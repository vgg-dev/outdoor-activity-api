const express = require("express");
const cors = require("cors");
const {
  port,
  corsOrigins,
  rateLimitWindowMs,
  rateLimitMaxRequests,
  recommendationCacheTtlMs,
} = require("./config");
const {
  getHourlyForecast,
  getPointMetadata,
  getRelativeLocation,
  getActiveAlerts,
  isHighRiskAlert,
} = require("./services/weatherGov");
const { getAirQuality, getAqiForTimestamp } = require("./services/airnow");
const { getUvForecastByZip, getUvForTimestamp } = require("./services/uv");
const { getMoonDataForHours } = require("./services/usno");
const { getCurrentAviationConditions } = require("./services/aviationWeather");
const { reverseGeocode, geocodeCityState } = require("./services/geocode");
const { scoreHour, topWindows, isSupportedActivity } = require("./scoring");
const {
  buildRecommendationCacheKeyWithPlace,
  parseCityState,
  parseLatLon,
  parseZip,
} = require("./requestUtils");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const recommendationBuckets = new Map();
const recommendationCache = new Map();

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function buildCorsOptions() {
  const allowAll = corsOrigins.length === 0;

  return {
    methods: ["GET"],
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowAll || corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin denied."));
    },
  };
}

function rateLimitRecommendations(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const bucket = recommendationBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const freshBucket = {
      count: 1,
      resetAt: now + rateLimitWindowMs,
    };
    recommendationBuckets.set(key, freshBucket);
    res.setHeader("X-RateLimit-Limit", String(rateLimitMaxRequests));
    res.setHeader("X-RateLimit-Remaining", String(rateLimitMaxRequests - freshBucket.count));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(freshBucket.resetAt / 1000)));
    return next();
  }

  if (bucket.count >= rateLimitMaxRequests) {
    res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({
      error: "Too many requests. Please try again later.",
    });
  }

  bucket.count += 1;
  res.setHeader("X-RateLimit-Limit", String(rateLimitMaxRequests));
  res.setHeader("X-RateLimit-Remaining", String(rateLimitMaxRequests - bucket.count));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  next();
}

function getCachedRecommendation(key) {
  const cached = recommendationCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    recommendationCache.delete(key);
    return null;
  }

  return cached.payload;
}

function setCachedRecommendation(key, payload) {
  recommendationCache.set(key, {
    payload,
    expiresAt: Date.now() + recommendationCacheTtlMs,
  });
}

app.use(cors(buildCorsOptions()));
app.use(securityHeaders);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "outdoor-activity-api" });
});

app.get("/location-search", rateLimitRecommendations, async (req, res) => {
  const search = parseCityState(req.query);
  if (!search) {
    return res.status(400).json({ error: "city and state are required." });
  }

  if (search.error) {
    return res.status(400).json({ error: search.error });
  }

  try {
    const result = await geocodeCityState(search.city, search.state);

    if (!result) {
      return res.status(404).json({ error: "Could not resolve the requested city and state." });
    }

    return res.json(result);
  } catch (error) {
    console.error("location_search_failed", {
      message: error.message,
      city: search.city,
      state: search.state,
    });
    return res.status(502).json({
      error: "Failed to search for the requested city and state.",
    });
  }
});

app.get("/recommendations", rateLimitRecommendations, async (req, res) => {
  const coords = parseLatLon(req.query);
  if (coords.error) {
    return res.status(400).json({ error: coords.error });
  }

  const zip = parseZip(req.query);
  if (zip === "__invalid__") {
    return res.status(400).json({ error: "zip must be a 5-digit US ZIP code." });
  }

  const activity = String(req.query.activity || "hike").toLowerCase();
  if (!isSupportedActivity(activity)) {
    return res.status(400).json({
      error: "Unsupported activity. Use one of: hike, bike, fishing, astronomy, drone.",
    });
  }

  const searchedCity = String(req.query.city || "").trim();
  const searchedState = String(req.query.state || "").trim();
  const hasRequestedPlace = Boolean(searchedCity && searchedState);

  const cacheKey = buildRecommendationCacheKeyWithPlace({
    lat: coords.lat,
    lon: coords.lon,
    zip,
    city: searchedCity,
    state: searchedState,
    activity,
  });
  const cached = getCachedRecommendation(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  try {
    const now = Date.now();
    const [pointMetadata, alerts, airQuality, geocodedLocation, aviation] = await Promise.all([
      getPointMetadata(coords.lat, coords.lon).catch(() => null),
      getActiveAlerts(coords.lat, coords.lon),
      getAirQuality(coords.lat, coords.lon),
      reverseGeocode(coords.lat, coords.lon).catch(() => null),
      ["drone", "astronomy"].includes(activity)
        ? getCurrentAviationConditions(coords.lat, coords.lon).catch(() => null)
        : Promise.resolve(null),
    ]);
    const [hourlyForecast, relativeLocation] = await Promise.all([
      getHourlyForecast(coords.lat, coords.lon, 24, pointMetadata),
      getRelativeLocation(coords.lat, coords.lon, pointMetadata).catch(() => null),
    ]);

    const searchLocation = hasRequestedPlace
      ? await geocodeCityState(searchedCity, searchedState).catch(() => null)
      : null;
    const resolvedLocation =
      searchLocation ||
      (relativeLocation?.displayName ? relativeLocation : geocodedLocation);
    const derivedZipLookup =
      !zip && resolvedLocation?.place && resolvedLocation?.state
        ? await geocodeCityState(resolvedLocation.place, resolvedLocation.state).catch(() => null)
        : null;
    const effectiveZip = zip || derivedZipLookup?.zip || null;
    const [uvForecast, moonData] = await Promise.all([
      getUvForecastByZip(effectiveZip),
      activity === "astronomy"
        ? getMoonDataForHours(hourlyForecast, coords.lat, coords.lon)
        : Promise.resolve({ source: "usno", dailyByDate: {} }),
    ]);

    const hasHighRiskAlert = alerts.some(isHighRiskAlert);

    const hourly = hourlyForecast
      .filter((hour) => Date.parse(hour.endTime) > now)
      .map((hour) => {
      const localDate = hour.startTime.slice(0, 10);
      const moonForDate = moonData.dailyByDate?.[localDate] || null;
      const aqi = getAqiForTimestamp(hour.startTime, airQuality);
      const uvIndex = getUvForTimestamp(hour.startTime, uvForecast);
      const scored = scoreHour(
        {
          ...hour,
          aqi,
          uvIndex,
          moonIlluminationPercent: moonForDate?.moonIlluminationPercent ?? null,
        },
        activity,
        { alerts, hasHighRiskAlert }
      );

      return {
        ...hour,
        aqi,
        uvIndex,
        moonIlluminationPercent: moonForDate?.moonIlluminationPercent ?? null,
        moonPhase: moonForDate?.moonPhase ?? null,
        score: scored.score,
        isHardStop: scored.isHardStop,
        reasons: scored.reasons,
      };
    });

    const recommendableHours = hourly.filter(
      (hour) => Date.parse(hour.endTime) > now
    );
    const recommendations = topWindows(recommendableHours, activity, 60, 3);
    const severeAlerts = alerts.filter(isHighRiskAlert);

    const payload = {
      generatedAt: new Date().toISOString(),
      location: {
        lat: coords.lat,
        lon: coords.lon,
        zip: effectiveZip,
        place: resolvedLocation?.place || null,
        state: resolvedLocation?.state || null,
        displayName: resolvedLocation?.displayName || null,
      },
      activity,
      warnings: {
        hasAnyAlert: alerts.length > 0,
        hasSevereAlert: severeAlerts.length > 0,
        hasHighRiskAlert,
        activeAlerts: alerts,
        severeAlerts,
      },
      airQuality,
      uv: uvForecast,
      astronomy: moonData,
      aviation,
      recommendations,
      hourly,
    };

    setCachedRecommendation(cacheKey, payload);
    res.setHeader("X-Cache", "MISS");
    return res.json(payload);
  } catch (error) {
    console.error("recommendations_failed", {
      message: error.message,
      activity,
      lat: coords.lat,
      lon: coords.lon,
      zip,
    });
    return res.status(502).json({
      error: "Failed to build recommendations from external APIs.",
    });
  }
});

app.use((error, _req, res, next) => {
  if (error && error.message === "CORS origin denied.") {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  return next(error);
});

app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
});

const { weatherGovUserAgent, upstreamTimeoutMs } = require("../config");

const WEATHER_GOV_BASE = "https://api.weather.gov";

async function weatherGovFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": weatherGovUserAgent,
        Accept: "application/geo+json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Weather.gov request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Weather.gov request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function parseWindMph(windSpeedText) {
  if (!windSpeedText) return 0;

  const matches = String(windSpeedText).match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  return Math.max(...matches.map(Number));
}

function parseWindGustMph(text) {
  const normalized = String(text || "").toLowerCase();
  const gustMatch =
    normalized.match(/gusts?\s+(?:up to\s+)?(\d+)/) ||
    normalized.match(/gusts?\s+as high as\s+(\d+)/) ||
    normalized.match(/gusts?\s+(\d+)/);

  if (!gustMatch) {
    return null;
  }

  const gust = Number(gustMatch[1]);
  return Number.isFinite(gust) ? gust : null;
}

function toUtcHourKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 13);
}

function parseIsoDurationHours(durationText) {
  const normalized = String(durationText || "");
  const match = normalized.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/
  );

  if (!match) {
    return 0;
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);

  return days * 24 + hours + (minutes > 0 ? 1 : 0);
}

function kmhToMph(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 0.621371);
}

function celsiusToFahrenheit(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round((value * 9) / 5 + 32);
}

function buildGridHourlyLookup(gridSeries = {}, valueMapper = (value) => value) {
  const values = Array.isArray(gridSeries.values) ? gridSeries.values : [];
  const lookup = new Map();

  for (const entry of values) {
    if (!entry || typeof entry.validTime !== "string") {
      continue;
    }

    const [startText, durationText = "PT1H"] = entry.validTime.split("/");
    const start = new Date(startText);
    const hours = Math.max(1, parseIsoDurationHours(durationText));
    const mappedValue = valueMapper(entry.value);

    if (Number.isNaN(start.getTime()) || mappedValue === null) {
      continue;
    }

    for (let hourOffset = 0; hourOffset < hours; hourOffset += 1) {
      const instant = new Date(start.getTime() + hourOffset * 60 * 60 * 1000);
      const key = toUtcHourKey(instant);
      if (key) {
        lookup.set(key, mappedValue);
      }
    }
  }

  return lookup;
}

async function getGridData(pointsData) {
  const forecastGridDataUrl = pointsData?.properties?.forecastGridData;

  if (!forecastGridDataUrl) {
    return null;
  }

  return weatherGovFetch(forecastGridDataUrl);
}

async function getHourlyForecast(lat, lon, hours = 24, pointsData = null) {
  const resolvedPoints = pointsData || (await getPointMetadata(lat, lon));
  const forecastHourlyUrl = resolvedPoints?.properties?.forecastHourly;

  if (!forecastHourlyUrl) {
    throw new Error("Could not resolve forecastHourly URL from points endpoint.");
  }

  const forecastData = await weatherGovFetch(forecastHourlyUrl);
  const gridData = await getGridData(resolvedPoints).catch(() => null);
  const windGustLookup = buildGridHourlyLookup(
    gridData?.properties?.windGust,
    kmhToMph
  );
  const apparentTemperatureLookup = buildGridHourlyLookup(
    gridData?.properties?.apparentTemperature,
    celsiusToFahrenheit
  );
  const periods = forecastData?.properties?.periods || [];

  return periods.slice(0, hours).map((period) => ({
    startTime: period.startTime,
    endTime: period.endTime,
    isDaytime: period.isDaytime,
    temperatureF: period.temperature,
    feelsLikeF: apparentTemperatureLookup.get(toUtcHourKey(period.startTime)) ?? null,
    windSpeedMph: parseWindMph(period.windSpeed),
    windGustMph:
      windGustLookup.get(toUtcHourKey(period.startTime)) ??
      parseWindGustMph(period.detailedForecast || period.shortForecast),
    windDirection: period.windDirection,
    shortForecast: period.shortForecast,
    precipitationChance:
      period.probabilityOfPrecipitation &&
      typeof period.probabilityOfPrecipitation.value === "number"
        ? period.probabilityOfPrecipitation.value
        : null,
    relativeHumidity:
      period.relativeHumidity &&
      typeof period.relativeHumidity.value === "number"
        ? period.relativeHumidity.value
        : null,
  }));
}

async function getRelativeLocation(lat, lon, pointsData = null) {
  const resolvedPoints = pointsData || (await getPointMetadata(lat, lon));
  const relativeLocation = resolvedPoints?.properties?.relativeLocation?.properties;

  if (!relativeLocation) {
    return {
      place: null,
      state: null,
      displayName: null,
    };
  }

  const place = relativeLocation.city || null;
  const state = relativeLocation.state || null;

  return {
    place,
    state,
    displayName: [place, state].filter(Boolean).join(", ") || null,
  };
}

async function getPointMetadata(lat, lon) {
  const pointsUrl = `${WEATHER_GOV_BASE}/points/${lat},${lon}`;
  return weatherGovFetch(pointsUrl);
}

async function getActiveAlerts(lat, lon) {
  const url = `${WEATHER_GOV_BASE}/alerts/active?point=${lat},${lon}`;
  const data = await weatherGovFetch(url);
  const features = data?.features || [];

  return features.map((feature) => {
    const props = feature.properties || {};
    return {
      id: feature.id,
      event: props.event,
      severity: props.severity,
      urgency: props.urgency,
      headline: props.headline,
      onset: props.onset || props.effective || null,
      expires: props.expires || props.ends || null,
    };
  }).filter(isUserFacingAlert);
}

function isUserFacingAlert(alert = {}) {
  const event = String(alert.event || "").toLowerCase();
  const headline = String(alert.headline || "").toLowerCase();
  const id = String(alert.id || "").toLowerCase();
  const severity = String(alert.severity || "").toLowerCase();
  const urgency = String(alert.urgency || "").toLowerCase();

  if (event === "test message") {
    return false;
  }

  if (id.includes("keepalive") || headline.includes("keepalive")) {
    return false;
  }

  if (
    !headline &&
    (severity === "unknown" || severity === "") &&
    (urgency === "unknown" || urgency === "")
  ) {
    return false;
  }

  return true;
}

function isHighRiskAlert(alert = {}) {
  const event = String(alert.event || "").toLowerCase();
  const headline = String(alert.headline || "").toLowerCase();
  const joined = `${event} ${headline}`;

  return [
    "tornado warning",
    "severe thunderstorm warning",
    "flash flood warning",
    "blizzard warning",
    "extreme heat warning",
    "red flag warning",
    "dust storm warning",
    "ice storm warning",
    "high wind warning",
    "hurricane warning",
  ].some((term) => joined.includes(term));
}

module.exports = {
  getPointMetadata,
  getHourlyForecast,
  getRelativeLocation,
  getActiveAlerts,
  isUserFacingAlert,
  isHighRiskAlert,
  __testables: {
    buildGridHourlyLookup,
    celsiusToFahrenheit,
    kmhToMph,
    parseWindGustMph,
    parseIsoDurationHours,
    toUtcHourKey,
  },
};

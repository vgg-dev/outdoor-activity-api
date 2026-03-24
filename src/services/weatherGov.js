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

async function getHourlyForecast(lat, lon, hours = 24, pointsData = null) {
  const resolvedPoints = pointsData || (await getPointMetadata(lat, lon));
  const forecastHourlyUrl = resolvedPoints?.properties?.forecastHourly;

  if (!forecastHourlyUrl) {
    throw new Error("Could not resolve forecastHourly URL from points endpoint.");
  }

  const forecastData = await weatherGovFetch(forecastHourlyUrl);
  const periods = forecastData?.properties?.periods || [];

  return periods.slice(0, hours).map((period) => ({
    startTime: period.startTime,
    endTime: period.endTime,
    isDaytime: period.isDaytime,
    temperatureF: period.temperature,
    windSpeedMph: parseWindMph(period.windSpeed),
    windGustMph: parseWindGustMph(period.detailedForecast || period.shortForecast),
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
  const severity = String(alert.severity || "").toLowerCase();
  const event = String(alert.event || "").toLowerCase();
  const headline = String(alert.headline || "").toLowerCase();
  const joined = `${event} ${headline}`;

  if (["severe", "extreme"].includes(severity)) {
    return true;
  }

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
    parseWindGustMph,
  },
};

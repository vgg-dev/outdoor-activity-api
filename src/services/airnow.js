const { airnowApiKey, upstreamTimeoutMs } = require("../config");

const AIRNOW_BASE = "https://www.airnowapi.org";

async function airnowFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`AirNow request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AirNow request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function toYmd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function getAirQuality(lat, lon) {
  if (!airnowApiKey) {
    return {
      source: "airnow",
      note: "AIRNOW_API_KEY not configured",
      currentAqi: null,
      dailyForecastByDate: {},
    };
  }

  const forecastUrl = `${AIRNOW_BASE}/aq/forecast/latLong/?format=application/json&latitude=${lat}&longitude=${lon}&date=${toYmd()}&distance=25&API_KEY=${airnowApiKey}`;
  const currentUrl = `${AIRNOW_BASE}/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=25&API_KEY=${airnowApiKey}`;

  const [forecastRows, currentRows] = await Promise.all([
    airnowFetch(forecastUrl).catch(() => []),
    airnowFetch(currentUrl).catch(() => []),
  ]);

  const dailyForecastByDate = {};
  for (const row of forecastRows) {
    if (!row || !row.DateForecast || typeof row.AQI !== "number") continue;
    const key = row.DateForecast.slice(0, 10);
    dailyForecastByDate[key] = Math.max(dailyForecastByDate[key] || 0, row.AQI);
  }

  let currentAqi = null;
  for (const row of currentRows) {
    if (row && typeof row.AQI === "number") {
      currentAqi = Math.max(currentAqi || 0, row.AQI);
    }
  }

  return {
    source: "airnow",
    currentAqi,
    dailyForecastByDate,
  };
}

function getAqiForTimestamp(isoTimestamp, aq) {
  const dateKey = String(isoTimestamp).slice(0, 10);
  return aq.dailyForecastByDate[dateKey] ?? aq.currentAqi ?? null;
}

module.exports = {
  getAirQuality,
  getAqiForTimestamp,
};

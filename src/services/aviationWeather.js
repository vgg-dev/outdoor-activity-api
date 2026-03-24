const zlib = require("node:zlib");
const { upstreamTimeoutMs, weatherGovUserAgent } = require("../config");

const AVIATION_BASE = "https://aviationweather.gov/api/data";
const STATION_CACHE_URL = "https://aviationweather.gov/data/cache/stations.cache.json.gz";
const STATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let stationCache = {
  loadedAt: 0,
  stations: [],
};

function decodeGzipJson(buffer) {
  const unzipped = zlib.gunzipSync(buffer);
  return JSON.parse(unzipped.toString("utf8"));
}

async function aviationFetch(url, responseType = "json") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": weatherGovUserAgent,
        Accept: responseType === "buffer" ? "*/*" : "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Aviation Weather request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Aviation Weather request failed (${response.status}): ${body}`);
  }

  if (responseType === "buffer") {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return response.json();
}

function hasMetarCapability(station = {}) {
  return Boolean(
    Array.isArray(station.siteType) &&
      station.siteType.includes("METAR") &&
      station.icaoId
  );
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadStationCache() {
  if (
    stationCache.stations.length > 0 &&
    Date.now() - stationCache.loadedAt < STATION_CACHE_TTL_MS
  ) {
    return stationCache.stations;
  }

  const gzipped = await aviationFetch(STATION_CACHE_URL, "buffer");
  const stations = decodeGzipJson(gzipped).filter(hasMetarCapability);

  stationCache = {
    loadedAt: Date.now(),
    stations,
  };

  return stations;
}

async function findNearestMetarStation(lat, lon) {
  const stations = await loadStationCache();
  let nearest = null;

  for (const station of stations) {
    const distance = distanceMiles(lat, lon, Number(station.lat), Number(station.lon));

    if (!nearest || distance < nearest.distanceMiles) {
      nearest = {
        icaoId: station.icaoId,
        site: station.site,
        state: station.state || null,
        lat: Number(station.lat),
        lon: Number(station.lon),
        distanceMiles: Math.round(distance * 10) / 10,
      };
    }
  }

  return nearest;
}

function parseVisibilityMiles(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  if (/^\d+(?:\.\d+)?\+$/.test(text)) {
    return Number(text.replace("+", ""));
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(/\s+/);
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+\/\d+$/.test(parts[1])) {
    const [num, den] = parts[1].split("/").map(Number);
    return Number(parts[0]) + num / den;
  }

  if (/^\d+\/\d+$/.test(text)) {
    const [num, den] = text.split("/").map(Number);
    return den ? num / den : null;
  }

  return null;
}

async function getCurrentAviationConditions(lat, lon) {
  const station = await findNearestMetarStation(lat, lon);
  if (!station?.icaoId) {
    return {
      source: "aviationweather",
      station: null,
      visibilityMiles: null,
      flightCategory: null,
      observedAt: null,
    };
  }

  const metarUrl = `${AVIATION_BASE}/metar?ids=${encodeURIComponent(station.icaoId)}&format=json`;
  const observations = await aviationFetch(metarUrl);
  const observation = Array.isArray(observations) ? observations[0] : null;

  return {
    source: "aviationweather",
    station,
    visibilityMiles: parseVisibilityMiles(observation?.visib),
    flightCategory: observation?.fltCat || null,
    observedAt: observation?.reportTime || null,
  };
}

module.exports = {
  getCurrentAviationConditions,
  __testables: {
    distanceMiles,
    hasMetarCapability,
    parseVisibilityMiles,
  },
};

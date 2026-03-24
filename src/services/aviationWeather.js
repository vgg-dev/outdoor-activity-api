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

function hasTafCapability(station = {}) {
  return Boolean(
    Array.isArray(station.siteType) &&
      station.siteType.includes("TAF") &&
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
  const stations = decodeGzipJson(gzipped).filter((station) =>
    hasMetarCapability(station) || hasTafCapability(station)
  );

  stationCache = {
    loadedAt: Date.now(),
    stations,
  };

  return stations;
}

async function findNearestStations(lat, lon, predicate, limit = 5) {
  const stations = await loadStationCache();
  const matches = [];

  for (const station of stations) {
    if (!predicate(station)) {
      continue;
    }

    const distance = distanceMiles(lat, lon, Number(station.lat), Number(station.lon));
    matches.push({
      icaoId: station.icaoId,
      site: station.site,
      state: station.state || null,
      lat: Number(station.lat),
      lon: Number(station.lon),
      distanceMiles: Math.round(distance * 10) / 10,
    });
  }

  return matches.sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, limit);
}

async function findNearestMetarStation(lat, lon) {
  const stations = await findNearestStations(lat, lon, hasMetarCapability, 1);
  return stations[0] || null;
}

async function findNearestTafStation(lat, lon) {
  const stations = await findNearestStations(lat, lon, hasTafCapability, 1);
  return stations[0] || null;
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

function getLowestCeilingFeet(clouds = []) {
  const layers = Array.isArray(clouds) ? clouds : [];
  const ceilingCovers = new Set(["BKN", "OVC", "OVX"]);
  const bases = layers
    .filter((layer) => ceilingCovers.has(String(layer?.cover || "").toUpperCase()))
    .map((layer) => Number(layer.base))
    .filter((value) => Number.isFinite(value));

  if (bases.length === 0) {
    return null;
  }

  return Math.min(...bases);
}

function deriveFlightCategory(visibilityMiles, ceilingFeet) {
  if (
    (typeof visibilityMiles === "number" && visibilityMiles < 1) ||
    (typeof ceilingFeet === "number" && ceilingFeet < 500)
  ) {
    return "LIFR";
  }

  if (
    (typeof visibilityMiles === "number" && visibilityMiles < 3) ||
    (typeof ceilingFeet === "number" && ceilingFeet < 1000)
  ) {
    return "IFR";
  }

  if (
    (typeof visibilityMiles === "number" && visibilityMiles <= 5) ||
    (typeof ceilingFeet === "number" && ceilingFeet <= 3000)
  ) {
    return "MVFR";
  }

  return "VFR";
}

async function getCurrentAviationConditions(lat, lon) {
  const stations = await findNearestStations(lat, lon, hasMetarCapability, 5);
  if (stations.length === 0) {
    return {
      source: "aviationweather",
      station: null,
      visibilityMiles: null,
      flightCategory: null,
      observedAt: null,
    };
  }

  for (const station of stations) {
    const metarUrl = `${AVIATION_BASE}/metar?ids=${encodeURIComponent(station.icaoId)}&format=json`;
    let observations;

    try {
      observations = await aviationFetch(metarUrl);
    } catch {
      continue;
    }

    const observation = Array.isArray(observations) ? observations[0] : null;
    if (!observation) {
      continue;
    }

    return {
      source: "aviationweather",
      station,
      visibilityMiles: parseVisibilityMiles(observation?.visib),
      flightCategory: observation?.fltCat || null,
      observedAt: observation?.reportTime || null,
    };
  }

  return {
    source: "aviationweather",
    station: stations[0] || null,
    visibilityMiles: null,
    flightCategory: null,
    observedAt: null,
  };
}

async function getAviationForecast(lat, lon) {
  const station = await findNearestTafStation(lat, lon);
  if (!station?.icaoId) {
    return {
      source: "aviationweather",
      station: null,
      issuedAt: null,
      periods: [],
    };
  }

  const tafUrl = `${AVIATION_BASE}/taf?ids=${encodeURIComponent(station.icaoId)}&format=json`;
  const tafs = await aviationFetch(tafUrl);
  const taf = Array.isArray(tafs) ? tafs[0] : null;
  const periods = Array.isArray(taf?.fcsts)
    ? taf.fcsts.map((period) => {
        const visibilityMiles = parseVisibilityMiles(period.visib);
        const ceilingFeet = getLowestCeilingFeet(period.clouds);

        return {
          startTime: period.timeFrom
            ? new Date(period.timeFrom * 1000).toISOString()
            : null,
          endTime: period.timeTo
            ? new Date(period.timeTo * 1000).toISOString()
            : null,
          visibilityMiles,
          ceilingFeet,
          flightCategory:
            deriveFlightCategory(visibilityMiles, ceilingFeet),
          windSpeedMph:
            typeof period.wspd === "number" ? Number(period.wspd) : null,
          windGustMph:
            typeof period.wgst === "number" ? Number(period.wgst) : null,
          weather: period.wxString || null,
        };
      })
    : [];

  return {
    source: "aviationweather",
    station,
    issuedAt: taf?.issueTime || null,
    periods,
  };
}

module.exports = {
  getAviationForecast,
  getCurrentAviationConditions,
  __testables: {
    deriveFlightCategory,
    distanceMiles,
    findNearestStations,
    hasMetarCapability,
    hasTafCapability,
    getLowestCeilingFeet,
    parseVisibilityMiles,
  },
};

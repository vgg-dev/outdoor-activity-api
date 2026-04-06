const CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder";
const ZIPPOTAM_BASE = "https://api.zippopotam.us/us";
const { upstreamTimeoutMs } = require("../config");

const STATE_ABBREVIATIONS = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

async function geocodeFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Census geocoder request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Census geocoder request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function zippotamFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Zippopotam request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zippopotam request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function firstName(entry) {
  if (!entry) return null;
  return entry.NAME || entry.BASENAME || entry.NAMELSAD || null;
}

function pickPlaceName(geographies = {}) {
  const preferredLayers = [
    "Incorporated Places",
    "Census Designated Places",
    "County Subdivisions",
  ];

  for (const layer of preferredLayers) {
    const match = geographies[layer]?.[0];
    const name = firstName(match);
    if (name) {
      return name;
    }
  }

  for (const entries of Object.values(geographies)) {
    const match = Array.isArray(entries) ? entries[0] : null;
    const name = firstName(match);
    if (name) {
      return name;
    }
  }

  return null;
}

function pickStateName(geographies = {}) {
  const state = geographies.States?.[0];
  return firstName(state);
}

function cleanMatchCoordinates(coordinates = {}) {
  const x = Number(coordinates.x);
  const y = Number(coordinates.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    lat: y,
    lon: x,
  };
}

function normalizeStateInput(state) {
  const text = String(state || "").trim();
  if (!text) return null;

  if (/^[A-Za-z]{2}$/.test(text)) {
    return text.toUpperCase();
  }

  return STATE_ABBREVIATIONS[text.toLowerCase()] || null;
}

function normalizePlaceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickBestZippopotamPlace(city, places = []) {
  if (!Array.isArray(places) || places.length === 0) {
    return null;
  }

  const target = normalizePlaceName(city);
  const scoredPlaces = places
    .map((place) => {
      const placeName = String(place?.["place name"] || "").trim();
      const normalized = normalizePlaceName(placeName);

      let rank = 4;
      if (normalized === target) {
        rank = 0;
      } else if (normalized.startsWith(target)) {
        rank = 1;
      } else if (normalized.includes(target)) {
        rank = 2;
      } else if (target.includes(normalized)) {
        rank = 3;
      }

      return {
        place,
        rank,
        nameLength: placeName.length,
      };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }

      return a.nameLength - b.nameLength;
    });

  return scoredPlaces[0]?.place || null;
}

async function reverseGeocode(lat, lon) {
  const query = new URLSearchParams({
    x: String(lon),
    y: String(lat),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  const url = `${CENSUS_GEOCODER_BASE}/geographies/coordinates?${query.toString()}`;
  const data = await geocodeFetch(url);
  const result = data?.result || {};
  const geographies = result.geographies || {};

  const place = pickPlaceName(geographies);
  const state = pickStateName(geographies);
  const displayName = [place, state].filter(Boolean).join(", ");

  return {
    place: place || null,
    state: state || null,
    displayName: displayName || null,
  };
}

async function geocodeCityStateWithCensus(city, stateCode) {
  const address = `${city}, ${stateCode}`;
  const query = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  const url = `${CENSUS_GEOCODER_BASE}/locations/onelineaddress?${query.toString()}`;
  const data = await geocodeFetch(url).catch(() => null);
  const matches = data?.result?.addressMatches || [];
  const firstMatch = matches[0];
  const coordinates = cleanMatchCoordinates(firstMatch?.coordinates);

  if (!firstMatch || !coordinates) {
    return null;
  }

  const matchedAddress = String(firstMatch.matchedAddress || "").trim();

  return {
    city,
    state: stateCode,
    displayName: `${city}, ${stateCode}`,
    lat: coordinates.lat,
    lon: coordinates.lon,
    zip: null,
    matchedAddress,
  };
}

async function geocodeCityState(city, state) {
  const cityText = String(city || "").trim();
  const stateCode = normalizeStateInput(state);

  if (!cityText || !stateCode) {
    return null;
  }

  const citySlug = encodeURIComponent(cityText.toLowerCase());
  const url = `${ZIPPOTAM_BASE}/${stateCode.toLowerCase()}/${citySlug}`;
  const data = await zippotamFetch(url);
  const places = data?.places || [];
  const firstPlace = pickBestZippopotamPlace(cityText, places);

  if (!data || !firstPlace) {
    return geocodeCityStateWithCensus(cityText, stateCode);
  }
  const lat = Number(firstPlace.latitude);
  const lon = Number(firstPlace.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return geocodeCityStateWithCensus(cityText, stateCode);
  }

  const place = String(firstPlace["place name"] || cityText).trim();
  const normalizedState =
    String(data["state abbreviation"] || stateCode).trim().toUpperCase();
  const zip = String(firstPlace["post code"] || "").trim() || null;
  const matchedAddress = `${place}, ${normalizedState}`;

  return {
    city: place,
    state: normalizedState,
    displayName: `${place}, ${normalizedState}`,
    lat,
    lon,
    zip,
    matchedAddress,
  };
}

module.exports = {
  reverseGeocode,
  geocodeCityState,
  __testables: {
    normalizePlaceName,
    pickBestZippopotamPlace,
  },
};

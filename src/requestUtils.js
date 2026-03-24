function normalizeCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

function buildRecommendationCacheKeyWithPlace({
  lat,
  lon,
  zip,
  city,
  state,
  activity,
}) {
  return JSON.stringify({
    lat: normalizeCoordinate(lat),
    lon: normalizeCoordinate(lon),
    zip: zip || "",
    city: String(city || "").trim().toLowerCase(),
    state: String(state || "").trim().toLowerCase(),
    activity,
  });
}

function parseLatLon(query) {
  const lat = Number(query.lat);
  const lon = Number(query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: "Query params lat and lon are required numeric values." };
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: "lat must be [-90..90] and lon must be [-180..180]." };
  }

  return { lat, lon };
}

function parseZip(query) {
  const zip = query.zip ? String(query.zip).trim() : "";
  if (!zip) return null;
  return /^\d{5}$/.test(zip) ? zip : "__invalid__";
}

function parseCityState(query) {
  const city = String(query.city || "").trim();
  const state = String(query.state || "").trim();

  if (!city && !state) {
    return null;
  }

  if (!city || !state) {
    return { error: "city and state are both required for city search." };
  }

  if (!/^[A-Za-z .'-]{2,}$/.test(city)) {
    return { error: "city must contain only letters, spaces, periods, apostrophes, or hyphens." };
  }

  if (!/^[A-Za-z ]{2,}$/.test(state)) {
    return { error: "state must be a 2-letter abbreviation or state name." };
  }

  return { city, state };
}

module.exports = {
  buildRecommendationCacheKeyWithPlace,
  normalizeCoordinate,
  parseCityState,
  parseLatLon,
  parseZip,
};

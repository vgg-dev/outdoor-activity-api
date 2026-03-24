const assert = require("node:assert/strict");

const {
  getUvForTimestamp,
  __testables,
} = require("../src/services/uv");
const { scoreHour } = require("../src/scoring");
const { __testables: weatherGovTestables } = require("../src/services/weatherGov");
const {
  buildRecommendationCacheKeyWithPlace,
  parseCityState,
} = require("../src/requestUtils");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("maps EPA local-hour rows to hourly timestamps without timezone drift", () => {
  const uvForecast = __testables.buildUvForecastFromRows([
    { DATE_TIME: "Mar/24/2026 3 PM", UV_VALUE: "4" },
    { DATE_TIME: "Mar/24/2026 4 PM", UV_VALUE: "3" },
    { DATE_TIME: "Mar/24/2026 5 PM", UV_VALUE: "1" },
  ]);

  assert.equal(getUvForTimestamp("2026-03-24T15:00:00-04:00", uvForecast), 4);
  assert.equal(getUvForTimestamp("2026-03-24T16:00:00-04:00", uvForecast), 3);
  assert.equal(getUvForTimestamp("2026-03-24T17:00:00-04:00", uvForecast), 1);
});

run("returns null for unmatched or malformed timestamps", () => {
  const uvForecast = __testables.buildUvForecastFromRows([
    { DATE_TIME: "Mar/24/2026 3 PM", UV_VALUE: "4" },
  ]);

  assert.equal(getUvForTimestamp("not-a-timestamp", uvForecast), null);
  assert.equal(getUvForTimestamp("2026-03-24T18:00:00-04:00", uvForecast), null);
});

run("parses 12 AM and 12 PM correctly from EPA hour strings", () => {
  assert.deepEqual(__testables.parseLocalHourParts("Mar/24/2026 12 AM"), {
    year: 2026,
    month: 3,
    day: 24,
    hour: 0,
  });

  assert.deepEqual(__testables.parseLocalHourParts("Mar/24/2026 12 PM"), {
    year: 2026,
    month: 3,
    day: 24,
    hour: 12,
  });
});

run("accepts multi-word state names in city search parsing", () => {
  assert.deepEqual(parseCityState({ city: "New York", state: "New York" }), {
    city: "New York",
    state: "New York",
  });
});

run("keeps explicit city/state requests in separate cache entries", () => {
  const explicit = buildRecommendationCacheKeyWithPlace({
    lat: 39.1434,
    lon: -77.189,
    zip: "20877",
    city: "Gaithersburg",
    state: "MD",
    activity: "bike",
  });

  const inferred = buildRecommendationCacheKeyWithPlace({
    lat: 39.1434,
    lon: -77.189,
    zip: "20877",
    city: "",
    state: "",
    activity: "bike",
  });

  assert.notEqual(explicit, inferred);
});

run("parses wind gusts from forecast text", () => {
  assert.equal(
    weatherGovTestables.parseWindGustMph("Sunny. Gusts up to 24 mph."),
    24
  );
  assert.equal(
    weatherGovTestables.parseWindGustMph("Mostly clear with gusts as high as 18 mph."),
    18
  );
  assert.equal(weatherGovTestables.parseWindGustMph("Calm and clear."), null);
});

run("maps structured Weather.gov wind gust grid values to hourly UTC keys", () => {
  const lookup = weatherGovTestables.buildGridHourlyLookup({
    values: [
      { validTime: "2026-03-24T18:00:00+00:00/PT2H", value: 32.187 },
      { validTime: "2026-03-24T20:00:00+00:00/PT1H", value: 24.14 },
    ],
  });

  assert.equal(lookup.get("2026-03-24T18"), 20);
  assert.equal(lookup.get("2026-03-24T19"), 20);
  assert.equal(lookup.get("2026-03-24T20"), 15);
});

run("parses ISO duration hours for grid intervals", () => {
  assert.equal(weatherGovTestables.parseIsoDurationHours("PT1H"), 1);
  assert.equal(weatherGovTestables.parseIsoDurationHours("PT3H"), 3);
  assert.equal(weatherGovTestables.parseIsoDurationHours("P1DT2H"), 26);
  assert.equal(weatherGovTestables.parseIsoDurationHours("PT30M"), 1);
});

run("penalizes drone hours with strong gusts", () => {
  const result = scoreHour(
    {
      temperatureF: 68,
      windSpeedMph: 9,
      windGustMph: 26,
      precipitationChance: 0,
      aqi: 25,
      uvIndex: 2,
      isDaytime: true,
      shortForecast: "Sunny",
    },
    "drone",
    { alerts: [], hasHighRiskAlert: false }
  );

  assert.equal(result.isHardStop, true);
  assert.ok(result.reasons.includes("Gusts may be uncomfortable"));
});

console.log("All tests passed.");

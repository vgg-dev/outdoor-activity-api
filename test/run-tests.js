const assert = require("node:assert/strict");

const {
  getUvForTimestamp,
  __testables,
} = require("../src/services/uv");
const { scoreHour } = require("../src/scoring");
const { __testables: aviationTestables } = require("../src/services/aviationWeather");
const { __testables: weatherGovTestables } = require("../src/services/weatherGov");
const { __testables: usnoTestables } = require("../src/services/usno");
const {
  buildRecommendationCacheKeyWithPlace,
  normalizeCoordinate,
  parseCityState,
} = require("../src/requestUtils");
const { __testables: serverTestables } = require("../src/server");

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

run("keeps nearby coordinates in separate cache entries", () => {
  const first = buildRecommendationCacheKeyWithPlace({
    lat: 39.14191,
    lon: -77.18901,
    zip: "",
    city: "",
    state: "",
    activity: "hike",
  });

  const second = buildRecommendationCacheKeyWithPlace({
    lat: 39.14194,
    lon: -77.18904,
    zip: "",
    city: "",
    state: "",
    activity: "hike",
  });

  assert.notEqual(first, second);
  assert.equal(normalizeCoordinate(39.14191), "39.14191");
  assert.equal(normalizeCoordinate(-77.18904), "-77.18904");
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
  const lookup = weatherGovTestables.buildGridHourlyLookup(
    {
      values: [
        { validTime: "2026-03-24T18:00:00+00:00/PT2H", value: 32.187 },
        { validTime: "2026-03-24T20:00:00+00:00/PT1H", value: 24.14 },
      ],
    },
    weatherGovTestables.kmhToMph
  );

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

run("converts structured apparent temperature from celsius to fahrenheit", () => {
  const lookup = weatherGovTestables.buildGridHourlyLookup(
    {
      values: [{ validTime: "2026-03-24T18:00:00+00:00/PT1H", value: 10 }],
    },
    weatherGovTestables.celsiusToFahrenheit
  );

  assert.equal(lookup.get("2026-03-24T18"), 50);
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

run("uses feels-like temperature when scoring comfort", () => {
  const result = scoreHour(
    {
      temperatureF: 58,
      feelsLikeF: 39,
      windSpeedMph: 8,
      windGustMph: 10,
      precipitationChance: 0,
      aqi: 25,
      uvIndex: 2,
      isDaytime: true,
      shortForecast: "Sunny",
    },
    "bike",
    { alerts: [], hasHighRiskAlert: false }
  );

  assert.ok(result.reasons.includes("Feels cooler than preferred"));
});

run("parses USNO illumination percentages and local offsets", () => {
  assert.equal(usnoTestables.parseFractionIllumination("37%"), 37);
  assert.equal(usnoTestables.parseFractionIllumination("12.6%"), 13);
  assert.deepEqual(
    usnoTestables.getLocalDateAndOffset("2026-03-24T23:00:00-04:00"),
    { date: "2026-03-24", tz: -4 }
  );
});

run("penalizes astronomy hours with bright moonlight", () => {
  const brightMoon = scoreHour(
    {
      temperatureF: 52,
      feelsLikeF: 50,
      windSpeedMph: 4,
      windGustMph: 6,
      precipitationChance: 0,
      aqi: 18,
      uvIndex: null,
      isDaytime: false,
      shortForecast: "Clear",
      moonIlluminationPercent: 88,
    },
    "astronomy",
    { alerts: [], hasHighRiskAlert: false }
  );

  const darkMoon = scoreHour(
    {
      temperatureF: 52,
      feelsLikeF: 50,
      windSpeedMph: 4,
      windGustMph: 6,
      precipitationChance: 0,
      aqi: 18,
      uvIndex: null,
      isDaytime: false,
      shortForecast: "Clear",
      moonIlluminationPercent: 8,
    },
    "astronomy",
    { alerts: [], hasHighRiskAlert: false }
  );

  assert.ok(brightMoon.score < darkMoon.score);
});

run("parses aviation visibility strings in miles", () => {
  assert.equal(aviationTestables.parseVisibilityMiles("10+"), 10);
  assert.equal(aviationTestables.parseVisibilityMiles("6"), 6);
  assert.equal(aviationTestables.parseVisibilityMiles("1 1/2"), 1.5);
  assert.equal(aviationTestables.parseVisibilityMiles("3/4"), 0.75);
});

run("filters stations for METAR capability", () => {
  assert.equal(
    aviationTestables.hasMetarCapability({
      icaoId: "KDCA",
      siteType: ["METAR", "TAF"],
    }),
    true
  );
  assert.equal(
    aviationTestables.hasMetarCapability({
      icaoId: null,
      siteType: ["METAR"],
    }),
    false
  );
});

run("filters stations for TAF capability", () => {
  assert.equal(
    aviationTestables.hasTafCapability({
      icaoId: "KDCA",
      siteType: ["METAR", "TAF"],
    }),
    true
  );
  assert.equal(
    aviationTestables.hasTafCapability({
      icaoId: "KABC",
      siteType: ["METAR"],
    }),
    false
  );
});

run("derives flight category from visibility and ceiling", () => {
  assert.equal(aviationTestables.deriveFlightCategory(10, 5000), "VFR");
  assert.equal(aviationTestables.deriveFlightCategory(4, 5000), "MVFR");
  assert.equal(aviationTestables.deriveFlightCategory(2, 1500), "IFR");
  assert.equal(aviationTestables.deriveFlightCategory(0.5, 400), "LIFR");
});

run("finds the lowest ceiling from broken and overcast layers", () => {
  assert.equal(
    aviationTestables.getLowestCeilingFeet([
      { cover: "FEW", base: 500 },
      { cover: "BKN", base: 2500 },
      { cover: "OVC", base: 1800 },
    ]),
    1800
  );
});

run("skips caching daytime payloads when UV series is empty", () => {
  assert.equal(
    serverTestables.shouldCachePayload({
      uv: { hourlyByTimestamp: {} },
      hourly: [
        { isDaytime: true, startTime: "2026-03-24T12:00:00-05:00" },
        { isDaytime: false, startTime: "2026-03-24T20:00:00-05:00" },
      ],
    }),
    false
  );

  assert.equal(
    serverTestables.shouldCachePayload({
      uv: { hourlyByTimestamp: {} },
      hourly: [{ isDaytime: false, startTime: "2026-03-24T20:00:00-05:00" }],
    }),
    true
  );
});

console.log("All tests passed.");

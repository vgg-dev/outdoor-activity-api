const assert = require("node:assert/strict");

const {
  getUvForTimestamp,
  __testables,
} = require("../src/services/uv");

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

console.log("All tests passed.");

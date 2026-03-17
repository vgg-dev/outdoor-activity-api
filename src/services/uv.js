const UV_BASE =
  "https://data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP";
const { upstreamTimeoutMs } = require("../config");

async function uvFetch(url) {
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
      throw new Error(`EPA UV request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`EPA UV request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function normalizeHourlyValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseLocalHour(dateTimeValue) {
  const text = String(dateTimeValue || "").trim();
  const match = text.match(
    /^([A-Za-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})\s+(AM|PM)$/
  );

  if (!match) return null;

  const [, monthText, dayText, yearText, hourText, meridiem] = match;
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const month = months[monthText];
  if (month === undefined) return null;

  let hour = Number(hourText);
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const date = new Date(
    Number(yearText),
    month,
    Number(dayText),
    hour,
    0,
    0,
    0
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

async function getUvForecastByZip(zip) {
  if (!zip || !/^\d{5}$/.test(String(zip))) {
    return {
      source: "epa-uv",
      hourlyByTimestamp: {},
    };
  }

  const url = `${UV_BASE}/${zip}/JSON`;
  const payload = await uvFetch(url).catch(() => []);
  const rows = Array.isArray(payload) ? payload : payload.value || [];
  const hourlyByTimestamp = {};

  for (const row of rows) {
    const hourDate = parseLocalHour(row.DATE_TIME);
    const uvIndex = normalizeHourlyValue(
      row.UV_VALUE ?? row.UVINDEX ?? row.UV_INDEX
    );

    if (!hourDate || uvIndex === null) continue;
    hourlyByTimestamp[hourDate.toISOString()] = uvIndex;
  }

  return {
    source: "epa-uv",
    hourlyByTimestamp,
  };
}

function getUvForTimestamp(isoTimestamp, uv) {
  const targetHour = new Date(isoTimestamp);
  if (Number.isNaN(targetHour.getTime())) {
    return null;
  }

  const targetKey = [
    targetHour.getFullYear(),
    targetHour.getMonth(),
    targetHour.getDate(),
    targetHour.getHours(),
  ].join("-");

  for (const [timestamp, uvValue] of Object.entries(uv.hourlyByTimestamp || {})) {
    const sourceHour = new Date(timestamp);
    if (Number.isNaN(sourceHour.getTime())) continue;

    const sourceKey = [
      sourceHour.getFullYear(),
      sourceHour.getMonth(),
      sourceHour.getDate(),
      sourceHour.getHours(),
    ].join("-");

    if (sourceKey === targetKey) {
      return uvValue;
    }
  }

  return null;
}

module.exports = {
  getUvForecastByZip,
  getUvForTimestamp,
};

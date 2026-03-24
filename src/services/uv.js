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

function parseLocalHourParts(dateTimeValue) {
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

  return {
    year: Number(yearText),
    month: month + 1,
    day: Number(dayText),
    hour,
  };
}

function toHourKey(parts) {
  if (!parts) return null;

  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");

  return `${year}-${month}-${day}-${hour}`;
}

function toHourTimestamp(parts) {
  if (!parts) return null;

  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00`;
}

function hourKeyFromIsoTimestamp(isoTimestamp) {
  const match = String(isoTimestamp || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/
  );

  if (!match) return null;

  const [, year, month, day, hour] = match;
  return `${year}-${month}-${day}-${hour}`;
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
  const hourlyByHourKey = {};

  for (const row of rows) {
    const hourParts = parseLocalHourParts(row.DATE_TIME);
    const uvIndex = normalizeHourlyValue(
      row.UV_VALUE ?? row.UVINDEX ?? row.UV_INDEX
    );

    if (!hourParts || uvIndex === null) continue;

    const hourKey = toHourKey(hourParts);
    const hourTimestamp = toHourTimestamp(hourParts);

    if (!hourKey || !hourTimestamp) continue;
    hourlyByHourKey[hourKey] = uvIndex;
    hourlyByTimestamp[hourTimestamp] = uvIndex;
  }

  return {
    source: "epa-uv",
    hourlyByTimestamp,
    hourlyByHourKey,
  };
}

function getUvForTimestamp(isoTimestamp, uv) {
  const targetKey = hourKeyFromIsoTimestamp(isoTimestamp);
  if (!targetKey) return null;

  return uv.hourlyByHourKey?.[targetKey] ?? null;
}

module.exports = {
  getUvForecastByZip,
  getUvForTimestamp,
};

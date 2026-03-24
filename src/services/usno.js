const { upstreamTimeoutMs } = require("../config");

const USNO_BASE = "https://aa.usno.navy.mil/api";

function parseFractionIllumination(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function parsePhenomena(list = []) {
  const items = Array.isArray(list) ? list : [];
  const rise = items.find((item) => item?.phen === "Rise")?.time || null;
  const set = items.find((item) => item?.phen === "Set")?.time || null;
  const transit = items.find((item) => item?.phen === "Upper Transit")?.time || null;

  return { rise, set, transit };
}

function getLocalDateAndOffset(isoTimestamp) {
  const match = String(isoTimestamp || "").match(
    /^(\d{4}-\d{2}-\d{2})T.*([+-])(\d{2}):(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const [, date, sign, hoursText, minutesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const magnitude = hours + minutes / 60;
  const offset = sign === "-" ? -magnitude : magnitude;

  return { date, tz: offset };
}

async function usnoFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "OutdoorTimeFinder/1.0 (vgg-dev@outlook.com)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`USNO request timed out after ${upstreamTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`USNO request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function getMoonDataForDate(date, lat, lon, tz) {
  const url =
    `${USNO_BASE}/rstt/oneday?date=${encodeURIComponent(date)}` +
    `&coords=${encodeURIComponent(`${lat},${lon}`)}` +
    `&tz=${encodeURIComponent(String(tz))}`;

  const response = await usnoFetch(url);
  const data = response?.properties?.data;

  if (!data) {
    return null;
  }

  return {
    date,
    moonPhase: data.curphase || null,
    moonIlluminationPercent: parseFractionIllumination(data.fracillum),
    closestPhase: data.closestphase?.phase || null,
    moonrise: parsePhenomena(data.moondata).rise,
    moonset: parsePhenomena(data.moondata).set,
    moonTransit: parsePhenomena(data.moondata).transit,
  };
}

async function getMoonDataForHours(hours = [], lat, lon) {
  const byDate = {};
  const requests = [];

  for (const hour of hours) {
    const localInfo = getLocalDateAndOffset(hour?.startTime);
    if (!localInfo || byDate[localInfo.date]) {
      continue;
    }

    byDate[localInfo.date] = null;
    requests.push(
      getMoonDataForDate(localInfo.date, lat, lon, localInfo.tz)
        .then((data) => {
          byDate[localInfo.date] = data;
        })
        .catch(() => {
          byDate[localInfo.date] = null;
        })
    );
  }

  await Promise.all(requests);

  return {
    source: "usno",
    dailyByDate: byDate,
  };
}

module.exports = {
  getMoonDataForHours,
  __testables: {
    getLocalDateAndOffset,
    parseFractionIllumination,
    parsePhenomena,
  },
};

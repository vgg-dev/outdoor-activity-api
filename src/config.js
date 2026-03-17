const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function parsePositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function parseCorsOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const port = parsePositiveInt(process.env.PORT, 3000);
const weatherGovUserAgent =
  process.env.WEATHER_GOV_UA || "OutdoorTimeApp/0.1 (dev@example.com)";
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const rateLimitWindowMs = parsePositiveInt(
  process.env.RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const rateLimitMaxRequests = parsePositiveInt(
  process.env.RATE_LIMIT_MAX_REQUESTS,
  60
);
const upstreamTimeoutMs = parsePositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 8000);
const recommendationCacheTtlMs = parsePositiveInt(
  process.env.RECOMMENDATION_CACHE_TTL_MS,
  5 * 60 * 1000
);

if (process.env.NODE_ENV === "production" && weatherGovUserAgent.includes("dev@example.com")) {
  throw new Error("WEATHER_GOV_UA must be set to a real contact in production.");
}

module.exports = {
  port,
  weatherGovUserAgent,
  airnowApiKey: process.env.AIRNOW_API_KEY || "",
  corsOrigins,
  rateLimitWindowMs,
  rateLimitMaxRequests,
  upstreamTimeoutMs,
  recommendationCacheTtlMs,
};

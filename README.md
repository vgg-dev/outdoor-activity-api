# Outdoor Activity API

[![release](https://img.shields.io/badge/release-v0.1.0--alpha-orange)](https://github.com/vgg-dev/outdoor-activity-api)
[![license](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](./package.json)
[![render](https://img.shields.io/badge/render-ready-46E3B7)](./render.yaml)

US-focused backend API for finding the best times to get outside.

It combines forecast, alerts, air quality, and UV data into activity-aware recommendation windows for:

- `bike`
- `hike`
- `fishing`
- `astronomy`
- `drone`

## Highlights

- Hour-by-hour scoring for the next 24 hours
- Top recommendation windows instead of single “best hours”
- Weather.gov alert awareness with high-risk filtering
- AirNow AQI integration
- EPA UV integration
- ZIP, city/state, and coordinate-based location workflows
- Render-friendly deployment and production hardening

## Data Sources

- [Weather.gov](https://www.weather.gov/documentation/services-web-api)
- [AirNow API](https://docs.airnowapi.org/)
- [EPA UV data](https://www.epa.gov/enviro/web-services)
- [Zippopotam.us](https://www.zippopotam.us/)
- [U.S. Census Geocoder](https://geocoding.geo.census.gov/)

## API Overview

### `GET /health`

Basic health check.

Example:

```bash
curl http://localhost:3000/health
```

### `GET /location-search?city=Gaithersburg&state=MD`

Resolves a US city/state pair to coordinates and, when available, ZIP.

Example response:

```json
{
  "city": "Gaithersburg",
  "state": "MD",
  "displayName": "Gaithersburg, MD",
  "lat": 39.1419,
  "lon": -77.189,
  "zip": "20877"
}
```

### `GET /recommendations`

Returns scored hourly forecast data plus top recommendation windows.

Example:

```bash
curl "http://localhost:3000/recommendations?lat=39.1419&lon=-77.189&zip=20877&city=Gaithersburg&state=MD&activity=bike"
```

Response includes:

- `location`
- `warnings`
- `airQuality`
- `uv`
- `recommendations`
- `hourly`

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy [`.env.example`](./.env.example) to `.env` and fill in values as needed.

```env
PORT=3000
NODE_ENV=production
WEATHER_GOV_UA=OutdoorTimeFinder/1.0 (your-email@example.com)
AIRNOW_API_KEY=your_airnow_api_key_here
CORS_ORIGINS=https://your-frontend.example.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=60
UPSTREAM_TIMEOUT_MS=8000
RECOMMENDATION_CACHE_TTL_MS=300000
```

Notes:

- `AIRNOW_API_KEY` is optional for local development, but AQI will be `null` without it.
- `WEATHER_GOV_UA` should include a real contact email in production.
- `CORS_ORIGINS` accepts a comma-separated allowlist of browser origins.

### 3. Run

```bash
npm start
```

### 4. Smoke test

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/location-search?city=Gaithersburg&state=MD"
curl "http://localhost:3000/recommendations?lat=39.1419&lon=-77.189&zip=20877&city=Gaithersburg&state=MD&activity=bike"
```

## Development

Run a quick code sanity check:

```bash
npm test
```

Current test coverage is lightweight and focused on syntax/entrypoint validation. Functional API smoke tests are still manual.

## Deploying to Render

This repo includes [render.yaml](./render.yaml), but the easiest path for most users is a standard Render Web Service.

### Option 1: Render Web Service

Use:

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Recommended environment variables:

```env
NODE_ENV=production
WEATHER_GOV_UA=OutdoorTimeFinder/1.0 (your-email@example.com)
AIRNOW_API_KEY=your_airnow_api_key_here
CORS_ORIGINS=https://your-frontend.example.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=60
UPSTREAM_TIMEOUT_MS=8000
RECOMMENDATION_CACHE_TTL_MS=300000
```

### Option 2: Render Blueprint

If your Render plan supports Blueprints, this repo is already set up for that via [render.yaml](./render.yaml).

## Production Hardening Included

- proxy-aware request handling
- configurable CORS allowlist
- basic security headers
- per-IP rate limiting
- upstream timeouts
- short-lived response caching
- safer external API error handling

## Project Structure

```text
src/
  config.js
  scoring.js
  server.js
  services/
    airnow.js
    geocode.js
    uv.js
    weatherGov.js
```

## License

ISC. See [LICENSE](./LICENSE).

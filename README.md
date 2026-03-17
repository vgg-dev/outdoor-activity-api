# Outdoor Activity API

[![release](https://img.shields.io/badge/release-v0.1.0--alpha-orange)](https://github.com/vgg-dev/outdoor-activity-api)
[![license](https://img.shields.io/badge/license-ISC-blue)](./package.json)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](./package.json)
[![render-ready](https://img.shields.io/badge/render-ready-46E3B7)](./render.yaml)

Backend API for finding the best times to do outdoor activities across the U.S.

It combines:

- Weather.gov hourly forecast
- Weather.gov active alerts
- AirNow AQI
- EPA UV data
- ZIP and city/state location search

Supported activities:

- `bike`
- `hike`
- `fishing`
- `astronomy`
- `drone`

## What It Does

Given a location and activity, the API returns:

- scored hourly forecast data
- top recommendation windows
- severe and advisory weather alerts
- air quality context
- UV exposure context

## Endpoints

### `GET /health`

Basic health check.

### `GET /location-search?city=Rockville&state=MD`

Resolves a U.S. city/state pair to coordinates and, when available, ZIP.

Example response:

```json
{
  "city": "Rockville",
  "state": "MD",
  "displayName": "Rockville, MD",
  "lat": 39.144,
  "lon": -77.2076,
  "zip": "20847"
}
```

### `GET /recommendations?lat=39.144&lon=-77.2076&zip=20847&city=Rockville&state=MD&activity=bike`

Returns the next 24 scored hours and the best recommendation windows for the selected activity.

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env` from [`.env.example`](./.env.example)

3. Start the server

```bash
npm start
```

4. Test locally

```bash
http://localhost:3000/health
http://localhost:3000/location-search?city=Rockville&state=MD
http://localhost:3000/recommendations?lat=39.144&lon=-77.2076&zip=20847&city=Rockville&state=MD&activity=bike
```

## Environment Variables

Use [`.env.example`](./.env.example) as the template:

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

- `AIRNOW_API_KEY` is optional for local development, but AQI data will be `null` without it.
- `WEATHER_GOV_UA` should include a real contact email in production.
- `CORS_ORIGINS` accepts a comma-separated allowlist of frontend origins.

## Deploying to Render

This repo includes [render.yaml](./render.yaml), so it can be deployed as a Render Blueprint.

Suggested flow:

1. Create a new Blueprint service in Render from this GitHub repo
2. Set:
   - `WEATHER_GOV_UA`
   - `AIRNOW_API_KEY`
   - `CORS_ORIGINS`
3. Deploy
4. Verify:

```bash
https://your-render-url/health
```

## Production Hardening Included

- proxy-aware request handling
- configurable CORS allowlist
- basic security headers
- per-IP rate limiting
- upstream timeouts
- short-lived response caching
- safer external API error handling

## Stack

- Node.js
- Express
- Weather.gov
- AirNow
- EPA UV
- Zippopotam.us
- U.S. Census geocoder fallback

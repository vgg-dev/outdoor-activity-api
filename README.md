# Outdoor Activity API

Backend API that recommends the best times for outdoor activities using:

- `api.weather.gov` for hourly forecast and active alerts
- EPA AirNow for AQI
- EPA UV data
- Zippopotam.us and Census geocoding helpers for US location search

Supported activities:

- `hike`
- `bike`
- `fishing`
- `astronomy`
- `drone`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`

3. Start the API:

```bash
npm start
```

## Environment variables

Copy [`.env.example`](C:\Users\vgera\OneDrive\Code-Dev\outdoor-activity-api\.env.example) and set:

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

- `AIRNOW_API_KEY` is optional for local development, but AQI values will be `null` without it.
- `WEATHER_GOV_UA` should include a real contact email, especially in production.
- `CORS_ORIGINS` should be a comma-separated list of allowed frontend origins in production.

## Endpoints

- `GET /health`
- `GET /location-search?city=Rockville&state=MD`
- `GET /recommendations?lat=40.7128&lon=-74.0060&activity=bike`

## Deployment on Render

This repo now includes [render.yaml](C:\Users\vgera\OneDrive\Code-Dev\outdoor-activity-api\render.yaml) for a basic Render web service.

Recommended steps:

1. Push this repo to GitHub
2. In Render, create a new Blueprint or Web Service from the repo
3. Set these required env vars in Render:
   - `WEATHER_GOV_UA`
   - `AIRNOW_API_KEY`
   - `CORS_ORIGINS`
4. Confirm health checks pass at `/health`

## Production hardening already included

- proxy-aware request handling for hosted environments
- basic security headers
- configurable CORS allowlist
- simple per-IP rate limiting
- upstream request timeouts
- short-lived in-memory caching for repeated recommendation requests
- safer client-facing error responses

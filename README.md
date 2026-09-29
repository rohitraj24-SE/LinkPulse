# LinkPulse

**Short links. Live insights.**

LinkPulse is a full-stack URL shortener with a live analytics dashboard. It is built on the open-source [Kutt](https://github.com/thedevs-network/kutt) project (MIT License) and adds a per-click analytics pipeline, new API endpoints and a new dashboard UI.

## Features

- Create short links, with optional custom alias and expiration
- Redirect with click recording (bots are not counted)
- My Links: search, pagination, copy, delete, per-link analytics
- Overview: total links, total clicks, active links, clicks today, 7-day click chart, recent links, top links, recent activity feed
- Per-link analytics: total clicks, clicks today, daily timeline, device, browser, OS, referrer, country
- Live updates in the browser through Server-Sent Events (no page reload)
- Accounts with JWT cookie auth, API keys, bcrypt password hashing (inherited from Kutt)
- SQLite by default; PostgreSQL and MySQL/MariaDB are supported by the inherited Knex setup

Not implemented: unique-visitor counts (no IP or visitor identifier is stored), city-level location.
Country is only resolved when the geoip database can resolve the client IP; local traffic shows `unknown`.

## Architecture

Express + Handlebars (server-rendered shell) + vanilla JS dashboard (`static/scripts/dashboard.js`) + Chart.js (vendored) + Knex.

```
Browser (dashboard.js) --fetch / EventSource--> Express routes --> handlers --> queries (Knex) --> SQLite/PG/MySQL
short URL click --> redirect handler --> visit queue --> links.visit_count + visits + analytics_events
```

Flows are documented in [docs/FLOWS.md](docs/FLOWS.md).

## Live analytics architecture

`GET /api/analytics/stream` is a Server-Sent Events endpoint. Each connected dashboard causes the server to re-query the database every 5 seconds and push an `analytics` event containing the overview numbers, 7-day series and latest activity. The dashboard applies each payload to the DOM. Values always come from the database; the refresh interval means updates arrive within about 5 seconds of a click, not instantly. If the connection drops, the "Live" badge turns grey and the browser reconnects automatically.

## Database design

New table (migration `20260926120000_analytics_events.js`):

| column | type | notes |
|---|---|---|
| id | increments | primary key |
| link_id | integer | FK -> links.id, cascade delete |
| user_id | integer | FK -> users.id, cascade delete |
| browser, os | string | parsed from user agent |
| device | string | desktop / mobile / tablet |
| country | string(2) | ISO code or `unknown` |
| referrer | string | hostname or `direct` |
| created_at | datetime | indexed |

Existing Kutt tables (`users`, `links`, `domains`, `hosts`, `ips`, `visits`) are unchanged. `visits` keeps hourly aggregated counters used by the legacy `/stats` page.

## API overview

All endpoints require authentication (session cookie or `X-API-KEY` header).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/links` | create link (`target`, `customurl`, `expire_in`, ...) |
| GET | `/api/links` | list links (`limit`, `skip`, `search`) |
| DELETE | `/api/links/:id` | delete link |
| GET | `/api/links/:id/stats` | Kutt aggregated stats |
| GET | `/api/links/:id/analytics` | stats + device breakdown, clicks today, 14-day timeline |
| GET | `/api/analytics/overview` | account totals, 7-day series, top/recent links |
| GET | `/api/analytics/activity?limit=` | recent click events (max 50) |
| GET | `/api/analytics/stream` | Server-Sent Events live feed |

Other inherited endpoints (users, domains, auth) are unchanged. Raw IP addresses are never returned.

## Project structure

```
server/            Express app: routes/, handlers/, queries/, queues/, migrations/, views/, utils/
static/            css/dashboard.css, scripts/dashboard.js, libs/ (Chart.js, htmx, qrcode)
custom/            optional custom CSS/images/views (inherited)
docs/              FLOWS.md, api/ (OpenAPI generator)
db/                SQLite file location (ignored by git)
```

## Environment setup

```powershell
Copy-Item .example.env .env
```

With this file the app runs in development mode on `http://localhost:3000`. In development `JWT_SECRET` falls back to a built-in insecure default; set a long random `JWT_SECRET` in `.env` for anything else. Production (`npm start`) requires it. `NODE_ENV` defaults to `development` unless `--production` is passed or `NODE_ENV` is set.

## Installation and running

Requires Node.js 22 or newer (developed and tested on 22; `npm install` may print an engine warning from `geoip-lite`, which declares Node 24).

```powershell
npm install
npm run migrate
npm run dev
```

Open http://localhost:3000. On first run, create the admin account at `/create-admin`. Then sign in and use the dashboard.

## Docker

`Dockerfile` and `docker-compose*.yml` are inherited from Kutt and adjusted for the new name (`docker-compose.yml` reads `.env`). They were **not built or run** while preparing this release; treat them as untested.

## Testing

There is no automated test suite. Manual verification performed on a clean install (Linux, Node 22): `npm install`, `npm run migrate`, server start; create link (custom alias, expiry), invalid URL, duplicate alias, unauthenticated access, unknown link analytics, missing short code; redirect with referrer and different user agents; overview, activity and per-link analytics; SSE stream receiving an updated click count while open. The visual dashboard was not exercised in a real browser and the app was not run on Windows in this environment.

## Screenshots

No screenshots are included yet.

## Future improvements

- Unique-visitor estimate (e.g. salted hash with expiry)
- Push-based updates instead of 5 s polling inside the SSE loop
- Date-range picker for analytics
- Automated tests and browser-based UI tests

## Engineering decisions

- **Kept SQLite/Knex and the Express + Handlebars stack**; the dashboard is vanilla JS to avoid a build step.
- **Added a raw event table instead of replacing `visits`**, so existing stats and API keep working.
- **SSE over WebSocket**: one-way data, no extra dependency.
- **Defaulted `NODE_ENV` to development** in `server/env.js` (envalid otherwise assumes production, which broke HTTP local links and cookies).
- **Fixed `query.user.add()`** to return the new user id so tokens from `create-admin`/`signup` are valid.

## License and attribution

MIT. LinkPulse is derived from Kutt (Copyright (c) 2020 Kutt). See [LICENSE](LICENSE); the original notice is retained.

## Author

LinkPulse - built on Kutt by Pouria Ezzati and contributors. Add your name here.

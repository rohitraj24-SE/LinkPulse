# Changelog

## LinkPulse 3.3.0 (based on Kutt 3.2.6)

### New analytics functionality
- `analytics_events` table: one row per recorded click (browser, OS, device, country, referrer, timestamp). No IP address is stored or returned.
- `server/queues/visit.js` also writes an event on every counted visit; existing `visits` aggregation is untouched.
- New endpoints: `GET /api/analytics/overview`, `GET /api/analytics/activity`, `GET /api/analytics/stream` (SSE), `GET /api/links/:id/analytics`.
- New `getUseragentDevice` helper (desktop / mobile / tablet).

### Dashboard changes
- New SaaS-style dashboard at `/` for logged-in users: sidebar, top bar (search, live indicator, refresh), Overview, My Links, Analytics, Create Link.
- Charts use the already-vendored Chart.js. Live updates via Server-Sent Events.
- Legacy pages (login, settings, admin, `/stats`) are unchanged.

### Database changes
- Migration `20260926120000_analytics_events.js`.

### Configuration and bug fixes
- `server/env.js`: `NODE_ENV` defaults to `development` unless `--production` is passed. Previously envalid assumed production, which produced `https://localhost` links, `Secure` cookies over HTTP and ignored `devDefault` values.
- `server/queries/user.queries.js`: `add()` now returns the new user's `id`; the JWT returned by `create-admin` / `signup` previously had no `sub` and was rejected.
- Open Graph URLs use the correct protocol (`site_url` local).

### Branding
- `package.json` name/description/keywords/author, env defaults, manifest, meta tags, header/footer, API docs config, CI Docker repo name.
- Kutt attribution kept: `LICENSE` (MIT), footer, dashboard sidebar and README.

### Files
- Added: `server/migrations/20260926120000_analytics_events.js`, `server/queries/analytics.queries.js`, `server/handlers/analytics.handler.js`, `server/routes/analytics.routes.js`, `server/views/dashboard.hbs`, `static/css/dashboard.css`, `static/scripts/dashboard.js`, `docs/FLOWS.md`, `CHANGELOG.md`.
- Changed: `env.js`, `utils.js`, `queues/visit.js`, `queries/index.js`, `queries/user.queries.js`, `routes/routes.js`, `routes/link.routes.js`, `handlers/renders.handler.js`, `handlers/locals.handler.js`, `views/layout.hbs`, header/footer partials, `package.json`, `.example.env`, Docker/CI files, `README.md`.

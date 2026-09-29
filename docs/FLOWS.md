# LinkPulse flows

## URL creation

User -> Frontend -> API -> Database -> Short URL

1. The **Create Link** tab (`static/scripts/dashboard.js`) sends `POST /api/links` with `target`, optional `customurl` and `expire_in`.
2. `server/routes/link.routes.js` runs `auth.apikey` / `auth.jwt`, then `validators.createLink` (URL validity, alias rules, expiry format).
3. `links.handler.create` generates an address (or uses the custom alias), inserts a row in `links`, and returns the link.
4. The short URL is built by `utils.getShortURL` using `http://` in development and `https://` in production.

## Redirect

Short URL -> API -> Analytics Event -> Database -> Redirect

1. `GET /:id` is handled by `links.handler.redirect`.
2. The address is resolved (with Redis cache if enabled). Missing, banned or expired links go to the 404 / banned page.
3. Non-bot visits are queued via `server/queues/visit.js` (processed in-process unless Redis is enabled).
4. The processor increments `links.visit_count`, updates the hourly-bucketed `visits` table, and inserts one row in `analytics_events`.
5. The browser receives a `302` to the original URL.

## Analytics

Click -> Event -> Database -> Analytics API -> Dashboard

1. Each recorded click is a row in `analytics_events` (browser, OS, device, country, referrer, timestamp - no IP address).
2. `GET /api/analytics/overview`, `/activity` and `GET /api/links/:id/analytics` aggregate these tables per user.
3. `GET /api/analytics/stream` is a Server-Sent Events endpoint. Every 5 seconds it re-queries the database and pushes an `analytics` event.
4. The dashboard opens an `EventSource` and re-renders cards, chart and activity feed without a page reload.

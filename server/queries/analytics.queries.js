const { subDays, startOfDay, startOfToday } = require("date-fns");

const utils = require("../utils");
const knex = require("../knex");

// insert one raw click event row
async function addEvent(data) {
  return knex("analytics_events").insert({
    link_id: data.link_id,
    user_id: data.user_id,
    browser: data.browser,
    os: data.os,
    device: data.device,
    country: data.country || "unknown",
    referrer: data.referrer || "direct",
  });
}

// high level numbers for the Overview page: total links, total clicks,
// active links (not banned/expired) and clicks recorded today.
// user_id is required - LinkPulse never mixes stats across accounts.
async function overview(user_id) {
  const now = new Date();
  const todayStart = utils.dateToUTC(startOfToday());

  const [allLinks, clicksToday, topLinks, recentLinks] = await Promise.all([
    // small, per-user projection (banned/expire flags only) so we can
    // compute "active links" without relying on dialect-specific SQL
    knex("links").where({ user_id }).select("banned", "expire_in", "visit_count"),
    knex("analytics_events")
      .where({ user_id })
      .where("created_at", ">=", todayStart)
      .count("* as count")
      .first(),
    knex("links")
      .leftJoin("domains", "domains.id", "links.domain_id")
      .where("links.user_id", user_id)
      .orderBy("links.visit_count", "desc")
      .limit(5)
      .select("links.uuid", "links.address", "links.target", "links.visit_count", "links.created_at", "domains.address as domain"),
    knex("links")
      .leftJoin("domains", "domains.id", "links.domain_id")
      .where("links.user_id", user_id)
      .orderBy("links.created_at", "desc")
      .limit(5)
      .select("links.uuid", "links.address", "links.target", "links.visit_count", "links.created_at", "domains.address as domain"),
  ]);

  const totalLinks = allLinks.length;
  const totalClicks = allLinks.reduce((sum, link) => sum + Number(link.visit_count || 0), 0);
  const activeLinks = allLinks.filter((link) => {
    if (link.banned) return false;
    if (!link.expire_in) return true;
    return utils.parseDatetime(link.expire_in).getTime() > now.getTime();
  }).length;

  return {
    totalLinks,
    totalClicks,
    activeLinks,
    clicksToday: Number(clicksToday?.count || 0),
    topLinks,
    recentLinks,
  };
}

// clicks-per-day for the last `days` days (defaults to 7), always returns
// a fully populated, zero-filled array so the chart never has gaps.
async function clicksOverTime(user_id, days = 7) {
  const now = new Date();
  const from = startOfDay(subDays(now, days - 1));

  const rows = await knex("analytics_events")
    .where({ user_id })
    .where("created_at", ">=", utils.dateToUTC(from))
    .select("created_at");

  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const day = startOfDay(subDays(now, i));
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  rows.forEach((row) => {
    const day = utils.parseDatetime(row.created_at).toISOString().slice(0, 10);
    if (buckets.has(day)) {
      buckets.set(day, buckets.get(day) + 1);
    }
  });

  return Array.from(buckets.entries()).map(([date, clicks]) => ({ date, clicks }));
}

// most recent click events across all of a user's links, for the live
// "Recent activity" feed. Never includes the raw IP address.
async function activity(user_id, limit = 20) {
  return knex("analytics_events")
    .join("links", "links.id", "analytics_events.link_id")
    .leftJoin("domains", "domains.id", "links.domain_id")
    .where("analytics_events.user_id", user_id)
    .orderBy("analytics_events.created_at", "desc")
    .limit(limit)
    .select(
      "analytics_events.id",
      "analytics_events.created_at",
      "analytics_events.browser",
      "analytics_events.os",
      "analytics_events.device",
      "analytics_events.country",
      "analytics_events.referrer",
      "links.uuid as link_uuid",
      "links.address as address",
      "links.target as target",
      "domains.address as domain"
    );
}

// per-link breakdown, used by the Analytics tab in addition to the
// existing (aggregated) /stats endpoint.
async function linkBreakdown(link_id, user_id) {
  const [deviceRows, clicksToday, timeline] = await Promise.all([
    knex("analytics_events")
      .where({ link_id, user_id })
      .select("device")
      .count("* as count")
      .groupBy("device"),
    knex("analytics_events")
      .where({ link_id, user_id })
      .where("created_at", ">=", utils.dateToUTC(startOfToday()))
      .count("* as count")
      .first(),
    linkClicksOverTime(link_id, user_id, 14),
  ]);

  return {
    device: deviceRows.map((row) => ({ name: row.device, value: Number(row.count) })),
    clicksToday: Number(clicksToday?.count || 0),
    timeline,
  };
}

async function linkClicksOverTime(link_id, user_id, days = 14) {
  const now = new Date();
  const from = startOfDay(subDays(now, days - 1));

  const rows = await knex("analytics_events")
    .where({ link_id, user_id })
    .where("created_at", ">=", utils.dateToUTC(from))
    .select("created_at");

  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const day = startOfDay(subDays(now, i));
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  rows.forEach((row) => {
    const day = utils.parseDatetime(row.created_at).toISOString().slice(0, 10);
    if (buckets.has(day)) {
      buckets.set(day, buckets.get(day) + 1);
    }
  });

  return Array.from(buckets.entries()).map(([date, clicks]) => ({ date, clicks }));
}

module.exports = {
  activity,
  addEvent,
  clicksOverTime,
  linkBreakdown,
  overview,
};

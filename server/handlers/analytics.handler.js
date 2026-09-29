const query = require("../queries");
const utils = require("../utils");

const CustomError = utils.CustomError;

// strips anything that isn't safe to send to the browser
// (this project never sends raw IP addresses to the frontend)
function sanitizeActivityRow(row) {
  return {
    id: row.id,
    // stored as a UTC datetime; send ISO 8601 so browsers parse it as UTC
    time: utils.parseDatetime(row.created_at).toISOString(),
    link: utils.getShortURL(row.address, row.domain).url,
    target: row.target,
    browser: row.browser,
    os: row.os,
    device: row.device,
    country: row.country,
    referrer: row.referrer,
  };
}

async function overview(req, res) {
  const user_id = req.user.id;

  const [summary, timeline] = await Promise.all([
    query.analytics.overview(user_id),
    query.analytics.clicksOverTime(user_id, 7),
  ]);

  return res.status(200).send({
    totalLinks: summary.totalLinks,
    totalClicks: summary.totalClicks,
    activeLinks: summary.activeLinks,
    clicksToday: summary.clicksToday,
    clicksOverTime: timeline,
    topLinks: summary.topLinks.map((link) => ({
      id: link.uuid,
      address: link.address,
      link: utils.getShortURL(link.address, link.domain).url,
      target: link.target,
      clicks: link.visit_count,
      created_at: link.created_at,
    })),
    recentLinks: summary.recentLinks.map((link) => ({
      id: link.uuid,
      address: link.address,
      link: utils.getShortURL(link.address, link.domain).url,
      target: link.target,
      clicks: link.visit_count,
      created_at: link.created_at,
    })),
  });
}

async function activity(req, res) {
  const user_id = req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  const rows = await query.analytics.activity(user_id, limit);

  return res.status(200).send({
    data: rows.map(sanitizeActivityRow),
  });
}

// Server-Sent Events stream: pushes a fresh overview + activity snapshot
// every few seconds so the dashboard updates without a page reload.
// This intentionally re-reads the database on every tick - there are no
// fabricated or animated numbers, everything comes straight from SQL.
async function stream(req, res) {
  const user_id = req.user.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });

  async function tick() {
    if (closed) return;
    try {
      const [summary, timeline, activityRows] = await Promise.all([
        query.analytics.overview(user_id),
        query.analytics.clicksOverTime(user_id, 7),
        query.analytics.activity(user_id, 10),
      ]);

      const payload = {
        totalLinks: summary.totalLinks,
        totalClicks: summary.totalClicks,
        activeLinks: summary.activeLinks,
        clicksToday: summary.clicksToday,
        clicksOverTime: timeline,
        activity: activityRows.map(sanitizeActivityRow),
        updatedAt: new Date().toISOString(),
      };

      res.write(`event: analytics\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      // don't kill the connection on a transient DB hiccup
      console.error("Analytics stream error:", err.message);
    }
  }

  await tick();
  const interval = setInterval(tick, 5000);
}

async function linkAnalytics(req, res) {
  const { user } = req;
  const uuid = req.params.id;

  const link = await query.link.find({
    ...(!user.admin && { user_id: user.id }),
    uuid,
  });

  if (!link) {
    throw new CustomError("Link could not be found.");
  }

  const [stats, breakdown] = await Promise.all([
    query.visit.find({ link_id: link.id }, link.visit_count),
    query.analytics.linkBreakdown(link.id, link.user_id),
  ]);

  if (!stats) {
    throw new CustomError("Could not get the short link analytics. Try again later.");
  }

  return res.status(200).send({
    ...stats,
    ...utils.sanitize.link(link),
    device: breakdown.device,
    clicksToday: breakdown.clicksToday,
    timeline: breakdown.timeline,
  });
}

module.exports = {
  activity,
  linkAnalytics,
  overview,
  stream,
};

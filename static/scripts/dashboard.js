/**
 * LinkPulse Dashboard
 * Vanilla JS app (no build step) that drives the sidebar tabs, talks to
 * the JSON APIs (/api/analytics/*, /api/links) and keeps the Overview tab
 * live via Server-Sent Events. Every number rendered here comes straight
 * from a fetch() response - nothing is fabricated or animated client-side.
 */
(function () {
  "use strict";

  const state = {
    tab: "overview",
    links: { data: [], total: 0, limit: 10, skip: 0, search: "" },
    charts: {},
    eventSource: null,
  };

  /* ---------------- small helpers ---------------- */

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function $all(sel, ctx) {
    return Array.from((ctx || document).querySelectorAll(sel));
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortLabel(link) {
    // strips the protocol for a compact display, e.g. localhost:3000/abc123
    return (link || "").replace(/^https?:\/\//, "");
  }

  // the API sometimes returns UTC datetimes as "YYYY-MM-DD HH:MM:SS" (no zone)
  function parseUTC(value) {
    if (!value) return new Date(NaN);
    const str = String(value);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(" ", "T") + "Z");
  }

  function timeAgo(iso) {
    const then = parseUTC(iso).getTime();
    const diff = Math.max(0, Date.now() - then);
    const sec = Math.floor(diff / 1000);
    if (sec < 5) return "just now";
    if (sec < 60) return sec + "s ago";
    const min = Math.floor(sec / 60);
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    const day = Math.floor(hr / 24);
    return day + "d ago";
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function toast(message, kind) {
    const wrap = $("#lp-toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "lp-toast" + (kind ? " lp-toast--" + kind : "");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { Accept: "application/json" } }, options));
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message = (body && (body.error || body.message)) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return body;
  }

  /* ---------------- tabs / navigation ---------------- */

  function setTab(tab) {
    state.tab = tab;
    $all(".lp-nav__item[data-tab]").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    $all(".lp-panel").forEach((el) => el.classList.toggle("active", el.id === "panel-" + tab));

    const titles = {
      overview: ["Overview", "A live look at your links and their performance."],
      links: ["My Links", "Manage, search and inspect every link you've created."],
      analytics: ["Analytics", "Deep dive into a single link's traffic."],
      create: ["Create Link", "Shorten a URL and share it in seconds."],
    };
    const [title, subtitle] = titles[tab] || titles.overview;
    $("#lp-page-title").textContent = title;
    $("#lp-page-subtitle").textContent = subtitle;

    $("#lp-topbar-search").classList.toggle("visible", tab === "links");

    closeSidebar();

    if (tab === "links") loadLinks();
    if (tab === "analytics") loadAnalyticsLinkOptions();
  }

  function closeSidebar() {
    $("#lp-app").classList.remove("lp-sidebar-open");
  }

  function initNav() {
    $all("[data-tab]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (el.tagName === "A") e.preventDefault();
        setTab(el.dataset.tab);
      });
    });

    $("#lp-sidebar-open").addEventListener("click", () => $("#lp-app").classList.add("lp-sidebar-open"));
    $("#lp-sidebar-close").addEventListener("click", closeSidebar);
    $("#lp-backdrop").addEventListener("click", closeSidebar);

    $("#lp-refresh-btn").addEventListener("click", () => {
      loadOverview();
      if (state.tab === "links") loadLinks();
      toast("Refreshed", "success");
    });

    let searchTimer;
    $("#lp-search-input").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.links.search = e.target.value.trim();
        state.links.skip = 0;
        loadLinks();
      }, 300);
    });
  }

  /* ---------------- Overview ---------------- */

  function setCard(stat, value) {
    const card = document.querySelector(`.lp-card[data-stat="${stat}"] [data-value]`);
    if (card) card.textContent = value;
  }

  function renderOverviewChart(points) {
    const canvas = $("#overview-chart");
    const empty = $("#overview-chart-empty");
    if (!canvas) return;

    const total = points.reduce((sum, p) => sum + p.clicks, 0);
    empty.hidden = total > 0;
    canvas.style.display = total > 0 ? "block" : "none";
    if (total === 0) return;

    const labels = points.map((p) => new Date(p.date).toLocaleDateString(undefined, { weekday: "short" }));
    const values = points.map((p) => p.clicks);

    if (state.charts.overview) {
      state.charts.overview.data.labels = labels;
      state.charts.overview.data.datasets[0].data = values;
      state.charts.overview.update();
      return;
    }

    state.charts.overview = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Clicks",
            data: values,
            borderColor: "#6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.12)",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: "#6366f1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderMiniList(containerId, links, emptyMessage) {
    const container = $("#" + containerId);
    if (!container) return;
    if (!links || !links.length) {
      container.innerHTML = `<div class="lp-empty">${emptyMessage}</div>`;
      return;
    }
    container.innerHTML = links
      .map(
        (link) => `
        <div class="lp-mini-row">
          <div class="lp-mini-row__main">
            <a class="lp-mini-row__link" href="${escapeHTML(link.link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(shortLabel(link.link))}</a>
            <span class="lp-mini-row__target">${escapeHTML(link.target)}</span>
          </div>
          <span class="lp-mini-row__clicks">${link.clicks} clicks</span>
        </div>`
      )
      .join("");
  }

  function renderActivity(rows) {
    const feed = $("#activity-feed");
    if (!feed) return;
    if (!rows || !rows.length) {
      feed.innerHTML = `<li class="lp-empty">Waiting for the first click…</li>`;
      return;
    }
    feed.innerHTML = rows
      .map(
        (row) => `
        <li class="lp-activity-row">
          <span class="lp-activity-dot"></span>
          <div class="lp-activity-main">
            <span class="lp-activity-link">${escapeHTML(shortLabel(row.link))}</span>
            <span class="lp-activity-meta">${escapeHTML(row.browser)} · ${escapeHTML(row.os)} · ${escapeHTML(row.device)} · ${row.referrer === "direct" ? "direct" : escapeHTML(row.referrer)}</span>
          </div>
          <span class="lp-activity-time">${timeAgo(row.time)}</span>
        </li>`
      )
      .join("");
  }

  function applyOverviewPayload(data) {
    setCard("totalLinks", data.totalLinks);
    setCard("totalClicks", data.totalClicks);
    setCard("activeLinks", data.activeLinks);
    setCard("clicksToday", data.clicksToday);
    if (data.clicksOverTime) renderOverviewChart(data.clicksOverTime);
    if (data.recentLinks) renderMiniList("recent-links-list", data.recentLinks, "No links yet.");
    if (data.topLinks) renderMiniList("top-links-list", data.topLinks, "No clicks yet.");
    if (data.activity) renderActivity(data.activity);
  }

  async function loadOverview() {
    try {
      const data = await api("/api/analytics/overview");
      applyOverviewPayload(data);
      // seed the activity feed once on load; the SSE stream takes over after that
      const activity = await api("/api/analytics/activity?limit=10");
      renderActivity(activity.data);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function connectLiveStream() {
    if (!window.EventSource) return;
    const indicator = $("#lp-live-indicator");

    const es = new EventSource("/api/analytics/stream");
    state.eventSource = es;

    es.addEventListener("open", () => {
      indicator.classList.remove("offline");
    });

    es.addEventListener("analytics", (event) => {
      try {
        const data = JSON.parse(event.data);
        applyOverviewPayload(data);
        indicator.classList.remove("offline");
      } catch {
        /* ignore malformed frame */
      }
    });

    es.onerror = () => {
      indicator.classList.add("offline");
    };
  }

  /* ---------------- My Links ---------------- */

  function statusBadge(link) {
    if (link.banned) return `<span class="lp-status lp-status--banned">Banned</span>`;
    if (link.expire_in && parseUTC(link.expire_in).getTime() <= Date.now()) {
      return `<span class="lp-status lp-status--expired">Expired</span>`;
    }
    if (link.password) return `<span class="lp-status lp-status--protected">Protected</span>`;
    return `<span class="lp-status lp-status--active">Active</span>`;
  }

  function renderLinksTable() {
    const body = $("#links-table-body");
    const rows = state.links.data;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="lp-empty">${state.links.search ? "No links match your search." : "You haven't created any links yet."}</td></tr>`;
    } else {
      body.innerHTML = rows
        .map(
          (link) => `
          <tr data-id="${escapeHTML(link.id)}">
            <td><a class="lp-mono-link" href="${escapeHTML(link.link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(shortLabel(link.link))}</a></td>
            <td><span class="lp-cell-target" title="${escapeHTML(link.target)}">${escapeHTML(link.target)}</span></td>
            <td>${link.visit_count}</td>
            <td>${formatDate(link.created_at)}</td>
            <td>${statusBadge(link)}</td>
            <td>
              <div class="lp-row-actions">
                <button type="button" data-action="analytics" data-id="${escapeHTML(link.id)}" title="View analytics">${iconSvg("chart")}</button>
                <button type="button" data-action="copy" data-url="${escapeHTML(link.link)}" title="Copy link">${iconSvg("copy")}</button>
                <button type="button" class="danger" data-action="delete" data-id="${escapeHTML(link.id)}" title="Delete link">${iconSvg("trash")}</button>
              </div>
            </td>
          </tr>`
        )
        .join("");
    }

    const pagination = $("#links-pagination");
    const { total, limit, skip } = state.links;
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + limit, total);
    pagination.innerHTML = `
      <span>${from}–${to} of ${total}</span>
      <button type="button" id="links-prev" ${skip <= 0 ? "disabled" : ""}>Previous</button>
      <button type="button" id="links-next" ${skip + limit >= total ? "disabled" : ""}>Next</button>
    `;
    $("#links-prev").addEventListener("click", () => {
      state.links.skip = Math.max(0, state.links.skip - state.links.limit);
      loadLinks();
    });
    $("#links-next").addEventListener("click", () => {
      state.links.skip += state.links.limit;
      loadLinks();
    });

    $all('[data-action="copy"]', body).forEach((btn) =>
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.url);
        toast("Short link copied to clipboard", "success");
      })
    );
    $all('[data-action="delete"]', body).forEach((btn) =>
      btn.addEventListener("click", () => deleteLink(btn.dataset.id))
    );
    $all('[data-action="analytics"]', body).forEach((btn) =>
      btn.addEventListener("click", () => {
        setTab("analytics");
        setTimeout(() => {
          $("#analytics-link-select").value = btn.dataset.id;
          $("#analytics-link-select").dispatchEvent(new Event("change"));
        }, 0);
      })
    );
  }

  function iconSvg(name) {
    const icons = {
      chart: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16M9 19v-6M14 19V9M19 19v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" stroke-width="2"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };
    return icons[name] || "";
  }

  async function loadLinks() {
    const body = $("#links-table-body");
    body.innerHTML = `<tr><td colspan="6" class="lp-empty">Loading your links…</td></tr>`;
    try {
      const params = new URLSearchParams({
        limit: state.links.limit,
        skip: state.links.skip,
      });
      if (state.links.search) params.set("search", state.links.search);
      const data = await api("/api/links?" + params.toString());
      state.links.data = data.data;
      state.links.total = data.total;
      renderLinksTable();
    } catch (err) {
      body.innerHTML = `<tr><td colspan="6" class="lp-empty">Could not load links: ${escapeHTML(err.message)}</td></tr>`;
    }
  }

  async function deleteLink(id) {
    if (!confirm("Delete this link? This cannot be undone.")) return;
    try {
      await api("/api/links/" + id, { method: "DELETE" });
      toast("Link deleted", "success");
      loadLinks();
      loadOverview();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  /* ---------------- Analytics tab ---------------- */

  async function loadAnalyticsLinkOptions() {
    const select = $("#analytics-link-select");
    try {
      const data = await api("/api/links?limit=100");
      const current = select.value;
      select.innerHTML =
        `<option value="">Select a link…</option>` +
        data.data
          .map((link) => `<option value="${escapeHTML(link.id)}">${escapeHTML(shortLabel(link.link))} → ${escapeHTML(link.target)}</option>`)
          .join("");
      if (current) select.value = current;
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderBars(containerId, rows) {
    const container = $("#" + containerId);
    if (!container) return;
    const filtered = (rows || []).filter((r) => r.value > 0);
    if (!filtered.length) {
      container.innerHTML = `<div class="lp-empty">No data yet.</div>`;
      return;
    }
    const max = Math.max(...filtered.map((r) => r.value));
    container.innerHTML = filtered
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
      .map(
        (row) => `
        <div class="lp-bar-row">
          <span class="lp-bar-row__label">${escapeHTML(String(row.name).replace(/\[dot\]/g, "."))}</span>
          <span class="lp-bar-row__track"><span class="lp-bar-row__fill" style="width:${Math.max(4, (row.value / max) * 100)}%"></span></span>
          <span class="lp-bar-row__value">${row.value}</span>
        </div>`
      )
      .join("");
  }

  function renderDeviceChart(rows) {
    const canvas = $("#analytics-device-chart");
    if (!canvas) return;
    const filtered = (rows || []).filter((r) => r.value > 0);
    const labels = filtered.length ? filtered.map((r) => r.name) : ["No data"];
    const values = filtered.length ? filtered.map((r) => r.value) : [1];
    const colors = ["#6366f1", "#a855f7", "#0d9488", "#d97706", "#dc2626"];

    if (state.charts.device) state.charts.device.destroy();
    state.charts.device = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: filtered.length ? colors : ["#e6e8f0"] }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
      },
    });
  }

  function renderTimelineChart(rows) {
    const canvas = $("#analytics-timeline-chart");
    if (!canvas) return;
    const labels = (rows || []).map((r) => new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    const values = (rows || []).map((r) => r.clicks);

    if (state.charts.timeline) state.charts.timeline.destroy();
    state.charts.timeline = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Clicks", data: values, backgroundColor: "#7c3aed", borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  async function loadLinkAnalytics(id) {
    const empty = $("#analytics-empty");
    const content = $("#analytics-content");
    if (!id) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    try {
      const data = await api(`/api/links/${id}/analytics`);
      empty.hidden = true;
      content.hidden = false;

      $("#al-total").textContent = data.visit_count;
      $("#al-today").textContent = data.clicksToday;
      $("#al-referrers").textContent = (data.lastMonth.stats.referrer || []).filter((r) => r.value > 0).length;

      renderTimelineChart(data.timeline);
      renderDeviceChart(data.device);
      renderBars("al-browser", data.lastMonth.stats.browser);
      renderBars("al-os", data.lastMonth.stats.os);
      renderBars("al-referrer", data.lastMonth.stats.referrer);
      renderBars("al-country", data.lastMonth.stats.country);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function initAnalyticsTab() {
    $("#analytics-link-select").addEventListener("change", (e) => loadLinkAnalytics(e.target.value));
  }

  /* ---------------- Create Link ---------------- */

  function initCreateForm() {
    const form = $("#create-link-form");
    const submitBtn = $("#cl-submit");
    const result = $("#create-link-result");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      const original = submitBtn.innerHTML;
      submitBtn.textContent = "Creating…";

      const payload = {
        target: $("#cl-target").value.trim(),
      };
      const customurl = $("#cl-customurl").value.trim();
      if (customurl) payload.customurl = customurl;
      const expire = $("#cl-expire").value;
      if (expire) payload.expire_in = expire;

      try {
        const link = await api("/api/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        $("#create-link-output").value = link.link;
        $("#create-link-open").href = link.link;
        result.hidden = false;
        toast("Short link created", "success");
        form.reset();
        loadOverview();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = original;
      }
    });

    $("#create-link-copy").addEventListener("click", () => {
      navigator.clipboard.writeText($("#create-link-output").value);
      toast("Copied to clipboard", "success");
    });
  }

  /* ---------------- boot ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initAnalyticsTab();
    initCreateForm();
    loadOverview();
    connectLiveStream();

    window.addEventListener("beforeunload", () => {
      if (state.eventSource) state.eventSource.close();
    });
  });
})();

const { Router } = require("express");

const analytics = require("../handlers/analytics.handler");
const asyncHandler = require("../utils/asyncHandler");
const auth = require("../handlers/auth.handler");

const router = Router();

// GET /api/analytics/overview - account-wide stats for the Overview tab
router.get(
  "/overview",
  asyncHandler(auth.apikey),
  asyncHandler(auth.jwt),
  asyncHandler(analytics.overview)
);

// GET /api/analytics/activity - recent click activity feed
router.get(
  "/activity",
  asyncHandler(auth.apikey),
  asyncHandler(auth.jwt),
  asyncHandler(analytics.activity)
);

// GET /api/analytics/stream - Server-Sent Events, live dashboard updates
router.get(
  "/stream",
  asyncHandler(auth.apikey),
  asyncHandler(auth.jwt),
  asyncHandler(analytics.stream)
);

module.exports = router;

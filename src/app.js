require("dotenv").config();

const express = require("express");
const cors = require("cors");

const usersRouter = require("./routes/users");
const notificationsRouter = require("./routes/notifications");

const normalizeOrigin = (value) => String(value || "").trim().replace(/\/+$/, "");

// Allowlist of browser origins (comma-separated). Example:
// CLIENT_ORIGINS=https://dot-pay.vercel.app,https://dot-pay-git-branch.vercel.app
const CLIENT_ORIGINS_RAW = process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "";
const CLIENT_ORIGINS = CLIENT_ORIGINS_RAW.split(",").map(normalizeOrigin).filter(Boolean);

const app = express();

const allowLocalhost = process.env.NODE_ENV !== "production";
const allowedOriginSet = new Set(CLIENT_ORIGINS);

// Allow frontend origin(s): allowlisted in production; allow localhost in dev.
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true); // non-browser clients

  const o = normalizeOrigin(origin);
  if (allowLocalhost && /^https?:\/\/localhost(:\d+)?$/.test(o)) {
    return cb(null, true);
  }

  return cb(null, allowedOriginSet.has(o));
};

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
// Explicit preflight support for all routes.
app.options("*", cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

// Health endpoints.
// Note: Vercel rewrites can preserve the original path, so support "/" directly too.
app.get(["/", "/health", "/api/health"], (req, res) => {
  res.json({ ok: true, service: "dotpay-backend" });
});

app.use("/api/users", usersRouter);
app.use("/api/notifications", notificationsRouter);

// Last-resort error handler for unexpected exceptions.
// (Most routes already handle their own errors.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

module.exports = { app };

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB } = require("./config/db");
const usersRouter = require("./routes/users");
const notificationsRouter = require("./routes/notifications");

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

const app = express();

// Allow frontend origin(s): single CLIENT_ORIGIN or any localhost in dev
const corsOrigin =
  process.env.NODE_ENV === "production"
    ? CLIENT_ORIGIN
    : (origin, cb) => {
        if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      };

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "dotpay-backend" });
});

app.use("/api/users", usersRouter);
app.use("/api/notifications", notificationsRouter);

async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`DotPay backend running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

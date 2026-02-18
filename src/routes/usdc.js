const express = require("express");

const router = express.Router();

router.get("/conversionrate", (req, res) => {
  const configured = Number.parseFloat(process.env.KES_PER_USD || "130");
  const rate = Number.isFinite(configured) && configured > 0 ? configured : 130;

  return res.status(200).json({
    success: true,
    rate,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;


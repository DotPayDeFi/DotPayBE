const express = require("express");
const { connectDB } = require("../config/db");
const { mpesaConfig } = require("../config/mpesa");
const { MpesaTransaction } = require("../models/MpesaTransaction");
const { MpesaEvent } = require("../models/MpesaEvent");
const { assertTransition } = require("../services/mpesa/stateMachine");
const { scheduleAutoRefund } = require("../services/mpesa/refundService");
const { settleOnrampToUserWallet } = require("../services/settlement/treasurySettlement");

const router = express.Router();

function normalizeTxId(value) {
  return String(value || "").trim().toUpperCase();
}

function createWebhookLogId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function callbackAck(res) {
  return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
}

function normalizeResultCode(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function withMpesaActionHint(code, resultDesc) {
  const base = String(resultDesc || "").trim() || "M-Pesa request failed.";
  const normalized = normalizeResultCode(code);

  if (normalized === "8006") {
    return `${base} Action required: reset/unlock the Daraja initiator security credential in Safaricom portal, then update MPESA_PROD_B2C_SECURITY_CREDENTIAL and retry.`;
  }
  if (normalized === "2001") {
    return `${base} Action required: verify initiator name and security credential pairing for production B2C.`;
  }
  return base;
}

function parseResultCode(value) {
  const raw =
    value === undefined || value === null
      ? null
      : String(value).trim() || null;
  const asNumber = raw === null ? NaN : Number(raw);
  return {
    raw,
    number: Number.isFinite(asNumber) ? asNumber : null,
    key: raw ?? "unknown",
    isSuccess: raw === "0" || asNumber === 0,
  };
}

async function saveEventIfNew({ eventKey, transactionId, eventType, payload }) {
  try {
    await MpesaEvent.create({
      eventKey,
      transactionId,
      eventType,
      source: "webhook",
      payload,
      receivedAt: new Date(),
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

function findReceiptFromResult(result) {
  const list = result?.ResultParameters?.ResultParameter;
  if (!Array.isArray(list)) return null;
  const target = list.find((x) => {
    const key = String(x?.Key || "").toLowerCase();
    return key === "transactionreceipt" || key === "transactionid";
  });
  return target?.Value ? String(target.Value).trim() : null;
}

async function findTransactionFromWebhook(req, fallbackFields = {}) {
  const txParam = normalizeTxId(req.query?.tx);
  if (txParam) {
    const tx = await MpesaTransaction.findOne({ transactionId: txParam });
    if (tx) return tx;
  }

  const query = {
    $or: [],
  };

  if (fallbackFields.checkoutRequestId) {
    query.$or.push({ "daraja.checkoutRequestId": String(fallbackFields.checkoutRequestId) });
  }
  if (fallbackFields.conversationId) {
    query.$or.push({ "daraja.conversationId": String(fallbackFields.conversationId) });
  }
  if (fallbackFields.originatorConversationId) {
    query.$or.push({ "daraja.originatorConversationId": String(fallbackFields.originatorConversationId) });
  }

  if (query.$or.length === 0) return null;
  return MpesaTransaction.findOne(query);
}

router.use((req, res, next) => {
  if (!req.path.startsWith("/webhooks/")) {
    return next("router");
  }

  const requestId = createWebhookLogId();
  const startedAt = Date.now();
  const txParam = String(req.query?.tx || "").trim() || "-";
  const conversationId =
    String(req.body?.Result?.ConversationID || req.body?.Body?.stkCallback?.CheckoutRequestID || "")
      .trim() || "-";

  console.info(
    `[M-Pesa Webhook] req=${requestId} start method=${req.method} path=${req.originalUrl} tx=${txParam} ref=${conversationId}`
  );

  let completed = false;
  const finish = (eventName) => {
    if (completed) return;
    completed = true;
    console.info(
      `[M-Pesa Webhook] req=${requestId} ${eventName} status=${res.statusCode} durationMs=${
        Date.now() - startedAt
      }`
    );
  };

  res.on("finish", () => finish("finish"));
  res.on("close", () => finish("close"));
  next();
});

router.use(async (req, res, next) => {
  try {
    await connectDB();

    // Optional shared secret in webhook URL/query for extra safety.
    const expectedSecret = String(mpesaConfig.callbacks.webhookSecret || "").trim();
    if (expectedSecret) {
      const provided = String(req.query?.secret || req.get("x-mpesa-webhook-secret") || "").trim();
      if (!provided || provided !== expectedSecret) {
        return res.status(401).json({ ResultCode: 1, ResultDesc: "Unauthorized" });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mpesa/webhooks/stk
 */
router.post("/webhooks/stk", async (req, res) => {
  try {
    const stk = req.body?.Body?.stkCallback || {};
    const checkoutRequestId = stk?.CheckoutRequestID;
    const merchantRequestId = stk?.MerchantRequestID;
    const parsedCode = parseResultCode(stk?.ResultCode);
    const resultDesc = String(stk?.ResultDesc || "").trim() || null;

    const tx = await findTransactionFromWebhook(req, { checkoutRequestId, merchantRequestId });
    if (!tx) return callbackAck(res);

    const eventKey = `stk:${tx.transactionId}:${checkoutRequestId || "none"}:${parsedCode.key}`;
    const inserted = await saveEventIfNew({
      eventKey,
      transactionId: tx.transactionId,
      eventType: "stk_callback",
      payload: req.body,
    });
    if (!inserted) return callbackAck(res);

    const metadataItems = stk?.CallbackMetadata?.Item;
    const metadata = Array.isArray(metadataItems) ? metadataItems : [];
    const receiptItem = metadata.find((item) => String(item?.Name || "") === "MpesaReceiptNumber");
    const receiptNumber = receiptItem?.Value ? String(receiptItem.Value).trim() : null;

    tx.daraja = {
      ...(tx.daraja || {}),
      merchantRequestId: merchantRequestId || tx.daraja?.merchantRequestId || null,
      checkoutRequestId: checkoutRequestId || tx.daraja?.checkoutRequestId || null,
      resultCode: parsedCode.number,
      resultCodeRaw: parsedCode.raw,
      resultDesc,
      receiptNumber: receiptNumber || tx.daraja?.receiptNumber || null,
      rawCallback: req.body,
      callbackReceivedAt: new Date(),
    };

    if (parsedCode.isSuccess) {
      try {
        const settled = await settleOnrampToUserWallet(tx);
        console.info(
          `[M-Pesa Onramp Settlement] tx=${tx.transactionId} status=completed txHash=${
            settled?.txHash || "-"
          } reused=${Boolean(settled?.reused)}`
        );
      } catch (settlementErr) {
        const reason = String(settlementErr?.message || "On-chain settlement failed.").trim();
        console.error(
          `[M-Pesa Onramp Settlement] tx=${tx.transactionId} status=failed reason=${reason}`
        );

        tx.onchain = {
          ...(tx.onchain || {}),
          verificationStatus: "failed",
          verificationError: reason,
          verifiedBy: "treasury_settlement",
          verifiedAt: new Date(),
        };
        tx.daraja = {
          ...(tx.daraja || {}),
          resultDesc: `${resultDesc || "STK callback success"} | Settlement error: ${reason}`,
        };
        if (tx.status !== "failed") {
          assertTransition(tx, "failed", "On-chain settlement failed", "settlement");
        }

        await tx.save();
        return callbackAck(res);
      }

      if (tx.status !== "succeeded") {
        assertTransition(tx, "succeeded", "STK callback success", "webhook");
      }
    } else {
      if (tx.status !== "failed") {
        assertTransition(tx, "failed", "STK callback failure", "webhook");
      }
    }

    await tx.save();
    return callbackAck(res);
  } catch (err) {
    console.error("STK webhook error:", err);
    return callbackAck(res);
  }
});

/**
 * POST /api/mpesa/webhooks/b2c/result
 */
router.post("/webhooks/b2c/result", async (req, res) => {
  try {
    const result = req.body?.Result || {};
    const conversationId = result?.ConversationID;
    const originatorConversationId = result?.OriginatorConversationID;
    const parsedCode = parseResultCode(result?.ResultCode);
    const resultDescRaw = String(result?.ResultDesc || "").trim() || null;
    const resultDesc = withMpesaActionHint(parsedCode.raw, resultDescRaw);

    const tx = await findTransactionFromWebhook(req, { conversationId, originatorConversationId });
    if (!tx) return callbackAck(res);

    console.info(
      `[M-Pesa B2C Callback] tx=${tx.transactionId} conversationId=${conversationId || "-"} originatorConversationId=${originatorConversationId || "-"} resultCode=${parsedCode.raw || "-"} resultDesc=${resultDesc || "-"}`
    );

    const eventKey = `b2c_result:${tx.transactionId}:${conversationId || "none"}:${parsedCode.key}`;
    const inserted = await saveEventIfNew({
      eventKey,
      transactionId: tx.transactionId,
      eventType: "b2c_result",
      payload: req.body,
    });
    if (!inserted) return callbackAck(res);

    const receipt = findReceiptFromResult(result);

    tx.daraja = {
      ...(tx.daraja || {}),
      conversationId: conversationId || tx.daraja?.conversationId || null,
      originatorConversationId: originatorConversationId || tx.daraja?.originatorConversationId || null,
      resultCode: parsedCode.number,
      resultCodeRaw: parsedCode.raw,
      resultDesc,
      receiptNumber: receipt || tx.daraja?.receiptNumber || null,
      rawCallback: req.body,
      callbackReceivedAt: new Date(),
    };

    if (parsedCode.isSuccess) {
      if (tx.status !== "succeeded") {
        assertTransition(tx, "succeeded", "B2C callback success", "webhook");
      }
      await tx.save();
    } else {
      if (normalizeResultCode(parsedCode.raw) === "8006") {
        console.error(
          `[M-Pesa B2C Callback] tx=${tx.transactionId} credential_locked action=rotate_or_unlock_security_credential`
        );
      }
      if (tx.status !== "failed") {
        assertTransition(tx, "failed", "B2C callback failure", "webhook");
      }
      await tx.save();
      await scheduleAutoRefund(tx, `B2C failed: ${resultDesc || "Unknown error"}`);
    }

    return callbackAck(res);
  } catch (err) {
    console.error("B2C result webhook error:", err);
    return callbackAck(res);
  }
});

/**
 * POST /api/mpesa/webhooks/b2c/timeout
 */
router.post("/webhooks/b2c/timeout", async (req, res) => {
  try {
    const conversationId = req.body?.Result?.ConversationID || req.body?.ConversationID;
    const originatorConversationId = req.body?.Result?.OriginatorConversationID || req.body?.OriginatorConversationID;

    const tx = await findTransactionFromWebhook(req, { conversationId, originatorConversationId });
    if (!tx) return callbackAck(res);

    console.warn(
      `[M-Pesa B2C Timeout] tx=${tx.transactionId} conversationId=${conversationId || "-"} originatorConversationId=${originatorConversationId || "-"}`
    );

    const eventKey = `b2c_timeout:${tx.transactionId}:${conversationId || "none"}`;
    const inserted = await saveEventIfNew({
      eventKey,
      transactionId: tx.transactionId,
      eventType: "b2c_timeout",
      payload: req.body,
    });
    if (!inserted) return callbackAck(res);

    tx.daraja = {
      ...(tx.daraja || {}),
      rawCallback: req.body,
      callbackReceivedAt: new Date(),
      resultDesc: "Timeout",
    };

    if (tx.status !== "failed") {
      assertTransition(tx, "failed", "B2C timeout callback", "webhook");
    }
    await tx.save();
    await scheduleAutoRefund(tx, "B2C timeout");

    return callbackAck(res);
  } catch (err) {
    console.error("B2C timeout webhook error:", err);
    return callbackAck(res);
  }
});

/**
 * POST /api/mpesa/webhooks/b2b/result
 */
router.post("/webhooks/b2b/result", async (req, res) => {
  try {
    const result = req.body?.Result || {};
    const conversationId = result?.ConversationID;
    const originatorConversationId = result?.OriginatorConversationID;
    const parsedCode = parseResultCode(result?.ResultCode);
    const resultDesc = String(result?.ResultDesc || "").trim() || null;

    const tx = await findTransactionFromWebhook(req, { conversationId, originatorConversationId });
    if (!tx) return callbackAck(res);

    const eventKey = `b2b_result:${tx.transactionId}:${conversationId || "none"}:${parsedCode.key}`;
    const inserted = await saveEventIfNew({
      eventKey,
      transactionId: tx.transactionId,
      eventType: "b2b_result",
      payload: req.body,
    });
    if (!inserted) return callbackAck(res);

    tx.daraja = {
      ...(tx.daraja || {}),
      conversationId: conversationId || tx.daraja?.conversationId || null,
      originatorConversationId: originatorConversationId || tx.daraja?.originatorConversationId || null,
      resultCode: parsedCode.number,
      resultCodeRaw: parsedCode.raw,
      resultDesc,
      rawCallback: req.body,
      callbackReceivedAt: new Date(),
    };

    if (parsedCode.isSuccess) {
      if (tx.status !== "succeeded") {
        assertTransition(tx, "succeeded", "B2B callback success", "webhook");
      }
      await tx.save();
    } else {
      if (tx.status !== "failed") {
        assertTransition(tx, "failed", "B2B callback failure", "webhook");
      }
      await tx.save();
      await scheduleAutoRefund(tx, `B2B failed: ${resultDesc || "Unknown error"}`);
    }

    return callbackAck(res);
  } catch (err) {
    console.error("B2B result webhook error:", err);
    return callbackAck(res);
  }
});

/**
 * POST /api/mpesa/webhooks/b2b/timeout
 */
router.post("/webhooks/b2b/timeout", async (req, res) => {
  try {
    const conversationId = req.body?.Result?.ConversationID || req.body?.ConversationID;
    const originatorConversationId = req.body?.Result?.OriginatorConversationID || req.body?.OriginatorConversationID;

    const tx = await findTransactionFromWebhook(req, { conversationId, originatorConversationId });
    if (!tx) return callbackAck(res);

    const eventKey = `b2b_timeout:${tx.transactionId}:${conversationId || "none"}`;
    const inserted = await saveEventIfNew({
      eventKey,
      transactionId: tx.transactionId,
      eventType: "b2b_timeout",
      payload: req.body,
    });
    if (!inserted) return callbackAck(res);

    tx.daraja = {
      ...(tx.daraja || {}),
      rawCallback: req.body,
      callbackReceivedAt: new Date(),
      resultDesc: "Timeout",
    };

    if (tx.status !== "failed") {
      assertTransition(tx, "failed", "B2B timeout callback", "webhook");
    }
    await tx.save();
    await scheduleAutoRefund(tx, "B2B timeout");

    return callbackAck(res);
  } catch (err) {
    console.error("B2B timeout webhook error:", err);
    return callbackAck(res);
  }
});

module.exports = router;

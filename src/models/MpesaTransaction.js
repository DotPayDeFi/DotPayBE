const mongoose = require("mongoose");

const mpesaTransactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, trim: true, index: true },
    flow: {
      type: String,
      enum: ["C2B", "B2C", "B2B"],
      required: true,
      index: true,
    },
    product: {
      type: String,
      enum: ["deposit", "buy_crypto", "paybill", "till", "pay_with_crypto", "withdraw", "crypto_to_mpesa"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "timeout", "cancelled", "unknown"],
      default: "pending",
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    phoneNumber: { type: String, default: null, trim: true, index: true },
    targetNumber: { type: String, default: null, trim: true },
    accountNumber: { type: String, default: null, trim: true },
    chain: { type: String, default: null, trim: true },
    tokenType: { type: String, default: null, trim: true },
    mpesaReceiptNumber: { type: String, default: null, trim: true, uppercase: true, index: true },
    merchantRequestId: { type: String, default: null, trim: true, index: true },
    checkoutRequestId: { type: String, default: null, trim: true, index: true },
    conversationId: { type: String, default: null, trim: true, index: true },
    originatorConversationId: { type: String, default: null, trim: true, index: true },
    resultCode: { type: Number, default: null, index: true },
    resultDesc: { type: String, default: null, trim: true },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: null },
    callbackPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

mpesaTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model("MpesaTransaction", mpesaTransactionSchema);

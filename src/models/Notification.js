const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    /** Recipient wallet address (lowercased). */
    toAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    /** Sender wallet address (lowercased). */
    fromAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    /** Notification type. */
    type: {
      type: String,
      required: true,
      enum: ["payment_received"],
    },
    /** Chain ID where the underlying transaction happened. */
    chainId: {
      type: Number,
      required: true,
      min: 1,
    },
    /** ERC-20 contract address (lowercased). */
    contractAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    /** ERC-20 transfer tx hash (lowercased). */
    txHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    /** Log index for idempotency (unique per tx). */
    logIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Raw token amount in smallest units, stored as string to preserve precision. */
    value: {
      type: String,
      required: true,
      trim: true,
    },
    tokenSymbol: {
      type: String,
      required: true,
      trim: true,
    },
    tokenDecimal: {
      type: Number,
      required: true,
      min: 0,
      max: 18,
    },
    /** Optional user note attached to the payment. */
    note: {
      type: String,
      default: null,
      trim: true,
      maxlength: 180,
    },
    /** When the on-chain event happened (best-effort). */
    eventAt: {
      type: Date,
      required: true,
    },
    /** When the recipient read the notification. */
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ toAddress: 1, eventAt: -1 });
notificationSchema.index({ toAddress: 1, readAt: 1, eventAt: -1 });
notificationSchema.index({ toAddress: 1, txHash: 1, logIndex: 1 }, { unique: true });

module.exports = mongoose.model("Notification", notificationSchema);


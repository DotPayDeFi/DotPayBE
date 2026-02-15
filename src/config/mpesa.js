const DEFAULT_SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke";
const DEFAULT_PRODUCTION_BASE_URL = "https://api.safaricom.co.ke";

const fs = require("fs");
const path = require("path");
const { generateSecurityCredentialFromCertPath } = require("../services/mpesa/securityCredential");

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const envRaw = String(process.env.MPESA_ENV || "").trim().toLowerCase();
const env = envRaw === "production" ? "production" : "sandbox";

function defaultCertPathForEnv(targetEnv) {
  // Only sandbox cert is bundled; production should be supplied via MPESA_CERT_PATH.
  if (targetEnv === "sandbox") return path.join(__dirname, "../assets/mpesa-sandbox-cert.cer");
  return "";
}

const baseUrl =
  normalizeUrl(process.env.MPESA_BASE_URL) ||
  (env === "production" ? DEFAULT_PRODUCTION_BASE_URL : DEFAULT_SANDBOX_BASE_URL);

const resultBaseUrl = normalizeUrl(process.env.MPESA_RESULT_BASE_URL || process.env.NEXT_PUBLIC_DOTPAY_API_URL);
const timeoutBaseUrl = normalizeUrl(process.env.MPESA_TIMEOUT_BASE_URL || process.env.NEXT_PUBLIC_DOTPAY_API_URL);

let securityCredential = String(process.env.MPESA_SECURITY_CREDENTIAL || "").trim();
if (!securityCredential) {
  const initiatorPassword = String(process.env.MPESA_INITIATOR_PASSWORD || "").trim();
  const certPath = String(process.env.MPESA_CERT_PATH || "").trim() || defaultCertPathForEnv(env);
  if (initiatorPassword && certPath && fs.existsSync(certPath)) {
    try {
      securityCredential = generateSecurityCredentialFromCertPath({ initiatorPassword, certPath });
    } catch (err) {
      if (!global.__dotpay_mpesa_cred_warned) {
        global.__dotpay_mpesa_cred_warned = true;
        console.warn("Failed to generate MPESA_SECURITY_CREDENTIAL from password:", err?.message || err);
      }
    }
  }
}

const mpesaConfig = {
  enabled: toBool(process.env.MPESA_ENABLED, false),
  env,
  baseUrl,
  oauthUrl: `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
  endpoints: {
    stkPush: `${baseUrl}/mpesa/stkpush/v1/processrequest`,
    stkQuery: `${baseUrl}/mpesa/stkpushquery/v1/query`,
    b2cPayment:
      String(process.env.MPESA_B2C_API_VERSION || "")
        .trim()
        .toLowerCase() === "v1"
        ? `${baseUrl}/mpesa/b2c/v1/paymentrequest`
        : `${baseUrl}/mpesa/b2c/v3/paymentrequest`,
    b2bPayment: `${baseUrl}/mpesa/b2b/v1/paymentrequest`,
    transactionStatus: `${baseUrl}/mpesa/transactionstatus/v1/query`,
  },
  credentials: {
    consumerKey: String(process.env.MPESA_CONSUMER_KEY || "").trim(),
    consumerSecret: String(process.env.MPESA_CONSUMER_SECRET || "").trim(),
    shortcode: String(process.env.MPESA_SHORTCODE || "").trim(),
    stkShortcode:
      String(process.env.MPESA_STK_SHORTCODE || "").trim() ||
      String(process.env.MPESA_SHORTCODE || "").trim(),
    b2cShortcode:
      String(process.env.MPESA_B2C_SHORTCODE || "").trim() ||
      String(process.env.MPESA_SHORTCODE || "").trim(),
    b2bShortcode:
      String(process.env.MPESA_B2B_SHORTCODE || "").trim() ||
      String(process.env.MPESA_SHORTCODE || "").trim(),
    passkey: String(process.env.MPESA_PASSKEY || "").trim(),
    initiatorName: String(process.env.MPESA_INITIATOR_NAME || "").trim(),
    securityCredential,
  },
  callbacks: {
    resultBaseUrl,
    timeoutBaseUrl,
    webhookSecret: String(process.env.MPESA_WEBHOOK_SECRET || "").trim(),
  },
  limits: {
    maxTxnKes: toNumber(process.env.MPESA_MAX_TXN_KES, 150000),
    maxDailyKes: toNumber(process.env.MPESA_MAX_DAILY_KES, 500000),
  },
  quote: {
    ttlSeconds: toNumber(process.env.MPESA_QUOTE_TTL_SECONDS, 300),
  },
  refunds: {
    autoRefund: toBool(process.env.MPESA_AUTO_REFUND, true),
  },
  security: {
    pinMinLength: toNumber(process.env.MPESA_PIN_MIN_LENGTH, 4),
    signatureMaxAgeSeconds: toNumber(process.env.MPESA_SIGNATURE_MAX_AGE_SECONDS, 600),
  },
  treasury: {
    refundEnabled: toBool(process.env.TREASURY_REFUND_ENABLED, true),
    rpcUrl: normalizeUrl(process.env.TREASURY_RPC_URL),
    privateKey: String(process.env.TREASURY_PRIVATE_KEY || "").trim(),
    usdcContract: String(process.env.TREASURY_USDC_CONTRACT || "").trim(),
    chainId: toNumber(process.env.TREASURY_CHAIN_ID, 0) || null,
    usdcDecimals: toNumber(process.env.TREASURY_USDC_DECIMALS, 6),
    waitConfirmations: Math.max(1, toNumber(process.env.TREASURY_WAIT_CONFIRMATIONS, 1)),
  },
};

function ensureMpesaConfigured() {
  const missing = [];
  if (!mpesaConfig.credentials.consumerKey) missing.push("MPESA_CONSUMER_KEY");
  if (!mpesaConfig.credentials.consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  if (!mpesaConfig.credentials.stkShortcode) missing.push("MPESA_STK_SHORTCODE or MPESA_SHORTCODE");
  if (!mpesaConfig.credentials.b2cShortcode) missing.push("MPESA_B2C_SHORTCODE or MPESA_SHORTCODE");
  if (!mpesaConfig.credentials.b2bShortcode) missing.push("MPESA_B2B_SHORTCODE or MPESA_SHORTCODE");
  if (!mpesaConfig.callbacks.resultBaseUrl) missing.push("MPESA_RESULT_BASE_URL");
  if (!mpesaConfig.callbacks.timeoutBaseUrl) missing.push("MPESA_TIMEOUT_BASE_URL");

  if (missing.length > 0) {
    throw new Error(`Missing M-Pesa configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  mpesaConfig,
  ensureMpesaConfigured,
};

const { ethers } = require("ethers");

const ERC20_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];

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

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function now() {
  return new Date();
}

let _provider = null;
let _providerRpcUrl = null;
let _wallet = null;
let _walletPk = null;

function getTreasurySigner() {
  const rpcUrl = normalizeUrl(process.env.TREASURY_RPC_URL);
  const pk = normalizePrivateKey(process.env.TREASURY_PRIVATE_KEY);
  if (!rpcUrl || !pk) return null;

  if (!_provider || _providerRpcUrl !== rpcUrl) {
    _providerRpcUrl = rpcUrl;
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  if (!_wallet || _walletPk !== pk) {
    _walletPk = pk;
    _wallet = new ethers.Wallet(pk, _provider);
  }

  return _wallet;
}

function getWelcomeConfig() {
  return {
    enabled: toBool(process.env.WELCOME_USDC_ENABLED, false),
    amount: toNumber(process.env.WELCOME_USDC_AMOUNT, 2),
    waitConfirmations: Math.max(
      0,
      toNumber(process.env.WELCOME_USDC_WAIT_CONFIRMATIONS, toNumber(process.env.TREASURY_WAIT_CONFIRMATIONS, 1))
    ),
    usdcContract: String(process.env.TREASURY_USDC_CONTRACT || "").trim(),
    decimals: toNumber(process.env.TREASURY_USDC_DECIMALS, 6),
    chainId: toNumber(process.env.TREASURY_CHAIN_ID, 0) || null,
  };
}

function validateAddress(address) {
  const a = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) {
    throw new Error("Invalid recipient wallet address.");
  }
  return a.toLowerCase();
}

/**
 * Send a welcome USDC grant from the treasury wallet to the recipient address.
 *
 * Returns:
 * - { status: 'submitted', txHash }
 * - { status: 'confirmed', txHash, blockNumber } if waitConfirmations > 0 and receipt is available
 */
async function sendWelcomeUsdc({ toAddress }) {
  const cfg = getWelcomeConfig();
  if (!cfg.enabled) return null;

  // Safety: only run when treasury config is present.
  const tokenAddress = String(cfg.usdcContract || "").trim();
  if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    throw new Error("TREASURY_USDC_CONTRACT is not configured.");
  }

  // Hard safety: this faucet is for Arbitrum Sepolia only.
  // Prevent accidental enabling on mainnet-like environments.
  if (!cfg.chainId) {
    throw new Error("TREASURY_CHAIN_ID is not configured.");
  }
  if (cfg.chainId !== 421614) {
    throw new Error("Welcome USDC grant is only supported on Arbitrum Sepolia (chainId 421614).");
  }

  const signer = getTreasurySigner();
  if (!signer) {
    throw new Error("TREASURY_RPC_URL / TREASURY_PRIVATE_KEY is not configured.");
  }

  const recipient = validateAddress(toAddress);
  const decimals = Math.max(0, Math.min(18, Number(cfg.decimals || 6)));
  const amountHuman = Number(cfg.amount || 0);
  if (!Number.isFinite(amountHuman) || amountHuman <= 0) {
    throw new Error("WELCOME_USDC_AMOUNT must be a positive number.");
  }

  const amountUnits = ethers.parseUnits(String(amountHuman), decimals);
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await contract.transfer(recipient, amountUnits);

  if (cfg.waitConfirmations > 0) {
    const receipt = await tx.wait(cfg.waitConfirmations);
    return {
      status: "confirmed",
      txHash: String(tx.hash || "").toLowerCase(),
      blockNumber: receipt?.blockNumber ?? null,
    };
  }

  return {
    status: "submitted",
    txHash: String(tx.hash || "").toLowerCase(),
  };
}

/**
 * Idempotent helper: issue the welcome grant once per user.
 * It does not throw (it records errors in the user doc).
 */
async function maybeIssueWelcomeUsdcForUser(user) {
  const cfg = getWelcomeConfig();
  if (!cfg.enabled) return false;
  if (!user) return false;

  // Already issued (or in-flight)
  if (user.welcomeUsdc?.status) return false;

  const issuedAt = now();
  user.welcomeUsdc = {
    amount: cfg.amount,
    chainId: cfg.chainId,
    tokenAddress: String(cfg.usdcContract || "").trim().toLowerCase() || null,
    status: "pending",
    txHash: null,
    error: null,
    issuedAt,
    confirmedAt: null,
  };

  try {
    const result = await sendWelcomeUsdc({ toAddress: user.address });
    if (!result) {
      // Disabled between checks.
      user.welcomeUsdc.status = null;
      return false;
    }

    user.welcomeUsdc.txHash = result.txHash;
    if (result.status === "confirmed") {
      user.welcomeUsdc.status = "succeeded";
      user.welcomeUsdc.confirmedAt = now();
    } else {
      user.welcomeUsdc.status = "submitted";
    }

    return true;
  } catch (err) {
    user.welcomeUsdc.status = "failed";
    user.welcomeUsdc.error = err instanceof Error ? err.message : String(err);
    return false;
  }
}

module.exports = {
  getWelcomeConfig,
  sendWelcomeUsdc,
  maybeIssueWelcomeUsdcForUser,
};

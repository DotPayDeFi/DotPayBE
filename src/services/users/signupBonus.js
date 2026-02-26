const { ethers } = require("ethers");
const { mpesaConfig } = require("../../config/mpesa");

const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
];

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isAddress(value) {
  return /^0x[a-f0-9]{40}$/.test(normalizeAddress(value));
}

function readBonusConfig() {
  const bonus = mpesaConfig.signupBonus || {};
  const treasury = mpesaConfig.treasury || {};

  return {
    enabled: Boolean(bonus.enabled),
    amountUsd: Number(bonus.amountUsd || 0),
    chainId: Number(bonus.chainId || 0) || null,
    waitConfirmations: Math.max(1, Number(bonus.waitConfirmations || treasury.waitConfirmations || 1)),
    rpcUrl: String(treasury.rpcUrl || "").trim(),
    privateKey: String(treasury.privateKey || "").trim(),
    tokenAddress: normalizeAddress(treasury.usdcContract),
    treasuryChainId: Number(treasury.chainId || 0) || null,
    decimals: Math.max(0, Math.min(18, Number(treasury.usdcDecimals || 6))),
  };
}

function ensureTransferConfig(config) {
  const missing = [];
  if (!config.rpcUrl) missing.push("TREASURY_RPC_URL");
  if (!config.privateKey) missing.push("TREASURY_PRIVATE_KEY");
  if (!config.tokenAddress) missing.push("TREASURY_USDC_CONTRACT");
  if (missing.length > 0) {
    throw new Error(`Missing signup bonus treasury config: ${missing.join(", ")}`);
  }
}

function currentAttempts(user) {
  const n = Number(user?.signupBonus?.attempts || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function markPending(user, config) {
  user.signupBonus = {
    ...(user.signupBonus || {}),
    status: "pending",
    amountUsd: config.amountUsd,
    tokenAddress: config.tokenAddress || null,
    chainId: config.treasuryChainId || config.chainId || null,
    lastAttemptAt: new Date(),
    attempts: currentAttempts(user) + 1,
    lastError: null,
  };
  await user.save();
}

async function markFailure(user, config, err) {
  user.signupBonus = {
    ...(user.signupBonus || {}),
    status: "failed",
    amountUsd: config.amountUsd || user?.signupBonus?.amountUsd || null,
    tokenAddress: config.tokenAddress || user?.signupBonus?.tokenAddress || null,
    chainId: config.treasuryChainId || config.chainId || user?.signupBonus?.chainId || null,
    lastAttemptAt: new Date(),
    attempts: currentAttempts(user),
    lastError: err?.message || "Signup bonus transfer failed.",
  };
  await user.save();
}

async function markFunded(user, details) {
  user.signupBonus = {
    ...(user.signupBonus || {}),
    status: "funded",
    amountUsd: details.amountUsd,
    amountUnits: details.amountUnits,
    tokenAddress: details.tokenAddress,
    chainId: details.chainId,
    txHash: details.txHash,
    fundedAt: new Date(),
    lastAttemptAt: new Date(),
    attempts: currentAttempts(user),
    lastError: null,
  };
  await user.save();
}

/**
 * One-time USDC grant from treasury to newly onboarded users.
 * Designed for Arbitrum Sepolia testing, gated by env config and user state.
 */
async function grantSignupUsdcBonus(user, options = {}) {
  const source = String(options.source || "signup").trim() || "signup";
  if (!user) return { granted: false, reason: "missing_user" };

  const recipient = normalizeAddress(user.address);
  if (!isAddress(recipient)) {
    return { granted: false, reason: "invalid_recipient" };
  }

  if (user?.signupBonus?.status === "funded" && user?.signupBonus?.txHash) {
    return {
      granted: false,
      reason: "already_funded",
      txHash: normalizeAddress(user.signupBonus.txHash),
    };
  }

  const config = readBonusConfig();
  if (!config.enabled) return { granted: false, reason: "disabled" };
  if (!(config.amountUsd > 0)) return { granted: false, reason: "invalid_amount" };

  // Default behavior is Sepolia testing only.
  if (config.chainId && config.treasuryChainId && config.chainId !== config.treasuryChainId) {
    return {
      granted: false,
      reason: "chain_mismatch",
      message: `Treasury chainId ${config.treasuryChainId} does not match signup bonus chainId ${config.chainId}.`,
    };
  }

  try {
    ensureTransferConfig(config);
    await markPending(user, config);

    const amountUnits = ethers.parseUnits(config.amountUsd.toFixed(config.decimals), config.decimals);
    if (amountUnits <= 0n) {
      throw new Error("Signup bonus amount rounds to zero.");
    }

    const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.treasuryChainId || undefined);
    const signer = new ethers.Wallet(config.privateKey, provider);
    const token = new ethers.Contract(config.tokenAddress, ERC20_ABI, signer);

    const transferTx = await token.transfer(recipient, amountUnits);
    const receipt = await transferTx.wait(config.waitConfirmations);
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error("Signup bonus transfer transaction failed.");
    }

    const txHash = normalizeAddress(transferTx.hash);
    await markFunded(user, {
      amountUsd: config.amountUsd,
      amountUnits: amountUnits.toString(),
      tokenAddress: config.tokenAddress,
      chainId: config.treasuryChainId || config.chainId || null,
      txHash,
    });

    return {
      granted: true,
      reason: "funded",
      source,
      txHash,
      amountUsd: config.amountUsd,
      amountUnits: amountUnits.toString(),
      recipient,
    };
  } catch (err) {
    try {
      await markFailure(user, config, err);
    } catch {
      // Ignore secondary persistence failures; primary error will still be returned.
    }
    return {
      granted: false,
      reason: "failed",
      source,
      message: err?.message || "Signup bonus transfer failed.",
    };
  }
}

module.exports = {
  grantSignupUsdcBonus,
};


const { ethers } = require("ethers");
const { mpesaConfig } = require("../../config/mpesa");

const ERC20_ABI = ["function transfer(address to, uint256 value) returns (bool)"];

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

function parseUsdAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function hasTreasuryTransferConfig() {
  const treasury = mpesaConfig.treasury || {};
  return Boolean(
    String(treasury.rpcUrl || "").trim() &&
      String(treasury.privateKey || "").trim() &&
      String(treasury.usdcContract || "").trim()
  );
}

function getTreasuryTransferConfig() {
  const treasury = mpesaConfig.treasury || {};
  if (!hasTreasuryTransferConfig()) {
    throw new Error(
      "Missing treasury transfer configuration (TREASURY_RPC_URL, TREASURY_PRIVATE_KEY, TREASURY_USDC_CONTRACT)."
    );
  }

  const chainIdRaw = Number(treasury.chainId || 0);
  const chainId = Number.isFinite(chainIdRaw) && chainIdRaw > 0 ? Math.trunc(chainIdRaw) : null;
  const decimalsRaw = Number(treasury.usdcDecimals || 6);
  const decimals = Math.max(0, Math.min(18, Number.isFinite(decimalsRaw) ? Math.trunc(decimalsRaw) : 6));
  const waitConfirmationsRaw = Number(treasury.waitConfirmations || 1);
  const waitConfirmations = Math.max(
    1,
    Number.isFinite(waitConfirmationsRaw) ? Math.trunc(waitConfirmationsRaw) : 1
  );

  return {
    rpcUrl: String(treasury.rpcUrl || "").trim(),
    privateKey: String(treasury.privateKey || "").trim(),
    usdcContract: normalizeAddress(treasury.usdcContract),
    chainId,
    decimals,
    waitConfirmations,
    treasuryAddress: normalizeAddress(treasury.address),
  };
}

async function sendUsdcFromTreasury({ recipientAddress, amountUsd }) {
  const recipient = normalizeAddress(recipientAddress);
  if (!/^0x[a-f0-9]{40}$/.test(recipient)) {
    throw new Error("Recipient wallet address is invalid.");
  }

  const usdAmount = parseUsdAmount(amountUsd);
  if (usdAmount <= 0) {
    throw new Error("Settlement amount must be greater than zero.");
  }

  const cfg = getTreasuryTransferConfig();
  const amountUnits = ethers.parseUnits(usdAmount.toFixed(cfg.decimals), cfg.decimals);
  if (amountUnits <= 0n) {
    throw new Error("Settlement amount rounds to zero.");
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId || undefined);
  const signer = new ethers.Wallet(cfg.privateKey, provider);
  const token = new ethers.Contract(cfg.usdcContract, ERC20_ABI, signer);

  const sent = await token.transfer(recipient, amountUnits);
  const receipt = await sent.wait(cfg.waitConfirmations);
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error("On-chain settlement transaction failed.");
  }

  return {
    txHash: normalizeHash(sent.hash),
    chainId: cfg.chainId,
    tokenAddress: cfg.usdcContract,
    treasuryAddress: cfg.treasuryAddress || normalizeAddress(signer.address),
    amountUnits: amountUnits.toString(),
    amountUsd: parseFloat(usdAmount.toFixed(cfg.decimals)),
    fromAddress: normalizeAddress(signer.address),
    toAddress: recipient,
  };
}

function getOnrampCreditAmountUsd(transaction) {
  const fromQuote = parseUsdAmount(transaction?.quote?.amountUsd);
  if (fromQuote > 0) return fromQuote;

  const amountKes = parseUsdAmount(transaction?.quote?.amountKes);
  const rateKesPerUsd = parseUsdAmount(transaction?.quote?.rateKesPerUsd);
  if (amountKes > 0 && rateKesPerUsd > 0) {
    return amountKes / rateKesPerUsd;
  }

  return 0;
}

async function settleOnrampToUserWallet(transaction) {
  if (!transaction || transaction.flowType !== "onramp") {
    throw new Error("Onramp settlement is only supported for onramp transactions.");
  }

  const existingTxHash = normalizeHash(transaction?.onchain?.txHash);
  if (/^0x[a-f0-9]{64}$/.test(existingTxHash)) {
    return {
      reused: true,
      txHash: existingTxHash,
    };
  }

  const amountUsd = getOnrampCreditAmountUsd(transaction);
  if (amountUsd <= 0) {
    throw new Error("Unable to determine onramp settlement amount.");
  }

  const recipientAddress = normalizeAddress(transaction.userAddress);
  const settled = await sendUsdcFromTreasury({
    recipientAddress,
    amountUsd,
  });

  transaction.onchain = {
    ...(transaction.onchain || {}),
    required: false,
    txHash: settled.txHash,
    chainId: settled.chainId,
    tokenAddress: settled.tokenAddress,
    tokenSymbol: "USDC",
    treasuryAddress: settled.treasuryAddress,
    expectedAmountUsd: settled.amountUsd,
    expectedAmountUnits: settled.amountUnits,
    fundedAmountUsd: settled.amountUsd,
    fundedAmountUnits: settled.amountUnits,
    fromAddress: settled.fromAddress,
    toAddress: settled.toAddress,
    logIndex: null,
    verificationStatus: "verified",
    verificationError: null,
    verifiedBy: "treasury_settlement",
    verifiedAt: new Date(),
  };

  return settled;
}

module.exports = {
  hasTreasuryTransferConfig,
  settleOnrampToUserWallet,
};


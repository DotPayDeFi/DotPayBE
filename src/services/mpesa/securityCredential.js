const crypto = require("crypto");
const fs = require("fs");

function normalizePem(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (text.includes("BEGIN CERTIFICATE") || text.includes("BEGIN PUBLIC KEY")) return text;

  // If someone provides a base64 DER blob, wrap it as a PEM certificate.
  const b64 = text.replace(/\s+/g, "");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

function generateSecurityCredential({ initiatorPassword, certificatePemOrDer }) {
  const password = Buffer.from(String(initiatorPassword || ""), "utf8");
  if (!password.length) {
    throw new Error("initiatorPassword is required to generate SecurityCredential.");
  }

  const key = normalizePem(certificatePemOrDer);
  if (!key) {
    throw new Error("certificatePemOrDer is required to generate SecurityCredential.");
  }

  // Daraja expects RSA encryption using PKCS#1 v1.5 padding, base64-encoded.
  // Node/OpenSSL versions differ in whether passing a full X.509 cert directly is accepted,
  // so normalize to a PublicKey KeyObject first for maximum compatibility.
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(key);
  } catch {
    publicKey = key;
  }

  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    password
  );

  return encrypted.toString("base64");
}

function generateSecurityCredentialFromCertPath({ initiatorPassword, certPath }) {
  const pem = fs.readFileSync(certPath, "utf8");
  return generateSecurityCredential({ initiatorPassword, certificatePemOrDer: pem });
}

module.exports = {
  generateSecurityCredential,
  generateSecurityCredentialFromCertPath,
};

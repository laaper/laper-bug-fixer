const crypto = require("node:crypto");
const { ApiError } = require("./errors");

const CERT_URL = "https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let cachedCerts = null;
let certsExpireAt = 0;

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function getSigningCerts() {
  if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts;
  let response;
  try {
    response = await fetch(CERT_URL, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new ApiError(503, "auth_verification_unavailable", "Authentication verification is temporarily unavailable.");
  }
  if (!response.ok) throw new ApiError(503, "auth_verification_unavailable", "Authentication verification is temporarily unavailable.");
  const certs = await response.json();
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300);
  cachedCerts = certs;
  certsExpireAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  return certs;
}

async function verifyFirebaseIdToken(token, projectId) {
  if (!projectId) throw new ApiError(503, "auth_not_configured", "Firebase authentication is not configured.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "unauthorized", "A valid sign-in token is required.");
  let header;
  let claims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    throw new ApiError(401, "unauthorized", "A valid sign-in token is required.");
  }
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${projectId}`;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || claims.iss !== issuer || claims.aud !== projectId ||
      typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60) {
    throw new ApiError(401, "unauthorized", "A valid sign-in token is required.");
  }
  const certs = await getSigningCerts();
  const cert = certs[header.kid];
  if (!cert) {
    cachedCerts = null;
    throw new ApiError(401, "unauthorized", "A valid sign-in token is required.");
  }
  const valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), cert, Buffer.from(parts[2], "base64url"));
  if (!valid) throw new ApiError(401, "unauthorized", "A valid sign-in token is required.");
  return { uid: claims.sub };
}

module.exports = { verifyFirebaseIdToken };

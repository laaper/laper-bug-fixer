const http = require("node:http");
const crypto = require("node:crypto");
const config = require("./config");
const { verifyFirebaseIdToken } = require("./firebase-auth");
const { providerStatus } = require("./providers");
const { run } = require("./council");
const { ApiError } = require("./errors");

const buckets = new Map();
const WINDOW_MS = 60_000;

function send(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!config.origins.includes(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  res.setHeader("access-control-max-age", "600");
  return true;
}

function enforceRateLimit(key) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 10_000) {
    for (const [entry, value] of buckets) if (now - value.startedAt >= WINDOW_MS) buckets.delete(entry);
  }
  if (bucket.count > config.maxRequestsPerMinute) throw new ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.");
}

async function readJson(req) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > config.maxBodyBytes) throw new ApiError(413, "body_too_large", "Request body is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.maxBodyBytes) throw new ApiError(413, "body_too_large", "Request body is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "invalid_json", "Request body must be valid JSON."); }
}

function validateChat(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_request", "A JSON object is required.");
  if (typeof body.message !== "string" || !body.message.trim()) throw new ApiError(400, "invalid_message", "message is required.");
  const message = body.message.trim();
  if (message.length > 8000) throw new ApiError(400, "message_too_long", "message must be 8,000 characters or fewer.");
  const mode = body.mode === undefined ? "fast" : body.mode;
  if (mode !== "fast" && mode !== "council") throw new ApiError(400, "invalid_mode", "mode must be 'fast' or 'council'.");
  const rawHistory = body.history === undefined ? [] : body.history;
  if (!Array.isArray(rawHistory) || rawHistory.length > 20) throw new ApiError(400, "invalid_history", "history must be an array with at most 20 entries.");
  const history = rawHistory.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, "invalid_history", "Each history entry must include a role and text.");
    const text = typeof item.text === "string" ? item.text : (typeof item.content === "string" ? item.content : "");
    if (!text.trim() || text.length > 4000) throw new ApiError(400, "invalid_history", "History text must be between 1 and 4,000 characters.");
    if (!["user", "model", "assistant"].includes(item.role)) throw new ApiError(400, "invalid_history", "History roles must be user or model/assistant.");
    return { role: item.role, text: text.trim() };
  });
  return { message, history, mode };
}

async function authenticate(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) throw new ApiError(401, "unauthorized", "A Firebase sign-in token is required.");
  return verifyFirebaseIdToken(match[1], config.firebaseProjectId);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let status = 500;
    try {
      if (!applyCors(req, res)) throw new ApiError(403, "origin_not_allowed", "This website origin is not allowed.");
      if (req.method === "OPTIONS") {
        status = 204;
        res.writeHead(status);
        return res.end();
      }
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
        status = 200;
        return send(res, status, { success: true, service: "laper-ai-council-api", status: "ok" });
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const user = await authenticate(req);
        enforceRateLimit(user.uid);
        status = 200;
        return send(res, status, { success: true, providers: providerStatus() });
      }
      if (req.method === "POST" && (url.pathname === "/aiChat" || url.pathname === "/api/chat")) {
        if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError(415, "content_type_required", "Content-Type must be application/json.");
        }
        const user = await authenticate(req);
        enforceRateLimit(user.uid);
        const input = validateChat(await readJson(req));
        const result = await run(input);
        status = 200;
        return send(res, status, result);
      }
      if (req.method !== "GET" && req.method !== "POST") throw new ApiError(405, "method_not_allowed", "This HTTP method is not supported.");
      throw new ApiError(404, "not_found", "Route not found.");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "The request could not be completed.");
      status = apiError.status;
      if (status === 429) res.setHeader("retry-after", "60");
      send(res, status, {
        success: false,
        error: apiError.message,
        code: apiError.code,
        requestId,
        ...(apiError.details ? { details: apiError.details } : {})
      });
    } finally {
      // Deliberately omit message text, auth tokens, IP addresses, and upstream payloads.
      process.stdout.write(`${JSON.stringify({ event: "request", requestId, method: req.method, route: req.url?.split("?")[0], status, durationMs: Date.now() - startedAt })}\n`);
    }
  });
}

if (require.main === module) {
  createServer().listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`${JSON.stringify({ event: "startup", port: config.port, providerStatus: providerStatus() })}\n`);
  });
}

module.exports = { createServer, validateChat, enforceRateLimit };

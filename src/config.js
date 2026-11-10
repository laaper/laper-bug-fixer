const positiveInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const allowedProviders = new Set(["gemini", "groq"]);
const fastProvider = (process.env.FAST_PROVIDER || "gemini").toLowerCase();

module.exports = {
  port: positiveInt(process.env.PORT, 3000, 1, 65535),
  nodeEnv: process.env.NODE_ENV || "development",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
  origins: (process.env.LAPER_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  timeoutMs: positiveInt(process.env.REQUEST_TIMEOUT_MS, 30000, 1000, 120000),
  maxRequestsPerMinute: positiveInt(process.env.MAX_REQUESTS_PER_MINUTE, 20, 1, 1000),
  maxBodyBytes: positiveInt(process.env.MAX_BODY_BYTES, 32768, 1024, 262144),
  fastProvider: allowedProviders.has(fastProvider) ? fastProvider : "gemini",
  providers: {
    gemini: {
      key: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash"
    },
    groq: {
      key: process.env.GROQ_API_KEY || "",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    },
  }
};

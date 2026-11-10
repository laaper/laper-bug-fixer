const config = require("./config");
const { ApiError } = require("./errors");

function providerStatus() {
  return Object.fromEntries(Object.entries(config.providers).map(([name, item]) => [name, {
    configured: Boolean(item.key),
    model: item.model || null
  }]));
}

function upstreamError(status, provider) {
  if (status === 429) return new ApiError(429, "provider_quota_exceeded", `${provider} is at its current quota or rate limit. Try again later; no alternate provider was called.`);
  if (status === 401 || status === 403) return new ApiError(502, "provider_auth_error", `${provider} rejected its server-side credentials. Check the backend configuration.`);
  if (status >= 500) return new ApiError(502, "provider_unavailable", `${provider} is temporarily unavailable.`);
  return new ApiError(502, "provider_request_failed", `${provider} could not complete the request.`);
}

async function requestJson(url, headers, body, provider) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new ApiError(504, "provider_timeout", `${provider} did not respond before the timeout.`);
    throw new ApiError(502, "provider_network_error", `${provider} could not be reached.`);
  }
  if (!response.ok) throw upstreamError(response.status, provider);
  try { return await response.json(); }
  catch { throw new ApiError(502, "provider_invalid_response", `${provider} returned an unreadable response.`); }
}

function chatMessages({ message, history = [], system = "" }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  for (const item of history) {
    messages.push({ role: item.role === "model" || item.role === "assistant" ? "assistant" : "user", content: item.text });
  }
  messages.push({ role: "user", content: message });
  return messages;
}

async function complete(provider, input) {
  const setting = config.providers[provider];
  if (!setting?.key) {
    throw new ApiError(503, "provider_unconfigured", `${provider} is not configured. Add its key in the server environment.`);
  }
  if (provider === "gemini") {
    const contents = [...input.history.map((item) => ({
      role: item.role === "model" || item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.text }]
    })), { role: "user", parts: [{ text: input.message }] }];
    const body = {
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {})
    };
    const data = await requestJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setting.model)}:generateContent`,
      { "x-goog-api-key": setting.key }, body, "Gemini"
    );
    const answer = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
    if (!answer) throw new ApiError(502, "provider_empty_response", "Gemini returned an empty response.");
    return { answer, model: setting.model };
  }
  const base = "https://api.groq.com/openai/v1/chat/completions";
  const data = await requestJson(base, { authorization: `Bearer ${setting.key}` }, {
    model: setting.model,
    messages: chatMessages(input),
    temperature: 0.7,
    max_tokens: 2048
  }, "Groq");
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new ApiError(502, "provider_empty_response", `${provider} returned an empty response.`);
  return { answer, model: data.model || setting.model };
}

module.exports = { complete, providerStatus };

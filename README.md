# Laper AI Council backend — Stage 1

An isolated Node.js 20 HTTP API for the Laper AI chat. It does not modify the Laper website and has not been deployed. It uses Node's built-in modules only.

## What is included

- `POST /aiChat` preserves the route already present in the inspected Laper page.
- `POST /api/chat` is an equivalent versioned route for future frontend work.
- Fast mode sends one request to `FAST_PROVIDER` (Gemini by default). It never falls back to another provider.
- Council mode runs Gemini Creator → Groq Reviewer → Gemini Verifier sequentially. It checks that Gemini and Groq are configured before sending any provider request. Any quota/provider failure stops the run; there is no fallback or automatic billing logic.
- Firebase ID-token authentication, exact-origin CORS, per-user process-local rate limiting, JSON/schema/body-size limits, upstream timeouts, sanitized errors, request IDs, health check, and privacy-conscious logs.
- Provider keys remain server environment variables. They are unset by default.

## Frontend integration contract

The inspected Laper page at `laper-development/public/index.html` currently defines `AI_API_URL` as `https://lapper-ai.onrender.com/aiChat`. It posts `{ message, history }`, where history items use `{ role, text }`, and reads `{ success, answer, error }`. The old payload is accepted and defaults to Fast mode. The available page source did not send an authorization header. The existing Firebase client sign-in should provide a Firebase ID token; add it to the request before connecting this backend:

```js
const token = await window.laperAuth.currentUser.getIdToken();
const response = await fetch(AI_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({ message, history, mode: "fast" })
});
```

For Council mode set `mode: "council"`. A successful Fast response contains `success`, `answer`, `model`, and `mode`. A successful Council response contains `success`, final `answer`, `mode: "council"`, `verification: "completed"`, and role/provider/model metadata. Errors use `{ success: false, error, code, requestId }`; show quota, missing configuration, and auth failures clearly in the UI. Do not put provider keys or a shared backend secret in browser code.

This frontend contract is based on the project source found at `C:\Users\Parth mahajan\Documents\Codex\2026-11-09\project-laper-engineer-autonomous-ai-software\laper-development`. The codebase was inspected read-only. The Render URL is already referenced there, but source alone cannot confirm which backend currently owns it. The contract is therefore compatible with the inspected client, but should be confirmed against the live service before changing the website.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set `FIREBASE_PROJECT_ID` to the Firebase project used by Laper. Set `LAPER_ORIGINS` to the exact production and local development origins.
3. Add provider keys only after obtaining them. Fast mode requires `GEMINI_API_KEY`. Council requires both `GEMINI_API_KEY` and `GROQ_API_KEY`; Gemini is called twice, once for Creator and once for Verifier.
4. Run `npm test`, then `npm start`. `GET /health` checks process availability. `GET /api/status` requires a Firebase ID token and reports provider configuration without revealing secrets.

No `.env` file or provider credentials are included.

## Render setup (manual; no deployment performed)

1. Put this folder in a private Git repository, or select the backend subdirectory when configuring a Render service from the repository.
2. Create a Render **Web Service** with Node runtime. Use build command `npm install`, start command `npm start`, and health check path `/health`. `render.yaml` provides the same service blueprint.
3. Add `FIREBASE_PROJECT_ID`, `LAPER_ORIGINS`, and provider keys using Render's Environment settings. Keep secrets out of source control. The Verifier uses the existing Gemini key.
4. Keep `FAST_PROVIDER=gemini` unless intentionally changing Fast mode. The backend will return an explicit unavailable/configuration error rather than route to a different provider.
5. After you review the API and configure credentials, test the Render URL privately. Do not update the website's `AI_API_URL` until auth, CORS, and real provider calls are confirmed.

Render free instances may sleep or restart. The in-memory rate limit resets on restart and is per instance, so it is a basic abuse limit, not a durable multi-instance quota. For public production traffic, use a shared rate-limit store and monitoring before broad rollout. The API sends prompts and supplied history to the selected provider; disclose this in the product and ask users not to submit sensitive information. Logs intentionally exclude message contents, bearer tokens, and IP addresses.

## API details

- `GET /health`: unauthenticated process check only; does not imply providers are configured.
- `GET /api/status`: Firebase bearer token required; reports configured booleans/model IDs.
- `POST /aiChat` or `/api/chat`: Firebase bearer token required. JSON body: `{ "message": "...", "history": [{ "role": "user"|"model", "text": "..." }], "mode": "fast"|"council" }`. `mode` is optional and defaults to `fast` for the inspected legacy Laper client.
- Quota exhaustion returns HTTP 429 and `code: "provider_quota_exceeded"`. No other provider is attempted.
- Each provider request has a configurable timeout. Secrets and upstream response bodies are never returned to the client or logged.

Provider request formats follow the vendors' current API references: [Gemini](https://ai.google.dev/api) and [Groq](https://console.groq.com/docs/api-reference).

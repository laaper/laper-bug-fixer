const test = require("node:test");
const assert = require("node:assert/strict");
const { validateChat } = require("../src/server");
const { providerStatus } = require("../src/providers");

test("accepts the current Laper payload shape and defaults it to Fast mode", () => {
  const parsed = validateChat({
    message: "Hello",
    history: [{ role: "user", text: "Earlier" }, { role: "model", text: "Answer" }]
  });
  assert.equal(parsed.mode, "fast");
  assert.equal(parsed.history.length, 2);
});

test("supports explicit Council mode", () => {
  assert.equal(validateChat({ message: "Check this", mode: "council" }).mode, "council");
});

test("rejects invalid and oversized request inputs", () => {
  assert.throws(() => validateChat({ message: " " }), { code: "invalid_message" });
  assert.throws(() => validateChat({ message: "x".repeat(8001) }), { code: "message_too_long" });
  assert.throws(() => validateChat({ message: "ok", mode: "automatic-fallback" }), { code: "invalid_mode" });
  assert.throws(() => validateChat({ message: "ok", history: Array(21).fill({ role: "user", text: "x" }) }), { code: "invalid_history" });
});

test("reports provider keys as unconfigured until supplied", () => {
  const status = providerStatus();
  assert.equal(status.gemini.configured, false);
  assert.equal(status.groq.configured, false);
  assert.equal(Object.hasOwn(status, "openrouter"), false);
});


import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_SETTINGS, getProviderPreset } from "../lib/ai/model-settings.ts";
import {
  assertClientBaseURL,
  clientReasoning,
  publicClientModelError,
  resolveClientModel,
  safeClientHeaders,
} from "../lib/ai/client-provider.ts";
import { normalizedClientCatalog } from "../lib/ai/client-models.ts";
import { clientBuilderTransport } from "../lib/ai/client-chat.ts";

function settingsFor(presetId, overrides = {}) {
  const preset = getProviderPreset(presetId);
  return {
    ...DEFAULT_MODEL_SETTINGS,
    ...preset,
    ...overrides,
    capabilities: { ...DEFAULT_MODEL_SETTINGS.capabilities, ...overrides.capabilities },
    generation: { ...DEFAULT_MODEL_SETTINGS.generation, ...overrides.generation },
    builder: { ...DEFAULT_MODEL_SETTINGS.builder, ...overrides.builder },
  };
}

test("validates browser-direct URLs and removes forbidden headers", () => {
  assert.equal(assertClientBaseURL("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(assertClientBaseURL("http://localhost:11434/v1"), "http://localhost:11434/v1");
  assert.throws(() => assertClientBaseURL("http://api.example.com/v1"), /HTTPS/);
  assert.throws(() => assertClientBaseURL("https://user:secret@example.com/v1"), /账号/);

  const headers = safeClientHeaders(settingsFor("custom", {
    apiKey: "secret",
    authMode: "api-key",
    customHeaders: { Cookie: "bad", Origin: "bad", "X-Trace": "ok" },
  }), "secret");
  assert.deepEqual(headers, { "X-Trace": "ok", "api-key": "secret" });
});

test("uses a local browser generator when automatic mode has no key", () => {
  const resolved = resolveClientModel(settingsFor("auto", { apiKey: "" }));
  assert.equal(resolved.mode, "local");
  assert.match(resolved.label, /浏览器本地/);
});

test("disables incompatible DeepSeek thinking mode and sanitizes browser errors", () => {
  assert.equal(clientReasoning(settingsFor("deepseek", {
    generation: { ...DEFAULT_MODEL_SETTINGS.generation, reasoningEffort: "high" },
  })), undefined);
  assert.equal(clientReasoning(settingsFor("openai", {
    generation: { ...DEFAULT_MODEL_SETTINGS.generation, reasoningEffort: "low" },
  })), "low");
  // "off" 必须映射为 "none" 真正关闭推理，而不是 undefined（供应商默认仍会思考）。
  assert.equal(clientReasoning(settingsFor("openai", {
    generation: { ...DEFAULT_MODEL_SETTINGS.generation, reasoningEffort: "off" },
  })), "none");
  const message = publicClientModelError(new Error("Failed to fetch secret-key"), "secret-key");
  assert.doesNotMatch(message, /secret-key/);
  assert.match(message, /CORS/);
});

test("normalizes provider model catalogs in the browser", () => {
  const models = normalizedClientCatalog({ data: [
    { id: "gpt-5", owned_by: "openai" },
    { id: "text-embedding-3-large" },
    { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
    { id: "gpt-5" },
  ] });
  assert.deepEqual(models.map((model) => model.id), ["gpt-5", "gemini-2.5-pro"]);
  assert.equal(models[0].vision, true);
});

test("streams the no-key demo locally without an HTTP chat endpoint", async () => {
  const stream = await clientBuilderTransport.sendMessages({
    trigger: "submit-message",
    chatId: "browser-test",
    messageId: undefined,
    messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "生成一座小屋" }] }],
    abortSignal: undefined,
    body: {
      version: "1.21.11",
      source: "",
      settings: settingsFor("auto", { apiKey: "" }),
    },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.ok(chunks.some((chunk) => chunk.type === "tool-input-available" && chunk.toolName === "commit_source"));
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
});

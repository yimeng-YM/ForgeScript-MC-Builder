import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function fetchWorker(path = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init ?? { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ForgeScript workbench shell", async () => {
  const response = await fetchWorker();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ForgeScript/);
  assert.match(html, /Minecraft AI 建筑工作台/);
  assert.match(html, /与建筑 AI 对话/);
  assert.match(html, /打开模型与生成设置/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /forgescript-favicon-32\.png/);
  assert.match(html, /forgescript-icon-512\.png/);
  assert.doesNotMatch(html, /rel="icon"[^>]+og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("the 3D viewport owns and releases one WebGL renderer", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "builder", "viewport-3d.tsx"),
    "utf8",
  );

  assert.equal(source.match(/new THREE\.WebGLRenderer/g)?.length, 1);
  assert.match(source, /renderer\.forceContextLoss\(\)/);
  assert.doesNotMatch(source, /PCFSoftShadowMap/);
});

test("tests the default model connection without exposing a secret", async () => {
  const response = await fetchWorker("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.mode, "local");
  assert.doesNotMatch(JSON.stringify(result), /apiKey|AI_GATEWAY_API_KEY/);
});

test("rejects malformed model catalog requests before contacting a provider", async () => {
  const response = await fetchWorker("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: {} }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /模型配置无效/);
});

test("rejects malformed chat message histories with a 400 response", async () => {
  const response = await fetchWorker("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [null] }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /Invalid UI message history/);
});

test("rejects invalid chat JSON without raising a server error", async () => {
  const response = await fetchWorker("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /Invalid JSON/);
});

test("ships generated multi-version profile packs", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/version-packs/catalog.json", import.meta.url), "utf8"));
  assert.equal(catalog.format, 1);
  assert.ok(catalog.versions.length >= 16);
  assert.ok(catalog.versions.find((entry) => entry.id === "1.21.11")?.blockCount > 1000);
  assert.equal(catalog.versions.find((entry) => entry.id === "26.2")?.experimental, true);
});

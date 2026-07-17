import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ForgeScript workbench shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ForgeScript/);
  assert.match(html, /Minecraft AI 建筑工作台/);
  assert.match(html, /与建筑 AI 对话/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("ships generated multi-version profile packs", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/version-packs/catalog.json", import.meta.url), "utf8"));
  assert.equal(catalog.format, 1);
  assert.ok(catalog.versions.length >= 16);
  assert.ok(catalog.versions.find((entry) => entry.id === "1.21.11")?.blockCount > 1000);
  assert.equal(catalog.versions.find((entry) => entry.id === "26.2")?.experimental, true);
});


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

test("pre-renders the home page so Cloudflare serves it without invoking the Worker", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const workerConfig = JSON.parse(
    await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
  );
  const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(html, /ForgeScript/);
  assert.equal(workerConfig.assets.directory, "../client");
  assert.equal(workerConfig.assets.run_worker_first, undefined);
  assert.equal(workerConfig.limits, undefined);
  assert.doesNotMatch(layoutSource, /next\/headers|generateMetadata|headers\(\)/);
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

test("first-person preview requests pointer lock from the user gesture and suspends orbit controls", async () => {
  const viewport = await readFile(
    path.join(process.cwd(), "components", "builder", "viewport-3d.tsx"),
    "utf8",
  );
  const workbench = await readFile(
    path.join(process.cwd(), "components", "builder", "workbench.tsx"),
    "utf8",
  );

  assert.match(workbench, /viewportControllerRef\.current\?\.requestFirstPerson\(\)/);
  assert.match(workbench, /onSelect=\{selectBlock\}/);
  assert.doesNotMatch(workbench, /aria-label="第一人称移动速度"/);
  assert.match(viewport, /new PointerLockControls\(camera, renderer\.domElement\)/);
  assert.match(viewport, /if \(runtime\.firstPersonUpdate\) runtime\.firstPersonUpdate\(deltaSeconds\)/);
  assert.doesNotMatch(viewport, /requestAnimationFrame\(tick\)/);
  assert.match(viewport, /if \(!locked\) onFirstPersonChangeRef\.current\(false\)/);
  assert.match(viewport, /raycaster\.ray\.origin\.copy\(runtime\.renderedCameraPosition\)/);
  assert.match(viewport, /applyQuaternion\(runtime\.renderedCameraQuaternion\)/);
  assert.match(viewport, /pointerControls\.moveForward\(forward \* distance\)/);
  assert.match(viewport, /pointerControls\.moveRight\(right \* distance\)/);
  assert.match(viewport, /renderedCameraQuaternion/);
  assert.match(viewport, /canvas\.addEventListener\("wheel", onWheel/);
  assert.match(viewport, /first-person-speed-notice/);
  assert.doesNotMatch(viewport, /if \(document\.pointerLockElement === renderer\.domElement\) return/);
  assert.doesNotMatch(viewport, /requestAnimationFrame\(\(\) => \{\s*canvas\.requestPointerLock\(\)/);
});

test("keeps every AI operation in the browser client", async () => {
  const workbench = await readFile(new URL("../components/builder/workbench.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../components/builder/model-settings-dialog.tsx", import.meta.url), "utf8");
  const transport = await readFile(new URL("../lib/ai/client-chat.ts", import.meta.url), "utf8");
  const modelClient = await readFile(new URL("../lib/ai/client-models.ts", import.meta.url), "utf8");

  assert.doesNotMatch(workbench, /DefaultChatTransport|\/api\/chat/);
  assert.doesNotMatch(dialog, /\/api\/models/);
  assert.match(transport, /implements ChatTransport/);
  assert.match(transport, /createAgentUIStream/);
  assert.match(modelClient, /fetchClientModelCatalog/);
  await assert.rejects(readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"), /ENOENT/);
  await assert.rejects(readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8"), /ENOENT/);
  await assert.rejects(readFile(new URL("../app/api/models/test/route.ts", import.meta.url), "utf8"), /ENOENT/);
});

test("ships generated multi-version profile packs", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/version-packs/catalog.json", import.meta.url), "utf8"));
  assert.equal(catalog.format, 1);
  assert.ok(catalog.versions.length >= 16);
  assert.ok(catalog.versions.find((entry) => entry.id === "1.21.11")?.blockCount > 1000);
  assert.equal(catalog.versions.find((entry) => entry.id === "26.2")?.experimental, true);
});

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vinextCli = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const serverRoot = path.join(projectRoot, "dist", "server");
const clientRoot = path.join(projectRoot, "dist", "client");
const prerenderRoot = path.join(serverRoot, "prerendered-routes");
const prerenderManifest = path.join(serverRoot, "vinext-prerender.json");
const prerenderedIndex = path.join(prerenderRoot, "index.html");
const publishedIndex = path.join(clientRoot, "index.html");
const windowsVinextShutdownAssertion = 0xc0000409;

// Never accept artifacts left over from an earlier build when deciding whether
// vinext completed its prerendering phase successfully.
rmSync(prerenderManifest, { force: true });
rmSync(prerenderedIndex, { force: true });
rmSync(publishedIndex, { force: true });

const build = spawnSync(process.execPath, [vinextCli, "build", "--prerender-all"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

if (build.error) {
  throw build.error;
}

let homeRouteWasPrerendered = false;
let html = "";

if (existsSync(prerenderManifest) && existsSync(prerenderedIndex)) {
  const manifest = JSON.parse(readFileSync(prerenderManifest, "utf8"));
  const homeRoute = manifest.routes?.find((route) => route.route === "/");
  html = readFileSync(prerenderedIndex, "utf8");
  homeRouteWasPrerendered =
    homeRoute?.status === "rendered" &&
    /^<!doctype html>/i.test(html.trimStart()) &&
    html.includes("__VINEXT_RSC_DONE__");
}

if (!homeRouteWasPrerendered) {
  console.error("[build] The home page was not prerendered; refusing to publish a Worker-only build.");
  process.exit(build.status || 1);
}

const hitWindowsVinextShutdownAssertion =
  process.platform === "win32" && build.status === windowsVinextShutdownAssertion;

if (build.status !== 0 && !hitWindowsVinextShutdownAssertion) {
  process.exit(build.status || 1);
}

if (build.status !== 0) {
  // vinext 0.0.50 can hit a libuv assertion while shutting down on Windows,
  // after all build and prerender artifacts have already been written.
  console.warn(`[build] vinext exited with code ${build.status} after producing a valid prerender; continuing on Windows.`);
}

mkdirSync(clientRoot, { recursive: true });
copyFileSync(prerenderedIndex, publishedIndex);

console.log(`[build] Published static / to dist/client/index.html (${statSync(publishedIndex).size} bytes).`);

/**
 * Post-build script to fix SSR external module resolution in Cloudflare Workers.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SSR_ASSETS_DIR = resolve(import.meta.dirname, "..", "dist", "server", "ssr", "assets");

function bundleNpm(packageName) {
  try {
    return readFileSync(require.resolve(packageName), "utf-8");
  } catch {
    console.warn(`  Warning: cannot bundle "${packageName}" - stub`);
    return `// Stub for "${packageName}"\nexport {};`;
  }
}

const BUILTIN_BUNDLES = {
  "clsx": () => 'function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f)}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}export{clsx};export default clsx;',
  "@radix-ui/primitive": () => 'function composeEventHandlers(a,b,c){c=c||{};var d=c.checkForDefaultPrevented===void 0?true:c.checkForDefaultPrevented;return function(e){a&&a(e);if(d===false||!e||!e.defaultPrevented)return b&&b(e)}};export{composeEventHandlers};',
  "aria-hidden": () => 'export function hideOthers(t){return function(){}}export function inertOthers(t){return function(){}}export function suppressOthers(t){return function(){}}',
  "get-nonce": () => 'function getNonce(){if(typeof __webpack_nonce__!=="undefined")return __webpack_nonce__;return null}function setNonce(n){__webpack_nonce__=n}export{getNonce,setNonce};',
  "throttleit": () => 'export default function(fn,wait){var t=0;return function(){var n=Date.now();if(n-t>=wait){t=n;return fn.apply(this,arguments)}}};',
};

function getFileName(s) {
  if (s.endsWith(".js") || s.endsWith(".mjs")) return s;
  return s + ".js";
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function extractBareImports(fp) {
  const c = readFileSync(fp, "utf-8");
  const re = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^.@/][^"']*|[.@][^"']+)["']/g;
  const s = new Set(); let m;
  while ((m = re.exec(c)) !== null) {
    const sp = m[1];
    if (!sp.startsWith(".") && !sp.startsWith("node:")) s.add(sp);
  }
  return s;
}

function main() {
  console.log("Fixing SSR externals...");
  if (!existsSync(SSR_ASSETS_DIR)) { console.log("  No SSR assets dir."); return; }
  const all = new Set();
  for (const f of readdirSync(SSR_ASSETS_DIR).filter(x => x.endsWith(".js"))) {
    for (const imp of extractBareImports(resolve(SSR_ASSETS_DIR, f))) all.add(imp);
  }
  if (all.size === 0) { console.log("  No bare imports. Done."); return; }
  console.log(`  ${all.size} bare imports found.`);
  let cr = 0, sk = 0;
  for (const sp of all) {
    const fn = getFileName(sp);
    const fp = resolve(SSR_ASSETS_DIR, fn);
    if (existsSync(fp)) { sk++; continue; }
    ensureDir(dirname(fp));
    try {
      writeFileSync(fp, BUILTIN_BUNDLES[sp] ? BUILTIN_BUNDLES[sp]() : bundleNpm(sp), "utf-8");
      cr++;
      console.log(`    Created ${fn}`);
    } catch (e) {
      console.error(`    Failed ${sp}: ${e.message}`);
    }
  }
  console.log(`  Done: ${cr} created, ${sk} skipped.`);
}
main();

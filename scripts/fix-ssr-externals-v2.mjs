/**
 * Post-build: fix SSR external modules with smart stubs.
 * REAL: small critical packages bundled from node_modules.
 * STUB: large client-only packages replaced with no-op stubs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ASSETS = resolve(import.meta.dirname, "..", "dist", "server", "ssr", "assets");

// Packages to STUB (client-side only, large)
const STUB_PACKAGES = new Set([
  "three", "three/examples/jsm/controls/OrbitControls.js",
  "ai", "@ai-sdk/provider", "@ai-sdk/provider-utils", "@ai-sdk/gateway",
  "shiki", "shiki/core", "shiki/wasm", "shiki/engine/javascript",
  "shiki/langs/javascript.mjs", "shiki/langs/json.mjs",
  "shiki/themes/github-dark.mjs", "shiki/themes/github-light.mjs",
  "mermaid", "d3", "dompurify", "stylis",
  "@shikijs/engine-oniguruma", "@shikijs/engine-javascript",
  "es-toolkit/compat", "ts-dedent"
]);

// Inline implementations for tiny critical packages
const INLINE = {
  "clsx": 'function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f)}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}export{clsx};export default clsx;',
  "class-variance-authority": 'function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f)}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}var cx=clsx;var cva=function(base,config){return function(props){if((config===null||config===void 0?void 0:config.variants)==null)return cx(base,props===null||props===void 0?void 0:props.class,props===null||props===void 0?void 0:props.className);var v=config.variants,d=config.defaultVariants,cv=config.compoundVariants;var rv={};for(var k in v){var val=props===null||props===void 0?void 0:props[k];var res=val&&k in (d||{})?val:val!==null&&val!==void 0?val:d===null||d===void 0?void 0:d[k];if(res!==void 0)rv[k]=res}var cls=[];if(base)cls.push(base);var vc=[];for(var k1 in v){var vt=v[k1];var r1=rv[k1];if(r1===void 0||!(r1 in vt))continue;vc.push(vt[r1])}if(vc.length)cls.push(vc.join(" "));return cx(cls,props===null||props===void 0?void 0:props.class,props===null||props===void 0?void 0:props.className)};};export{cva,cx};',
  "@radix-ui/primitive": 'function composeEventHandlers(a,b,c){c=c||{};var d=c.checkForDefaultPrevented===void 0?true:c.checkForDefaultPrevented;return function(e){a&&a(e);if(d===false||!e||!e.defaultPrevented)return b&&b(e)}};export{composeEventHandlers};',
  "get-nonce": 'function getNonce(){if(typeof __webpack_nonce__!=="undefined")return __webpack_nonce__;return null}function setNonce(n){__webpack_nonce__=n}export{getNonce,setNonce};',
  "aria-hidden": 'export function hideOthers(t){return function(){}}export function inertOthers(t){return function(){}}export function suppressOthers(t){return function(){}}',
  "throttleit": 'export default function(fn,wait){var t=0;return function(){var n=Date.now();if(n-t>=wait){t=now;return fn.apply(this,arguments)}}};',
  "remend": 'export default function(){};',
  // Minimal tailwind-merge stub to save ~103KB - just passes classes through
  "tailwind-merge": 'function twMerge(){var r="";for(var i=0;i<arguments.length;i++){if(arguments[i]){if(r)r+=" ";r+=arguments[i]}}return r}export{twMerge};export default twMerge;export function extendTailwindMerge(c){return twMerge}export function createTailwindMerge(){return twMerge}',
};

function bundleNpm(pkg) {
  try { return readFileSync(require.resolve(pkg), "utf-8"); }
  catch { return "// not found\nexport {};"; }
}

function genStub(pkg, exports) {
  // Generate stub that exports all used names as no-ops
  let code = "// stub: " + pkg + "\n";
  if (exports.size === 0) {
    code += "export {};";
  } else {
    for (const name of exports) {
      if (name === "default") code += "export default function(){};\n";
      else code += "export function " + name + "(){}\n";
    }
  }
  return code;
}

function extractImports(fp) {
  const c = readFileSync(fp, "utf-8");
  const found = new Map(); // specifier -> Set of imported names
  const re = /import\s+((?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(c)) !== null) {
    const spec = m[2];
    if (spec.startsWith(".") || spec.startsWith("node:")) continue;
    const bindings = m[1];
    if (!found.has(spec)) found.set(spec, new Set());
    const names = found.get(spec);
    // Extract named/default imports
    for (const part of bindings.split(",")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("{")) {
        const inner = trimmed.slice(1, -1);
        for (const n of inner.split(",")) {
          const name = n.trim().split(/\s+as\s+/)[0].trim();
          if (name && name !== ",") names.add(name);
        }
      } else if (trimmed.startsWith("*")) {
        // namespace import - skip
      } else {
        // default import
        names.add("default");
      }
    }
  }
  // Also match side-effect imports: import "pkg"
  const seRe = /import\s+["']([^"']+)["']/g;
  while ((m = seRe.exec(c)) !== null) {
    const spec = m[1];
    if (!spec.startsWith(".") && !spec.startsWith("node:") && !found.has(spec)) {
      found.set(spec, new Set());
    }
  }
  return found;
}

function getFileName(s) {
  if (s.endsWith(".js") || s.endsWith(".mjs")) return s;
  return s + ".js";
}

function main() {
  if (!existsSync(ASSETS)) { console.log("No SSR assets dir."); return; }
  const all = new Map();
  for (const f of readdirSync(ASSETS).filter(x => x.endsWith(".js"))) {
    const imps = extractImports(resolve(ASSETS, f));
    for (const [spec, names] of imps) {
      if (!all.has(spec)) all.set(spec, new Set());
      for (const n of names) all.get(spec).add(n);
    }
  }
  console.log("SSR externals fix (" + all.size + " packages):");
  let created = 0, skipped = 0;
  for (const [spec, names] of all) {
    const fn = getFileName(spec);
    const fp = resolve(ASSETS, fn);
    if (existsSync(fp) && !STUB_PACKAGES.has(spec)) { skipped++; continue; }
    const dir = dirname(fp);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let code;
    if (INLINE[spec]) {
      code = INLINE[spec];
    } else if (STUB_PACKAGES.has(spec)) {
      code = genStub(spec, names);
    } else {
      code = bundleNpm(spec);
    }
    writeFileSync(fp, code, "utf-8");
    created++;
    const kb = (code.length / 1024).toFixed(1);
    const tag = STUB_PACKAGES.has(spec) ? "[stub]" : INLINE[spec] ? "[inline]" : "[real]";
    console.log("  " + tag + " " + fn + " (" + kb + " KB)");
  }
  
  console.log("  Done: " + created + " created, " + skipped + " skipped.");
}
main();

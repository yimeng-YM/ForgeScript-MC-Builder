const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const cwd = __dirname;

// Step 1: Generate app/page.tsx
const pageContent = `"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const BuilderWorkbench = dynamic(
  () => import("@/components/builder/workbench").then((m) => m.BuilderWorkbench),
  {
    ssr: false,
    loading: () => (
      <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0a0a0f",color:"#888",fontFamily:"system-ui, sans-serif"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:40,height:40,border:"3px solid #333",borderTopColor:"#6366f1",borderRadius:"50%",margin:"0 auto 16px",animation:"spin 1s linear infinite"}} />
          <div>LLM MC Builder</div>
          <style>{\x60@keyframes spin { to { transform: rotate(360deg); } }\x60}</style>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{minHeight:"100vh",background:"#0a0a0f"}} />;
  return <BuilderWorkbench />;
}
`;
fs.writeFileSync(path.join(cwd, "app", "page.tsx"), pageContent, "utf8");
console.log("Page generated");

// Step 2: Build
console.log("Building...");
cp.execSync("npm install", { cwd, stdio: "inherit" });
cp.execSync("npm run build", { cwd, stdio: "inherit" });

// Step 3: Fix SSR external modules
const assetsDir = path.join(cwd, "dist", "server", "ssr", "assets");
if (fs.existsSync(assetsDir)) {
  const bareImports = new Set();
  for (const f of fs.readdirSync(assetsDir).filter(x => x.endsWith(".js"))) {
    const c = fs.readFileSync(path.join(assetsDir, f), "utf-8");
    const re = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^.@/][^"']*|[.@][^"']+)["']/g;
    let m;
    while ((m = re.exec(c)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("node:")) bareImports.add(spec);
    }
  }
  
  const hasFile = (p) => fs.existsSync(path.join(assetsDir, p));
  const write = (p, c) => { const fp = path.join(assetsDir, p); const d = path.dirname(fp); if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); fs.writeFileSync(fp, c, "utf8"); };
  
  // Critical inline bundles
  write("class-variance-authority.js", 'function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f)}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}var cx=clsx;var cva=function(b,cfg){return function(p){if(!cfg||!cfg.variants)return cx(b,p&&p.class,p&&p.className);var d=cfg.defaultVariants,rv={};for(var k in cfg.variants){var v=p&&p[k];var r=v&&k in(d||{})?v:v!=null?v:d&&d[k];if(r!==void 0)rv[k]=r}var cls=[];if(b)cls.push(b);return cx(cls,p&&p.class,p&&p.className)}};export{cva,cx};');
  write("clsx.js", 'function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f)}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}export{clsx};export default clsx;');
  write("@radix-ui/primitive.js", 'function composeEventHandlers(a,b,c){c=c||{};var d=c.checkForDefaultPrevented===void 0?true:c.checkForDefaultPrevented;return function(e){a&&a(e);if(d===false||!e||!e.defaultPrevented)return b&&b(e)}};export{composeEventHandlers};');
  write("tailwind-merge.js", 'function twMerge(){var r="";for(var i=0;i<arguments.length;i++){if(arguments[i]){if(r)r+=" ";r+=arguments[i]}}return r}export{twMerge};export default twMerge;export function extendTailwindMerge(c){return twMerge}export function createTailwindMerge(){return twMerge}');
  write("get-nonce.js", 'function getNonce(){if(typeof __webpack_nonce__!=="undefined")return __webpack_nonce__;return null}function setNonce(n){__webpack_nonce__=n}export{getNonce,setNonce};');
  write("aria-hidden.js", 'export function hideOthers(t){return function(){}}export function inertOthers(t){return function(){}}export function suppressOthers(t){return function(){}}');
  write("throttleit.js", 'export default function(fn,wait){var t=0;return function(){var n=Date.now();if(n-t>=wait){t=n;return fn.apply(this,arguments)}}};');
  write("remend.js", 'export default function(){};');
  
  // Read node_modules for small packages
  const realPkgs = ["tslib", "zod", "unified", "remark-parse", "remark-gfm", "remark-rehype", "rehype-raw", "rehype-sanitize", "rehype-harden", "unist-util-visit", "unist-util-visit-parents", "hast-util-to-jsx-runtime", "html-url-attributes", "marked", "remark-cjk-friendly", "remark-cjk-friendly-gfm-strikethrough", "rehype-katex", "remark-math"];
  for (const pkg of realPkgs) {
    if (bareImports.has(pkg) && !hasFile(pkg + ".js")) {
      try { write(pkg + ".js", fs.readFileSync(require.resolve(pkg), "utf-8")); } catch {}
    }
  }
  write("zod/v4.js", 'export * from "../zod.js";');
  
  // Stubs for client-only packages
  const stubPkgs = ["three", "three/examples/jsm/controls/OrbitControls.js", "ai", "@ai-sdk/provider", "@ai-sdk/provider-utils", "@ai-sdk/gateway", "shiki", "shiki/core", "shiki/wasm", "shiki/engine/javascript", "shiki/langs/javascript.mjs", "shiki/langs/json.mjs", "shiki/themes/github-dark.mjs", "shiki/themes/github-light.mjs", "mermaid", "d3", "dompurify", "stylis", "@shikijs/engine-oniguruma", "@shikijs/engine-javascript", "es-toolkit/compat", "ts-dedent"];
  for (const pkg of stubPkgs) {
    if (bareImports.has(pkg) && !hasFile((pkg.endsWith(".js")||pkg.endsWith(".mjs"))?pkg:pkg+".js")) {
      write((pkg.endsWith(".js")||pkg.endsWith(".mjs"))?pkg:pkg+".js", "// stub: " + pkg + "\nexport {};");
    }
  }
  
  console.log("SSR externals fixed");
}

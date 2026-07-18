/**
 * Post-build: make vinext's SSR externals deployable as Worker modules.
 *
 * Cloudflare Workers do not perform Node-style resolution for bare module
 * specifiers in uploaded ES modules. Every external is therefore emitted as a
 * self-contained ESM file and every importer is rewritten to an explicit,
 * relative path with a file extension.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildSync } from "esbuild";
import { init, parse } from "es-module-lexer";

const ROOT = resolve(import.meta.dirname, "..");
const SSR_ROOT = resolve(ROOT, "dist", "server", "ssr");
const ASSETS = resolve(SSR_ROOT, "assets");

// These packages are only used by client components. Their real browser code
// is already present in dist/client; the SSR client-reference modules only need
// matching exports so that the Worker can instantiate the module graph.
const STUB_PACKAGES = new Set([
  "three",
  "three/examples/jsm/controls/OrbitControls.js",
  "shiki",
  "shiki/core",
  "shiki/wasm",
  "shiki/engine/javascript",
  "shiki/langs/javascript.mjs",
  "shiki/langs/json.mjs",
  "shiki/themes/github-dark.mjs",
  "shiki/themes/github-light.mjs",
  "mermaid",
  "d3",
  "dompurify",
  "stylis",
  "@shikijs/engine-oniguruma",
  "@shikijs/engine-javascript",
  "es-toolkit/compat",
  "ts-dedent",
]);

const STUB_EXPORT_VALUES = new Map([
  [
    "shiki",
    new Map([
      ["bundledLanguages", "{}"],
      ["bundledLanguagesInfo", "[]"],
    ]),
  ],
]);

function isModuleFile(path) {
  return path.endsWith(".js") || path.endsWith(".mjs");
}

function listModuleFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...listModuleFiles(path));
    else if (entry.isFile() && isModuleFile(path)) files.push(path);
  }
  return files;
}

function isBareSpecifier(specifier) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !/^[a-zA-Z][a-zA-Z+.-]*:/.test(specifier)
  );
}

function moduleFileName(specifier) {
  return specifier.endsWith(".js") || specifier.endsWith(".mjs")
    ? specifier
    : `${specifier}.js`;
}

function modulePath(specifier) {
  const path = resolve(ASSETS, moduleFileName(specifier));
  const fromAssets = relative(ASSETS, path);
  if (fromAssets.startsWith("..") || isAbsolute(fromAssets)) {
    throw new Error(`Unsafe SSR external specifier: ${specifier}`);
  }
  return path;
}

function importNames(clause) {
  const names = new Set();
  if (!clause) return names;

  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    for (const binding of named[1].split(",")) {
      const imported = binding.trim().split(/\s+as\s+/)[0];
      if (imported) names.add(imported);
    }
  }

  const withoutNamed = clause.replace(/\{[^}]*\}/, "").trim();
  if (/^[A-Za-z_$][\w$]*/.test(withoutNamed)) names.add("default");
  if (/\*\s+as\s+/.test(withoutNamed)) names.add("*");
  return names;
}

function collectBareImports(files) {
  const found = new Map();

  function add(specifier, names = new Set()) {
    if (!isBareSpecifier(specifier)) return;
    if (!found.has(specifier)) found.set(specifier, new Set());
    for (const name of names) found.get(specifier).add(name);
  }

  for (const file of files) {
    const code = readFileSync(file, "utf8");
    for (const imported of parse(code)[0]) {
      if (!imported.n) continue;
      const statement = code.slice(imported.ss, imported.se);
      const clause = statement.match(/^import\s+([\s\S]*?)\s+from\b/)?.[1];
      add(imported.n, importNames(clause));
    }
  }

  return found;
}

function stubModule(specifier, names) {
  const lines = [`// SSR-only stub for ${specifier}`, "function noop() {}"];
  if (names.has("default")) lines.push("export default noop;");
  const values = STUB_EXPORT_VALUES.get(specifier);
  for (const name of names) {
    if (name === "default" || name === "*") continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`Unsupported import name ${name} from ${specifier}`);
    }
    lines.push(`export const ${name} = ${values?.get(name) ?? "noop"};`);
  }
  if (lines.length === 2) lines.push("export {};");
  return `${lines.join("\n")}\n`;
}

function bundleModule(specifier) {
  const quoted = JSON.stringify(specifier);
  const result = buildSync({
    stdin: {
      contents: [
        `import * as dependency from ${quoted};`,
        `export * from ${quoted};`,
        "export default dependency.default;",
      ].join("\n"),
      loader: "js",
      resolveDir: ROOT,
      sourcefile: `ssr-external:${specifier}`,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    logLevel: "silent",
    conditions: ["worker", "browser", "module", "import", "default"],
    mainFields: ["browser", "module", "main"],
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`esbuild produced no output for ${specifier}`);
  return output;
}

function relativeModuleSpecifier(importer, target) {
  let specifier = relative(dirname(importer), target).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function rewriteBareImports(file) {
  const original = readFileSync(file, "utf8");
  const edits = [];

  for (const imported of parse(original)[0]) {
    if (!imported.n || !isBareSpecifier(imported.n)) continue;
    const rewritten = relativeModuleSpecifier(file, modulePath(imported.n));
    const source = original.slice(imported.s, imported.e);
    const quote = source[0];
    const replacement =
      imported.d >= 0 && (quote === '"' || quote === "'")
        ? `${quote}${rewritten}${quote}`
        : rewritten;
    edits.push({ start: imported.s, end: imported.e, replacement });
  }

  let code = original;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    code = `${code.slice(0, edit.start)}${edit.replacement}${code.slice(edit.end)}`;
  }

  if (code !== original) writeFileSync(file, code, "utf8");
}

function main() {
  if (!existsSync(SSR_ROOT) || !existsSync(ASSETS)) {
    console.log("No SSR output directory; skipping external module fix.");
    return;
  }

  const importers = listModuleFiles(SSR_ROOT);
  const externals = collectBareImports(importers);
  console.log(`SSR externals fix (${externals.size} packages):`);

  for (const [specifier, names] of externals) {
    const path = modulePath(specifier);
    mkdirSync(dirname(path), { recursive: true });
    const stubbed = STUB_PACKAGES.has(specifier);
    const code = stubbed
      ? stubModule(specifier, names)
      : bundleModule(specifier);
    writeFileSync(path, code, "utf8");
    console.log(
      `  ${stubbed ? "[stub]" : "[bundle]"} ${moduleFileName(specifier)} (${(
        code.length / 1024
      ).toFixed(1)} KB)`,
    );
  }

  for (const file of importers) rewriteBareImports(file);
  console.log(`  Rewrote ${importers.length} SSR modules to explicit paths.`);
}

await init;
main();

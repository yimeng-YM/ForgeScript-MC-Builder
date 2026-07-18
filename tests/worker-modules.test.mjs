import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";

const SSR_ROOT = fileURLToPath(new URL("../dist/server/ssr/", import.meta.url));

function moduleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return moduleFiles(target);
    return entry.isFile() && /\.(?:m?js)$/.test(entry.name) ? [target] : [];
  });
}

await init;

test("Worker SSR modules use resolvable explicit imports", () => {
  const unresolved = [];
  const bare = [];

  for (const file of moduleFiles(SSR_ROOT)) {
    const code = readFileSync(file, "utf8");
    for (const imported of parse(code)[0]) {
      const specifier = imported.n;
      if (!specifier) continue;
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        bare.push(`${path.relative(SSR_ROOT, file)} -> ${specifier}`);
        continue;
      }

      const target = path.resolve(path.dirname(file), specifier);
      if (!existsSync(target)) {
        unresolved.push(`${path.relative(SSR_ROOT, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(bare, [], `bare imports remain:\n${bare.join("\n")}`);
  assert.deepEqual(
    unresolved,
    [],
    `relative imports are missing:\n${unresolved.join("\n")}`,
  );
});

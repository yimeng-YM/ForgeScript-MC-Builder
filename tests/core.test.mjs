import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsSchema,
  PROVIDER_PRESETS,
} from "../lib/ai/model-settings.ts";
import { DEFAULT_SOURCE, sourceForPrompt } from "../lib/minecraft/demo-source.ts";
import { createLitematicBlob } from "../lib/minecraft/litematic.ts";
import { executeBuilderSource } from "../lib/minecraft/runner.ts";
import { validateWorld } from "../lib/minecraft/versions.ts";

const pack = JSON.parse(
  await readFile(new URL("../public/version-packs/1.21.11.json", import.meta.url), "utf8"),
);

test("ships validated model provider presets and safe generation defaults", () => {
  assert.ok(PROVIDER_PRESETS.length >= 12);
  for (const preset of PROVIDER_PRESETS) {
    const parsed = modelSettingsSchema.safeParse({
      ...DEFAULT_MODEL_SETTINGS,
      ...preset,
      apiKey: "",
      customHeaders: {},
    });
    assert.equal(parsed.success, true, `${preset.presetId} should be a valid preset`);
  }
  assert.equal(DEFAULT_MODEL_SETTINGS.builder.redstonePrecision, true);
  assert.equal(DEFAULT_MODEL_SETTINGS.builder.strictBlockStates, true);
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.maxOutputTokens, 16_000);
});

test("executes generated JavaScript inside the controlled Building SDK", async () => {
  const world = await executeBuilderSource(DEFAULT_SOURCE);
  assert.equal(world.version, "1.21.11");
  assert.ok(world.blocks.length > 500);
  assert.deepEqual(
    validateWorld(world, pack).filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );
});

test("preserves redstone direction and state properties", async () => {
  const world = await executeBuilderSource(sourceForPrompt("生成红石延迟链", "1.21.11"));
  const repeater = world.blocks.find((block) => block.state.id === "minecraft:repeater");
  assert.equal(repeater?.state.properties.facing, "east");
  assert.equal(repeater?.state.properties.delay, "2");
  assert.equal(repeater?.state.properties.locked, "false");
});

test("encodes a gzip-compressed modern Litematic NBT payload", async () => {
  const world = await executeBuilderSource(DEFAULT_SOURCE);
  const blob = await createLitematicBlob(world, pack);
  const raw = gunzipSync(Buffer.from(await blob.arrayBuffer()));
  assert.equal(raw[0], 10);
  assert.match(raw.toString("latin1"), /MinecraftDataVersion/);
  assert.match(raw.toString("latin1"), /BlockStatePalette/);
  assert.match(raw.toString("latin1"), /BlockStates/);
});

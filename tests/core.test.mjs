import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import {
  DEFAULT_GENERATION_TIMEOUT_MS,
  DEFAULT_MODEL_SETTINGS,
  createModelProfile,
  inferVisionCapability,
  loadModelProfiles,
  MAX_GENERATION_TIMEOUT_MS,
  modelSettingsSchema,
  PROVIDER_PRESETS,
  saveModelProfiles,
} from "../lib/ai/model-settings.ts";
import { preflightBuilderSource } from "../lib/ai/source-preflight.ts";
import { DEFAULT_SOURCE, sourceForPrompt } from "../lib/minecraft/demo-source.ts";
import { createLitematicBlob } from "../lib/minecraft/litematic.ts";
import { redstoneSignalDirection } from "../lib/minecraft/redstone.ts";
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
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.timeoutMs, 30 * 60 * 1_000);
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.timeoutMs, DEFAULT_GENERATION_TIMEOUT_MS);
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.maxSteps, 6);
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.reasoningEffort, "medium");
  assert.equal(DEFAULT_MODEL_SETTINGS.capabilities.vision, true);
  assert.equal(DEFAULT_MODEL_SETTINGS.builder.maxAutoFixAttempts, 3);
  assert.equal(
    modelSettingsSchema.safeParse({
      ...DEFAULT_MODEL_SETTINGS,
      generation: {
        ...DEFAULT_MODEL_SETTINGS.generation,
        timeoutMs: MAX_GENERATION_TIMEOUT_MS,
      },
    }).success,
    true,
  );
  assert.equal(
    modelSettingsSchema.safeParse({
      ...DEFAULT_MODEL_SETTINGS,
      generation: {
        ...DEFAULT_MODEL_SETTINGS.generation,
        timeoutMs: MAX_GENERATION_TIMEOUT_MS + 1,
      },
    }).success,
    false,
  );
});

test("infers common multimodal model capabilities without treating utility models as vision chat", () => {
  assert.equal(inferVisionCapability("openai/gpt-5.4"), true);
  assert.equal(inferVisionCapability("anthropic/claude-sonnet-4.6"), true);
  assert.equal(inferVisionCapability("google/gemini-2.5-pro"), true);
  assert.equal(inferVisionCapability("text-embedding-3-large"), false);
  assert.equal(inferVisionCapability("deepseek-chat"), false);
});

test("saves multiple model profiles and restores the active preset after reload", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const storageFor = (values) => ({
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: storageFor(localValues),
    sessionStorage: storageFor(sessionValues),
  };

  try {
    const defaultProfile = {
      id: "default",
      name: "默认配置",
      settings: DEFAULT_MODEL_SETTINGS,
      updatedAt: 0,
    };
    const deepseekPreset = PROVIDER_PRESETS.find((preset) => preset.presetId === "deepseek");
    assert.ok(deepseekPreset);
    const deepseekProfile = createModelProfile({
      ...DEFAULT_MODEL_SETTINGS,
      ...deepseekPreset,
      apiKey: "session-only-secret",
      rememberApiKey: true,
    }, "DeepSeek 预设");

    saveModelProfiles([defaultProfile, deepseekProfile], deepseekProfile.id);
    const restored = loadModelProfiles();

    assert.equal(restored.profiles.length, 2);
    assert.equal(restored.activeProfileId, deepseekProfile.id);
    assert.equal(restored.profiles[1].name, "DeepSeek 预设");
    assert.equal(restored.profiles[1].settings.model, deepseekPreset.model);
    assert.equal(restored.profiles[1].settings.apiKey, "session-only-secret");
    assert.doesNotMatch(JSON.stringify([...localValues.values()]), /session-only-secret/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("preflights agent source without requiring the QuickJS WASM runtime", () => {
  const valid = preflightBuilderSource(
    sourceForPrompt("建造一座高塔", "1.21.11"),
    "1.21.11",
    250_000,
  );
  assert.equal(valid.accepted, true);
  assert.ok(valid.accepted && valid.validation.operationCount > 0);

  const wrongVersion = preflightBuilderSource(
    sourceForPrompt("建造一座高塔", "1.20.4"),
    "1.21.11",
    250_000,
  );
  assert.equal(wrongVersion.accepted, false);
  assert.equal(wrongVersion.accepted ? "" : wrongVersion.stage, "metadata");

  const unsafe = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, () => { fetch("https://example.com"); });',
    "1.21.11",
    250_000,
  );
  assert.equal(unsafe.accepted, false);
  assert.equal(unsafe.accepted ? "" : unsafe.stage, "security");

  const missingNamespace = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, ({ block }) => { block("stone"); });',
    "1.21.11",
    250_000,
  );
  assert.equal(missingNamespace.accepted, false);
  assert.match(missingNamespace.accepted ? "" : missingNamespace.error, /minecraft:stone/);

  const malformed = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, () => {',
    "1.21.11",
    250_000,
  );
  assert.equal(malformed.accepted, false);
  assert.equal(malformed.accepted ? "" : malformed.stage, "syntax");
});

test("executes generated JavaScript inside the controlled Building SDK", async () => {
  const world = await executeBuilderSource(sourceForPrompt("建造一座高塔", "1.21.11"));
  assert.equal(world.version, "1.21.11");
  assert.ok(world.blocks.length > 500);
  assert.deepEqual(
    validateWorld(world, pack).filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );
});

test("starts with a neutral empty project instead of a demo building", async () => {
  const world = await executeBuilderSource(DEFAULT_SOURCE);
  assert.equal(world.name, "空白项目");
  assert.equal(world.blocks.length, 0);
  assert.doesNotMatch(DEFAULT_SOURCE, /小木屋|spruce_planks|oak_planks/);
});

test("safely interrupts runaway building scripts at the configured deadline", async () => {
  await assert.rejects(
    executeBuilderSource("while (true) {}", { timeoutMs: 1_000 }),
    /建筑脚本执行超过 1 秒/,
  );
});

test("preserves redstone direction and state properties", async () => {
  const world = await executeBuilderSource(sourceForPrompt("repeater comparator delay circuit", "1.21.11"));
  const repeater = world.blocks.find((block) => block.state.id === "minecraft:repeater");
  const comparator = world.blocks.find((block) => block.state.id === "minecraft:comparator");
  const wire = world.blocks.find(
    (block) => block.state.id === "minecraft:redstone_wire" && block.x === 4,
  );
  assert.equal(repeater?.state.properties.facing, "west");
  assert.equal(redstoneSignalDirection(repeater?.state.properties.facing), "east");
  assert.equal(repeater?.state.properties.delay, "2");
  assert.equal(repeater?.state.properties.locked, "false");
  assert.equal(comparator?.state.properties.facing, "west");
  assert.equal(redstoneSignalDirection(comparator?.state.properties.facing), "east");
  assert.deepEqual(wire?.state.properties, {
    north: "none",
    east: "side",
    south: "none",
    west: "side",
    power: "0",
  });
  assert.deepEqual(
    validateWorld(world, pack).filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );
  assert.equal(
    validateWorld(world, pack).some(
      (diagnostic) => diagnostic.code === "REDSTONE_WIRE_TOPOLOGY_MISMATCH",
    ),
    false,
  );
});

test("resolves redstone wire straight lines, corners, and vertical climbs", async () => {
  const source = `mc.build({ name: "topology", version: "1.21.11" }, ({ world, block, redstone }) => {
    const main = world.region("main");
    const wire = redstone.wire(0);
    main.set([0, 0, 0], wire);
    main.set([1, 0, 0], wire);
    main.set([1, 0, 1], wire);
    main.set([3, 0, 0], wire);
    main.set([4, 0, 0], block("minecraft:stone"));
    main.set([4, 1, 0], wire);
  });`;
  const world = await executeBuilderSource(source);
  const at = (x, y, z) =>
    world.blocks.find((block) => block.x === x && block.y === y && block.z === z)?.state.properties;

  assert.deepEqual(at(0, 0, 0), {
    north: "none", east: "side", south: "none", west: "side", power: "0",
  });
  assert.deepEqual(at(1, 0, 0), {
    north: "none", east: "none", south: "side", west: "side", power: "0",
  });
  assert.deepEqual(at(1, 0, 1), {
    north: "side", east: "none", south: "side", west: "none", power: "0",
  });
  assert.deepEqual(at(3, 0, 0), {
    north: "none", east: "up", south: "none", west: "side", power: "0",
  });
  assert.deepEqual(at(4, 1, 0), {
    north: "none", east: "side", south: "none", west: "side", power: "0",
  });
});

test("encodes a gzip-compressed modern Litematic NBT payload", async () => {
  const world = await executeBuilderSource(sourceForPrompt("建造一座高塔", "1.21.11"));
  const blob = await createLitematicBlob(world, pack);
  const raw = gunzipSync(Buffer.from(await blob.arrayBuffer()));
  assert.equal(raw[0], 10);
  assert.match(raw.toString("latin1"), /MinecraftDataVersion/);
  assert.match(raw.toString("latin1"), /BlockStatePalette/);
  assert.match(raw.toString("latin1"), /BlockStates/);
});

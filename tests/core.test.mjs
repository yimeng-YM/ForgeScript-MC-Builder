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
import { latestCommitOutput } from "../lib/ai/agent-protocol.ts";
import {
  requiredClientToolChoice as requiredToolChoice,
  shouldUseClientStrictToolSchema as shouldUseStrictToolSchema,
} from "../lib/ai/client-provider.ts";
import { preflightBuilderSource } from "../lib/ai/source-preflight.ts";
import {
  REDSTONE_MUSIC_MODULE,
  buildKnowledgeModules,
  detectModules,
} from "../lib/ai/prompt-modules.ts";
import { DEFAULT_SOURCE, emptySource, sourceForPrompt } from "../lib/minecraft/demo-source.ts";
import { createLitematicBlob } from "../lib/minecraft/litematic.ts";
import { redstoneSignalDirection } from "../lib/minecraft/redstone.ts";
import { executeBuilderSource } from "../lib/minecraft/runner.ts";
import { validateWorld } from "../lib/minecraft/versions.ts";

const pack = JSON.parse(
  await readFile(new URL("../public/version-packs/1.21.11.json", import.meta.url), "utf8"),
);

test("loads strict note-block construction rules for redstone music prompts", () => {
  const modules = detectModules("请创建一段红石音乐", "", {
    redstoneCircuitModule: "auto",
  });
  assert.deepEqual(modules, ["block-states", "redstone-music"]);

  const prompt = buildKnowledgeModules(modules);
  assert.match(prompt, /需要演奏普通音符的音符盒，上方一格必须是 minecraft:air/);
  assert.match(prompt, /允许用普通方块或红石部件遮挡上方/);
  assert.match(prompt, /源码注释中标记“故意静音”/);
  assert.match(prompt, /尽量不要用红石粉直接贴着音符盒激活/);
  assert.match(prompt, /redstone\.noteBlock\(instrument, note\)/);
  assert.match(prompt, /投影所需音色来自调色板 NBT 中的 instrument 状态/);
  assert.match(prompt, /redstone\.repeater\(signalDirection, \{ delay \}\)/);
  assert.match(prompt, /四分音符=600\/x rt/);
  assert.match(prompt, /redstone\.delayChain\(signalDirection, totalTicks\)/);
  assert.match(prompt, /不要逐段独立四舍五入/);
  assert.match(prompt, /同一时刻的音符是和弦/);
  assert.match(prompt, /琶音是把和弦音按时间先后逐个触发/);
  assert.match(prompt, /chordStart\+i×stepRt/);
  assert.match(prompt, /2\.5 rt 使用 2、3、2、3/);
  assert.match(prompt, /交替放置“中继器→音符盒→中继器→音符盒”/);
  assert.match(prompt, /不能改变用户给定的低音线或旋律最高音/);
  assert.match(prompt, /合法生物头颅音色允许对应头颅在上方/);
  assert.match(prompt, /同一个音符盒再次演奏前必须先断电/);
  assert.equal(prompt.includes(REDSTONE_MUSIC_MODULE), true);
});

test("rejects implicit note-block states but permits intentional muting with a warning", async () => {
  const source = `mc.build({ name: "note-block-validation", version: "1.21.11" }, ({ world, block, redstone }) => {
    const region = world.region("music");
    region.set([0, 0, 0], block("minecraft:note_block", { note: "12", powered: "false" }));
    region.set([0, 1, 0], block("minecraft:stone"));
    region.set([1, 0, 0], redstone.wire(0));
  });`;
  const world = await executeBuilderSource(source);
  const diagnostics = validateWorld(world, pack);

  assert.ok(diagnostics.some((item) => item.code === "INCOMPLETE_NOTE_BLOCK_STATE"));
  const mutedDiagnostic = diagnostics.find((item) => item.code === "NOTE_BLOCK_MUTED_BY_ABOVE_BLOCK");
  assert.equal(mutedDiagnostic?.severity, "warning");
  assert.match(mutedDiagnostic?.suggestion ?? "", /valid for an intentionally silent note block/);
  assert.ok(diagnostics.some((item) => item.code === "NOTE_BLOCK_DIRECT_REDSTONE_WIRE"));
});

test("does not treat a Java 1.20+ mob-head instrument as a muted note block", async () => {
  const source = `mc.build({ name: "mob-head-note", version: "1.21.11" }, ({ world, block, redstone }) => {
    const region = world.region("music");
    region.set([0, 0, 0], redstone.noteBlock("zombie", 0));
    region.set([0, 1, 0], block("minecraft:zombie_head", { rotation: "0" }));
  });`;
  const world = await executeBuilderSource(source);
  const diagnostics = validateWorld(world, pack);

  assert.equal(
    diagnostics.some((item) => item.code === "NOTE_BLOCK_MUTED_BY_ABOVE_BLOCK"),
    false,
  );
});

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
  assert.equal(DEFAULT_MODEL_SETTINGS.generation.maxOutputTokens, 32_768);
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

test("uses DeepSeek strict tools only with its required beta endpoint", () => {
  const deepseek = PROVIDER_PRESETS.find((preset) => preset.presetId === "deepseek");
  const openai = PROVIDER_PRESETS.find((preset) => preset.presetId === "openai");
  assert.ok(deepseek);
  assert.ok(openai);

  assert.equal(shouldUseStrictToolSchema({ ...DEFAULT_MODEL_SETTINGS, ...deepseek }), false);
  assert.equal(requiredToolChoice({ ...DEFAULT_MODEL_SETTINGS, ...deepseek }), undefined);
  assert.equal(shouldUseStrictToolSchema({
    ...DEFAULT_MODEL_SETTINGS,
    ...deepseek,
    baseURL: "https://api.deepseek.com/beta",
  }), true);
  assert.equal(shouldUseStrictToolSchema({ ...DEFAULT_MODEL_SETTINGS, ...openai }), true);
  assert.equal(requiredToolChoice({ ...DEFAULT_MODEL_SETTINGS, ...openai }), "required");
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

  const regexLiteral = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, ({ world, block }) => { const region = world.region("main"); const closing = /[)]/; if (closing.test(")")) region.set([0, 0, 0], block("minecraft:stone")); });',
    "1.21.11",
    250_000,
  );
  assert.equal(regexLiteral.accepted, true, "regular expressions must be parsed as JavaScript, not brackets");

  const unsafeTemplateInterpolation = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, () => { const value = `${fetch("https://example.com")}`; });',
    "1.21.11",
    250_000,
  );
  assert.equal(unsafeTemplateInterpolation.accepted, false);
  assert.equal(unsafeTemplateInterpolation.accepted ? "" : unsafeTemplateInterpolation.stage, "security");

  const unsafeGlobalAccess = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, () => { globalThis.fetch("https://example.com"); });',
    "1.21.11",
    250_000,
  );
  assert.equal(unsafeGlobalAccess.accepted, false);
  assert.equal(unsafeGlobalAccess.accepted ? "" : unsafeGlobalAccess.stage, "security");

  const missingRegionNamespace = preflightBuilderSource(
    'mc.build({ version: "1.21.11" }, ({ world }) => { const region = world.region("main"); region.set([0, 0, 0], "stone"); });',
    "1.21.11",
    250_000,
  );
  assert.equal(missingRegionNamespace.accepted, false);
  assert.match(missingRegionNamespace.accepted ? "" : missingRegionNamespace.error, /minecraft:stone/);
});

test("starts a fresh agent run after a new user message", () => {
  const acceptedAssistant = {
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "tool-commit_source",
      toolCallId: "call-1",
      state: "output-available",
      input: { source: "mc.build({ version: '1.21.11' }, () => {});", summary: "ok", version: "1.21.11" },
      output: { accepted: true, terminal: true },
    }],
  };
  assert.equal(latestCommitOutput([acceptedAssistant])?.accepted, true);
  assert.equal(latestCommitOutput([
    acceptedAssistant,
    { id: "user-2", role: "user", parts: [{ type: "text", text: "再建一座塔" }] },
  ]), null);
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

  const versionedWorld = await executeBuilderSource(emptySource("1.20.4"));
  assert.equal(versionedWorld.version, "1.20.4");
  assert.equal(versionedWorld.blocks.length, 0);
});

test("keeps conversations and source ephemeral and resets the complete drawing workspace", async () => {
  const workbenchSource = await readFile(
    new URL("../components/builder/workbench.tsx", import.meta.url),
    "utf8",
  );
  const persistenceSource = await readFile(
    new URL("../lib/ai/agent-persistence.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(workbenchSource, /loadAgentSession|saveAgentSession/);
  assert.doesNotMatch(persistenceSource, /loadAgentSession|saveAgentSession|objectStore/);
  assert.match(persistenceSource, /indexedDB\.deleteDatabase/);
  assert.match(workbenchSource, /void clearAgentSession\(\)/);
  assert.match(workbenchSource, /setMessages\(\[\]\)/);
  assert.match(workbenchSource, /setSource\(emptySource\(version\)\)/);
  assert.match(workbenchSource, /setWorld\(createEmptyWorld\(version\)\)/);
  assert.match(workbenchSource, /setDiagnostics\(\[\]\)/);
  assert.match(workbenchSource, /setActiveTab\("preview"\)/);
  assert.match(workbenchSource, /<span>新会话<\/span>/);
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

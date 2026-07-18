import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  blockStateOffset,
  collisionBoxesForBlock,
  defaultBlockProperties,
} from "../lib/minecraft/block-shapes.ts";
import {
  parseResourcePackMetadata,
  resourcePackCompatibility,
} from "../lib/minecraft/resource-packs.ts";

test("parses modern resource-pack ranges, overlays, filters, and text components", () => {
  const metadata = parseResourcePackMetadata(JSON.stringify({
    pack: {
      pack_format: 46,
      supported_formats: { min_inclusive: 34, max_inclusive: 75 },
      description: { text: "基础", extra: [{ text: " + 扩展" }] },
    },
    overlays: {
      entries: [{ directory: "overlay_1_21", formats: [46, 75] }],
    },
    filter: {
      block: [{ namespace: "minecraft", path: "textures/block/.*" }],
    },
  }), "Fallback");

  assert.equal(metadata.description, "基础 + 扩展");
  assert.equal(metadata.packFormat, 46);
  assert.equal(metadata.minFormat, 34);
  assert.equal(metadata.maxFormat, 75);
  assert.deepEqual(metadata.overlays, [{ directory: "overlay_1_21", formats: { min: 46, max: 75 } }]);
  assert.deepEqual(metadata.filters, [{ namespace: "minecraft", path: "textures/block/.*" }]);
});

test("reports resource-pack compatibility against the active Java format", () => {
  const pack = {
    id: "pack",
    name: "Pack",
    description: "",
    fileName: "pack.zip",
    fileSize: 1,
    kind: "resource-pack",
    packFormat: 46,
    minFormat: 34,
    maxFormat: 64,
    enabled: true,
    order: 0,
    importedAt: 0,
    assetCount: 1,
    overlayCount: 0,
    iconDataUrl: null,
    warnings: [],
  };

  assert.equal(resourcePackCompatibility(pack, 46), "compatible");
  assert.equal(resourcePackCompatibility(pack, 75), "older");
  assert.equal(resourcePackCompatibility(pack, 22), "newer");
});

test("resolves state-id ordering and versioned slab collision shapes", async () => {
  const versionPack = JSON.parse(await readFile(new URL("../public/version-packs/1.21.4.json", import.meta.url), "utf8"));
  const shapePack = JSON.parse(await readFile(new URL("../public/shape-packs/1.21.4.json", import.meta.url), "utf8"));
  const slab = versionPack.blocks.find((block) => block.id === "minecraft:oak_slab");
  assert.ok(slab);
  assert.deepEqual(slab.properties.find((property) => property.name === "waterlogged").stateIdValues, ["true", "false"]);

  const defaults = defaultBlockProperties(slab);
  assert.equal(defaults.type, "bottom");
  assert.equal(defaults.waterlogged, "false");
  assert.ok(blockStateOffset(slab, { type: "top", waterlogged: "false" }) >= 0);

  const bottom = collisionBoxesForBlock({
    region: "main",
    x: 0,
    y: 0,
    z: 0,
    state: { id: "minecraft:oak_slab", properties: { type: "bottom", waterlogged: "false" } },
  }, shapePack, versionPack);
  const top = collisionBoxesForBlock({
    region: "main",
    x: 0,
    y: 0,
    z: 0,
    state: { id: "minecraft:oak_slab", properties: { type: "top", waterlogged: "false" } },
  }, shapePack, versionPack);

  assert.deepEqual(bottom, [[0, 0, 0, 1, 0.5, 1]]);
  assert.deepEqual(top, [[0, 0.5, 0, 1, 1, 1]]);
});

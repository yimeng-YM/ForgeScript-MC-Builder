import type { BlockDefinition, PlacedBlock, VersionPack } from "./types";

export type CollisionBox = [number, number, number, number, number, number];

export type CollisionShapePack = {
  format: 1;
  gameVersion: string;
  blocks: Record<string, number | number[]>;
  shapes: Record<string, CollisionBox[]>;
};

const shapePackCache = new Map<string, CollisionShapePack>();
const blockDefinitionCache = new WeakMap<VersionPack, Map<string, BlockDefinition>>();

function blockDefinitions(versionPack: VersionPack) {
  const cached = blockDefinitionCache.get(versionPack);
  if (cached) return cached;
  const definitions = new Map(versionPack.blocks.map((definition) => [definition.id, definition]));
  blockDefinitionCache.set(versionPack, definitions);
  return definitions;
}

function stateValueOrder(property: BlockDefinition["properties"][number]) {
  return property.stateIdValues?.length ? property.stateIdValues : property.values;
}

export function defaultBlockProperties(definition: BlockDefinition) {
  const result: Record<string, string> = {};
  let stateOffset = Math.max(0, definition.defaultStateId - definition.minStateId);
  for (let index = definition.properties.length - 1; index >= 0; index -= 1) {
    const property = definition.properties[index];
    const values = stateValueOrder(property);
    if (values.length === 0) continue;
    const valueIndex = stateOffset % values.length;
    result[property.name] = values[valueIndex] ?? values[0];
    stateOffset = Math.floor(stateOffset / values.length);
  }
  return result;
}

export function blockStateOffset(definition: BlockDefinition, properties: Record<string, string>) {
  const defaults = defaultBlockProperties(definition);
  let offset = 0;
  let multiplier = 1;
  for (let index = definition.properties.length - 1; index >= 0; index -= 1) {
    const property = definition.properties[index];
    const values = stateValueOrder(property);
    if (values.length === 0) continue;
    const requested = String(properties[property.name] ?? defaults[property.name] ?? values[0]);
    const valueIndex = values.indexOf(requested);
    offset += Math.max(0, valueIndex) * multiplier;
    multiplier *= values.length;
  }
  return Math.min(Math.max(offset, 0), Math.max(0, definition.maxStateId - definition.minStateId));
}

export async function loadCollisionShapePack(version: string) {
  const cached = shapePackCache.get(version);
  if (cached) return cached;
  const response = await fetch(`/shape-packs/${encodeURIComponent(version)}.json`);
  if (!response.ok) throw new Error(`无法加载 Minecraft ${version} 的预览形状包`);
  const pack = await response.json() as CollisionShapePack;
  shapePackCache.set(version, pack);
  return pack;
}

function proceduralFallbackBoxes(block: PlacedBlock): CollisionBox[] {
  const id = block.state.id;
  if (/air$|structure_void$/.test(id)) return [];
  if (/water$|lava$/.test(id)) return [[0, 0, 0, 1, 1, 1]];
  if (/redstone_wire|rail|carpet|pressure_plate|tripwire/.test(id)) {
    return [[0, 0, 0, 1, 0.0625, 1]];
  }
  if (/torch|end_rod|lightning_rod/.test(id)) {
    return [[0.4, 0, 0.4, 0.6, 0.75, 0.6]];
  }
  if (/button/.test(id)) return [[0.31, 0.4, 0.42, 0.69, 0.6, 0.58]];
  if (/sapling|flower|mushroom|roots|grass|fern|bush|crop|cane|vine/.test(id)) {
    return [
      [0.12, 0, 0.44, 0.88, 0.9, 0.56],
      [0.44, 0, 0.12, 0.56, 0.9, 0.88],
    ];
  }
  if (/door|pane|bars/.test(id)) return [[0, 0, 0.4375, 1, 1, 0.5625]];
  return [[0.2, 0.2, 0.2, 0.8, 0.8, 0.8]];
}

export function collisionBoxesForBlock(
  block: PlacedBlock,
  shapePack: CollisionShapePack | null,
  versionPack: VersionPack | null,
) {
  if (!shapePack || !versionPack) return proceduralFallbackBoxes(block);
  const id = block.state.id.replace(/^minecraft:/, "");
  const shapeReference = shapePack.blocks[id];
  if (shapeReference === undefined) return proceduralFallbackBoxes(block);

  let shapeId: number;
  if (Array.isArray(shapeReference)) {
    const definition = blockDefinitions(versionPack).get(block.state.id);
    const offset = definition ? blockStateOffset(definition, block.state.properties) : 0;
    shapeId = shapeReference[offset] ?? shapeReference[0] ?? 0;
  } else {
    shapeId = shapeReference;
  }
  const boxes = shapePack.shapes[String(shapeId)] ?? [];
  return boxes.length > 0 ? boxes : proceduralFallbackBoxes(block);
}

import type {
  Diagnostic,
  VersionCatalogEntry,
  VersionPack,
  WorldDocument,
  WorldStats,
} from "./types";
import { CARDINAL_DIRECTIONS, resolveRedstoneConnections } from "./redstone.ts";

export const VERSION_OPTIONS: VersionCatalogEntry[] = [
  { id: "1.12.2", dataVersion: 1343, protocolVersion: 340, blockCount: 254, bytes: 42993 },
  { id: "1.13.2", dataVersion: 1631, protocolVersion: 404, blockCount: 598, bytes: 142305 },
  { id: "1.16.5", dataVersion: 2586, protocolVersion: 754, blockCount: 763, bytes: 190101 },
  { id: "1.18.2", dataVersion: 2975, protocolVersion: 758, blockCount: 898, bytes: 225842 },
  { id: "1.19.2", dataVersion: 3120, protocolVersion: 760, blockCount: 933, bytes: 236107 },
  { id: "1.19.4", dataVersion: 3337, protocolVersion: 762, blockCount: 998, bytes: 256329 },
  { id: "1.20.1", dataVersion: 3465, protocolVersion: 763, blockCount: 1003, bytes: 257744 },
  { id: "1.20.4", dataVersion: 3700, protocolVersion: 765, blockCount: 1058, bytes: 275836 },
  { id: "1.20.6", dataVersion: 3839, protocolVersion: 766, blockCount: 1060, bytes: 276434 },
  { id: "1.21.1", dataVersion: 3955, protocolVersion: 767, blockCount: 1060, bytes: 276434 },
  { id: "1.21.4", dataVersion: 4189, protocolVersion: 769, blockCount: 1095, bytes: 286435 },
  { id: "1.21.8", dataVersion: 4440, protocolVersion: 772, blockCount: 1105, bytes: 288595 },
  { id: "1.21.10", dataVersion: 4556, protocolVersion: 773, blockCount: 1166, bytes: 310074 },
  { id: "1.21.11", dataVersion: 4671, protocolVersion: 774, blockCount: 1166, bytes: 310058 },
  { id: "26.1.2", dataVersion: null, protocolVersion: null, blockCount: 0, bytes: 0, experimental: true },
  { id: "26.2", dataVersion: null, protocolVersion: null, blockCount: 0, bytes: 0, experimental: true },
];

const packCache = new Map<string, VersionPack>();

export async function loadVersionPack(version: string): Promise<VersionPack> {
  const cached = packCache.get(version);
  if (cached) return cached;

  const entry = VERSION_OPTIONS.find((item) => item.id === version);
  if (!entry || entry.experimental) {
    throw new Error(`${version} 的完整方块版本包尚未发布`);
  }

  const response = await fetch(`/version-packs/${encodeURIComponent(version)}.json`);
  if (!response.ok) throw new Error(`无法加载 Minecraft ${version} 版本包`);
  const pack = (await response.json()) as VersionPack;
  packCache.set(version, pack);
  return pack;
}

export function validateWorld(world: WorldDocument, pack: VersionPack): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const registry = new Map(pack.blocks.map((block) => [block.id, block]));
  const resolvedRedstone = resolveRedstoneConnections(world);

  for (const [blockIndex, placed] of world.blocks.entries()) {
    const schema = registry.get(placed.state.id);
    const location = {
      region: placed.region,
      x: placed.x,
      y: placed.y,
      z: placed.z,
    };
    if (!schema) {
      diagnostics.push({
        severity: "error",
        stage: "block-state",
        code: "UNKNOWN_BLOCK",
        message: `${placed.state.id} 不存在于 Minecraft ${pack.gameVersion}`,
        block: location,
      });
      continue;
    }

    const properties = new Map(schema.properties.map((property) => [property.name, property]));
    for (const [name, value] of Object.entries(placed.state.properties)) {
      const property = properties.get(name);
      if (!property) {
        diagnostics.push({
          severity: "error",
          stage: "block-state",
          code: "UNKNOWN_PROPERTY",
          message: `${placed.state.id} 没有属性 ${name}`,
          block: location,
        });
      } else if (!property.values.includes(String(value))) {
        diagnostics.push({
          severity: "error",
          stage: "block-state",
          code: "INVALID_PROPERTY_VALUE",
          message: `${placed.state.id}[${name}=${value}] 非法；可用值：${property.values.join(", ")}`,
          block: location,
        });
      }
    }

    if (placed.state.id === "minecraft:redstone_wire") {
      const schemaPropertyNames = new Set(schema.properties.map((property) => property.name));
      const requiredProperties = [...CARDINAL_DIRECTIONS, "power"].filter((name) =>
        schemaPropertyNames.has(name),
      );
      const missingProperties = requiredProperties.filter(
        (name) => placed.state.properties[name] === undefined,
      );
      if (missingProperties.length > 0) {
        diagnostics.push({
          severity: "error",
          stage: "redstone",
          code: "INCOMPLETE_REDSTONE_WIRE_STATE",
          message: `${placed.state.id} is missing ${missingProperties.join(", ")}`,
          block: location,
          suggestion: "Use redstone.wire(power); the runtime will resolve all four connections.",
        });
      }

      const resolvedProperties = resolvedRedstone.blocks[blockIndex]?.state.properties;
      const mismatchedDirections = CARDINAL_DIRECTIONS.filter(
        (direction) =>
          schemaPropertyNames.has(direction) &&
          placed.state.properties[direction] !== resolvedProperties?.[direction],
      );
      if (mismatchedDirections.length > 0) {
        diagnostics.push({
          severity: "warning",
          stage: "redstone",
          code: "REDSTONE_WIRE_TOPOLOGY_MISMATCH",
          message: `Redstone wire connections do not match neighbors: ${mismatchedDirections.join(", ")}`,
          block: location,
          suggestion: "Run the structure through the Building SDK connection resolver before export.",
        });
      }
    }

    if (
      ["minecraft:repeater", "minecraft:comparator", "minecraft:observer", "minecraft:piston"].includes(
        placed.state.id,
      ) &&
      !placed.state.properties.facing
    ) {
      diagnostics.push({
        severity: "warning",
        stage: "redstone",
        code: "IMPLICIT_FACING",
        message: `${placed.state.id} 未显式指定 facing；精密红石结构应固定朝向`,
        block: location,
        suggestion: "在 block() 的 properties 中加入 facing。",
      });
    }
  }

  if (world.blocks.length === 0) {
    diagnostics.push({
      severity: "warning",
      stage: "structure",
      code: "EMPTY_STRUCTURE",
      message: "结构中没有非空气方块",
    });
  }

  if (world.blocks.length > 250_000) {
    diagnostics.push({
      severity: "error",
      stage: "structure",
      code: "BLOCK_LIMIT",
      message: "第一阶段运行上限为 250,000 个非空气方块",
    });
  }

  return diagnostics;
}

export function getWorldStats(world: WorldDocument): WorldStats {
  if (world.blocks.length === 0) {
    return { blockCount: 0, paletteSize: 0, volume: 0, size: [0, 0, 0], materials: [] };
  }

  const xs = world.blocks.map((block) => block.x);
  const ys = world.blocks.map((block) => block.y);
  const zs = world.blocks.map((block) => block.z);
  const size: [number, number, number] = [
    Math.max(...xs) - Math.min(...xs) + 1,
    Math.max(...ys) - Math.min(...ys) + 1,
    Math.max(...zs) - Math.min(...zs) + 1,
  ];
  const materials = new Map<string, number>();
  const palette = new Set<string>();
  for (const block of world.blocks) {
    materials.set(block.state.id, (materials.get(block.state.id) ?? 0) + 1);
    palette.add(`${block.state.id}${JSON.stringify(block.state.properties)}`);
  }

  return {
    blockCount: world.blocks.length,
    paletteSize: palette.size,
    volume: size[0] * size[1] * size[2],
    size,
    materials: [...materials.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
  };
}

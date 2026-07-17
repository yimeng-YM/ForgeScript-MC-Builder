import type { BlockProperties, PlacedBlock, WorldDocument } from "./types";

export const CARDINAL_DIRECTIONS = ["north", "east", "south", "west"] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];
export type WireConnection = "none" | "side" | "up";

const DIRECTION_OFFSETS: Record<CardinalDirection, readonly [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

export const OPPOSITE_DIRECTION: Record<CardinalDirection, CardinalDirection> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
};

const GATE_IDS = new Set([
  "minecraft:repeater",
  "minecraft:comparator",
  "minecraft:powered_repeater",
  "minecraft:unpowered_repeater",
  "minecraft:powered_comparator",
  "minecraft:unpowered_comparator",
]);

const ALWAYS_CONNECT_IDS = new Set([
  "minecraft:redstone_block",
  "minecraft:redstone_torch",
  "minecraft:redstone_wall_torch",
  "minecraft:lever",
  "minecraft:daylight_detector",
  "minecraft:target",
  "minecraft:tripwire_hook",
  "minecraft:sculk_sensor",
  "minecraft:calibrated_sculk_sensor",
]);

function coordinateKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function isCardinalDirection(value: string | undefined): value is CardinalDirection {
  return CARDINAL_DIRECTIONS.includes(value as CardinalDirection);
}

function isWire(block: PlacedBlock | undefined) {
  return block?.state.id === "minecraft:redstone_wire";
}

function isButtonOrPressurePlate(id: string) {
  return id.endsWith("_button") || id.endsWith("_pressure_plate");
}

function componentConnectsFrom(block: PlacedBlock | undefined, direction: CardinalDirection) {
  if (!block) return false;
  const { id, properties } = block.state;
  if (id === "minecraft:redstone_wire") return true;
  if (GATE_IDS.has(id)) {
    const facing = properties.facing;
    return isCardinalDirection(facing) &&
      (facing === direction || OPPOSITE_DIRECTION[facing] === direction);
  }
  if (id === "minecraft:observer") {
    return properties.facing === direction;
  }
  return ALWAYS_CONNECT_IDS.has(id) || isButtonOrPressurePlate(id);
}

function deriveConnection(
  block: PlacedBlock,
  direction: CardinalDirection,
  blocksByPosition: ReadonlyMap<string, PlacedBlock>,
): WireConnection {
  const [dx, dz] = DIRECTION_OFFSETS[direction];
  const sameLevel = blocksByPosition.get(coordinateKey(block.x + dx, block.y, block.z + dz));
  if (componentConnectsFrom(sameLevel, direction)) return "side";

  const above = blocksByPosition.get(coordinateKey(block.x + dx, block.y + 1, block.z + dz));
  if (sameLevel && isWire(above)) return "up";

  const below = blocksByPosition.get(coordinateKey(block.x + dx, block.y - 1, block.z + dz));
  if (isWire(below)) return "side";

  return "none";
}

function completeStraightLine(connections: Record<CardinalDirection, WireConnection>) {
  const northSouth = connections.north !== "none" || connections.south !== "none";
  const eastWest = connections.east !== "none" || connections.west !== "none";

  if (eastWest && !northSouth) {
    if (connections.east === "none") connections.east = "side";
    if (connections.west === "none") connections.west = "side";
  } else if (northSouth && !eastWest) {
    if (connections.north === "none") connections.north = "side";
    if (connections.south === "none") connections.south = "side";
  }
}

export function isModernRedstoneVersion(version: string) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 13);
}

/**
 * Java repeaters and comparators store `facing` from their output side toward
 * their input side. This helper exposes the more natural signal travel direction.
 */
export function redstoneSignalDirection(facing: CardinalDirection): CardinalDirection {
  return OPPOSITE_DIRECTION[facing];
}

export function expectedWireProperties(
  block: PlacedBlock,
  blocksByPosition: ReadonlyMap<string, PlacedBlock>,
): BlockProperties {
  const connections: Record<CardinalDirection, WireConnection> = {
    north: deriveConnection(block, "north", blocksByPosition),
    east: deriveConnection(block, "east", blocksByPosition),
    south: deriveConnection(block, "south", blocksByPosition),
    west: deriveConnection(block, "west", blocksByPosition),
  };
  completeStraightLine(connections);

  return {
    ...block.state.properties,
    north: connections.north,
    east: connections.east,
    south: connections.south,
    west: connections.west,
    power: block.state.properties.power ?? "0",
  };
}

/**
 * Rebuilds redstone-wire render topology from the final structure, so generated
 * source cannot leave adjacent dust pieces in disconnected dot states.
 */
export function resolveRedstoneConnections(world: WorldDocument): WorldDocument {
  if (!isModernRedstoneVersion(world.version)) return world;

  const blocksByPosition = new Map<string, PlacedBlock>();
  for (const block of world.blocks) {
    blocksByPosition.set(coordinateKey(block.x, block.y, block.z), block);
  }

  return {
    ...world,
    blocks: world.blocks.map((block) => {
      if (block.state.id !== "minecraft:redstone_wire") return block;
      return {
        ...block,
        state: {
          ...block.state,
          properties: expectedWireProperties(block, blocksByPosition),
        },
      };
    }),
  };
}

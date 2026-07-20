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


// Auto-connecting blocks (glass panes, fences, walls, iron bars)
const CONNECTING_BLOCK_IDS = new Set([
  "minecraft:glass_pane",
  "minecraft:iron_bars",
  "minecraft:oak_fence",
  "minecraft:spruce_fence",
  "minecraft:birch_fence",
  "minecraft:jungle_fence",
  "minecraft:acacia_fence",
  "minecraft:dark_oak_fence",
  "minecraft:mangrove_fence",
  "minecraft:cherry_fence",
  "minecraft:bamboo_fence",
  "minecraft:crimson_fence",
  "minecraft:warped_fence",
  "minecraft:nether_brick_fence",
  "minecraft:cobblestone_wall",
  "minecraft:mossy_cobblestone_wall",
  "minecraft:stone_brick_wall",
  "minecraft:brick_wall",
  "minecraft:nether_brick_wall",
  "minecraft:red_nether_brick_wall",
  "minecraft:end_stone_brick_wall",
  "minecraft:prismarine_wall",
  "minecraft:sandstone_wall",
  "minecraft:red_sandstone_wall",
  "minecraft:granite_wall",
  "minecraft:diorite_wall",
  "minecraft:andesite_wall",
  "minecraft:blackstone_wall",
  "minecraft:polished_blackstone_wall",
  "minecraft:polished_blackstone_brick_wall",
  "minecraft:cobbled_deepslate_wall",
  "minecraft:polished_deepslate_wall",
  "minecraft:deepslate_brick_wall",
  "minecraft:deepslate_tile_wall",
  "minecraft:mud_brick_wall",
]);

const STAINED_GLASS_PANE_IDS = new Set([
  "minecraft:white_stained_glass_pane",
  "minecraft:orange_stained_glass_pane",
  "minecraft:magenta_stained_glass_pane",
  "minecraft:light_blue_stained_glass_pane",
  "minecraft:yellow_stained_glass_pane",
  "minecraft:lime_stained_glass_pane",
  "minecraft:pink_stained_glass_pane",
  "minecraft:gray_stained_glass_pane",
  "minecraft:light_gray_stained_glass_pane",
  "minecraft:cyan_stained_glass_pane",
  "minecraft:purple_stained_glass_pane",
  "minecraft:blue_stained_glass_pane",
  "minecraft:brown_stained_glass_pane",
  "minecraft:green_stained_glass_pane",
  "minecraft:red_stained_glass_pane",
  "minecraft:black_stained_glass_pane",
]);

function isConnectingBlock(id: string): boolean {
  return CONNECTING_BLOCK_IDS.has(id) || STAINED_GLASS_PANE_IDS.has(id);
}

function isWall(id: string): boolean {
  return id.endsWith("_wall");
}

function isFence(id: string): boolean {
  return id.endsWith("_fence");
}

function isGlassPaneOrBars(id: string): boolean {
  return id.endsWith("_glass_pane") || id === "minecraft:iron_bars";
}

function canConnectTo(blockId: string, neighborId: string): boolean {
  // Walls connect to walls and solid blocks
  if (isWall(blockId)) {
    return isWall(neighborId) || isSolidBlock(neighborId);
  }
  // Fences connect to any fence and solid blocks
  if (isFence(blockId)) {
    return isFence(neighborId) || isSolidBlock(neighborId);
  }
  // Glass panes and iron bars connect to same type or any solid block
  if (isGlassPaneOrBars(blockId)) {
    if (blockId === neighborId) return true;
    if (isGlassPaneOrBars(neighborId)) return true;
    return isSolidBlock(neighborId);
  }
  return false;
}

function isSolidBlock(id: string): boolean {
  // Non-solid blocks that glass panes/fences/walls should not connect through
  const nonSolid = new Set([
    "minecraft:air", "minecraft:cave_air", "minecraft:void_air",
    "minecraft:water", "minecraft:lava", "minecraft:flowing_water", "minecraft:flowing_lava",
    "minecraft:fire", "minecraft:soul_fire",
    "minecraft:torch", "minecraft:wall_torch",
    "minecraft:redstone_torch", "minecraft:redstone_wall_torch",
    "minecraft:soul_torch", "minecraft:soul_wall_torch",
    "minecraft:lantern", "minecraft:soul_lantern",
    "minecraft:lever", "minecraft:stone_button", "minecraft:oak_button",
    "minecraft:tripwire", "minecraft:tripwire_hook",
    "minecraft:rail", "minecraft:powered_rail", "minecraft:detector_rail", "minecraft:activator_rail",
    "minecraft:redstone_wire", "minecraft:redstone",
    "minecraft:repeater", "minecraft:comparator",
    "minecraft:flower_pot", "minecraft:potted_oak_sapling",
    "minecraft:snow_layer", "minecraft:snow",
    "minecraft:tall_grass", "minecraft:grass", "minecraft:fern",
    "minecraft:dead_bush", "minecraft:dandelion", "minecraft:poppy",
    "minecraft:red_mushroom", "minecraft:brown_mushroom",
    "minecraft:vine", "minecraft:glow_lichen",
    "minecraft:cobweb", "minecraft:string",
    "minecraft:sugar_cane", "minecraft:kelp", "minecraft:seagrass",
    "minecraft:lily_pad",
  ]);
  // If it's in the non-solid list, it's not solid
  if (nonSolid.has(id)) return false;
  // Air variants and non-blocks
  if (id.includes("air")) return false;
  // Most other blocks are solid
  return true;
}

export function resolveConnectingBlocks(world: WorldDocument): WorldDocument {
  const blocksByPosition = new Map<string, PlacedBlock>();
  for (const block of world.blocks) {
    blocksByPosition.set(coordinateKey(block.x, block.y, block.z), block);
  }

  return {
    ...world,
    blocks: world.blocks.map((block) => {
      if (!isConnectingBlock(block.state.id)) return block;

      const north = blocksByPosition.get(coordinateKey(block.x, block.y, block.z - 1));
      const south = blocksByPosition.get(coordinateKey(block.x, block.y, block.z + 1));
      const east = blocksByPosition.get(coordinateKey(block.x + 1, block.y, block.z));
      const west = blocksByPosition.get(coordinateKey(block.x - 1, block.y, block.z));

      const connectNorth = north ? canConnectTo(block.state.id, north.state.id) : false;
      const connectSouth = south ? canConnectTo(block.state.id, south.state.id) : false;
      const connectEast = east ? canConnectTo(block.state.id, east.state.id) : false;
      const connectWest = west ? canConnectTo(block.state.id, west.state.id) : false;

      // For walls, also check up for wall connections
      let upConnection = false;
      if (isWall(block.state.id)) {
        const up = blocksByPosition.get(coordinateKey(block.x, block.y + 1, block.z));
        upConnection = up ? isWall(up.state.id) || isSolidBlock(up.state.id) : false;
      }

      return {
        ...block,
        state: {
          ...block.state,
          properties: {
            ...block.state.properties,
            north: String(connectNorth),
            south: String(connectSouth),
            east: String(connectEast),
            west: String(connectWest),
            ...(isWall(block.state.id) ? { up: String(upConnection) } : {}),
          },
        },
      };
    }),
  };
}

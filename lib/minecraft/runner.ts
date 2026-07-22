import type { WorldDocument } from "./types";
import { resolveRedstoneConnections, resolveConnectingBlocks } from "./redstone.ts";

const SDK_BOOTSTRAP = String.raw`
(() => {
  "use strict";
  const placed = new Map();
  let metadata = {
    name: "Untitled build",
    version: "1.21.11",
    author: "LLM MC Builder",
    description: "Generated with the controlled Building SDK"
  };
  const limit = 250000;

  const integer = (value, label) => {
    if (!Number.isInteger(value)) throw new TypeError(label + " must be an integer");
    return value;
  };
  const vector = (value, label) => {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError(label + " must be [x, y, z]");
    return [integer(value[0], label + ".x"), integer(value[1], label + ".y"), integer(value[2], label + ".z")];
  };
  const normalizeState = (state) => {
    if (typeof state === "string") {
      let id = state;
      if (!id.includes(":")) id = "minecraft:" + id;
      return { id, properties: {} };
    }
    if (!state || typeof state.id !== "string") throw new TypeError("block state requires a namespaced id");
    let id = state.id;
    if (!id.includes(":")) id = "minecraft:" + id;
    const properties = {};
    for (const [name, value] of Object.entries(state.properties || {})) properties[name] = String(value);
    return { id, properties, nbt: state.nbt };
  };
  const key = (region, x, y, z) => region + "\u0000" + x + "," + y + "," + z;
  const put = (region, origin, position, state) => {
    const pos = vector(position, "position");
    const x = pos[0] + origin[0];
    const y = pos[1] + origin[1];
    const z = pos[2] + origin[2];
    const normalized = normalizeState(state);
    const blockKey = key(region, x, y, z);
    if (normalized.id === "minecraft:air" || normalized.id === "air") placed.delete(blockKey);
    else placed.set(blockKey, { region, x, y, z, state: normalized });
    if (placed.size > limit) throw new RangeError("Structure exceeds the 250000 block safety limit");
  };
  const eachBox = (from, to, visit) => {
    const a = vector(from, "from");
    const b = vector(to, "to");
    const min = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const max = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    for (let y = min[1]; y <= max[1]; y++) {
      for (let z = min[2]; z <= max[2]; z++) {
        for (let x = min[0]; x <= max[0]; x++) visit(x, y, z, min, max);
      }
    }
  };
  const makeRegion = (name, options = {}) => {
    const origin = vector(options.origin || [0, 0, 0], "origin");
    const api = {
      set(position, state) {
        put(name, origin, position, state);
        return api;
      },
      fill(from, to, state) {
        eachBox(from, to, (x, y, z) => put(name, origin, [x, y, z], state));
        return api;
      },
      hollowBox(from, to, state) {
        eachBox(from, to, (x, y, z, min, max) => {
          if (x === min[0] || x === max[0] || y === min[1] || y === max[1] || z === min[2] || z === max[2]) {
            put(name, origin, [x, y, z], state);
          }
        });
        return api;
      },
      walls(from, to, state) {
        eachBox(from, to, (x, y, z, min, max) => {
          if (x === min[0] || x === max[0] || z === min[2] || z === max[2]) put(name, origin, [x, y, z], state);
        });
        return api;
      },
      line(from, to, state) {
        const a = vector(from, "from");
        const b = vector(to, "to");
        const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]));
        if (steps === 0) put(name, origin, a, state);
        for (let index = 0; index <= steps; index++) {
          const t = index / steps;
          put(name, origin, [
            Math.round(a[0] + (b[0] - a[0]) * t),
            Math.round(a[1] + (b[1] - a[1]) * t),
            Math.round(a[2] + (b[2] - a[2]) * t)
          ], state);
        }
        return api;
      },
      pillar(position, height, state) {
        const start = vector(position, "position");
        integer(height, "height");
        const direction = height >= 0 ? 1 : -1;
        for (let offset = 0; offset !== height; offset += direction) {
          put(name, origin, [start[0], start[1] + offset, start[2]], state);
        }
        return api;
      },
      replace(from, to, matchId, state) {
        eachBox(from, to, (x, y, z) => {
          const block = placed.get(key(name, x + origin[0], y + origin[1], z + origin[2]));
          if (block && block.state.id === matchId) put(name, origin, [x, y, z], state);
        });
        return api;
      }
    };
    return Object.freeze(api);
  };

  const world = Object.freeze({ region: makeRegion });
  const block = (id, properties = {}, nbt) => Object.freeze({ id, properties, nbt });
  const cardinalDirections = ["north", "east", "south", "west"];
  const oppositeDirections = Object.freeze({ north: "south", east: "west", south: "north", west: "east" });
  const cardinal = (value, label) => {
    if (!cardinalDirections.includes(value)) throw new TypeError(label + " must be north, east, south, or west");
    return value;
  };
  const facingForSignal = (signalDirection) => oppositeDirections[cardinal(signalDirection, "signalDirection")];
  const booleanProperty = (value, label) => {
    if (value === true || value === "true") return "true";
    if (value === false || value === "false" || value === undefined) return "false";
    throw new TypeError(label + " must be true or false");
  };
  const modernRedstoneStates = () => {
    const match = /^(\d+)\.(\d+)/.exec(String(metadata.version));
    return !match || Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 13);
  };
  const redstone = Object.freeze({
    facingForSignal,
    signalDirection(facing) {
      return oppositeDirections[cardinal(facing, "facing")];
    },
    wire(power = 0) {
      integer(power, "power");
      if (power < 0 || power > 15) throw new RangeError("power must be between 0 and 15");
      if (!modernRedstoneStates()) return block("minecraft:redstone_wire");
      return block("minecraft:redstone_wire", {
        north: "none", east: "none", south: "none", west: "none", power: String(power)
      });
    },
    repeater(signalDirection, options = {}) {
      const delay = options.delay === undefined ? 1 : options.delay;
      integer(delay, "delay");
      if (delay < 1 || delay > 4) throw new RangeError("delay must be between 1 and 4");
      const powered = booleanProperty(options.powered, "powered");
      if (!modernRedstoneStates()) {
        return block(powered === "true" ? "minecraft:powered_repeater" : "minecraft:unpowered_repeater");
      }
      return block("minecraft:repeater", {
        facing: facingForSignal(signalDirection),
        delay: String(delay),
        locked: booleanProperty(options.locked, "locked"),
        powered
      });
    },
    comparator(signalDirection, options = {}) {
      const mode = options.mode === undefined ? "compare" : options.mode;
      if (mode !== "compare" && mode !== "subtract") throw new TypeError("mode must be compare or subtract");
      const powered = booleanProperty(options.powered, "powered");
      if (!modernRedstoneStates()) {
        return block(powered === "true" ? "minecraft:powered_comparator" : "minecraft:unpowered_comparator");
      }
      return block("minecraft:comparator", {
        facing: facingForSignal(signalDirection),
        mode,
        powered
      });
    },
    noteBlock(instrument, note) {
      if (typeof instrument !== 'string') throw new TypeError('instrument must be a string');
      var validInstruments = [
        'harp','basedrum','snare','hat','bass','flute','bell','guitar',
        'chime','xylophone','iron_xylophone','cow_bell','didgeridoo',
        'bit','banjo','pling','zombie','skeleton','creeper','dragon',
        'wither_skeleton','piglin','custom_head'
      ];
      if (!validInstruments.includes(instrument)) throw new TypeError('invalid instrument: ' + instrument);
      var n = integer(note, 'note');
      if (n < 0 || n > 24) throw new RangeError('note must be between 0 and 24');
      return block('minecraft:note_block', {
        instrument: instrument,
        note: String(n),
        powered: 'false'
      });
    },
    delayChain(signalDirection, totalTicks) {
      cardinal(signalDirection, 'signalDirection');
      integer(totalTicks, 'totalTicks');
      if (totalTicks < 1) throw new RangeError('totalTicks must be at least 1');
      var result = [];
      var remaining = totalTicks;
      while (remaining > 0) {
        var d = Math.min(remaining, 4);
        result.push({ delay: d });
        remaining -= d;
      }
      return result;
    }
  });
  const build = (nextMetadata, callback) => {
    if (!nextMetadata || typeof nextMetadata !== "object") throw new TypeError("mc.build requires metadata");
    metadata = { ...metadata, ...nextMetadata };
    if (typeof callback !== "function") throw new TypeError("mc.build requires a callback");
    callback(Object.freeze({ world, block, redstone }));
  };

  globalThis.mc = Object.freeze({ build, block, redstone });
  globalThis.__collectBuild = () => JSON.stringify({ ...metadata, blocks: Array.from(placed.values()) });
})();
`;

function describeQuickJSError(value: unknown): string {
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return [object.name, object.message, object.stack].filter(Boolean).join(": ");
  }
  return String(value);
}

export type BuilderExecutionOptions = {
  timeoutMs?: number;
};

const DEFAULT_EXECUTION_TIMEOUT_MS = 15_000;
const MAX_EXECUTION_TIMEOUT_MS = 60_000;

export async function executeBuilderSource(
  source: string,
  options: BuilderExecutionOptions = {},
): Promise<WorldDocument> {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const timeoutMs = Math.min(
    MAX_EXECUTION_TIMEOUT_MS,
    Math.max(1_000, options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS),
  );
  const startedAt = performance.now();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(2 * 1024 * 1024);
  runtime.setInterruptHandler(() => performance.now() - startedAt > timeoutMs);
  const context = runtime.newContext();

  try {
    const result = context.evalCode(`${SDK_BOOTSTRAP}\n${source}\n__collectBuild();`, "build.js");
    if (result.error) {
      const error = context.dump(result.error);
      result.error.dispose();
      const message = describeQuickJSError(error);
      if (/interrupted/i.test(message)) {
        throw new Error(`建筑脚本执行超过 ${(timeoutMs / 1_000).toFixed(0)} 秒，已安全中断`);
      }
      throw new Error(message);
    }
    const serialized = context.dump(result.value);
    result.value.dispose();
    if (typeof serialized !== "string") throw new Error("Building SDK did not return serialized world data");
    const parsed = JSON.parse(serialized) as WorldDocument;
    return resolveConnectingBlocks(resolveRedstoneConnections({
      name: parsed.name || "Untitled build",
      version: parsed.version || "1.21.11",
      author: parsed.author || "LLM MC Builder",
      description: parsed.description || "",
      blocks: parsed.blocks ?? [],
    }));
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

import type { BlockState } from "./types";

// ---------------------------------------------------------------------------
// NBT types (shared with litematic.ts)
// ---------------------------------------------------------------------------

type NbtNode =
  | { type: 0 }
  | { type: 3; value: number }
  | { type: 4; value: bigint }
  | { type: 5; value: number }
  | { type: 6; value: number }
  | { type: 7; value: Uint8Array }
  | { type: 8; value: string }
  | { type: 9; elementType: number; value: NbtNode[] }
  | { type: 10; value: Record<string, NbtNode> }
  | { type: 11; value: Int32Array }
  | { type: 12; value: BigInt64Array };

// ---------------------------------------------------------------------------
// Byte reader
// ---------------------------------------------------------------------------

class ByteReader {
  private offset = 0;
  constructor(private readonly data: Uint8Array) {}

  readByte(): number {
    if (this.offset >= this.data.length) throw new Error("NBT: unexpected end of data");
    return this.data[this.offset++];
  }

  readUnsignedShort(): number {
    return (this.readByte() << 8) | this.readByte();
  }

  readInt(): number {
    const b = this.data;
    const o = this.offset;
    this.offset += 4;
    return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  }

  readLong(): bigint {
    let v = 0n;
    for (let i = 0; i < 8; i++) {
      v = (v << 8n) | BigInt(this.readByte());
    }
    return BigInt.asIntN(64, v);
  }

  readFloat(): number {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, this.readInt());
    return new DataView(buf).getFloat32(0);
  }

  readDouble(): number {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(0, Number(this.readLong()));
    dv.setUint32(4, Number(this.readLong()));
    return dv.getFloat64(0);
  }

  readString(): string {
    const len = this.readUnsignedShort();
    const bytes = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  remaining(): number {
    return this.data.length - this.offset;
  }
}

// ---------------------------------------------------------------------------
// NBT parser
// ---------------------------------------------------------------------------

function readTagPayload(reader: ByteReader, tagType: number): NbtNode {
  switch (tagType) {
    case 0: return { type: 0 };
    case 3: return { type: 3, value: reader.readInt() };
    case 4: return { type: 4, value: reader.readLong() };
    case 5: return { type: 5, value: reader.readFloat() };
    case 6: return { type: 6, value: reader.readDouble() };
    case 7: {
      const len = reader.readInt();
      const value = new Uint8Array(len);
      for (let i = 0; i < len; i++) value[i] = reader.readByte();
      return { type: 7, value };
    }
    case 8: return { type: 8, value: reader.readString() };
    case 9: {
      const elementType = reader.readByte();
      const len = reader.readInt();
      const value: NbtNode[] = [];
      for (let i = 0; i < len; i++) value.push(readTagPayload(reader, elementType));
      return { type: 9, elementType, value };
    }
    case 10: {
      const value: Record<string, NbtNode> = {};
      for (;;) {
        const childType = reader.readByte();
        if (childType === 0) break;
        const name = reader.readString();
        value[name] = readTagPayload(reader, childType);
      }
      return { type: 10, value };
    }
    case 11: {
      const len = reader.readInt();
      const value = new Int32Array(len);
      for (let i = 0; i < len; i++) value[i] = reader.readInt();
      return { type: 11, value };
    }
    case 12: {
      const len = reader.readInt();
      const value = new BigInt64Array(len);
      for (let i = 0; i < len; i++) value[i] = reader.readLong();
      return { type: 12, value };
    }
    default:
      throw new Error(`NBT: unknown tag type ${tagType}`);
  }
}

function parseNbt(data: Uint8Array): NbtNode {
  const reader = new ByteReader(data);
  const rootType = reader.readByte();
  if (rootType === 0) return { type: 0 };
  reader.readString(); // root name
  return readTagPayload(reader, rootType);
}

// ---------------------------------------------------------------------------
// GZip decompression
// ---------------------------------------------------------------------------

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  console.log("[litematic] gunzip: input", data.length, "bytes");
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("当前浏览器不支持 GZip 解压");
  }
  try {
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream("gzip"));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    console.log("[litematic] gunzip: output", result.length, "bytes");
    return result;
  } catch (e) {
    console.error("[litematic] gunzip failed:", e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// NBT helpers
// ---------------------------------------------------------------------------

function getCompound(node: NbtNode | undefined): Record<string, NbtNode> | undefined {
  return node?.type === 10 ? node.value : undefined;
}

function getString(node: NbtNode | undefined): string | undefined {
  return node?.type === 8 ? node.value : undefined;
}

function getInt(node: NbtNode | undefined): number | undefined {
  return node?.type === 3 ? node.value : undefined;
}

function getLongArray(node: NbtNode | undefined): BigInt64Array | undefined {
  return node?.type === 12 ? node.value : undefined;
}

function getList(node: NbtNode | undefined): NbtNode[] | undefined {
  return node?.type === 9 ? node.value : undefined;
}

// ---------------------------------------------------------------------------
// Bit-packed reader (same layout as litematic.ts encoder)
// ---------------------------------------------------------------------------

function getPackedValue(storage: BigInt64Array, index: number, bits: number): number {
  const startBit = BigInt(index * bits);
  const firstLong = Number(startBit / 64n);
  const offset = Number(startBit % 64n);
  const mask = (1n << BigInt(bits)) - 1n;
  let value = (storage[firstLong] >> BigInt(offset)) & mask;
  const spill = offset + bits - 64;
  if (spill > 0) {
    value |= (storage[firstLong + 1] & ((1n << BigInt(spill)) - 1n)) << BigInt(bits - spill);
  }
  return Number(value);
}

// ---------------------------------------------------------------------------
// Parse litematic → blocks
// ---------------------------------------------------------------------------

type ParsedBlock = {
  x: number;
  y: number;
  z: number;
  state: BlockState;
};

function parsePaletteEntry(entry: NbtNode): BlockState {
  const c = getCompound(entry);
  if (!c) return { id: "minecraft:air", properties: {} };
  const id = getString(c.Name) ?? "minecraft:air";
  const props: Record<string, string> = {};
  const properties = getCompound(c.Properties);
  if (properties) {
    for (const [key, val] of Object.entries(properties)) {
      props[key] = getString(val) ?? String(val);
    }
  }
  return { id, properties: props };
}

function decodeRegion(regionNode: NbtNode): ParsedBlock[] {
  const region = getCompound(regionNode);
  if (!region) {
    console.log("[litematic] decodeRegion: not a compound");
    return [];
  }

  const regionKeys = Object.keys(region);
  console.log("[litematic] decodeRegion keys:", regionKeys);

  // In litematic NBT, palette is stored differently depending on version:
  // Version 5 (schematic): "Palette" as list, "BlockStates" as long array
  // Version 6+: "BlockStates" is a compound with "Palette" (list) and "Data" (long array)
  // Or just top-level "Palette" + "BlockStates"

  let paletteList: NbtNode[] | undefined;
  let blockStatesLongs: BigInt64Array | undefined;
  let sx = 0, sy = 0, sz = 0;

  // Try to get size (can be negative: region extends in negative direction)
  const sizeNode = getCompound(region.Size);
  if (sizeNode) {
    sx = getInt(sizeNode.x) ?? 0;
    sy = getInt(sizeNode.y) ?? 0;
    sz = getInt(sizeNode.z) ?? 0;
  }
  const posNode = getCompound(region.Position);
  const px = posNode ? (getInt(posNode.x) ?? 0) : 0;
  const py = posNode ? (getInt(posNode.y) ?? 0) : 0;
  const pz = posNode ? (getInt(posNode.z) ?? 0) : 0;
  console.log("[litematic] region size:", sx, sy, sz, "position:", px, py, pz);

  // Litematic uses: BlockStatePalette (list), BlockStates (long array)
  paletteList = getList(region.BlockStatePalette);
  blockStatesLongs = getLongArray(region.BlockStates);
  console.log("[litematic] palette:", paletteList?.length, "data longs:", blockStatesLongs?.length);

  if (!paletteList || !blockStatesLongs) {
    console.log("[litematic] missing palette or block states");
    return [];
  }

  const palette = paletteList.map(parsePaletteEntry);
  console.log("[litematic] palette entries:", palette.length, palette.slice(0, 3).map(s => s.id));

  // Use absolute values for iteration; negative size means extending in negative direction
  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const absSz = Math.abs(sz);
  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length))));
  const volume = absSx * absSy * absSz;
  console.log("[litematic] bits per block:", bits, "volume:", volume, "abs size:", absSx, absSy, absSz);
  const blocks: ParsedBlock[] = [];

  for (let y = 0; y < absSy; y++) {
    for (let z = 0; z < absSz; z++) {
      for (let x = 0; x < absSx; x++) {
        const linearIndex = y * (absSx * absSz) + z * absSx + x;
        const paletteIndex = getPackedValue(blockStatesLongs, linearIndex, bits);
        const state = palette[paletteIndex];
        if (state && state.id !== "minecraft:air") {
          // Apply position offset for world coordinates
          const worldX = px + (sx < 0 ? -(absSx - 1 - x) : x);
          const worldY = py + (sy < 0 ? -(absSy - 1 - y) : y);
          const worldZ = pz + (sz < 0 ? -(absSz - 1 - z) : z);
          blocks.push({ x: worldX, y: worldY, z: worldZ, state });
        }
      }
    }
  }
  console.log("[litematic] decoded", blocks.length, "non-air blocks");
  return blocks;
}

async function parseLitematic(data: Uint8Array): Promise<ParsedBlock[]> {
  console.log("[litematic] parseLitematic: input", data.length, "bytes");
  const decompressed = await gunzip(data);
  console.log("[litematic] decompressed:", decompressed.length, "bytes, first bytes:", Array.from(decompressed.slice(0, 10)));
  const nbt = parseNbt(decompressed);
  console.log("[litematic] parsed NBT root type:", nbt.type);
  const root = getCompound(nbt);
  if (!root) throw new Error("无效的 litematic 文件");

  const regions = getCompound(root.Regions);
  if (!regions) throw new Error("litematic 不包含任何区域");

  const allBlocks: ParsedBlock[] = [];
  for (const [name, regionNode] of Object.entries(regions)) {
    console.log("[litematic] processing region:", name);
    // Litematic structure: Regions.{regionName}.{BlockStatePalette, BlockStates, Size, ...}
    allBlocks.push(...decodeRegion(regionNode));
  }
  return allBlocks;
}

// ---------------------------------------------------------------------------
// Block grouping helpers
// ---------------------------------------------------------------------------

function stateKey(state: BlockState): string {
  const props = Object.entries(state.properties).sort(([a], [b]) => a.localeCompare(b));
  return `${state.id}[${props.map(([k, v]) => `${k}=${v}`).join(",")}]`;
}

function stateToCode(state: BlockState): string {
  const props = Object.entries(state.properties).sort(([a], [b]) => a.localeCompare(b));
  if (props.length === 0) return `block("${state.id}")`;
  const propStr = props.map(([k, v]) => `${k}: "${v}"`).join(", ");
  return `block("${state.id}", { ${propStr} })`;
}

type Axis = "x" | "y" | "z";

function findLineRuns(
  blocks: ParsedBlock[],
  stateMap: Map<string, ParsedBlock[]>,
): Map<string, ParsedBlock[][]> {
  const result = new Map<string, ParsedBlock[][]>();
  for (const [key, group] of stateMap) {
    const runs: ParsedBlock[][] = [];
    const remaining = new Set(group.map((b) => `${b.x},${b.y},${b.z}`));
    const posMap = new Map(group.map((b) => [`${b.x},${b.y},${b.z}`, b]));

    for (const block of group) {
      const bk = `${block.x},${block.y},${block.z}`;
      if (!remaining.has(bk)) continue;
      // Try extending along each axis
      let bestRun: ParsedBlock[] = [block];
      for (const axis of ["x", "y", "z"] as Axis[]) {
        const run: ParsedBlock[] = [block];
        for (const dir of [1, -1]) {
          let step = dir;
          for (;;) {
            const next = axis === "x"
              ? posMap.get(`${block.x + step},${block.y},${block.z}`)
              : axis === "y"
              ? posMap.get(`${block.x},${block.y + step},${block.z}`)
              : posMap.get(`${block.x},${block.y},${block.z + step}`);
            if (!next || !remaining.has(`${next.x},${next.y},${next.z}`)) break;
            run.push(next);
            step += dir;
          }
        }
        if (run.length > bestRun.length) bestRun = run;
      }
      if (bestRun.length >= 2) {
        bestRun.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
        for (const b of bestRun) remaining.delete(`${b.x},${b.y},${b.z}`);
        runs.push(bestRun);
      }
    }
    result.set(key, runs);
  }
  return result;
}

// ---------------------------------------------------------------------------
// JS code generation
// ---------------------------------------------------------------------------

export async function litematicToJs(data: Uint8Array, name?: string): Promise<string> {
  console.log("[litematic] litematicToJs: starting, input", data.length, "bytes");
  const blocks = await parseLitematic(data);
  console.log("[litematic] parsed", blocks.length, "non-air blocks");
  if (blocks.length === 0) throw new Error("litematic 文件中没有非空气方块");

  // Group by state
  const stateGroups = new Map<string, ParsedBlock[]>();
  for (const block of blocks) {
    const key = stateKey(block.state);
    const group = stateGroups.get(key);
    if (group) group.push(block);
    else stateGroups.set(key, [block]);
  }

  // Find line runs (>=2 contiguous blocks on same axis)
  const lineRuns = findLineRuns(blocks, stateGroups);

  // Track which blocks are covered by line runs
  const covered = new Set<string>();
  for (const [, runs] of lineRuns) {
    for (const run of runs) {
      for (const b of run) covered.add(`${b.x},${b.y},${b.z}`);
    }
  }

  // Build output lines
  const lines: string[] = [];
  const varNames = new Map<string, string>();
  let varIndex = 0;

  lines.push(`mc.build({`);
  lines.push(`  name: "${(name ?? "导入结构").replace(/"/g, '\\"')}",`);
  lines.push(`  version: "1.21.11",`);
  lines.push(`  author: "Litematic 导入",`);
  lines.push(`  description: "从 .litematic 文件自动生成"`);
  lines.push(`}, ({ world, block, redstone }) => {`);
  lines.push(`  const main = world.region("main", { origin: [0, 0, 0] });`);
  lines.push(``);

  // Emit line runs first
  for (const [key, runs] of lineRuns) {
    if (runs.length === 0) continue;
    const state = stateGroups.get(key)![0].state;
    const varName = `b${varIndex++}`;
    varNames.set(key, varName);
    lines.push(`  const ${varName} = ${stateToCode(state)};`);
    for (const run of runs) {
      const first = run[0];
      const last = run[run.length - 1];
      lines.push(`  main.line([${first.x}, ${first.y}, ${first.z}], [${last.x}, ${last.y}, ${last.z}], ${varName});`);
    }
  }

  // Emit remaining individual blocks
  const uncovered = blocks.filter((b) => !covered.has(`${b.x},${b.y},${b.z}`));
  if (uncovered.length > 0) {
    // Group consecutive same-state blocks
    const byState = new Map<string, ParsedBlock[]>();
    for (const block of uncovered) {
      const key = stateKey(block.state);
      const group = byState.get(key);
      if (group) group.push(block);
      else byState.set(key, [block]);
    }

    for (const [key, group] of byState) {
      if (!varNames.has(key)) {
        const state = group[0].state;
        const varName = `b${varIndex++}`;
        varNames.set(key, varName);
        lines.push(`  const ${varName} = ${stateToCode(state)};`);
      }
      const varName = varNames.get(key)!;
      for (const block of group) {
        lines.push(`  main.set([${block.x}, ${block.y}, ${block.z}], ${varName});`);
      }
    }
  }

  lines.push(`});`);
  return lines.join("\n");
}

import type { BlockState, VersionPack, WorldDocument } from "./types";

const TAG = {
  end: 0,
  int: 3,
  long: 4,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
} as const;

type NbtNode =
  | { type: typeof TAG.int; value: number }
  | { type: typeof TAG.long; value: bigint }
  | { type: typeof TAG.string; value: string }
  | { type: typeof TAG.list; elementType: number; value: NbtNode[] }
  | { type: typeof TAG.compound; value: Record<string, NbtNode> }
  | { type: typeof TAG.intArray; value: number[] }
  | { type: typeof TAG.longArray; value: bigint[] };

const int = (value: number): NbtNode => ({ type: TAG.int, value });
const long = (value: bigint): NbtNode => ({ type: TAG.long, value });
const string = (value: string): NbtNode => ({ type: TAG.string, value });
const compound = (value: Record<string, NbtNode>): NbtNode => ({ type: TAG.compound, value });
const list = (elementType: number, value: NbtNode[]): NbtNode => ({ type: TAG.list, elementType, value });
const longArray = (value: bigint[]): NbtNode => ({ type: TAG.longArray, value });

class ByteWriter {
  private readonly bytes: number[] = [];

  writeByte(value: number) {
    this.bytes.push(value & 0xff);
  }

  writeUnsignedShort(value: number) {
    this.writeByte(value >>> 8);
    this.writeByte(value);
  }

  writeInt(value: number) {
    this.writeByte(value >>> 24);
    this.writeByte(value >>> 16);
    this.writeByte(value >>> 8);
    this.writeByte(value);
  }

  writeLong(value: bigint) {
    const unsigned = BigInt.asUintN(64, value);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      this.writeByte(Number((unsigned >> shift) & 0xffn));
    }
  }

  writeString(value: string) {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > 65_535) throw new Error("NBT string exceeds 65535 bytes");
    this.writeUnsignedShort(encoded.length);
    for (const byte of encoded) this.writeByte(byte);
  }

  writePayload(node: NbtNode) {
    switch (node.type) {
      case TAG.int:
        this.writeInt(node.value);
        return;
      case TAG.long:
        this.writeLong(node.value);
        return;
      case TAG.string:
        this.writeString(node.value);
        return;
      case TAG.list:
        this.writeByte(node.elementType);
        this.writeInt(node.value.length);
        for (const child of node.value) this.writePayload(child);
        return;
      case TAG.compound:
        for (const [name, child] of Object.entries(node.value)) {
          this.writeByte(child.type);
          this.writeString(name);
          this.writePayload(child);
        }
        this.writeByte(TAG.end);
        return;
      case TAG.intArray:
        this.writeInt(node.value.length);
        for (const item of node.value) this.writeInt(item);
        return;
      case TAG.longArray:
        this.writeInt(node.value.length);
        for (const item of node.value) this.writeLong(item);
        return;
    }
  }

  finishRoot(root: NbtNode): Uint8Array {
    if (root.type !== TAG.compound) throw new Error("NBT root must be a compound");
    this.writeByte(TAG.compound);
    this.writeString("");
    this.writePayload(root);
    return Uint8Array.from(this.bytes);
  }
}

function positionTag(x: number, y: number, z: number): NbtNode {
  return compound({ x: int(x), y: int(y), z: int(z) });
}

function canonicalState(state: BlockState): string {
  const properties = Object.entries(state.properties).sort(([left], [right]) => left.localeCompare(right));
  return `${state.id}[${properties.map(([name, value]) => `${name}=${value}`).join(",")}]`;
}

function paletteNode(state: BlockState): NbtNode {
  const properties = Object.fromEntries(
    Object.entries(state.properties)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, string(String(value))]),
  );
  return compound({
    Name: string(state.id),
    ...(Object.keys(properties).length > 0 ? { Properties: compound(properties) } : {}),
  });
}

function setPackedValue(storage: bigint[], index: number, bits: number, value: number) {
  const startBit = index * bits;
  const firstLong = Math.floor(startBit / 64);
  const offset = startBit % 64;
  const mask = (1n << BigInt(bits)) - 1n;
  const encoded = BigInt(value) & mask;
  storage[firstLong] = (storage[firstLong] ?? 0n) | (encoded << BigInt(offset));
  const spill = offset + bits - 64;
  if (spill > 0) {
    storage[firstLong + 1] = (storage[firstLong + 1] ?? 0n) | (encoded >> BigInt(bits - spill));
  }
}

function encodeRegion(world: WorldDocument) {
  if (world.blocks.length === 0) throw new Error("空结构不能导出为 Litematic");
  const xs = world.blocks.map((block) => block.x);
  const ys = world.blocks.map((block) => block.y);
  const zs = world.blocks.map((block) => block.z);
  const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)] as const;
  const max = [Math.max(...xs), Math.max(...ys), Math.max(...zs)] as const;
  const size = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1] as const;
  const volume = size[0] * size[1] * size[2];

  const air: BlockState = { id: "minecraft:air", properties: {} };
  const palette: BlockState[] = [air];
  const paletteIndex = new Map([[canonicalState(air), 0]]);
  for (const block of world.blocks) {
    const key = canonicalState(block.state);
    if (!paletteIndex.has(key)) {
      paletteIndex.set(key, palette.length);
      palette.push(block.state);
    }
  }

  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length))));
  const storage = Array.from({ length: Math.ceil((volume * bits) / 64) }, () => 0n);
  for (const block of world.blocks) {
    const x = block.x - min[0];
    const y = block.y - min[1];
    const z = block.z - min[2];
    const linearIndex = y * (size[0] * size[2]) + z * size[0] + x;
    setPackedValue(storage, linearIndex, bits, paletteIndex.get(canonicalState(block.state)) ?? 0);
  }

  return { min, size, volume, palette, storage };
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (!("CompressionStream" in globalThis)) {
    throw new Error("当前浏览器不支持原生 GZip，无法导出 .litematic");
  }
  const input = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function createLitematicBlob(world: WorldDocument, pack: VersionPack): Promise<Blob> {
  if (pack.gameVersion === "1.12.2") {
    throw new Error("Legacy 1.12.2 codec 仍处于预览阶段；当前版本不会生成未经验证的文件");
  }

  const region = encodeRegion(world);
  const now = BigInt(Date.now());
  const schematicVersion = pack.dataVersion <= 3700 ? 6 : 7;
  const root = compound({
    MinecraftDataVersion: int(pack.dataVersion),
    Version: int(schematicVersion),
    SubVersion: int(1),
    Metadata: compound({
      Name: string(world.name),
      Author: string(world.author),
      Description: string(world.description),
      RegionCount: int(1),
      TotalVolume: int(region.volume),
      TotalBlocks: int(world.blocks.length),
      TimeCreated: long(now),
      TimeModified: long(now),
      EnclosingSize: positionTag(region.size[0], region.size[1], region.size[2]),
    }),
    Regions: compound({
      Main: compound({
        BlockStatePalette: list(TAG.compound, region.palette.map(paletteNode)),
        BlockStates: longArray(region.storage),
        TileEntities: list(TAG.compound, []),
        PendingBlockTicks: list(TAG.compound, []),
        PendingFluidTicks: list(TAG.compound, []),
        Entities: list(TAG.compound, []),
        Position: positionTag(region.min[0], region.min[1], region.min[2]),
        Size: positionTag(region.size[0], region.size[1], region.size[2]),
      }),
    }),
  });

  const raw = new ByteWriter().finishRoot(root);
  if (raw[0] !== TAG.compound) throw new Error("Litematic NBT root self-check failed");
  const compressed = await gzip(raw);
  const output = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  ) as ArrayBuffer;
  return new Blob([output], { type: "application/gzip" });
}

export function safeLitematicName(name: string): string {
  const normalized = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return `${normalized || "minecraft-build"}.litematic`;
}

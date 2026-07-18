import * as THREE from "three";
import { Cull, Identifier, type Mesh as DeepslateMesh, type Resources } from "deepslate";
import { collisionBoxesForBlock, type CollisionShapePack } from "./block-shapes";
import type { PlacedBlock, VersionPack } from "./types";

type GeometryAccumulator = {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  triangleBlocks: PlacedBlock[];
};

export type PreviewMeshResult = {
  objects: THREE.Object3D[];
  selectable: THREE.Object3D[];
  modelBlockCount: number;
  fallbackBlockCount: number;
};

function emptyAccumulator(): GeometryAccumulator {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [], triangleBlocks: [] };
}

export function blockPreviewColor(id: string): number {
  if (/redstone|repeater|comparator|observer|piston|lever|button/.test(id)) return 0xc2473f;
  if (/copper/.test(id)) return /oxidized/.test(id) ? 0x4e9180 : 0xb66b48;
  if (/glass|ice/.test(id)) return 0x8ac4d4;
  if (/spruce|dark_oak/.test(id)) return 0x59402f;
  if (/oak|planks|log|wood/.test(id)) return 0x9b7547;
  if (/deepslate|blackstone/.test(id)) return 0x45464e;
  if (/stone|cobble|andesite|brick/.test(id)) return 0x777a7b;
  if (/grass|moss|leaves|vine/.test(id)) return 0x5f8648;
  if (/water/.test(id)) return 0x3b73b9;
  if (/lava|magma/.test(id)) return 0xe26b2d;
  if (/sand|sandstone/.test(id)) return 0xd2bd7e;
  if (/white|quartz|snow/.test(id)) return 0xdadbd4;
  if (/lantern|torch|lamp/.test(id)) return 0xe2a33c;
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.28, 0.48).getHex();
}

function blockKey(block: Pick<PlacedBlock, "x" | "y" | "z">) {
  return `${block.x},${block.y},${block.z}`;
}

function cullForBlock(block: PlacedBlock, positions: Map<string, PlacedBlock>, resources: Resources) {
  const cull = Cull.none();
  const neighbors = [
    ["up", 0, 1, 0],
    ["down", 0, -1, 0],
    ["west", -1, 0, 0],
    ["east", 1, 0, 0],
    ["north", 0, 0, -1],
    ["south", 0, 0, 1],
  ] as const;
  for (const [direction, dx, dy, dz] of neighbors) {
    const neighbor = positions.get(`${block.x + dx},${block.y + dy},${block.z + dz}`);
    if (!neighbor) continue;
    const flags = resources.getBlockFlags(Identifier.parse(neighbor.state.id));
    if (flags?.opaque) cull[direction] = true;
  }
  return cull;
}

function appendModelMesh(target: GeometryAccumulator, mesh: DeepslateMesh, block: PlacedBlock) {
  for (const quad of mesh.quads) {
    const base = target.positions.length / 3;
    const normal = quad.normal();
    for (const vertex of quad.vertices()) {
      target.positions.push(
        vertex.pos.x + block.x - 0.5,
        vertex.pos.y + block.y - 0.5,
        vertex.pos.z + block.z - 0.5,
      );
      target.normals.push(normal.x, normal.y, normal.z);
      target.uvs.push(vertex.texture?.[0] ?? 0, vertex.texture?.[1] ?? 0);
      target.colors.push(vertex.color[0] ?? 1, vertex.color[1] ?? 1, vertex.color[2] ?? 1);
    }
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    target.triangleBlocks.push(block, block);
  }
}

function atlasTexture(resources: Resources) {
  const image = resources.getTextureAtlas();
  const data = new Uint8Array(image.data.buffer.slice(0));
  const texture = new THREE.DataTexture(data, image.width, image.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function meshFromAccumulator(
  accumulator: GeometryAccumulator,
  texture: THREE.Texture,
  translucent: boolean,
  xray: boolean,
) {
  if (accumulator.indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(accumulator.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(accumulator.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(accumulator.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(accumulator.colors, 3));
  geometry.setIndex(accumulator.indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: xray || translucent ? 0 : 0.05,
    transparent: xray || translucent,
    opacity: xray ? 0.34 : 1,
    depthWrite: !(xray || translucent),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.triangleBlocks = accumulator.triangleBlocks;
  mesh.castShadow = !xray && !translucent;
  mesh.receiveShadow = true;
  return mesh;
}

type FallbackEntry = {
  block: PlacedBlock;
  x: number;
  y: number;
  z: number;
};

function fallbackMeshes(
  blocks: PlacedBlock[],
  shapePack: CollisionShapePack | null,
  versionPack: VersionPack,
  xray: boolean,
) {
  const groups = new Map<string, {
    color: number;
    size: [number, number, number];
    translucent: boolean;
    entries: FallbackEntry[];
  }>();
  for (const block of blocks) {
    const color = blockPreviewColor(block.state.id);
    const translucent = /glass|water|ice|portal|slime|honey/.test(block.state.id);
    for (const box of collisionBoxesForBlock(block, shapePack, versionPack)) {
      const size: [number, number, number] = [box[3] - box[0], box[4] - box[1], box[5] - box[2]];
      if (size.some((value) => value <= 0)) continue;
      const localCenter = [
        (box[0] + box[3]) / 2 - 0.5,
        (box[1] + box[4]) / 2 - 0.5,
        (box[2] + box[5]) / 2 - 0.5,
      ];
      const key = [color, translucent ? 1 : 0, ...size, ...localCenter].join(":");
      const group = groups.get(key) ?? { color, size, translucent, entries: [] };
      group.entries.push({
        block,
        x: block.x + localCenter[0],
        y: block.y + localCenter[1],
        z: block.z + localCenter[2],
      });
      groups.set(key, group);
    }
  }

  const matrix = new THREE.Matrix4();
  const meshes: THREE.InstancedMesh[] = [];
  for (const group of groups.values()) {
    const geometry = new THREE.BoxGeometry(...group.size);
    const material = new THREE.MeshStandardMaterial({
      color: group.color,
      roughness: 0.82,
      metalness: 0.02,
      transparent: xray || group.translucent,
      opacity: xray ? 0.34 : group.translucent ? 0.58 : 1,
      depthWrite: !(xray || group.translucent),
    });
    const mesh = new THREE.InstancedMesh(geometry, material, group.entries.length);
    mesh.userData.blocks = group.entries.map((entry) => entry.block);
    mesh.castShadow = !xray && !group.translucent;
    mesh.receiveShadow = true;
    group.entries.forEach((entry, index) => {
      matrix.makeTranslation(entry.x, entry.y, entry.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    meshes.push(mesh);
  }
  return meshes;
}

export function createPreviewMeshes({
  blocks,
  canCull,
  shapePack,
  versionPack,
  resources,
  xray,
}: {
  blocks: PlacedBlock[];
  canCull: boolean;
  shapePack: CollisionShapePack | null;
  versionPack: VersionPack;
  resources: Resources | null;
  xray: boolean;
}): PreviewMeshResult {
  const objects: THREE.Object3D[] = [];
  const selectable: THREE.Object3D[] = [];
  const fallback: PlacedBlock[] = [];
  let modelBlockCount = 0;

  if (resources) {
    const opaque = emptyAccumulator();
    const translucent = emptyAccumulator();
    const positions = canCull ? new Map(blocks.map((block) => [blockKey(block), block])) : new Map<string, PlacedBlock>();
    for (const block of blocks) {
      const id = Identifier.parse(block.state.id);
      const definition = resources.getBlockDefinition(id);
      if (!definition) {
        fallback.push(block);
        continue;
      }
      try {
        const properties = {
          ...(resources.getDefaultBlockProperties(id) ?? {}),
          ...block.state.properties,
        };
        const cull = canCull ? cullForBlock(block, positions, resources) : Cull.none();
        const mesh = definition.getMesh(id, properties, resources, resources, cull);
        if (mesh.isEmpty()) {
          fallback.push(block);
          continue;
        }
        const flags = resources.getBlockFlags(id);
        appendModelMesh(flags?.semi_transparent ? translucent : opaque, mesh, block);
        modelBlockCount += 1;
      } catch {
        fallback.push(block);
      }
    }
    if (opaque.indices.length > 0 || translucent.indices.length > 0) {
      const texture = atlasTexture(resources);
      const opaqueMesh = meshFromAccumulator(opaque, texture, false, xray);
      const translucentMesh = meshFromAccumulator(translucent, texture, true, xray);
      for (const mesh of [opaqueMesh, translucentMesh]) {
        if (!mesh) continue;
        objects.push(mesh);
        selectable.push(mesh);
      }
    }
  } else {
    fallback.push(...blocks);
  }

  const fallbackObjects = fallbackMeshes(fallback, shapePack, versionPack, xray);
  objects.push(...fallbackObjects);
  selectable.push(...fallbackObjects);
  return { objects, selectable, modelBlockCount, fallbackBlockCount: fallback.length };
}

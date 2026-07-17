"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlacedBlock, WorldDocument } from "@/lib/minecraft/types";

type Viewport3DProps = {
  world: WorldDocument;
  xray: boolean;
  redstoneOnly: boolean;
  layer: number | null;
  selected: PlacedBlock | null;
  onSelect: (block: PlacedBlock | null) => void;
};

function blockColor(id: string): number {
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
  const color = new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.28, 0.48);
  return color.getHex();
}

export function Viewport3D({ world, xray, redstoneOnly, layer, selected, onSelect }: Viewport3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e5dc);
    scene.fog = new THREE.Fog(0xe8e5dc, 70, 170);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;
    controls.maxDistance = 240;
    controls.minDistance = 3;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d716d, 2.2));
    const sun = new THREE.DirectionalLight(0xfff4dc, 2.5);
    sun.position.set(24, 36, 18);
    sun.castShadow = true;
    scene.add(sun);

    const visible = world.blocks
      .filter((block) => (layer === null ? true : block.y <= layer))
      .filter((block) => (redstoneOnly ? /redstone|repeater|comparator|observer|piston|lever|button|lamp/.test(block.state.id) : true));
    const sampled = visible.length > 12_000 ? visible.filter((_, index) => index % Math.ceil(visible.length / 12_000) === 0) : visible;
    const groups = new Map<number, PlacedBlock[]>();
    for (const block of sampled) {
      const color = blockColor(block.state.id);
      const group = groups.get(color) ?? [];
      group.push(block);
      groups.set(color, group);
    }

    const bounds = new THREE.Box3();
    const geometry = new THREE.BoxGeometry(0.94, 0.94, 0.94);
    const matrix = new THREE.Matrix4();
    const meshes: THREE.InstancedMesh[] = [];
    for (const [color, blocks] of groups) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.82,
        metalness: /copper|iron|gold/.test(blocks[0]?.state.id ?? "") ? 0.28 : 0.02,
        transparent: xray || blocks.some((block) => /glass|water|ice/.test(block.state.id)),
        opacity: xray ? 0.34 : blocks.some((block) => /glass|water|ice/.test(block.state.id)) ? 0.56 : 1,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
      mesh.userData.blocks = blocks;
      mesh.castShadow = !xray;
      mesh.receiveShadow = true;
      blocks.forEach((block, index) => {
        matrix.makeTranslation(block.x, block.y, block.z);
        mesh.setMatrixAt(index, matrix);
        bounds.expandByPoint(new THREE.Vector3(block.x, block.y, block.z));
      });
      mesh.instanceMatrix.needsUpdate = true;
      meshes.push(mesh);
      scene.add(mesh);
    }

    const size = bounds.isEmpty() ? new THREE.Vector3(12, 8, 12) : bounds.getSize(new THREE.Vector3());
    const center = bounds.isEmpty() ? new THREE.Vector3(0, 2, 0) : bounds.getCenter(new THREE.Vector3());
    const gridSize = Math.max(24, Math.ceil(Math.max(size.x, size.z) + 12));
    const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 64), 0x8f958e, 0xc8c8bd);
    grid.position.y = bounds.isEmpty() ? -0.5 : bounds.min.y - 0.5;
    scene.add(grid);
    const axes = new THREE.AxesHelper(Math.min(8, gridSize / 4));
    axes.position.set(center.x - size.x / 2 - 1, grid.position.y + 0.02, center.z - size.z / 2 - 1);
    scene.add(axes);

    const radius = Math.max(8, size.length() * 0.8);
    camera.position.set(center.x + radius, center.y + radius * 0.72, center.z + radius);
    controls.target.copy(center);
    controls.update();

    let selectionLines: THREE.LineSegments | null = null;
    if (selected) {
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08));
      selectionLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffc857 }));
      selectionLines.position.set(selected.x, selected.y, selected.z);
      scene.add(selectionLines);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit || hit.instanceId === undefined) {
        onSelectRef.current(null);
        return;
      }
      const blocks = (hit.object.userData.blocks ?? []) as PlacedBlock[];
      onSelectRef.current(blocks[hit.instanceId] ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointer);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      controls.dispose();
      geometry.dispose();
      for (const mesh of meshes) (mesh.material as THREE.Material).dispose();
      if (selectionLines) {
        selectionLines.geometry.dispose();
        (selectionLines.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [world, xray, redstoneOnly, layer, selected]);

  return <div className="viewport-host" ref={hostRef} aria-label="Minecraft 结构三维预览" />;
}

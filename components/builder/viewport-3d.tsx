"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadCollisionShapePack, type CollisionShapePack } from "@/lib/minecraft/block-shapes";
import { createPreviewMeshes } from "@/lib/minecraft/preview-mesher";
import { loadRenderResources, type LoadedRenderResources } from "@/lib/minecraft/render-resources";
import type { ResourcePackSummary } from "@/lib/minecraft/resource-packs";
import type { PlacedBlock, VersionPack, WorldDocument } from "@/lib/minecraft/types";

type Viewport3DProps = {
  world: WorldDocument;
  xray: boolean;
  redstoneOnly: boolean;
  layer: number | null;
  selected: PlacedBlock | null;
  versionPack: VersionPack | null;
  resourcePacks: ResourcePackSummary[];
  onSelect: (block: PlacedBlock | null) => void;
};

type ViewportRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  content: THREE.Group;
  selection: THREE.Group;
  meshes: THREE.Object3D[];
  framedWorld: WorldDocument | null;
};

function disposeGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
      if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map);
    }
  });
  group.clear();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export function Viewport3D({
  world,
  xray,
  redstoneOnly,
  layer,
  selected,
  versionPack,
  resourcePacks,
  onSelect,
}: Viewport3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const onSelectRef = useRef(onSelect);
  const [shapePack, setShapePack] = useState<CollisionShapePack | null>(null);
  const [renderResources, setRenderResources] = useState<LoadedRenderResources | null>(null);
  const [resourceState, setResourceState] = useState<{
    status: "fallback" | "loading" | "ready" | "error";
    message: string;
  }>({ status: "fallback", message: "真实形状 · 程序化材质" });

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
    renderer.shadowMap.type = THREE.PCFShadowMap;
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

    const content = new THREE.Group();
    const selection = new THREE.Group();
    scene.add(content, selection);

    const runtime: ViewportRuntime = {
      scene,
      camera,
      renderer,
      controls,
      content,
      selection,
      meshes: [],
      framedWorld: null,
    };
    runtimeRef.current = runtime;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(runtime.meshes, false)[0];
      if (!hit) {
        onSelectRef.current(null);
        return;
      }
      if (hit.instanceId !== undefined) {
        const blocks = (hit.object.userData.blocks ?? []) as PlacedBlock[];
        onSelectRef.current(blocks[hit.instanceId] ?? null);
        return;
      }
      const triangleBlocks = (hit.object.userData.triangleBlocks ?? []) as PlacedBlock[];
      const faceIndex = hit.faceIndex;
      onSelectRef.current(faceIndex === undefined || faceIndex === null ? null : triangleBlocks[faceIndex] ?? null);
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
      disposeGroup(content);
      disposeGroup(selection);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCollisionShapePack(world.version)
      .then((loaded) => {
        if (!cancelled) setShapePack(loaded);
      })
      .catch(() => {
        if (!cancelled) setShapePack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [world.version]);

  useEffect(() => {
    let cancelled = false;
    const enabled = resourcePacks.filter((item) => item.enabled);
    if (!versionPack || enabled.length === 0) {
      queueMicrotask(() => {
        if (cancelled) return;
        setRenderResources(null);
        setResourceState({ status: "fallback", message: "真实形状 · 程序化材质" });
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) setResourceState({ status: "loading", message: `正在合并 ${enabled.length} 个资源包…` });
    });
    loadRenderResources(resourcePacks, versionPack.resourcePackFormat ?? null, versionPack)
      .then((loaded) => {
        if (cancelled) return;
        setRenderResources(loaded);
        setResourceState(loaded
          ? {
              status: "ready",
              message: `${loaded.packNames.length} 个资源包 · ${loaded.textureCount.toLocaleString()} 张纹理`,
            }
          : { status: "fallback", message: "真实形状 · 程序化材质" });
      })
      .catch((error) => {
        if (cancelled) return;
        setRenderResources(null);
        setResourceState({
          status: "error",
          message: `资源包加载失败：${error instanceof Error ? error.message : String(error)}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resourcePacks, versionPack]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    disposeGroup(runtime.content);
    const visible = world.blocks
      .filter((block) => (layer === null ? true : block.y <= layer))
      .filter((block) => (redstoneOnly ? /redstone|repeater|comparator|observer|piston|lever|button|lamp/.test(block.state.id) : true));
    const sampled = visible.length > 12_000
      ? visible.filter((_, index) => index % Math.ceil(visible.length / 12_000) === 0)
      : visible;
    const bounds = new THREE.Box3();
    for (const block of sampled) bounds.expandByPoint(new THREE.Vector3(block.x, block.y, block.z));
    if (versionPack) {
      const result = createPreviewMeshes({
        blocks: sampled,
        canCull: sampled.length === visible.length,
        shapePack,
        versionPack,
        resources: renderResources?.resources ?? null,
        xray,
      });
      runtime.meshes = result.selectable;
      if (result.objects.length > 0) runtime.content.add(...result.objects);
    } else {
      runtime.meshes = [];
    }

    const size = bounds.isEmpty() ? new THREE.Vector3(12, 8, 12) : bounds.getSize(new THREE.Vector3());
    const center = bounds.isEmpty() ? new THREE.Vector3(0, 2, 0) : bounds.getCenter(new THREE.Vector3());
    const gridSize = Math.max(24, Math.ceil(Math.max(size.x, size.z) + 12));
    const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 64), 0x8f958e, 0xc8c8bd);
    grid.position.y = bounds.isEmpty() ? -0.5 : bounds.min.y - 0.5;
    runtime.content.add(grid);
    const axes = new THREE.AxesHelper(Math.min(8, gridSize / 4));
    axes.position.set(center.x - size.x / 2 - 1, grid.position.y + 0.02, center.z - size.z / 2 - 1);
    runtime.content.add(axes);

    if (runtime.framedWorld !== world) {
      const radius = Math.max(8, size.length() * 0.8);
      runtime.camera.position.set(center.x + radius, center.y + radius * 0.72, center.z + radius);
      runtime.controls.target.copy(center);
      runtime.controls.update();
      runtime.framedWorld = world;
    }
  }, [world, xray, redstoneOnly, layer, versionPack, shapePack, renderResources]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeGroup(runtime.selection);
    if (!selected) return;
    const box = new THREE.BoxGeometry(1.08, 1.08, 1.08);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffc857 }));
    lines.position.set(selected.x, selected.y, selected.z);
    runtime.selection.add(lines);
  }, [selected]);

  return (
    <div className="viewport-frame">
      <div className="viewport-host" ref={hostRef} aria-label="Minecraft 结构三维预览" />
      <div className={`render-resource-state ${resourceState.status}`} aria-live="polite">
        <span />
        {resourceState.message}
      </div>
    </div>
  );
}

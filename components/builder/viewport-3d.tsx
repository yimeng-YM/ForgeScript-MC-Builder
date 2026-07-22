"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
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
  firstPerson: boolean;
  firstPersonSpeed: number;
  selected: PlacedBlock | null;
  versionPack: VersionPack | null;
  resourcePacks: ResourcePackSummary[];
  onSelect: (block: PlacedBlock | null) => void;
  onFirstPersonChange: (active: boolean) => void;
  onFirstPersonSpeedChange: (speed: number) => void;
  controllerRef: Ref<Viewport3DController>;
};

export type Viewport3DController = {
  requestFirstPerson: () => boolean;
};

type ViewportRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  pointerControls: PointerLockControls;
  content: THREE.Group;
  selection: THREE.Group;
  meshes: THREE.Object3D[];
  framedWorld: WorldDocument | null;
  bounds: THREE.Box3;
  firstPersonUpdate: ((deltaSeconds: number) => void) | null;
  renderedCameraPosition: THREE.Vector3;
  renderedCameraQuaternion: THREE.Quaternion;
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
  firstPerson,
  firstPersonSpeed,
  selected,
  versionPack,
  resourcePacks,
  onSelect,
  onFirstPersonChange,
  onFirstPersonSpeedChange,
  controllerRef,
}: Viewport3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const onSelectRef = useRef(onSelect);
  const onFirstPersonChangeRef = useRef(onFirstPersonChange);
  const firstPersonSpeedRef = useRef(firstPersonSpeed);
  const onFirstPersonSpeedChangeRef = useRef(onFirstPersonSpeedChange);
  const speedNoticeTimerRef = useRef<number | null>(null);
  const [speedNotice, setSpeedNotice] = useState<number | null>(null);
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
    onFirstPersonChangeRef.current = onFirstPersonChange;
  }, [onFirstPersonChange]);

  useEffect(() => {
    firstPersonSpeedRef.current = firstPersonSpeed;
  }, [firstPersonSpeed]);

  useEffect(() => {
    onFirstPersonSpeedChangeRef.current = onFirstPersonSpeedChange;
  }, [onFirstPersonSpeedChange]);

  useImperativeHandle(controllerRef, () => ({
    requestFirstPerson() {
      const canvas = runtimeRef.current?.renderer.domElement;
      if (!canvas || typeof canvas.requestPointerLock !== "function") return false;
      try {
        const request = canvas.requestPointerLock();
        void Promise.resolve(request).catch(() => onFirstPersonChangeRef.current(false));
        return true;
      } catch {
        return false;
      }
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e5dc);
    scene.fog = new THREE.Fog(0xe8e5dc, 300, 800);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;
    controls.maxDistance = 1000;
    controls.minDistance = 3;
    const pointerControls = new PointerLockControls(camera, renderer.domElement);
    pointerControls.enabled = false;

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
      pointerControls,
      content,
      selection,
      meshes: [],
      framedWorld: null,
      bounds: new THREE.Box3(),
      firstPersonUpdate: null,
      renderedCameraPosition: new THREE.Vector3(),
      renderedCameraQuaternion: new THREE.Quaternion(),
    };
    runtimeRef.current = runtime;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointer = (event: PointerEvent) => {
      const pointerLocked = document.pointerLockElement === renderer.domElement;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (!pointerLocked) {
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      }
      if (pointerLocked) {
        // Pick from the exact camera pose used by the last displayed frame.
        raycaster.ray.origin.copy(runtime.renderedCameraPosition);
        raycaster.ray.direction
          .set(0, 0, -1)
          .applyQuaternion(runtime.renderedCameraQuaternion)
          .normalize();
      } else {
        camera.updateMatrixWorld();
        raycaster.setFromCamera(pointer, camera);
      }
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
    let previousTime = performance.now();
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const deltaSeconds = Math.min(Math.max((time - previousTime) / 1000, 0), 0.1);
      previousTime = time;
      if (runtime.firstPersonUpdate) runtime.firstPersonUpdate(deltaSeconds);
      else runtime.controls.update();
      renderer.render(scene, camera);
      runtime.renderedCameraPosition.copy(camera.position);
      runtime.renderedCameraQuaternion.copy(camera.quaternion);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      runtime.controls.dispose();
      runtime.pointerControls.dispose();
      if (speedNoticeTimerRef.current !== null) window.clearTimeout(speedNoticeTimerRef.current);
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
    const sampled = visible.length > 500_000
      ? visible.filter((_, index) => index % Math.ceil(visible.length / 500_000) === 0)
      : visible;
    const bounds = new THREE.Box3();
    for (const block of sampled) bounds.expandByPoint(new THREE.Vector3(block.x, block.y, block.z));
    runtime.bounds.copy(bounds);
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
    const gridSize = Math.max(48, Math.ceil(Math.max(size.x, size.z) * 2 + 24));
    const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 64), 0x8f958e, 0xc8c8bd);
    grid.position.y = bounds.isEmpty() ? -0.5 : bounds.min.y - 0.5;
    runtime.content.add(grid);
    const axes = new THREE.AxesHelper(Math.min(8, gridSize / 4));
    axes.position.set(center.x - size.x / 2 - 1, grid.position.y + 0.02, center.z - size.z / 2 - 1);
    runtime.content.add(axes);

    if (runtime.framedWorld !== world && !firstPerson) {
      const radius = Math.max(8, size.length() * 0.8);
      runtime.camera.position.set(center.x + radius, center.y + radius * 0.72, center.z + radius);
      runtime.controls.target.copy(center);
      runtime.controls.update();
      runtime.framedWorld = world;
    }
  }, [world, xray, redstoneOnly, layer, firstPerson, versionPack, shapePack, renderResources]);

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

  // First-person pointer-lock controls
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !firstPerson) return;

    const { camera, renderer, scene, pointerControls } = runtime;
    const canvas = renderer.domElement;
    if (typeof canvas.requestPointerLock !== "function") {
      queueMicrotask(() => onFirstPersonChangeRef.current(false));
      return;
    }

    const orbitPosition = camera.position.clone();
    const orbitTarget = runtime.controls.target.clone();
    const bounds = runtime.bounds;
    const startY = bounds.isEmpty() ? 1.62 : bounds.min.y + 1.62;
    const startZ = bounds.isEmpty() ? orbitTarget.z - 6 : bounds.min.z - 3;
    camera.position.set(orbitTarget.x, startY, startZ);
    const lookTarget = new THREE.Vector3(orbitTarget.x, startY, orbitTarget.z);
    camera.lookAt(lookTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld();

    // OrbitControls.update() overwrites the camera quaternion, so the render loop
    // must skip it while pointer-lock controls own the camera.
    runtime.controls.enabled = false;
    pointerControls.enabled = true;

    // Extended fog for first-person view
    const originalFog = scene.fog;
    scene.fog = new THREE.Fog(0xe8e5dc, 200, 1000);

    // Pointer-lock state
    let locked = document.pointerLockElement === canvas;
    const onLockChange = () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) onFirstPersonChangeRef.current(false);
    };
    const onLockError = () => onFirstPersonChangeRef.current(false);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);

    // Key tracking
    const keys = new Set<string>();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!locked) return;
      const tracked = [
        "KeyW", "KeyA", "KeyS", "KeyD",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Space", "ShiftLeft", "ShiftRight",
      ];
      if (tracked.includes(event.code)) {
        event.preventDefault();
        keys.add(event.code);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const clearKeys = () => keys.clear();

    const onWheel = (event: WheelEvent) => {
      if (!locked || event.deltaY === 0) return;
      event.preventDefault();
      const nextSpeed = THREE.MathUtils.clamp(
        firstPersonSpeedRef.current + (event.deltaY < 0 ? 1 : -1),
        1,
        20,
      );
      firstPersonSpeedRef.current = nextSpeed;
      onFirstPersonSpeedChangeRef.current(nextSpeed);
      setSpeedNotice(nextSpeed);
      if (speedNoticeTimerRef.current !== null) window.clearTimeout(speedNoticeTimerRef.current);
      speedNoticeTimerRef.current = window.setTimeout(() => {
        speedNoticeTimerRef.current = null;
        setSpeedNotice(null);
      }, 1_000);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener("blur", clearKeys);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const updateFirstPerson = (deltaSeconds: number) => {
      const forward = Number(keys.has("KeyW") || keys.has("ArrowUp"))
        - Number(keys.has("KeyS") || keys.has("ArrowDown"));
      const right = Number(keys.has("KeyD") || keys.has("ArrowRight"))
        - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      const vertical = Number(keys.has("Space"))
        - Number(keys.has("ShiftLeft") || keys.has("ShiftRight"));
      const magnitude = Math.hypot(forward, right, vertical);
      if (magnitude === 0) return;
      const distance = firstPersonSpeedRef.current * deltaSeconds / magnitude;
      // PointerLockControls reads the camera's local axes from camera.matrix.
      camera.updateMatrix();
      pointerControls.moveForward(forward * distance);
      pointerControls.moveRight(right * distance);
      camera.position.y += vertical * distance;
    };
    runtime.firstPersonUpdate = updateFirstPerson;
    updateFirstPerson(0);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener("blur", clearKeys);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);

      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }

      scene.fog = originalFog;
      keys.clear();
      pointerControls.enabled = false;
      if (runtime.firstPersonUpdate === updateFirstPerson) runtime.firstPersonUpdate = null;

      camera.position.copy(orbitPosition);
      runtime.controls.target.copy(orbitTarget);
      runtime.controls.enabled = true;
      runtime.controls.update();
    };
  }, [firstPerson]);

  return (
    <div className="viewport-frame">
      <div className="viewport-host" ref={hostRef} aria-label="Minecraft 结构三维预览" />
      {firstPerson && speedNotice !== null && (
        <div className="first-person-speed-notice" role="status">移动速度 {speedNotice} 格/秒</div>
      )}
      <div className={`render-resource-state ${resourceState.status}`} aria-live="polite">
        <span />
        {resourceState.message}
      </div>
    </div>
  );
}

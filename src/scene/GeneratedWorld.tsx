import { TransformControls } from "@react-three/drei";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GeneratedEnvironment, WorldObjectPlacement } from "../environment";
import { loopWrap, useStore } from "../store";
import { CompositionMap, LoopPreviewTransform, tiledMapTransforms, transformLoopPoint } from "../map";
import { WORLD_OBJECT_SPECS, WorldObjectPart } from "../worldgen/objects";
import { terrainFieldFor } from "../worldgen/sampler";
import { TerrainField, flattenSources, terrainHeightAt } from "../worldgen/terrain";
import { loopEditPoint } from "../worldgen/loop";
import { valueNoise2 } from "../worldgen/noise";
import { skyGradient } from "./skyGradient";
import {
  createFadedInstancedMesh,
  disposeFadedInstancedMesh,
  ENVIRONMENT_INSTANCE_UPDATE_INTERVAL,
  finishInstanceFadeUpdate,
  setInstanceFade,
} from "./fadedInstances";
import { effectiveFadeOuter, radialFade, subscribeDebugFade } from "./fade";

// Procedurally generated world: a terrain heightfield plus instanced scatter
// objects, both derived from composition.environment.generated (see
// src/worldgen/). Terrain is a standard opaque mesh, so the scene fog fades it
// at the shared radial band for free; scatter objects are GPU-instanced and
// therefore route their visibility through radialFade per the AGENTS.md
// convention, reusing the same faded-instance machinery as authored packs.
export function GeneratedWorld({ editMode }: { editMode: boolean }) {
  const composition = useStore((s) => s.composition);
  const generated = composition.environment.generated;
  const field = terrainFieldFor(composition);
  // Stem drags throttle sampler rebuilds (see sampler.ts); nudge one extra
  // render after the throttle window so the terrain settles on the final state.
  const [, bumpSettle] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => bumpSettle((v) => v + 1), 350);
    return () => window.clearTimeout(timer);
  }, [composition]);
  if (!generated || !field) return null;
  return (
    <group>
      <SkyDome skyColor={generated.params.skyColor} />
      <MoodLighting generated={generated} />
      <TerrainPatch generated={generated} field={field} editMode={editMode} />
      <ScatterInstances generated={generated} field={field} map={composition.map} editMode={editMode} />
      {editMode && <SelectedWorldObjectGizmo generated={generated} field={field} map={composition.map} />}
      {editMode && <ConstraintZones generated={generated} />}
    </group>
  );
}

// Camera-following gradient sky: lighter shade of the authored sky color at
// the horizon, darker at the zenith (both derived in skyGradient.ts — the
// composer picks one color). The horizon shade doubles as the fog/background
// color, so geometry fading at the radial band dissolves into the dome
// seamlessly. Drawn first with depth disabled, like the AR backdrop, so the
// world always renders over it; fog must not affect it.
function SkyDome({ skyColor }: { skyColor: string }) {
  const camera = useThree((state) => state.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          horizonColor: { value: new THREE.Color() },
          zenithColor: { value: new THREE.Color() },
        },
        vertexShader: `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: `
uniform vec3 horizonColor;
uniform vec3 zenithColor;
varying vec3 vDir;
void main() {
  float up = clamp(normalize(vDir).y, 0.0, 1.0);
  gl_FragColor = vec4(mix(horizonColor, zenithColor, pow(up, 0.6)), 1.0);
}`,
      }),
    [],
  );
  useEffect(() => {
    const { horizon, zenith } = skyGradient(skyColor);
    (material.uniforms.horizonColor.value as THREE.Color).set(horizon);
    (material.uniforms.zenithColor.value as THREE.Color).set(zenith);
  }, [material, skyColor]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => mesh.current?.position.copy(camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-999} frustumCulled={false}>
      <sphereGeometry args={[170, 32, 16]} />
    </mesh>
  );
}

function MoodLighting({ generated }: { generated: GeneratedEnvironment }) {
  const { moodAmbient, moodSun, skyColor } = generated.params;
  return (
    <group>
      <ambientLight intensity={moodAmbient * 0.55} color={skyColor} />
      <hemisphereLight args={[skyColor, "#0a0c10", moodAmbient * 0.5]} />
      <directionalLight position={[34, 48, 20]} intensity={moodSun * 0.9} color="#d8e2f5" />
    </group>
  );
}

// --- Terrain ---------------------------------------------------------------

function TerrainPatch({
  generated,
  field,
  editMode,
}: {
  generated: GeneratedEnvironment;
  field: TerrainField;
  editMode: boolean;
}) {
  const geometry = useMemo(() => buildTerrainGeometry(generated, field), [generated, field]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const brush = useTerrainBrush(field, editMode);
  return (
    <>
      <mesh
        geometry={geometry}
        receiveShadow
        renderOrder={-1}
        onPointerDown={editMode ? brush.onPointerDown : undefined}
        onPointerMove={editMode ? brush.onPointerMove : undefined}
        onPointerLeave={editMode ? brush.onPointerLeave : undefined}
        onClick={editMode ? brush.onClick : undefined}
      >
        <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
      </mesh>
      {brush.cursor}
    </>
  );
}

function buildTerrainGeometry(generated: GeneratedEnvironment, field: TerrainField): THREE.BufferGeometry {
  const { resolution, size, center, heights } = field;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const positions = new Float32Array(verts * verts * 3);
  const colors = new Float32Array(verts * verts * 3);
  const palette = generated.params.palette.map((hex) => new THREE.Color(hex));
  const amplitude = Math.max(generated.params.terrainAmplitude, 2);
  const color = new THREE.Color();

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const index = iz * verts + ix;
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const h = heights[index];
      positions[index * 3] = x;
      positions[index * 3 + 1] = h;
      positions[index * 3 + 2] = z;
      // Palette ramp by height with a little patchiness so flats aren't
      // flat-colored. Loop-aware fields supply lift-free shade heights and
      // canonical patch coordinates so colors match across the loop seam.
      const shadeHeight = field.shade ? field.shade[index] : h;
      const px = field.patch ? field.patch[index * 2] : x;
      const pz = field.patch ? field.patch[index * 2 + 1] : z;
      const patch = valueNoise2(generated.seed + 977, px * 0.11, pz * 0.11) * 0.35;
      const t = Math.min(1, Math.max(0, 0.5 + shadeHeight / (2 * amplitude) + (patch - 0.175)));
      if (t < 0.5) color.lerpColors(palette[0], palette[1], t * 2);
      else color.lerpColors(palette[1], palette[2], (t - 0.5) * 2);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }

  const indices = new Uint32Array(resolution * resolution * 6);
  let offset = 0;
  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const a = iz * verts + ix;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices[offset++] = a;
      indices[offset++] = c;
      indices[offset++] = b;
      indices[offset++] = b;
      indices[offset++] = c;
      indices[offset++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// --- Terrain brush / object placement tools ---------------------------------

const BRUSH_COLORS = { raise: "#7ee081", lower: "#ffa057", smooth: "#5b8cff" } as const;
/** Height delta (raise/lower) or blend strength (smooth) emitted per brush step. */
const BRUSH_STEP_AMOUNT = 0.55;

function useTerrainBrush(field: TerrainField, editMode: boolean) {
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null;
  const [cursorAt, setCursorAt] = useState<[number, number] | null>(null);
  const dragging = useRef(false);
  const strokeIds = useRef<string[]>([]);
  const lastEmit = useRef<[number, number] | null>(null);
  const downAt = useRef<[number, number] | null>(null);
  const worldTool = useStore((s) => s.worldTool);

  const endStroke = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (controls) controls.enabled = true;
    useStore.getState().finishTerrainStroke(strokeIds.current);
    strokeIds.current = [];
    lastEmit.current = null;
  }, [controls]);

  useEffect(() => {
    if (!editMode) return;
    window.addEventListener("pointerup", endStroke);
    return () => {
      window.removeEventListener("pointerup", endStroke);
      endStroke();
    };
  }, [editMode, endStroke]);

  const emit = useCallback(
    (point: [number, number]) => {
      const state = useStore.getState();
      const tool = state.worldTool;
      if (tool.kind !== "terrain") return;
      const last = lastEmit.current;
      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < Math.max(0.6, tool.radius * 0.3)) return;
      lastEmit.current = point;
      const amount =
        tool.mode === "lower" ? -tool.amount * BRUSH_STEP_AMOUNT :
        tool.mode === "raise" ? tool.amount * BRUSH_STEP_AMOUNT :
        Math.min(1, tool.amount * BRUSH_STEP_AMOUNT);
      strokeIds.current.push(
        state.applyTerrainBrush({ mode: tool.mode, center: point, radius: tool.radius, amount }),
      );
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      downAt.current = [event.point.x, event.point.z];
      if (event.button !== 0) return;
      if (useStore.getState().worldTool.kind !== "terrain") return;
      event.stopPropagation();
      dragging.current = true;
      if (controls) controls.enabled = false;
      emit([event.point.x, event.point.z]);
    },
    [controls, emit],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const tool = useStore.getState().worldTool;
      if (tool.kind === "terrain" || tool.kind === "place") {
        setCursorAt([event.point.x, event.point.z]);
      } else {
        setCursorAt((current) => (current ? null : current));
      }
      if (dragging.current) emit([event.point.x, event.point.z]);
    },
    [emit],
  );

  const onPointerLeave = useCallback(() => setCursorAt(null), []);

  const onClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    const state = useStore.getState();
    const tool = state.worldTool;
    if (tool.kind === "place") {
      event.stopPropagation();
      state.addWorldObject(tool.objectKind, [event.point.x, event.point.z]);
      return;
    }
    if (tool.kind !== "none") return;
    // The terrain blankets the floor, so clicking it would otherwise swallow
    // the "click empty space clears selection" gesture. Treat a non-drag click
    // on bare ground as empty space.
    const down = downAt.current;
    if (down && Math.hypot(event.point.x - down[0], event.point.z - down[1]) < 0.5) {
      state.select(null);
    }
  }, []);

  const tool = worldTool;
  const cursor =
    editMode && cursorAt && (tool.kind === "terrain" || tool.kind === "place") ? (
      <mesh
        position={[cursorAt[0], terrainHeightAt(field, cursorAt[0], cursorAt[1]) + 0.12, cursorAt[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={5}
      >
        <ringGeometry
          args={tool.kind === "terrain" ? [tool.radius * 0.93, tool.radius, 48] : [0.65, 0.8, 32]}
        />
        <meshBasicMaterial
          color={tool.kind === "terrain" ? BRUSH_COLORS[tool.mode] : "#8fffe8"}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    ) : null;

  return { onPointerDown, onPointerMove, onPointerLeave, onClick, cursor };
}

// --- Scatter objects ---------------------------------------------------------

interface ScatterBatch {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  /** Object id per instance slot, parallel to matrices (selection/deletion). */
  ids: string[];
}

const PART_GEOMETRIES: Record<WorldObjectPart["shape"], () => THREE.BufferGeometry> = {
  cone: () => new THREE.ConeGeometry(1, 1, 7),
  cylinder: () => new THREE.CylinderGeometry(1, 1, 1, 7),
  sphere: () => new THREE.SphereGeometry(1, 9, 7),
  icosahedron: () => new THREE.IcosahedronGeometry(1, 0),
  octahedron: () => new THREE.OctahedronGeometry(1, 0),
};

const geometryCache = new Map<WorldObjectPart["shape"], THREE.BufferGeometry>();
function partGeometry(shape: WorldObjectPart["shape"]): THREE.BufferGeometry {
  let geometry = geometryCache.get(shape);
  if (!geometry) {
    geometry = PART_GEOMETRIES[shape]();
    geometryCache.set(shape, geometry);
  }
  return geometry;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function partMaterial(part: WorldObjectPart): THREE.MeshStandardMaterial {
  const key = `${part.shape}:${part.emissive ?? ""}:${part.emissiveIntensity ?? 0}:${part.tintable ? "tint" : part.color}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      // Tintable parts carry their color per instance (instanceColor), so the
      // base material stays white; fixed parts bake the color into the material.
      color: part.tintable ? "#ffffff" : part.color,
      roughness: 0.88,
      metalness: 0,
      flatShading: part.shape === "icosahedron" || part.shape === "octahedron",
      ...(part.emissive ? { emissive: part.emissive, emissiveIntensity: part.emissiveIntensity ?? 0.4 } : {}),
    });
    materialCache.set(key, material);
  }
  return material;
}

function buildScatterBatches(
  generated: GeneratedEnvironment,
  field: TerrainField,
  loopCopies: LoopPreviewTransform[],
): ScatterBatch[] {
  const byKind = new Map<string, WorldObjectPlacement[]>();
  for (const object of generated.objects) {
    const list = byKind.get(object.kind);
    if (list) list.push(object);
    else byKind.set(object.kind, [object]);
  }
  const batches: ScatterBatch[] = [];
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [kind, objects] of byKind) {
    const spec = WORLD_OBJECT_SPECS[kind as WorldObjectPlacement["kind"]];
    spec.parts.forEach((part, partIndex) => {
      const matrices: THREE.Matrix4[] = [];
      const colors: THREE.Color[] = [];
      const ids: string[] = [];
      const push = (object: WorldObjectPlacement, x: number, z: number, yaw: number) => {
        // Display-field height: by loop invariance a copy's spot already
        // carries the right lift, so the object always sits on visible terrain.
        const baseY = terrainHeightAt(field, x, z) + object.position[1];
        quaternion.setFromAxisAngle(up, yaw);
        const offset = new THREE.Vector3(...part.offset)
          .multiplyScalar(object.scale)
          .applyQuaternion(quaternion);
        matrices.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x + offset.x, baseY + offset.y, z + offset.z),
            quaternion,
            new THREE.Vector3(part.scale[0] * object.scale, part.scale[1] * object.scale, part.scale[2] * object.scale),
          ),
        );
        colors.push(new THREE.Color(part.tintable && object.tint ? object.tint : part.color));
        // Copies share the base object's id: clicking the tree beyond the loop
        // seam selects (and edits) the one object it is a view of.
        ids.push(object.id);
      };
      for (const object of objects) {
        push(object, object.position[0], object.position[2], object.yaw);
        for (const copy of loopCopies) {
          const [x, z] = transformLoopPoint(copy, [object.position[0], object.position[2]]);
          if (Math.abs(x - generated.center[0]) > field.size || Math.abs(z - generated.center[1]) > field.size) continue;
          push(object, x, z, object.yaw + copy.rotation);
        }
      }
      batches.push({
        key: `${kind}:${partIndex}`,
        geometry: partGeometry(part.shape),
        material: partMaterial(part),
        matrices,
        colors,
        ids,
      });
    });
  }
  return batches;
}

function ScatterInstances({
  generated,
  field,
  map,
  editMode,
}: {
  generated: GeneratedEnvironment;
  field: TerrainField;
  map: CompositionMap;
  editMode: boolean;
}) {
  // Path-loop maps repeat the scattered objects across the seam, like stems
  // do. The chain is anchored at the region center (not the viewer), so the
  // matrices are static; per-frame visibility is the refill's job.
  const loopCopies = useMemo(
    () =>
      map.tiling.type === "path-loop"
        ? tiledMapTransforms(map, generated.center, generated.size + 180)
        : [],
    [map, generated.center, generated.size],
  );
  const batches = useMemo(
    () => buildScatterBatches(generated, field, loopCopies),
    [generated, field, loopCopies],
  );
  return (
    <group>
      {batches.map((batch) => (
        <ScatterBatchMesh key={batch.key} batch={batch} editMode={editMode} />
      ))}
    </group>
  );
}

function ScatterBatchMesh({ batch, editMode }: { batch: ScatterBatch; editMode: boolean }) {
  const camera = useThree((state) => state.camera);
  const mesh = useMemo(
    () => createFadedInstancedMesh(batch.geometry, batch.material, Math.max(1, batch.matrices.length)),
    [batch],
  );
  const visibleIds = useRef<string[]>([]);
  const position = useMemo(() => new THREE.Vector3(), []);
  const lastUpdate = useRef(-Infinity);

  const refill = useCallback(() => {
    let count = 0;
    const cullAt = effectiveFadeOuter();
    const ids: string[] = [];
    for (let i = 0; i < batch.matrices.length; i++) {
      const matrix = batch.matrices[i];
      position.setFromMatrixPosition(matrix);
      const distance = position.distanceTo(camera.position);
      if (distance > cullAt) continue;
      const fade = radialFade(distance);
      if (fade <= 0.002) continue;
      mesh.setMatrixAt(count, matrix);
      mesh.setColorAt(count, batch.colors[i]);
      setInstanceFade(mesh, count, fade);
      ids.push(batch.ids[i]);
      count++;
    }
    visibleIds.current = ids;
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    finishInstanceFadeUpdate(mesh);
    mesh.computeBoundingSphere();
  }, [batch, camera, mesh, position]);

  useEffect(() => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return () => disposeFadedInstancedMesh(mesh);
  }, [mesh]);
  useLayoutEffect(() => {
    refill();
  }, [refill]);
  useEffect(() => subscribeDebugFade(() => {
    lastUpdate.current = -Infinity;
  }), []);
  const seenWrap = useRef(loopWrap.generation);
  useFrame(({ clock }) => {
    // On a loop wrap the camera teleports; refill immediately so loop copies'
    // fades match the new position instead of lagging a frame.
    const wrapped = seenWrap.current !== loopWrap.generation;
    seenWrap.current = loopWrap.generation;
    if (!wrapped && clock.elapsedTime - lastUpdate.current < ENVIRONMENT_INSTANCE_UPDATE_INTERVAL) return;
    lastUpdate.current = clock.elapsedTime;
    refill();
  });

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (event.instanceId === undefined) return;
      const id = visibleIds.current[event.instanceId];
      if (!id) return;
      const state = useStore.getState();
      const tool = state.worldTool;
      if (tool.kind === "delete") {
        event.stopPropagation();
        state.deleteWorldObject(id);
      } else if (tool.kind === "none") {
        event.stopPropagation();
        state.selectWorldObject(id);
      }
    },
    [],
  );

  return <primitive object={mesh} onClick={editMode ? onClick : undefined} />;
}

// --- Selection gizmo ---------------------------------------------------------

function SelectedWorldObjectGizmo({
  generated,
  field,
  map,
}: {
  generated: GeneratedEnvironment;
  field: TerrainField;
  map: CompositionMap;
}) {
  const selectedId = useStore((s) => s.selectedWorldObjectId);
  const object = generated.objects.find((candidate) => candidate.id === selectedId);
  const group = useRef<THREE.Group>(null);
  const dragStart = useRef<[number, number] | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => setReady(!!group.current && !!object), [object]);
  if (!object) return null;

  const spec = WORLD_OBJECT_SPECS[object.kind];
  const baseY = terrainHeightAt(field, object.position[0], object.position[2]) + object.position[1];
  const ringRadius = Math.max(0.8, spec.radius * object.scale * 1.3);

  const commitFromGizmo = () => {
    const target = group.current;
    if (!target) return;
    const terrain = terrainHeightAt(field, target.position.x, target.position.z);
    useStore.getState().updateWorldObject(object.id, {
      position: [
        Math.round(target.position.x * 100) / 100,
        Math.max(-4, Math.round((target.position.y - terrain) * 100) / 100),
        Math.round(target.position.z * 100) / 100,
      ],
    });
  };

  // A drag commits incrementally (so the object follows live), which would
  // classify every step as a minor nudge. Measure the whole drag against its
  // start and upgrade the edit level once at release.
  const onDragStart = () => {
    dragStart.current = [object.position[0], object.position[2]];
  };
  const onDragEnd = () => {
    const start = dragStart.current;
    const target = group.current;
    dragStart.current = null;
    if (!start || !target) return;
    if (Math.hypot(target.position.x - start[0], target.position.z - start[1]) >= 3) {
      useStore.getState().markWorldObjectEdit(object.id, "major");
    }
    // On path-loop maps, an object dropped near/beyond the end seam is stored
    // at its fundamental-domain spot (remapping mid-drag would yank the gizmo
    // away from the cursor); its loop copy keeps it visible where it was
    // dropped.
    const mapped = loopEditPoint(map, [target.position.x, target.position.z]);
    if (mapped[0] !== target.position.x || mapped[1] !== target.position.z) {
      // Offset above the terrain is measured at the DROP spot (display field);
      // measuring at the remapped spot would bake the loop lift into it.
      const terrain = terrainHeightAt(field, target.position.x, target.position.z);
      useStore.getState().updateWorldObject(object.id, {
        position: [mapped[0], Math.max(-4, Math.round((target.position.y - terrain) * 100) / 100), mapped[1]],
      });
    }
  };

  return (
    <>
      <group ref={group} position={[object.position[0], baseY, object.position[2]]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} renderOrder={4}>
          <ringGeometry args={[ringRadius * 0.9, ringRadius, 40]} />
          <meshBasicMaterial color="#8fffe8" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {ready && group.current && (
        <TransformControls
          object={group.current}
          mode="translate"
          size={0.8}
          onObjectChange={commitFromGizmo}
          onMouseDown={onDragStart}
          onMouseUp={onDragEnd}
        />
      )}
    </>
  );
}

// --- Constraint visualization -------------------------------------------------

// Edit-mode overlay showing the clear zones generation respects: stem discs,
// walkable strips, and the start area. Like the other edit handles this is
// edit-only UI and intentionally outside the radial-fade contract.
function ConstraintZones({ generated }: { generated: GeneratedEnvironment }) {
  const show = useStore((s) => s.showConstraintZones);
  const map = useStore((s) => s.composition.map);
  const tracks = useStore((s) => s.composition.tracks);
  const sources = useMemo(
    () => (show ? flattenSources(map, tracks, generated) : []),
    [show, map, tracks, generated],
  );
  if (!show) return null;
  const buffer = generated.constraints.buffer;
  return (
    <group>
      {sources.map((source, index) => {
        if (source.kind === "disc") {
          return (
            <mesh
              key={index}
              position={[source.center[0], source.y + 0.14, source.center[1]]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={4}
            >
              <circleGeometry args={[source.radius + buffer, 40]} />
              <meshBasicMaterial color="#ff5d5d" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        }
        const dx = source.b[0] - source.a[0];
        const dz = source.b[1] - source.a[1];
        const length = Math.hypot(dx, dz);
        if (length === 0) return null;
        return (
          <mesh
            key={index}
            position={[
              (source.a[0] + source.b[0]) / 2,
              (source.ya + source.yb) / 2 + 0.14,
              (source.a[1] + source.b[1]) / 2,
            ]}
            rotation={[-Math.PI / 2, 0, -Math.atan2(dz, dx)]}
            renderOrder={4}
          >
            <planeGeometry args={[length, (source.halfWidth + buffer) * 2]} />
            <meshBasicMaterial color="#ff5d5d" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

import { useTexture } from "@react-three/drei";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GeneratedEnvironment } from "../environment";
import type { SurfaceMaterialDefinition } from "../creatorAssets";
import { materialTextureUrls } from "./SurfaceDressing";
import { useStore } from "../store";
import { surfaceHeightAt } from "../map";
import { flattenSourcesFor, terrainFieldFor } from "../worldgen/sampler";
import { TerrainField, flattenAt, flattenSources, terrainHeightAt } from "../worldgen/terrain";
import { LOOP_BLEND_BAND, loopFieldContext, loopProgress } from "../worldgen/loop";
import { debugFlag } from "../debug";
import { valueNoise2 } from "../worldgen/noise";
import { skyGradient } from "./skyGradient";

// Procedurally generated world: a sculptable terrain heightfield derived from
// composition.environment.generated (see src/worldgen/), plus the gradient
// sky and mood lighting. Terrain is a standard opaque mesh, so the scene fog
// fades it at the shared radial band for free.
export function GeneratedWorld({
  editMode,
  groundMaterial,
}: {
  editMode: boolean;
  groundMaterial?: SurfaceMaterialDefinition;
}) {
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
      <SkyDome skyColor={generated.params.skyColor} skyColor2={generated.params.skyColor2} />
      <MoodLighting generated={generated} />
      <TerrainPatch generated={generated} field={field} editMode={editMode} groundMaterial={groundMaterial} />
      {editMode && <ConstraintZones generated={generated} />}
      {debugFlag("debugTerrainProbe") && <TerrainProbe field={field} />}
    </group>
  );
}

// ?debug=1&debugTerrainProbe=1 — once a second, log the terrain state under
// the viewer: surface vs terrain height, flatten weight/target, and loop
// progress. For diagnosing "terrain covering the path" reports; see
// docs/investigations/terrain-blobs-on-paths.md.
function TerrainProbe({ field }: { field: TerrainField }) {
  const lastLog = useRef(-Infinity);
  useFrame(({ clock, camera }) => {
    if (clock.elapsedTime - lastLog.current < 1) return;
    lastLog.current = clock.elapsedTime;
    const state = useStore.getState();
    const generated = state.composition.environment.generated;
    if (!generated) return;
    const map = state.composition.map;
    const x = camera.position.x;
    const z = camera.position.z;
    const sources = flattenSourcesFor(state.composition);
    const { weight, target } = flattenAt(sources, generated.constraints.buffer, x, z);
    const ctx = loopFieldContext(map);
    const sample = {
      at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10],
      tiling: map.tiling.type,
      constraints: generated.constraints,
      surfaceY: Math.round(surfaceHeightAt(map, [x, z]) * 100) / 100,
      terrainY: Math.round(terrainHeightAt(field, x, z) * 100) / 100,
      flattenWeight: Math.round(weight * 100) / 100,
      flattenTarget: Math.round(target * 100) / 100,
      loopProgress: ctx ? Math.round(loopProgress(ctx, x, z) * 100) / 100 : null,
      loopBand: ctx ? loopProgress(ctx, x, z) >= 1 - LOOP_BLEND_BAND : null,
    };
    (window as unknown as { polyTerrainProbe?: unknown }).polyTerrainProbe = sample;
    console.log("[terrain-probe]", JSON.stringify(sample));
  });
  return null;
}

// Camera-following gradient sky. One authored color derives both shades
// (lighter horizon, darker zenith); an optional second color makes the
// gradient run exactly horizon → zenith (see skyGradient.ts). The horizon
// shade doubles as the fog/background color, so geometry fading at the
// radial band dissolves into the dome seamlessly. Drawn first with depth
// disabled, like the AR backdrop, so the world always renders over it; fog
// must not affect it.
function SkyDome({ skyColor, skyColor2 }: { skyColor: string; skyColor2?: string }) {
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
    const { horizon, zenith } = skyGradient(skyColor, skyColor2);
    (material.uniforms.horizonColor.value as THREE.Color).set(horizon);
    (material.uniforms.zenithColor.value as THREE.Color).set(zenith);
  }, [material, skyColor, skyColor2]);
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
  groundMaterial,
}: {
  generated: GeneratedEnvironment;
  field: TerrainField;
  editMode: boolean;
  groundMaterial?: SurfaceMaterialDefinition;
}) {
  const geometry = useMemo(
    () => buildTerrainGeometry(generated, field, !!groundMaterial),
    [generated, field, groundMaterial],
  );
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
        {groundMaterial ? (
          <Suspense fallback={<meshStandardMaterial vertexColors roughness={0.96} metalness={0} />}>
            <TerrainGroundMaterial definition={groundMaterial} />
          </Suspense>
        ) : (
          <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
        )}
      </mesh>
      {brush.cursor}
    </>
  );
}

// A high-quality imported material applied to the generated terrain. Textures
// tile in world space (the geometry carries world-unit UVs; `repeat` scales
// the tile size) and multiply with the height-palette vertex colors, so the
// biome tint still reads through. Textures are cloned per definition rather
// than shared with SurfaceDressing so the repeat settings never fight.
function TerrainGroundMaterial({ definition }: { definition: SurfaceMaterialDefinition }) {
  const urls = useMemo(() => materialTextureUrls(definition), [definition]);
  const loaded = useTexture(urls) as THREE.Texture[];
  const textureByUrl = useMemo(() => {
    // World-space tile size: `repeat` means roughly "tiles per slab" on map
    // surfaces; here it shrinks the tile from a 16-unit base.
    const tile = 16 / Math.max(definition.repeat, 0.1);
    return new Map(
      urls.map((url, index) => {
        const texture = loaded[index].clone();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / tile, 1 / tile);
        if (url === definition.albedo) texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return [url, texture] as const;
      }),
    );
  }, [definition, loaded, urls]);
  const material = useMemo(() => {
    const texture = (url: string | undefined) => (url ? textureByUrl.get(url) : undefined);
    return new THREE.MeshStandardMaterial({
      map: texture(definition.albedo),
      normalMap: texture(definition.normal),
      normalScale: new THREE.Vector2(definition.normalScale ?? 0.7, definition.normalScale ?? 0.7),
      roughnessMap: texture(definition.roughnessMap),
      roughness: definition.roughness,
      metalnessMap: texture(definition.metalnessMap),
      metalness: definition.metalness,
      vertexColors: true,
    });
  }, [definition, textureByUrl]);
  useEffect(
    () => () => {
      material.dispose();
      for (const texture of textureByUrl.values()) texture.dispose();
    },
    [material, textureByUrl],
  );
  return <primitive object={material} attach="material" />;
}

function buildTerrainGeometry(
  generated: GeneratedEnvironment,
  field: TerrainField,
  textured: boolean,
): THREE.BufferGeometry {
  const { resolution, size, center, heights } = field;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const positions = new Float32Array(verts * verts * 3);
  const colors = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  const palette = generated.params.palette.map((hex) => new THREE.Color(hex));
  const amplitude = Math.max(generated.params.terrainAmplitude, 2);
  const color = new THREE.Color();
  const white = new THREE.Color("#ffffff");

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const index = iz * verts + ix;
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const h = heights[index];
      positions[index * 3] = x;
      positions[index * 3 + 1] = h;
      positions[index * 3 + 2] = z;
      // World-unit UVs; the ground material's texture.repeat sets tile size.
      uvs[index * 2] = x;
      uvs[index * 2 + 1] = z;
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
      // Vertex colors MULTIPLY with a ground texture; the dark biome palette
      // would crush it, so textured terrain lightens the tint toward white
      // and keeps the palette as a subtle height-graded wash.
      if (textured) color.lerp(white, 0.72);
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
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// --- Terrain brushes ----------------------------------------------------------

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
      if (tool.kind === "terrain") {
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
    if (state.worldTool.kind !== "none") return;
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
    editMode && cursorAt && tool.kind === "terrain" ? (
      <mesh
        position={[cursorAt[0], terrainHeightAt(field, cursorAt[0], cursorAt[1]) + 0.12, cursorAt[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={5}
      >
        <ringGeometry args={[tool.radius * 0.93, tool.radius, 48]} />
        <meshBasicMaterial
          color={BRUSH_COLORS[tool.mode]}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    ) : null;

  return { onPointerDown, onPointerMove, onPointerLeave, onClick, cursor };
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

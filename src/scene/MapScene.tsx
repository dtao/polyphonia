import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { clampToMap, CompositionMap, WalkableSegment } from "../map";
import { useStore } from "../store";

const MAX_TRACK_LIGHTS = 12;

export function MapScene({ map, tracks, editMode }: { map: CompositionMap; tracks: TrackDef[]; editMode: boolean }) {
  const selectedMapSegmentId = useStore((s) => s.selectedMapSegmentId);
  const endpointCounts = new Map<string, number>();
  for (const segment of map.segments) {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
    }
  }
  return (
    <group>
      <StartMarker map={map} editMode={editMode} />
      <WalkableFloor segments={map.segments} tracks={tracks} editMode={editMode} />
      {map.segments.map((segment) => (
        <Segment
          key={segment.id}
          segment={segment}
          segments={map.segments}
          editMode={editMode}
          endpointCounts={endpointCounts}
          selected={selectedMapSegmentId === segment.id}
        />
      ))}
      {editMode && <BranchPlacementLayer map={map} />}
      {editMode && <EndpointEditor map={map} endpointCounts={endpointCounts} />}
    </group>
  );
}

// Click the start disc to select it (clears other selections), then drag the
// drei TransformControls gizmo to move it — the exact mechanism stems use, so
// it's reliable. A Move/Rotate toggle (Map panel) flips the gizmo between
// translating the position and rotating the starting heading.
function StartMarker({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const setMap = useStore((s) => s.setMap);
  const selectedStart = useStore((s) => s.selectedStart);
  const selectStart = useStore((s) => s.selectStart);
  const setStartGizmoMode = useStore((s) => s.setStartGizmoMode);
  const gizmoMode = useStore((s) => s.startGizmoMode);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [x, z] = map.start.position;
  const [fx, fz] = map.start.direction;
  const angle = -Math.atan2(fz, fx);
  const active = editMode && selectedStart;
  const opacity = editMode ? 0.92 : 0.4;
  const color = active ? "#8fffe8" : "#ffffff";

  function handleObjectChange() {
    if (!obj) return;
    const { map: compositionMap, map: { start } } = useStore.getState().composition;
    if (gizmoMode === "translate") {
      // Clamp to the walkable area, then snap the gizmo object to the clamped
      // position so it never fights against the boundary on the next frame.
      const [cx, cz] = clampToMap(compositionMap, [obj.position.x, obj.position.z]);
      obj.position.set(cx, obj.position.y, cz);
      setMap({ start: { ...start, position: [cx, cz] } });
    } else {
      const a = obj.rotation.y;
      setMap({ start: { ...start, direction: [Math.cos(a), -Math.sin(a)] } });
    }
  }

  return (
    <>
      <group
        ref={setObj}
        position={[x, 0.08, z]}
        rotation={[0, angle, 0]}
        // Disc click → move mode. Arrow click (below) → rotate mode.
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          setStartGizmoMode("translate");
          selectStart();
        }}
        onPointerOver={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.15, 48]} />
          <meshBasicMaterial color={color} transparent opacity={editMode ? 0.26 : 0.14} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.1, 1.24, 48]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
        </mesh>
        {/* Arrow click → rotate mode. stopPropagation prevents the group's
            translate handler from also firing. */}
        <mesh
          position={[1.75, 0.02, 0]}
          rotation={[0, 0, -Math.PI / 2]}
          onClick={(e) => {
            if (!editMode) return;
            e.stopPropagation();
            setStartGizmoMode("rotate");
            selectStart();
          }}
        >
          <coneGeometry args={[0.36, 0.85, 3]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
        </mesh>
        <pointLight position={[0, 0.8, 0]} color="#ffffff" intensity={editMode ? 1.2 : 0.5} distance={5} />
      </group>

      {active && obj && (
        <TransformControls
          key={gizmoMode}
          object={obj}
          mode={gizmoMode}
          showX={gizmoMode === "translate"}
          showZ={gizmoMode === "translate"}
          showY={gizmoMode === "rotate"}
          size={0.9}
          onObjectChange={handleObjectChange}
        />
      )}
    </>
  );
}

function Segment({
  segment,
  segments,
  editMode,
  endpointCounts,
  selected,
}: {
  segment: WalkableSegment;
  segments: WalkableSegment[];
  editMode: boolean;
  endpointCounts: Map<string, number>;
  selected: boolean;
}) {
  const selectMapSegment = useStore((s) => s.selectMapSegment);
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dz);
  const angle = -Math.atan2(dz, dx);
  const mid: [number, number, number] = [(segment.start[0] + segment.end[0]) / 2, 0, (segment.start[1] + segment.end[1]) / 2];

  return (
    <group>
      <mesh
        position={[mid[0], 0.04, mid[2]]}
        rotation={[-Math.PI / 2, 0, angle]}
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          selectMapSegment(segment.id);
        }}
      >
        <planeGeometry args={[length, segment.width]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <BorderRail
          key={side}
          start={borderPoint(segment, segments, "start", side)}
          end={borderPoint(segment, segments, "end", side)}
          editMode={editMode}
          selected={selected}
        />
      ))}
      {[segment.start, segment.end].map((point, i) => (
        <group key={i}>
          {(endpointCounts.get(pointKey(point)) ?? 0) === 1 && (
            <mesh position={[point[0], 0.047, point[1]]} rotation={[-Math.PI / 2, 0, angle]}>
              <planeGeometry args={[0.16, segment.width]} />
              <meshBasicMaterial
                color={selected ? "#8fffe8" : editMode ? "#dce7ff" : "#c8d2df"}
                transparent
                opacity={selected ? 0.72 : editMode ? 0.46 : 0.28}
                toneMapped={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function WalkableFloor({
  segments,
  tracks,
  editMode,
}: {
  segments: WalkableSegment[];
  tracks: TrackDef[];
  editMode: boolean;
}) {
  const geometry = useMemo(() => walkableFloorGeometry(segments), [segments]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0.026, 0]}>
      <PathMaterial tracks={tracks} editMode={editMode} selected={false} />
    </mesh>
  );
}

function BranchPlacementLayer({ map }: { map: CompositionMap }) {
  const branchStartPointKey = useStore((s) => s.branchStartPointKey);
  const setBranchStartPoint = useStore((s) => s.setBranchStartPoint);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const startPoint = branchStartPointKey ? findPoint(map, branchStartPointKey) : null;
  const averageWidth = map.segments.length ? map.segments.reduce((sum, s) => sum + s.width, 0) / map.segments.length : 7.5;

  if (!branchStartPointKey || !startPoint) return null;

  return (
    <group>
      <mesh
        position={[0, 0.12, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          const end: [number, number] = [e.point.x, e.point.z];
          setMap({
            preset: "custom",
            segments: [
              ...useStore.getState().composition.map.segments,
              {
                id: `branch-${Date.now().toString(36)}`,
                start: startPoint,
                end,
                width: averageWidth,
              },
            ],
          });
          const endKey = pointKey(end);
          setBranchStartPoint(null);
          selectMapPoint(endKey);
        }}
      >
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[startPoint[0], 0.09, startPoint[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.55, 48]} />
        <meshBasicMaterial color="#8fffe8" transparent opacity={0.8} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function BorderRail({ start, end, editMode, selected }: { start: [number, number]; end: [number, number]; editMode: boolean; selected: boolean }) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  if (length < 0.02) return null;
  const angle = -Math.atan2(dz, dx);
  const mid: [number, number, number] = [(start[0] + end[0]) / 2, 0.045, (start[1] + end[1]) / 2];

  return (
    <mesh position={mid} rotation={[-Math.PI / 2, 0, angle]}>
      <planeGeometry args={[length, 0.16]} />
      <meshBasicMaterial
        color={selected ? "#8fffe8" : editMode ? "#dce7ff" : "#c8d2df"}
        transparent
        opacity={selected ? 0.72 : editMode ? 0.42 : 0.24}
        toneMapped={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

type SegmentEnd = "start" | "end";
type Arm = {
  segment: WalkableSegment;
  end: SegmentEnd;
  dir: [number, number];
  angle: number;
};

function borderPoint(segment: WalkableSegment, segments: WalkableSegment[], end: SegmentEnd, segmentSide: -1 | 1): [number, number] {
  const joint = end === "start" ? segment.start : segment.end;
  const arms = incidentArms(segments, joint);
  const armIndex = arms.findIndex((arm) => arm.segment.id === segment.id && arm.end === end);
  const arm = arms[armIndex];
  if (!arm) return offsetEndpoint(segment, end, segmentSide);
  const outwardSide = end === "start" ? segmentSide : (-segmentSide as -1 | 1);
  const fallback = offsetFromArm(joint, arm, outwardSide, segment.width / 2);
  if (arms.length < 2) return fallback;

  const neighborIndex = outwardSide === 1 ? (armIndex + 1) % arms.length : (armIndex - 1 + arms.length) % arms.length;
  const neighbor = arms[neighborIndex];
  const neighborSide = outwardSide === 1 ? -1 : 1;
  const intersect = intersectOffsetRays(joint, arm, outwardSide, segment.width / 2, neighbor, neighborSide, neighbor.segment.width / 2);
  if (!intersect) return fallback;

  const dx = intersect[0] - joint[0];
  const dz = intersect[1] - joint[1];
  const maxMiter = Math.max(segment.width, neighbor.segment.width) * 1.4;
  return dx * dx + dz * dz <= maxMiter * maxMiter ? intersect : fallback;
}

function incidentArms(segments: WalkableSegment[], joint: [number, number]): Arm[] {
  return segments
    .flatMap((segment): Arm[] => {
      const arms: Arm[] = [];
      if (pointKey(segment.start) === pointKey(joint)) arms.push(makeArm(segment, "start"));
      if (pointKey(segment.end) === pointKey(joint)) arms.push(makeArm(segment, "end"));
      return arms;
    })
    .sort((a, b) => a.angle - b.angle);
}

function makeArm(segment: WalkableSegment, end: SegmentEnd): Arm {
  const from = end === "start" ? segment.start : segment.end;
  const to = end === "start" ? segment.end : segment.start;
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz) || 1;
  const dir: [number, number] = [dx / length, dz / length];
  return { segment, end, dir, angle: Math.atan2(dir[1], dir[0]) };
}

function offsetEndpoint(segment: WalkableSegment, end: SegmentEnd, side: -1 | 1): [number, number] {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dz) || 1;
  const normal: [number, number] = [-dz / length, dx / length];
  const point = end === "start" ? segment.start : segment.end;
  return [point[0] + normal[0] * (segment.width / 2) * side, point[1] + normal[1] * (segment.width / 2) * side];
}

function offsetFromArm(joint: [number, number], arm: Arm, side: -1 | 1, halfWidth: number): [number, number] {
  const normal: [number, number] = [-arm.dir[1], arm.dir[0]];
  return [joint[0] + normal[0] * halfWidth * side, joint[1] + normal[1] * halfWidth * side];
}

function intersectOffsetRays(
  joint: [number, number],
  a: Arm,
  aSide: -1 | 1,
  aHalfWidth: number,
  b: Arm,
  bSide: -1 | 1,
  bHalfWidth: number,
): [number, number] | null {
  const aPoint = offsetFromArm(joint, a, aSide, aHalfWidth);
  const bPoint = offsetFromArm(joint, b, bSide, bHalfWidth);
  const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(cross) < 0.0001) return null;
  const delta: [number, number] = [bPoint[0] - aPoint[0], bPoint[1] - aPoint[1]];
  const t = (delta[0] * b.dir[1] - delta[1] * b.dir[0]) / cross;
  return [aPoint[0] + a.dir[0] * t, aPoint[1] + a.dir[1] * t];
}

function walkableFloorGeometry(segments: WalkableSegment[]): THREE.BufferGeometry | null {
  if (!segments.length) return null;
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const segment of segments) {
    addFloorPolygon(
      [
        borderPoint(segment, segments, "start", -1),
        borderPoint(segment, segments, "end", -1),
        borderPoint(segment, segments, "end", 1),
        borderPoint(segment, segments, "start", 1),
      ],
      vertices,
      indices,
    );
  }

  for (const { point, segments: jointSegments } of sharedJoints(segments)) {
    const points: [number, number][] = [];
    for (const segment of jointSegments) {
      const end = pointKey(segment.start) === pointKey(point) ? "start" : "end";
      points.push(borderPoint(segment, segments, end, -1));
      points.push(borderPoint(segment, segments, end, 1));
    }
    addFloorPolygon(convexHull(uniquePoints(points)), vertices, indices);
  }

  if (!vertices.length || !indices.length) return null;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sharedJoints(segments: WalkableSegment[]): Array<{ point: [number, number]; segments: WalkableSegment[] }> {
  const endpoints = new Map<string, { point: [number, number]; segments: WalkableSegment[] }>();
  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      const existing = endpoints.get(key);
      if (existing) existing.segments.push(segment);
      else endpoints.set(key, { point, segments: [segment] });
    }
  }
  return Array.from(endpoints.values()).filter((joint) => joint.segments.length > 1);
}

function addFloorPolygon(points: [number, number][], vertices: number[], indices: number[]): void {
  const polygon = uniquePoints(points);
  if (polygon.length < 3) return;
  const base = vertices.length / 3;
  for (const point of polygon) vertices.push(point[0], 0, point[1]);
  const triangles = THREE.ShapeUtils.triangulateShape(
    polygon.map((point) => new THREE.Vector2(point[0], point[1])),
    [],
  );
  for (const triangle of triangles) indices.push(base + triangle[0], base + triangle[1], base + triangle[2]);
}

function uniquePoints(points: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const unique: [number, number][] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 3) return sorted;
  const lower: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function PathMaterial({ tracks, editMode, selected }: { tracks: TrackDef[]; editMode: boolean; selected: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const engine = useStore((s) => s.engine);
  const smoothedLevels = useRef(new Float32Array(MAX_TRACK_LIGHTS));
  const uniforms = useMemo(() => {
    const positions = Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
    const colors = Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Color("#000000"));
    const levels = new Float32Array(MAX_TRACK_LIGHTS);
    tracks.slice(0, MAX_TRACK_LIGHTS).forEach((track, i) => {
      const volume = track.volume ?? 1;
      const refDistance = track.refDistance ?? 4;
      const maxDistance = track.maxDistance ?? 40;
      positions[i].set(track.position[0], track.position[2], Math.max(7, Math.min(24, refDistance + maxDistance * 0.22 + volume * 4)));
      colors[i].set(track.color);
    });
    return {
      baseColor: { value: new THREE.Color(selected ? "#8fffe8" : "#c8d2df") },
      trackPositions: { value: positions },
      trackColors: { value: colors },
      trackLevels: { value: levels },
      trackCount: { value: Math.min(tracks.length, MAX_TRACK_LIGHTS) },
      floorStrength: { value: selected ? 0.92 : editMode ? 0.78 : 0.66 },
    };
  }, [tracks, editMode, selected]);

  useFrame((_, dt) => {
    if (!material.current) return;
    const levels = material.current.uniforms.trackLevels.value as Float32Array;
    for (let i = 0; i < MAX_TRACK_LIGHTS; i++) {
      const track = tracks[i];
      const target = track ? engine?.level(track.id) ?? 0 : 0;
      smoothedLevels.current[i] = THREE.MathUtils.damp(smoothedLevels.current[i], target, 12, dt);
      levels[i] = smoothedLevels.current[i];
    }
  });

  return (
    <shaderMaterial
      ref={material}
      transparent={false}
      depthWrite
      toneMapped={false}
      blending={THREE.NormalBlending}
      side={THREE.DoubleSide}
      uniforms={uniforms}
      vertexShader={pathVertexShader}
      fragmentShader={pathFragmentShader}
    />
  );
}

function EndpointEditor({ map, endpointCounts }: { map: CompositionMap; endpointCounts: Map<string, number> }) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const drag = useRef<{ pointKey: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const endpoints = useMemo(() => {
    const points = new Map<string, [number, number]>();
    for (const segment of map.segments) {
      points.set(pointKey(segment.start), segment.start);
      points.set(pointKey(segment.end), segment.end);
    }
    return Array.from(points.entries()).map(([key, point]) => ({
      id: key,
      key,
      point,
      shared: (endpointCounts.get(key) ?? 0) > 1,
    }));
  }, [endpointCounts, map.segments]);

  function moveEndpoint(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const next: [number, number] = [hit.x, hit.z];
    const activeKey = drag.current.pointKey;
    const nextKey = pointKey(next);
    drag.current.pointKey = nextKey;
    setActiveId(nextKey);
    setMap({
      preset: "custom",
      segments: useStore.getState().composition.map.segments.map((segment) => ({
        ...segment,
        start: pointKey(segment.start) === activeKey ? next : segment.start,
        end: pointKey(segment.end) === activeKey ? next : segment.end,
      })),
    });
    selectMapPoint(nextKey);
  }

  function endDrag(e?: ThreeEvent<PointerEvent>) {
    e?.stopPropagation();
    drag.current = null;
    setActiveId(null);
    if (controls) controls.enabled = true;
    const target = e?.nativeEvent.target as Element | null | undefined;
    target?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "grab";
  }

  return (
    <group onPointerMove={moveEndpoint} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerLeave={endDrag}>
      {endpoints.map(({ id, key, point, shared }) => {
        const active = activeId === id;
        const selected = selectedMapPointKey === key;
        return (
          <mesh
            key={id}
            position={[point[0], 0.35, point[1]]}
            onPointerDown={(e) => {
              e.stopPropagation();
              drag.current = { pointKey: key };
              setActiveId(id);
              selectMapPoint(key);
              if (controls) controls.enabled = false;
              const target = e.nativeEvent.target as Element | null;
              target?.setPointerCapture?.(e.pointerId);
              document.body.style.cursor = "grabbing";
            }}
            onPointerMove={moveEndpoint}
            onPointerUp={endDrag}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "grab";
            }}
            onPointerOut={() => {
              if (!drag.current) document.body.style.cursor = "auto";
            }}
          >
            <sphereGeometry args={[active ? 0.95 : selected ? 0.82 : shared ? 0.72 : 0.58, 24, 16]} />
            <meshBasicMaterial color={active ? "#8fffe8" : selected ? "#9fb4ff" : shared ? "#ffd166" : "#ffffff"} transparent opacity={1} toneMapped={false} />
            {(active || selected) && (
              <mesh>
                <sphereGeometry args={[active ? 1.35 : 1.12, 24, 16]} />
                <meshBasicMaterial
                  color={active ? "#8fffe8" : "#9fb4ff"}
                  transparent
                  opacity={active ? 0.22 : 0.16}
                  toneMapped={false}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                />
              </mesh>
            )}
          </mesh>
        );
      })}
    </group>
  );
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

function findPoint(map: CompositionMap, key: string): [number, number] | null {
  for (const segment of map.segments) {
    if (pointKey(segment.start) === key) return segment.start;
    if (pointKey(segment.end) === key) return segment.end;
  }
  return null;
}

const pathVertexShader = `
  varying vec2 vWorld;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const pathFragmentShader = `
  #define MAX_TRACK_LIGHTS ${MAX_TRACK_LIGHTS}

  uniform vec3 baseColor;
  uniform vec3 trackColors[MAX_TRACK_LIGHTS];
  uniform vec3 trackPositions[MAX_TRACK_LIGHTS];
  uniform float trackLevels[MAX_TRACK_LIGHTS];
  uniform int trackCount;
  uniform float floorStrength;
  varying vec2 vWorld;

  void main() {
    vec3 color = baseColor * floorStrength;
    float lightTotal = 0.0;

    for (int i = 0; i < MAX_TRACK_LIGHTS; i++) {
      if (i >= trackCount) break;
      float radius = trackPositions[i].z;
      float d = distance(vWorld, trackPositions[i].xy);
      float pulse = trackLevels[i];
      float light = pow(smoothstep(radius * (1.0 + pulse * 0.16), 0.0, d), 1.55) * (0.72 + pulse * 0.92);
      lightTotal += light;
      color = mix(color, trackColors[i] * (1.08 + pulse * 0.28), light * 0.58);
      color += trackColors[i] * light * (0.34 + pulse * 0.46);
    }

    color += baseColor * min(lightTotal, 1.0) * 0.08;
    gl_FragColor = vec4(color, 1.0);
  }
`;

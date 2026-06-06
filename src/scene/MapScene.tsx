import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { canAddBranchAtPoint, clampToMap, CompositionMap, loopRoleForPoint, MapRoom, roomAttachedToPoint, roomElevation, ROOM_WALL_THICKNESS, solidWallSpans, surfaceHeightAt, wallOpenings, WalkableSegment } from "../map";
import { useStore } from "../store";
import { PATH_HEIGHT, UNDERFLOOR_HEIGHT } from "./mapHeights";

const MAX_TRACK_LIGHTS = 64;

export function MapScene({
  map,
  tracks,
  editMode,
  lightTracks = tracks,
  previewFade = 1,
}: {
  map: CompositionMap;
  tracks: TrackDef[];
  editMode: boolean;
  lightTracks?: TrackDef[];
  previewFade?: number;
}) {
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
      {editMode && <StartMarker map={map} editMode={editMode} />}
      <ReflectiveUnderfloor segments={map.segments} tracks={tracks} lightTracks={lightTracks} previewFade={previewFade} />
      <WalkableFloor map={map} tracks={lightTracks} editMode={editMode} previewFade={previewFade} />
      <PathDropSkirt map={map} />
      {map.segments.map((segment) => (
        <Segment
          key={segment.id}
          segment={segment}
          map={map}
          editMode={editMode}
          endpointCounts={endpointCounts}
          selected={selectedMapSegmentId === segment.id}
        />
      ))}
      <Rooms map={map} editMode={editMode} />
      {editMode && <BranchPlacementLayer map={map} />}
      {editMode && <EndpointEditor map={map} endpointCounts={endpointCounts} />}
    </group>
  );
}

const ROOM_FLOOR_Y = 0.05;

function Rooms({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const selectedRoomId = useStore((s) => s.selectedRoomId);
  return (
    <group>
      {map.rooms.map((room) => (
        <Room key={room.id} room={room} elevationY={roomElevation(map, room)} editMode={editMode} selected={editMode && selectedRoomId === room.id} />
      ))}
    </group>
  );
}

function Room({ room, elevationY, editMode, selected }: { room: MapRoom; elevationY: number; editMode: boolean; selected: boolean }) {
  const selectRoom = useStore((s) => s.selectRoom);
  const [cx, cz] = room.center;
  const h = room.height;
  const boxes = roomWallBoxes(room);
  const wallOpacity = editMode ? 0.3 : 1;
  const wallColor = selected ? "#8fffe8" : "#9aa6bd";
  const wallTransparent = editMode;

  return (
    <>
      <group
        position={[cx, elevationY, cz]}
        rotation={[0, room.rotation, 0]}
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          selectRoom(room.id);
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ROOM_FLOOR_Y, 0]}>
          <planeGeometry args={[room.width, room.depth]} />
          <meshStandardMaterial color={selected ? "#16302e" : "#14161e"} roughness={0.92} metalness={0.08} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
          <planeGeometry args={[room.width, room.depth]} />
          <meshStandardMaterial color={wallColor} roughness={0.85} metalness={0.05} transparent={wallTransparent} opacity={wallOpacity} depthWrite={!editMode} side={THREE.DoubleSide} />
        </mesh>
        {boxes.map((b, i) => (
          <mesh key={i} position={[b.pos[0], h / 2, b.pos[1]]}>
            <boxGeometry args={[b.size[0], h, b.size[1]]} />
            <meshStandardMaterial color={wallColor} roughness={0.85} metalness={0.05} transparent={wallTransparent} opacity={wallOpacity} depthWrite={!editMode} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </>
  );
}

// Wall boxes in room-local coords; each entrance leaves a gap in its wall.
function roomWallBoxes(room: MapRoom): Array<{ pos: [number, number]; size: [number, number] }> {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const t = ROOM_WALL_THICKNESS;
  const boxes: Array<{ pos: [number, number]; size: [number, number] }> = [];
  for (const [s, e] of solidWallSpans(hw, wallOpenings(room, "north"))) boxes.push({ pos: [(s + e) / 2, -hd], size: [e - s + t, t] });
  for (const [s, e] of solidWallSpans(hw, wallOpenings(room, "south"))) boxes.push({ pos: [(s + e) / 2, hd], size: [e - s + t, t] });
  for (const [s, e] of solidWallSpans(hd, wallOpenings(room, "west"))) boxes.push({ pos: [-hw, (s + e) / 2], size: [t, e - s + t] });
  for (const [s, e] of solidWallSpans(hd, wallOpenings(room, "east"))) boxes.push({ pos: [hw, (s + e) / 2], size: [t, e - s + t] });
  return boxes;
}

function ReflectiveUnderfloor({
  segments,
  tracks,
  lightTracks,
  previewFade,
}: {
  segments: WalkableSegment[];
  tracks: TrackDef[];
  lightTracks: TrackDef[];
  previewFade: number;
}) {
  const bounds = useMemo(() => mapBounds(segments, tracks), [segments, tracks]);
  if (!bounds) return null;

  return (
    <mesh position={[bounds.center[0], UNDERFLOOR_HEIGHT, bounds.center[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[bounds.size, bounds.size, 96, 96]} />
      <ReflectiveUnderfloorMaterial tracks={lightTracks} previewFade={previewFade} />
    </mesh>
  );
}

function PathDropSkirt({ map }: { map: CompositionMap }) {
  const geometry = useMemo(() => pathSkirtGeometry(map), [map.segments, map.elevations]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#182033" transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
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
  const startY = surfaceHeightAt(map, map.start.position);
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
        position={[x, startY + 0.08, z]}
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
  map,
  editMode,
  endpointCounts,
  selected,
}: {
  segment: WalkableSegment;
  map: CompositionMap;
  editMode: boolean;
  endpointCounts: Map<string, number>;
  selected: boolean;
}) {
  const selectMapSegment = useStore((s) => s.selectMapSegment);
  const segments = map.segments;
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dz);
  const angle = -Math.atan2(dz, dx);
  const startY = elevationAt(map, segment.start);
  const endY = elevationAt(map, segment.end);
  const midY = (startY + endY) / 2;
  const mid: [number, number, number] = [(segment.start[0] + segment.end[0]) / 2, 0, (segment.start[1] + segment.end[1]) / 2];

  return (
    <group>
      <mesh
        position={[mid[0], midY + 0.04, mid[2]]}
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
      {([-1, 1] as const).map((side) => {
        const a = borderPoint(segment, segments, "start", side);
        const b = borderPoint(segment, segments, "end", side);
        // Drop the stretch of rail that runs over a crossing path's floor so
        // intersections read as one shared surface, not two lines crossing.
        return clipRail(a, b, segment, segments).map(([t0, t1], i) => (
          <BorderRail
            key={`${side}-${i}`}
            start={lerp2(a, b, t0)}
            startY={startY + (endY - startY) * t0}
            end={lerp2(a, b, t1)}
            endY={startY + (endY - startY) * t1}
            editMode={editMode}
            selected={selected}
          />
        ));
      })}
      {[segment.start, segment.end].map((point, i) => (
        <group key={i}>
          {(endpointCounts.get(pointKey(point)) ?? 0) === 1 && (
            <mesh position={[point[0], (i === 0 ? startY : endY) + 0.047, point[1]]} rotation={[-Math.PI / 2, 0, angle]}>
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
  map,
  tracks,
  editMode,
  previewFade,
}: {
  map: CompositionMap;
  tracks: TrackDef[];
  editMode: boolean;
  previewFade: number;
}) {
  const geometry = useMemo(() => walkableFloorGeometry(map), [map.segments, map.elevations]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, PATH_HEIGHT, 0]}>
      <PathMaterial tracks={tracks} editMode={editMode} selected={false} previewFade={previewFade} />
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

  if (!branchStartPointKey || !startPoint || !canAddBranchAtPoint(map, branchStartPointKey)) return null;

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
      <mesh position={[startPoint[0], elevationAt(map, startPoint) + 0.09, startPoint[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.55, 48]} />
        <meshBasicMaterial color="#8fffe8" transparent opacity={0.8} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function BorderRail({ start, startY = 0, end, endY = 0, editMode, selected }: { start: [number, number]; startY?: number; end: [number, number]; endY?: number; editMode: boolean; selected: boolean }) {
  const ax = start[0];
  const az = start[1];
  const bx = end[0];
  const bz = end[1];
  const ay = startY + 0.045;
  const by = endY + 0.045;
  // The strip follows the ramp in 3D: its length axis points start→end (tilting
  // with the slope), its width lies horizontal-perpendicular, normal points up.
  const orientation = useMemo(() => {
    const forward = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const length = forward.length();
    if (length < 0.02) return null;
    forward.divideScalar(length);
    const width = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);
    if (width.lengthSq() < 1e-6) width.set(1, 0, 0);
    width.normalize();
    const normal = new THREE.Vector3().crossVectors(forward, width).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, width, normal));
    return { length, quaternion };
  }, [ax, ay, az, bx, by, bz]);
  if (!orientation) return null;
  const mid: [number, number, number] = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];

  return (
    <mesh position={mid} quaternion={orientation.quaternion}>
      <planeGeometry args={[orientation.length, 0.16]} />
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

function lerp2(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Split a border rail (a→b) into the spans that stay clear of any *unconnected*
// crossing path. Connected segments share a joint and are handled by the miter
// in `borderPoint`, so only paths that physically overlap without a shared
// endpoint clip the rail.
function clipRail(a: [number, number], b: [number, number], segment: WalkableSegment, segments: WalkableSegment[]): Array<[number, number]> {
  const ownKeys = new Set([pointKey(segment.start), pointKey(segment.end)]);
  const covered: Array<[number, number]> = [];
  for (const other of segments) {
    if (other.id === segment.id) continue;
    if (ownKeys.has(pointKey(other.start)) || ownKeys.has(pointKey(other.end))) continue;
    const span = railInsideRect(a, b, other);
    if (span) covered.push(span);
  }
  return keptSpans(covered);
}

// Liang–Barsky clip of the rail param t∈[0,1] against `seg`'s rectangular floor
// footprint; returns the [t0,t1] where the rail lies inside it, or null.
function railInsideRect(a: [number, number], b: [number, number], seg: WalkableSegment): [number, number] | null {
  const sx = seg.start[0];
  const sz = seg.start[1];
  const dx = seg.end[0] - sx;
  const dz = seg.end[1] - sz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const hw = seg.width / 2;
  const au = (a[0] - sx) * ux + (a[1] - sz) * uz;
  const av = (a[0] - sx) * -uz + (a[1] - sz) * ux;
  const bu = (b[0] - sx) * ux + (b[1] - sz) * uz;
  const bv = (b[0] - sx) * -uz + (b[1] - sz) * ux;
  const du = bu - au;
  const dv = bv - av;

  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-du, au) && clip(du, len - au) && clip(-dv, av + hw) && clip(dv, hw - av) && t1 > t0) {
    return [t0, t1];
  }
  return null;
}

// Complement of the covered spans within [0,1]: the rail spans we still draw.
function keptSpans(covered: Array<[number, number]>): Array<[number, number]> {
  if (!covered.length) return [[0, 1]];
  const sorted = covered
    .map(([s, e]): [number, number] => [Math.max(0, s), Math.min(1, e)])
    .filter(([s, e]) => e - s > 1e-4)
    .sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1e-4) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  const kept: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s - cursor > 1e-3) kept.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (1 - cursor > 1e-3) kept.push([cursor, 1]);
  return kept;
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

function walkableFloorGeometry(map: CompositionMap): THREE.BufferGeometry | null {
  const segments = map.segments;
  if (!segments.length) return null;
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  // Each segment quad ramps from its start elevation to its end elevation.
  for (const segment of segments) {
    const sy = elevationAt(map, segment.start);
    const ey = elevationAt(map, segment.end);
    addFloorPolygon(
      [
        { point: borderPoint(segment, segments, "start", -1), y: sy },
        { point: borderPoint(segment, segments, "end", -1), y: ey },
        { point: borderPoint(segment, segments, "end", 1), y: ey },
        { point: borderPoint(segment, segments, "start", 1), y: sy },
      ],
      vertices,
      indices,
    );
  }

  // Joints are a single shared height, so their fill patch is flat.
  for (const { point, segments: jointSegments } of sharedJoints(segments)) {
    const jy = elevationAt(map, point);
    const points: [number, number][] = [];
    for (const segment of jointSegments) {
      const end = pointKey(segment.start) === pointKey(point) ? "start" : "end";
      points.push(borderPoint(segment, segments, end, -1));
      points.push(borderPoint(segment, segments, end, 1));
    }
    addFloorPolygon(
      convexHull(uniquePoints(points)).map((p) => ({ point: p, y: jy })),
      vertices,
      indices,
    );
  }

  if (!vertices.length || !indices.length) return null;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function pathSkirtGeometry(map: CompositionMap): THREE.BufferGeometry | null {
  const segments = map.segments;
  if (!segments.length) return null;
  const counts = countEndpoints(segments);
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const segment of segments) {
    const sy = elevationAt(map, segment.start);
    const ey = elevationAt(map, segment.end);
    addSkirtEdge(borderPoint(segment, segments, "start", -1), sy, borderPoint(segment, segments, "end", -1), ey, vertices, indices);
    addSkirtEdge(borderPoint(segment, segments, "end", 1), ey, borderPoint(segment, segments, "start", 1), sy, vertices, indices);
    // Cap any free end so it reads as the edge of a board, not a hollow tunnel.
    for (const end of ["start", "end"] as const) {
      const point = end === "start" ? segment.start : segment.end;
      if ((counts.get(pointKey(point)) ?? 0) !== 1) continue;
      const y = end === "start" ? sy : ey;
      addSkirtEdge(borderPoint(segment, segments, end, -1), y, borderPoint(segment, segments, end, 1), y, vertices, indices);
    }
  }

  if (!vertices.length || !indices.length) return null;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The skirt top edge follows the (possibly ramped) path; the bottom hangs a
// fixed depth below it.
function addSkirtEdge(a: [number, number], aY: number, b: [number, number], bY: number, vertices: number[], indices: number[]): void {
  const base = vertices.length / 3;
  vertices.push(
    a[0], PATH_HEIGHT + aY, a[1],
    b[0], PATH_HEIGHT + bY, b[1],
    b[0], UNDERFLOOR_HEIGHT + bY, b[1],
    a[0], UNDERFLOOR_HEIGHT + aY, a[1],
  );
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function countEndpoints(segments: WalkableSegment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
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

function addFloorPolygon(points: Array<{ point: [number, number]; y: number }>, vertices: number[], indices: number[]): void {
  const polygon = uniqueElevatedPoints(points);
  if (polygon.length < 3) return;
  const base = vertices.length / 3;
  for (const { point, y } of polygon) vertices.push(point[0], y, point[1]);
  const triangles = THREE.ShapeUtils.triangulateShape(
    polygon.map(({ point }) => new THREE.Vector2(point[0], point[1])),
    [],
  );
  for (const triangle of triangles) indices.push(base + triangle[0], base + triangle[1], base + triangle[2]);
}

function uniqueElevatedPoints(points: Array<{ point: [number, number]; y: number }>): Array<{ point: [number, number]; y: number }> {
  const seen = new Set<string>();
  const unique: Array<{ point: [number, number]; y: number }> = [];
  for (const entry of points) {
    const key = pointKey(entry.point);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
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

function mapBounds(segments: WalkableSegment[], tracks: TrackDef[]): { center: [number, number]; size: number } | null {
  if (!segments.length) return null;
  const points: [number, number][] = [];
  for (const segment of segments) points.push(segment.start, segment.end);
  for (const track of tracks) points.push([track.position[0], track.position[2]]);

  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const center: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const span = Math.max(maxX - minX, maxZ - minZ);
  return { center, size: Math.max(90, span + 70) };
}

function PathMaterial({ tracks, editMode, selected, previewFade }: { tracks: TrackDef[]; editMode: boolean; selected: boolean; previewFade: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const engine = useStore((s) => s.engine);
  const smoothedLevels = useRef(new Float32Array(MAX_TRACK_LIGHTS));
  const isPreview = previewFade < 0.999;
  // Stable uniforms object — created ONCE. Recreating it on prop changes (e.g.
  // when `tracks` mutates on the first edit) hands a new object to
  // <shaderMaterial>, which desyncs the live material from what this useFrame
  // writes and freezes the shader. So we mutate values in place every frame.
  const uniforms = useMemo(
    () => ({
      baseColor: { value: new THREE.Color("#c8d2df") },
      trackPositions: { value: Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Vector3(0, 0, 0)) },
      trackColors: { value: Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Color("#000000")) },
      trackLevels: { value: new Float32Array(MAX_TRACK_LIGHTS) },
      trackCount: { value: 0 },
      floorStrength: { value: 0.66 },
      opacity: { value: previewFade },
    }),
    [],
  );

  useFrame((_, dt) => {
    if (!material.current) return;
    const u = material.current.uniforms;
    u.trackCount.value = Math.min(tracks.length, MAX_TRACK_LIGHTS);
    for (let i = 0; i < MAX_TRACK_LIGHTS; i++) {
      const track = tracks[i];
      if (track) {
        const volume = track.volume ?? 1;
        const refDistance = track.refDistance ?? 4;
        const maxDistance = track.maxDistance ?? 40;
        u.trackPositions.value[i].set(track.position[0], track.position[2], Math.max(7, Math.min(24, refDistance + maxDistance * 0.22 + volume * 4)));
        u.trackColors.value[i].set(track.color);
      }
      const target = track ? engine?.level(track.id) ?? 0 : 0;
      smoothedLevels.current[i] = THREE.MathUtils.damp(smoothedLevels.current[i], target, 12, dt);
      u.trackLevels.value[i] = smoothedLevels.current[i];
    }
    u.baseColor.value.set(selected ? "#8fffe8" : "#c8d2df");
    u.floorStrength.value = selected ? 0.92 : editMode ? 0.78 : 0.66;
    u.opacity.value = previewFade;
  });

  return (
    <shaderMaterial
      ref={material}
      transparent={isPreview}
      depthWrite={!isPreview}
      toneMapped={false}
      blending={THREE.NormalBlending}
      side={THREE.DoubleSide}
      uniforms={uniforms}
      vertexShader={pathVertexShader}
      fragmentShader={pathFragmentShader}
    />
  );
}

function ReflectiveUnderfloorMaterial({ tracks, previewFade }: { tracks: TrackDef[]; previewFade: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const engine = useStore((s) => s.engine);
  const smoothedLevels = useRef(new Float32Array(MAX_TRACK_LIGHTS));
  // Stable uniforms object (see PathMaterial): recreating it on `tracks` change
  // would freeze this shader after the first edit. Mutate values in place.
  const uniforms = useMemo(
    () => ({
      trackPositions: { value: Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Vector3(0, 0, 0)) },
      trackColors: { value: Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Color("#000000")) },
      trackLevels: { value: new Float32Array(MAX_TRACK_LIGHTS) },
      trackCount: { value: 0 },
      time: { value: 0 },
      opacity: { value: previewFade },
    }),
    [],
  );

  useFrame(({ clock }, dt) => {
    if (!material.current) return;
    const u = material.current.uniforms;
    u.time.value = clock.elapsedTime;
    u.opacity.value = previewFade;
    u.trackCount.value = Math.min(tracks.length, MAX_TRACK_LIGHTS);
    for (let i = 0; i < MAX_TRACK_LIGHTS; i++) {
      const track = tracks[i];
      if (track) {
        const volume = track.volume ?? 1;
        const refDistance = track.refDistance ?? 4;
        const maxDistance = track.maxDistance ?? 40;
        u.trackPositions.value[i].set(track.position[0], track.position[2], Math.max(10, Math.min(36, refDistance + maxDistance * 0.34 + volume * 6)));
        u.trackColors.value[i].set(track.color);
      }
      const target = track ? engine?.level(track.id) ?? 0 : 0;
      smoothedLevels.current[i] = THREE.MathUtils.damp(smoothedLevels.current[i], target, 9, dt);
      u.trackLevels.value[i] = smoothedLevels.current[i];
    }
  });

  return (
    <shaderMaterial
      ref={material}
      transparent
      depthWrite={false}
      toneMapped={false}
      blending={THREE.NormalBlending}
      side={THREE.DoubleSide}
      uniforms={uniforms}
      vertexShader={reflectiveFloorVertexShader}
      fragmentShader={reflectiveFloorFragmentShader}
    />
  );
}

// Heights (above the branch point's surface) of the floor grab sphere and the
// floating knob that drags elevation.
const HANDLE_BASE = 0.58;
const ELEVATION_KNOB_LIFT = 1.8;

function EndpointEditor({ map, endpointCounts }: { map: CompositionMap; endpointCounts: Map<string, number> }) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const camera = useThree((s) => s.camera);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const drag = useRef<{ pointKey: string; axis: "xz" | "y" } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  // Reused scratch objects for the vertical drag plane.
  const vplane = useMemo(() => new THREE.Plane(), []);
  const vnormal = useMemo(() => new THREE.Vector3(), []);
  const vpoint = useMemo(() => new THREE.Vector3(), []);
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
      hasRoom: !!roomAttachedToPoint(map, key),
      loopRole: loopRoleForPoint(map, key),
    }));
  }, [endpointCounts, map]);

  // Route a drag move to the right axis: ground plane (X/Z) or elevation (Y).
  function onDragMove(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    if (drag.current.axis === "y") moveElevation(e);
    else moveEndpoint(e);
  }

  function moveEndpoint(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const next: [number, number] = [hit.x, hit.z];
    const activeKey = drag.current.pointKey;
    const nextKey = pointKey(next);
    drag.current.pointKey = nextKey;
    setActiveId(nextKey);
    const currentMap = useStore.getState().composition.map;
    setMap({
      preset: "custom",
      segments: currentMap.segments.map((segment) => ({
        ...segment,
        start: pointKey(segment.start) === activeKey ? next : segment.start,
        end: pointKey(segment.end) === activeKey ? next : segment.end,
      })),
      // Carry the point's height to its new key so moving a raised point keeps it.
      elevations: renameElevationKey(currentMap.elevations, activeKey, nextKey),
    });
    selectMapPoint(nextKey);
  }

  // Drag the floating knob to set the surface height at this branch point. A
  // vertical plane through the point (facing the camera) turns cursor height
  // into elevation; the point itself doesn't move, so its key is unchanged.
  function moveElevation(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    const key = drag.current.pointKey;
    const point = endpoints.find((p) => p.key === key)?.point ?? findPoint(map, key);
    if (!point) return;
    vnormal.set(camera.position.x - point[0], 0, camera.position.z - point[1]);
    if (vnormal.lengthSq() < 1e-6) vnormal.set(0, 0, 1);
    vnormal.normalize();
    vpoint.set(point[0], 0, point[1]);
    vplane.setFromNormalAndCoplanarPoint(vnormal, vpoint);
    if (!e.ray.intersectPlane(vplane, hit)) return;
    const elevation = Math.round((hit.y - HANDLE_BASE - ELEVATION_KNOB_LIFT) * 100) / 100;
    setMap({ preset: "custom", elevations: { ...(map.elevations ?? {}), [key]: elevation } });
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

  function startDrag(e: ThreeEvent<PointerEvent>, key: string) {
    e.stopPropagation();
    drag.current = { pointKey: key, axis: "xz" };
    setActiveId(key);
    selectMapPoint(key);
    if (controls) controls.enabled = false;
    const target = e.nativeEvent.target as Element | null;
    target?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function startElevationDrag(e: ThreeEvent<PointerEvent>, key: string) {
    e.stopPropagation();
    drag.current = { pointKey: key, axis: "y" };
    setActiveId(key);
    selectMapPoint(key);
    if (controls) controls.enabled = false;
    const target = e.nativeEvent.target as Element | null;
    target?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "ns-resize";
  }

  function selectEndpoint(e: ThreeEvent<MouseEvent>, key: string) {
    e.stopPropagation();
    selectMapPoint(key);
  }

  return (
    <group onPointerUp={endDrag} onPointerCancel={endDrag}>
      {drag.current && (
        <mesh position={[0, 0.64, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <planeGeometry args={[240, 240]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {endpoints.map(({ id, key, point, shared, hasRoom, loopRole }) => {
        const active = activeId === id;
        const selected = selectedMapPointKey === key;
        const loopColor = loopRole === "start" ? "#56e0c0" : loopRole === "end" ? "#ff9f6e" : null;
        const terminalColor = loopColor ?? (hasRoom ? "#8fffe8" : "#ffffff");
        return (
          <mesh
            key={id}
            position={[point[0], HANDLE_BASE + elevationAt(map, point), point[1]]}
            renderOrder={50}
            onPointerDown={(e) => startDrag(e, key)}
            onClick={(e) => selectEndpoint(e, key)}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "grab";
            }}
            onPointerOut={() => {
              if (!drag.current) document.body.style.cursor = "auto";
            }}
          >
            <sphereGeometry args={[shared || hasRoom || loopRole ? 1.6 : 1.35, 24, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            <mesh>
              <sphereGeometry args={[active ? 0.95 : selected ? 0.82 : shared || hasRoom || loopRole ? 0.72 : 0.58, 24, 16]} />
              <meshBasicMaterial color={active ? "#8fffe8" : selected ? "#9fb4ff" : shared ? "#ffd166" : terminalColor} transparent opacity={1} toneMapped={false} />
            </mesh>
            {loopRole && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.95, 1.12, 36]} />
                <meshBasicMaterial color={loopColor ?? "#ffffff"} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
              </mesh>
            )}
            {(active || selected) && (
              <>
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
                <EndpointSelectionRing active={active} color={active ? "#8fffe8" : "#9fb4ff"} />
              </>
            )}
            {selected && (
              <>
                {/* Stick from the point up to the grab knob. */}
                <mesh position={[0, ELEVATION_KNOB_LIFT / 2, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, ELEVATION_KNOB_LIFT, 8]} />
                  <meshBasicMaterial color="#8fffe8" transparent opacity={0.6} toneMapped={false} depthWrite={false} />
                </mesh>
                {/* Drag this knob up/down to set the branch point's elevation. */}
                <mesh
                  position={[0, ELEVATION_KNOB_LIFT, 0]}
                  onPointerDown={(e) => startElevationDrag(e, key)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    document.body.style.cursor = "ns-resize";
                  }}
                  onPointerOut={() => {
                    if (!drag.current) document.body.style.cursor = "auto";
                  }}
                >
                  <sphereGeometry args={[0.55, 20, 14]} />
                  <meshBasicMaterial color="#8fffe8" transparent opacity={0.92} toneMapped={false} />
                </mesh>
              </>
            )}
          </mesh>
        );
      })}
    </group>
  );
}

// Move a point's elevation entry to a new key when the point moves in XZ.
function renameElevationKey(elevations: Record<string, number> | undefined, fromKey: string, toKey: string): Record<string, number> {
  const next = { ...(elevations ?? {}) };
  if (fromKey === toKey) return next;
  if (fromKey in next) {
    next[toKey] = next[fromKey];
    delete next[fromKey];
  }
  return next;
}

function EndpointSelectionRing({ active, color }: { active: boolean; color: string }) {
  const group = useRef<THREE.Group>(null);
  const dots = useMemo(() => Array.from({ length: 24 }, (_, i) => (i / 24) * Math.PI * 2), []);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.rotation.y += dt * (active ? 1.1 : 0.62);
  });

  return (
    <group rotation={[0.16, 0, 0.08]}>
      <group ref={group}>
      {dots.map((a, i) => {
        const emphasis = i % 4 === 0;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45]}>
            <sphereGeometry args={[emphasis ? 0.075 : 0.052, 10, 8]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={emphasis ? 0.95 : 0.58}
              toneMapped={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}
      </group>
    </group>
  );
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

// Surface height at a branch point (0 = flat). Mirrors map.ts `pointElevation`
// but keyed off the local `pointKey`.
function elevationAt(map: CompositionMap, point: [number, number]): number {
  const value = map.elevations?.[pointKey(point)];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
  uniform float opacity;
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
    gl_FragColor = vec4(color, opacity);
  }
`;

const reflectiveFloorVertexShader = `
  varying vec2 vWorld;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const reflectiveFloorFragmentShader = `
  #define MAX_TRACK_LIGHTS ${MAX_TRACK_LIGHTS}

  uniform vec3 trackColors[MAX_TRACK_LIGHTS];
  uniform vec3 trackPositions[MAX_TRACK_LIGHTS];
  uniform float trackLevels[MAX_TRACK_LIGHTS];
  uniform int trackCount;
  uniform float time;
  uniform float opacity;
  varying vec2 vWorld;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 centeredUv = vUv - 0.5;
    float edgeFade = smoothstep(0.72, 0.18, length(centeredUv));
    float grain = noise(vWorld * 0.07 + time * 0.015);
    float brushed = pow(0.5 + 0.5 * sin((vWorld.x + vWorld.y) * 0.16 + grain * 2.4), 2.0);
    vec3 color = mix(vec3(0.012, 0.015, 0.024), vec3(0.035, 0.045, 0.062), brushed * 0.45);
    float glowTotal = 0.0;

    for (int i = 0; i < MAX_TRACK_LIGHTS; i++) {
      if (i >= trackCount) break;
      float radius = trackPositions[i].z;
      float d = distance(vWorld, trackPositions[i].xy);
      float pulse = trackLevels[i];
      float glow = pow(smoothstep(radius * (1.0 + pulse * 0.22), 0.0, d), 2.05) * (0.38 + pulse * 1.25);
      float streak = exp(-abs(vWorld.x - trackPositions[i].x) / (radius * 0.18)) * smoothstep(radius, 0.0, abs(vWorld.y - trackPositions[i].y));
      glowTotal += glow;
      color += trackColors[i] * glow * (0.28 + pulse * 0.4);
      color += trackColors[i] * streak * (0.035 + pulse * 0.11);
    }

    vec3 sheen = vec3(0.12, 0.16, 0.19) * (0.08 + brushed * 0.18 + min(glowTotal, 1.0) * 0.15);
    color += sheen;
    float alpha = edgeFade * (0.72 + min(glowTotal, 1.0) * 0.22);
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

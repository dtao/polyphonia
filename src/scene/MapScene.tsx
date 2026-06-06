import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Line, TransformControls } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { newId } from "../id";
import { canAddBranchAtPoint, clampToMap, CompositionMap, doorVisualOpenAmount, DOOR_DEPTH, entranceLocalCenter, isTunnelSegment, loopRoleForPoint, MapPlatform, MapRoom, MapWall, platformElevation, platformLocalPolygon, pointHasAttachment, RoomEntrance, roomElevation, roomLocalPoint, roomWorldPoint, RoomSide, solidWallSpans, surfaceHeightAt, tunnelHeight, tunnelSideWalls, wallOpenings, wallThickness, WalkableSegment } from "../map";
import { useStore, viewState } from "../store";
import { DEFAULT_ENCLOSURE_HEIGHT } from "../spatialConstants";
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
      <Platforms map={map} editMode={editMode} />
      <StandaloneWalls map={map} editMode={editMode} />
      <Tunnels map={map} editMode={editMode} />
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
  const updateRoom = useStore((s) => s.updateRoom);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [cx, cz] = room.center;
  const h = room.height;
  const boxes = roomWallBoxes(room);
  const wallOpacity = editMode ? 0.3 : 1;
  const wallColor = selected ? "#8fffe8" : "#9aa6bd";
  const wallTransparent = editMode;

  function handleObjectChange() {
    if (!obj) return;
    updateRoom(room.id, {
      center: [obj.position.x, obj.position.z],
      elevation: Math.max(-20, Math.min(40, obj.position.y)),
      attachment: undefined,
    });
  }

  return (
    <>
      <group
        ref={setObj}
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
        {room.entrances.map((entrance, i) => (entrance.door ? <DoorPanel key={`door-${i}`} room={room} entrance={entrance} editMode={editMode} /> : null))}
        {editMode && selected && <RoomEntranceEditor room={room} elevationY={elevationY} />}
      </group>
      {editMode && selected && obj && (
        <TransformControls object={obj} mode="translate" showX showY showZ size={0.9} onObjectChange={handleObjectChange} />
      )}
    </>
  );
}

// Edit-mode handles inside a room: a "+" on each wall to add a doorway, and a
// draggable marker on each entrance that selects it and slides it along the
// wall. Rendered in the room's local frame (a child of the room group).
function RoomEntranceEditor({ room, elevationY }: { room: MapRoom; elevationY: number }) {
  const selectedRoomId = useStore((s) => s.selectedRoomId);
  const selectedEntranceIndex = useStore((s) => s.selectedEntranceIndex);
  return (
    <group>
      {(["north", "south", "east", "west"] as RoomSide[]).map((side) => (
        <WallAddButton key={side} room={room} side={side} />
      ))}
      {room.entrances.map((entrance, i) => (
        <EntranceHandle key={i} room={room} entrance={entrance} index={i} elevationY={elevationY} selected={selectedRoomId === room.id && selectedEntranceIndex === i} />
      ))}
    </group>
  );
}

function WallAddButton({ room, side }: { room: MapRoom; side: RoomSide }) {
  const addEntrance = useStore((s) => s.addEntrance);
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const out = 1;
  const pos: [number, number, number] =
    side === "north" ? [0, 1, -hd - out] : side === "south" ? [0, 1, hd + out] : side === "west" ? [-hw - out, 1, 0] : [hw + out, 1, 0];
  return (
    <AddButtonGlyph
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        addEntrance(room.id, side);
      }}
    />
  );
}

function EntranceHandle({ room, entrance, index, elevationY, selected }: { room: MapRoom; entrance: RoomEntrance; index: number; elevationY: number; selected: boolean }) {
  const updateEntrance = useStore((s) => s.updateEntrance);
  const selectEntrance = useStore((s) => s.selectEntrance);
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const dragging = useRef(false);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevationY), [elevationY]);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const [lx, lz] = entranceLocalCenter(room, entrance);
  const horizontal = entrance.side === "north" || entrance.side === "south";
  const size: [number, number, number] = horizontal ? [entrance.width, room.height, 0.5] : [0.5, room.height, entrance.width];

  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;
    const local = roomLocalPoint(room, [hit.x, hit.z]);
    updateEntrance(room.id, index, { offset: horizontal ? local[0] : local[1] });
  }

  function onDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    dragging.current = true;
    selectEntrance(room.id, index);
    if (controls) controls.enabled = false;
    (e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function onUp(e?: ThreeEvent<PointerEvent>) {
    dragging.current = false;
    if (controls) controls.enabled = true;
    (e?.nativeEvent.target as Element | null | undefined)?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "auto";
  }

  return (
    <mesh
      position={[lx, room.height / 2, lz]}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onClick={(e) => {
        e.stopPropagation();
        selectEntrance(room.id, index);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (!dragging.current) document.body.style.cursor = "auto";
      }}
    >
      <boxGeometry args={size} />
      <meshBasicMaterial color={selected ? "#8fffe8" : "#5b8cff"} transparent opacity={selected ? 0.5 : 0.3} depthWrite={false} />
    </mesh>
  );
}

// A sliding door that fills its doorway and retracts into the adjacent wall as
// the listener approaches from an allowed side (see `doorVisualOpenAmount`).
function DoorPanel({ room, entrance, editMode }: { room: MapRoom; entrance: RoomEntrance; editMode: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const data = useMemo(() => doorPanelData(room, entrance), [room, entrance]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const target = doorVisualOpenAmount(room, entrance, [viewState.x, viewState.z], open.current > 0.05);
    open.current = THREE.MathUtils.damp(open.current, target, 8, dt);
    const slide = open.current * (data.width + 0.4);
    ref.current.position.set(data.center[0] + (data.axis === "x" ? slide : 0), room.height / 2, data.center[1] + (data.axis === "z" ? slide : 0));
  });
  return (
    <mesh ref={ref} position={[data.center[0], room.height / 2, data.center[1]]}>
      <boxGeometry args={data.size} />
      <meshStandardMaterial color="#caa46a" roughness={0.5} metalness={0.35} transparent={editMode} opacity={editMode ? 0.55 : 1} depthWrite={!editMode} side={THREE.DoubleSide} />
    </mesh>
  );
}

const DOOR_PANEL_THICKNESS = 0.08;
const DOOR_PANEL_CLEARANCE = 0.02;

function doorPanelData(room: MapRoom, entrance: RoomEntrance): { center: [number, number]; axis: "x" | "z"; width: number; size: [number, number, number] } {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const t = wallThickness(room.wallThickness);
  const h = room.height;
  const w = Math.max(0.1, entrance.width - 0.04);
  const inset = t / 2 + DOOR_PANEL_THICKNESS / 2 + DOOR_PANEL_CLEARANCE;
  switch (entrance.side) {
    case "north":
      return { center: [entrance.offset, -hd + inset], axis: "x", width: w, size: [w, h, DOOR_PANEL_THICKNESS] };
    case "south":
      return { center: [entrance.offset, hd - inset], axis: "x", width: w, size: [w, h, DOOR_PANEL_THICKNESS] };
    case "west":
      return { center: [-hw + inset, entrance.offset], axis: "z", width: w, size: [DOOR_PANEL_THICKNESS, h, w] };
    case "east":
      return { center: [hw - inset, entrance.offset], axis: "z", width: w, size: [DOOR_PANEL_THICKNESS, h, w] };
  }
}

// Wall boxes in room-local coords; each entrance leaves a gap in its wall.
function roomWallBoxes(room: MapRoom): Array<{ pos: [number, number]; size: [number, number] }> {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const t = wallThickness(room.wallThickness);
  const boxes: Array<{ pos: [number, number]; size: [number, number] }> = [];
  for (const [s, e] of solidWallSpans(hw, wallOpenings(room, "north"))) boxes.push({ pos: [wallSpanCenter(s, e, hw, t), -hd], size: [wallSpanLength(s, e, hw, t), t] });
  for (const [s, e] of solidWallSpans(hw, wallOpenings(room, "south"))) boxes.push({ pos: [wallSpanCenter(s, e, hw, t), hd], size: [wallSpanLength(s, e, hw, t), t] });
  for (const [s, e] of solidWallSpans(hd, wallOpenings(room, "west"))) boxes.push({ pos: [-hw, wallSpanCenter(s, e, hd, t)], size: [t, wallSpanLength(s, e, hd, t)] });
  for (const [s, e] of solidWallSpans(hd, wallOpenings(room, "east"))) boxes.push({ pos: [hw, wallSpanCenter(s, e, hd, t)], size: [t, wallSpanLength(s, e, hd, t)] });
  return boxes;
}

function wallSpanCenter(start: number, end: number, half: number, thickness: number): number {
  const min = start - (touchesWallEdge(start, -half) ? thickness / 2 : 0);
  const max = end + (touchesWallEdge(end, half) ? thickness / 2 : 0);
  return (min + max) / 2;
}

function wallSpanLength(start: number, end: number, half: number, thickness: number): number {
  const min = start - (touchesWallEdge(start, -half) ? thickness / 2 : 0);
  const max = end + (touchesWallEdge(end, half) ? thickness / 2 : 0);
  return max - min;
}

function touchesWallEdge(value: number, edge: number): boolean {
  return Math.abs(value - edge) < 0.001;
}

// Enclosed corridors: side walls + a ceiling drawn over a tunnel segment's
// walkable strip. The ceiling is hidden in edit mode so the overhead camera can
// still click the floor to select the segment; the side walls stay (faint) so
// the corridor reads as enclosed.
function Tunnels({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const tunnels = map.segments.filter(isTunnelSegment);
  if (!tunnels.length) return null;
  return (
    <group>
      {tunnels.map((segment) => (
        <Tunnel key={segment.id} segment={segment} map={map} editMode={editMode} />
      ))}
    </group>
  );
}

function Tunnel({ segment, map, editMode }: { segment: WalkableSegment; map: CompositionMap; editMode: boolean }) {
  const height = tunnelHeight(map, segment, DEFAULT_ENCLOSURE_HEIGHT);
  const walls = useMemo(() => tunnelWallGeometry(map, segment, height), [segment, map.elevations, height]);
  const ceiling = useMemo(() => tunnelCeilingGeometry(map, segment, height), [segment, map.elevations, height]);
  return (
    <group>
      <mesh geometry={walls}>
        <meshStandardMaterial color="#9aa6bd" roughness={0.85} metalness={0.05} transparent={editMode} opacity={editMode ? 0.28 : 1} depthWrite={!editMode} side={THREE.DoubleSide} />
      </mesh>
      {!editMode && (
        <mesh geometry={ceiling}>
          <meshStandardMaterial color="#8e99af" roughness={0.88} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function tunnelWallGeometry(map: CompositionMap, segment: WalkableSegment, height: number): THREE.BufferGeometry {
  const sy = elevationAt(map, segment.start) + PATH_HEIGHT;
  const ey = elevationAt(map, segment.end) + PATH_HEIGHT;
  const [left, right] = tunnelSideWalls(segment);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const side of [left, right]) {
    addQuad(
      [side[0][0], sy, side[0][1]],
      [side[1][0], ey, side[1][1]],
      [side[1][0], ey + height, side[1][1]],
      [side[0][0], sy + height, side[0][1]],
      vertices,
      indices,
    );
  }
  return buildBufferGeometry(vertices, indices);
}

function tunnelCeilingGeometry(map: CompositionMap, segment: WalkableSegment, height: number): THREE.BufferGeometry {
  const sy = elevationAt(map, segment.start) + PATH_HEIGHT + height;
  const ey = elevationAt(map, segment.end) + PATH_HEIGHT + height;
  const [left, right] = tunnelSideWalls(segment);
  const vertices: number[] = [];
  const indices: number[] = [];
  addQuad(
    [left[0][0], sy, left[0][1]],
    [left[1][0], ey, left[1][1]],
    [right[1][0], ey, right[1][1]],
    [right[0][0], sy, right[0][1]],
    vertices,
    indices,
  );
  return buildBufferGeometry(vertices, indices);
}

function addQuad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], vertices: number[], indices: number[]): void {
  const base = vertices.length / 3;
  vertices.push(...a, ...b, ...c, ...d);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildBufferGeometry(vertices: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Open walkable areas (rect/hex/circle) — like rooms without walls or ceilings.
// Attached to a terminal path point, so position/elevation follow that point.
const PLATFORM_FLOOR_Y = 0.06;

function Platforms({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const selectedPlatformId = useStore((s) => s.selectedPlatformId);
  if (!map.platforms.length) return null;
  return (
    <group>
      {map.platforms.map((platform) => (
        <Platform key={platform.id} platform={platform} map={map} editMode={editMode} selected={editMode && selectedPlatformId === platform.id} />
      ))}
    </group>
  );
}

function Platform({ platform, map, editMode, selected }: { platform: MapPlatform; map: CompositionMap; editMode: boolean; selected: boolean }) {
  const selectPlatform = useStore((s) => s.selectPlatform);
  const updatePlatform = useStore((s) => s.updatePlatform);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const outline = useMemo(() => platformOutlinePoints(platform), [platform]);
  const elevationY = platformElevation(map, platform);

  function handleObjectChange() {
    if (!obj) return;
    updatePlatform(platform.id, {
      center: [obj.position.x, obj.position.z],
      elevation: Math.max(-20, Math.min(40, obj.position.y)),
      attachment: undefined,
    });
  }

  return (
    <>
      <group
        ref={setObj}
        position={[platform.center[0], elevationY, platform.center[1]]}
        rotation={[0, platform.rotation, 0]}
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          selectPlatform(platform.id);
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PLATFORM_FLOOR_Y, 0]}>
          <PlatformGeometry platform={platform} />
          <meshStandardMaterial color={selected ? "#16302e" : "#14161e"} roughness={0.9} metalness={0.08} side={THREE.DoubleSide} />
        </mesh>
        <Line points={outline} color={selected ? "#8fffe8" : "#5d6b86"} lineWidth={selected ? 2.4 : 1.4} transparent opacity={selected ? 0.95 : 0.6} />
        {editMode && selected && <PlatformPathEditor platform={platform} map={map} elevationY={elevationY} />}
      </group>
      {editMode && selected && obj && (
        <TransformControls object={obj} mode="translate" showX showY showZ size={0.9} onObjectChange={handleObjectChange} />
      )}
    </>
  );
}

function PlatformPathEditor({ platform, map, elevationY }: { platform: MapPlatform; map: CompositionMap; elevationY: number }) {
  return (
    <group>
      {(["north", "south", "east", "west"] as RoomSide[]).map((side) => (
        <PlatformAddButton key={side} platform={platform} map={map} side={side} elevationY={elevationY} />
      ))}
    </group>
  );
}

function PlatformAddButton({ platform, map, side, elevationY }: { platform: MapPlatform; map: CompositionMap; side: RoomSide; elevationY: number }) {
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const averageWidth = map.segments.length ? map.segments.reduce((sum, s) => sum + s.width, 0) / map.segments.length : 7.5;
  const extentX = platform.width / 2;
  const extentZ = platform.shape === "rect" ? platform.depth / 2 : platform.width / 2;
  const out = 1;
  const localStart: [number, number] =
    side === "north" ? [0, -extentZ] : side === "south" ? [0, extentZ] : side === "west" ? [-extentX, 0] : [extentX, 0];
  const localDir: [number, number] =
    side === "north" ? [0, -1] : side === "south" ? [0, 1] : side === "west" ? [-1, 0] : [1, 0];
  const pos: [number, number, number] = [localStart[0] + localDir[0] * out, 1, localStart[1] + localDir[1] * out];

  function addPath(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    const start = platformWorldPoint(platform, localStart);
    const end = platformWorldPoint(platform, [localStart[0] + localDir[0] * 12, localStart[1] + localDir[1] * 12]);
    const currentMap = useStore.getState().composition.map;
    setMap({
      preset: "custom",
      segments: [
        ...currentMap.segments,
        {
          id: newId(),
          start,
          end,
          width: averageWidth,
          connections: { start: { kind: "platform", platformId: platform.id, localPoint: localStart } },
        },
      ],
      elevations: elevationY ? { ...(currentMap.elevations ?? {}), [pointKey(start)]: elevationY, [pointKey(end)]: elevationY } : currentMap.elevations,
    });
    selectMapPoint(pointKey(end));
  }

  return <AddButtonGlyph position={pos} onClick={addPath} />;
}

function AddButtonGlyph({ position, onClick }: { position: [number, number, number]; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group
      position={position}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 24]} />
        <meshBasicMaterial color="#13243a" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.58, 0.66, 24]} />
        <meshBasicMaterial color="#8fffe8" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.5, 0.02, 0.12]} />
        <meshBasicMaterial color="#8fffe8" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.12, 0.02, 0.5]} />
        <meshBasicMaterial color="#8fffe8" toneMapped={false} />
      </mesh>
    </group>
  );
}

function PlatformGeometry({ platform }: { platform: MapPlatform }) {
  const r = platform.width / 2;
  if (platform.shape === "circle") return <circleGeometry args={[r, 48]} />;
  if (platform.shape === "hex") return <circleGeometry args={[r, 6]} />;
  return <planeGeometry args={[platform.width, platform.depth]} />;
}

// Closed outline ring in the platform's local XZ frame, lifted just above the
// floor so it reads as an edge.
function platformOutlinePoints(platform: MapPlatform): Array<[number, number, number]> {
  const y = PLATFORM_FLOOR_Y + 0.04;
  if (platform.shape === "circle") {
    const r = platform.width / 2;
    return Array.from({ length: 49 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [Math.cos(a) * r, y, Math.sin(a) * r] as [number, number, number];
    });
  }
  const polygon = platformLocalPolygon(platform);
  return [...polygon, polygon[0]].map(([x, z]) => [x, y, z] as [number, number, number]);
}

function platformWorldPoint(platform: MapPlatform, localPoint: [number, number]): [number, number] {
  const c = Math.cos(platform.rotation);
  const s = Math.sin(platform.rotation);
  return [platform.center[0] + localPoint[0] * c + localPoint[1] * s, platform.center[1] - localPoint[0] * s + localPoint[1] * c];
}

// Free-standing walls — sound occluders placed anywhere. Click to select; the
// selected wall shows draggable endpoint handles.
function StandaloneWalls({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const selectedWallId = useStore((s) => s.selectedWallId);
  if (!map.walls.length) return null;
  const selectedWall = editMode && selectedWallId ? map.walls.find((w) => w.id === selectedWallId) : null;
  return (
    <group>
      {map.walls.map((wall) => (
        <WallMesh key={wall.id} wall={wall} editMode={editMode} selected={editMode && selectedWallId === wall.id} />
      ))}
      {selectedWall && <WallHandles wall={selectedWall} />}
    </group>
  );
}

function WallMesh({ wall, editMode, selected }: { wall: MapWall; editMode: boolean; selected: boolean }) {
  const selectWall = useStore((s) => s.selectWall);
  const updateWall = useStore((s) => s.updateWall);
  const [object, setObject] = useState<THREE.Mesh | null>(null);
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const length = Math.max(0.02, Math.hypot(dx, dz));
  const angle = Math.atan2(-dz, dx);
  const mid: [number, number] = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2];
  const elevation = wall.elevation ?? 0;

  function handleObjectChange() {
    if (!object) return;
    const offset: [number, number] = [
      object.position.x - mid[0],
      object.position.z - mid[1],
    ];
    updateWall(wall.id, {
      start: [wall.start[0] + offset[0], wall.start[1] + offset[1]],
      end: [wall.end[0] + offset[0], wall.end[1] + offset[1]],
      elevation: object.position.y - wall.height / 2,
    });
  }

  return (
    <>
      <mesh
        ref={setObject}
        position={[mid[0], elevation + wall.height / 2, mid[1]]}
        rotation={[0, angle, 0]}
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          selectWall(wall.id);
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
        <boxGeometry args={[length, wall.height, wallThickness(wall.wallThickness)]} />
        <meshStandardMaterial color={selected ? "#8fffe8" : "#9aa6bd"} roughness={0.8} metalness={0.1} transparent={editMode} opacity={editMode ? 0.55 : 1} depthWrite={!editMode} side={THREE.DoubleSide} />
      </mesh>
      {editMode && selected && object && (
        <TransformControls
          object={object}
          mode="translate"
          size={0.85}
          onObjectChange={handleObjectChange}
        />
      )}
    </>
  );
}

function WallHandles({ wall }: { wall: MapWall }) {
  const updateWall = useStore((s) => s.updateWall);
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const elevation = wall.elevation ?? 0;
  const ground = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation),
    [elevation],
  );
  const hit = useMemo(() => new THREE.Vector3(), []);
  const drag = useRef<"start" | "end" | null>(null);

  function move(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const point: [number, number] = [hit.x, hit.z];
    updateWall(wall.id, drag.current === "start" ? { start: point } : { end: point });
  }

  function startDrag(e: ThreeEvent<PointerEvent>, which: "start" | "end") {
    e.stopPropagation();
    drag.current = which;
    if (controls) controls.enabled = false;
    (e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function endDrag(e?: ThreeEvent<PointerEvent>) {
    drag.current = null;
    if (controls) controls.enabled = true;
    (e?.nativeEvent.target as Element | null | undefined)?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "auto";
  }

  return (
    <group onPointerUp={endDrag} onPointerCancel={endDrag}>
      {drag.current && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} onPointerMove={move} onPointerUp={endDrag}>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {(["start", "end"] as const).map((which) => {
        const point = wall[which];
        return (
          <mesh
            key={which}
            position={[point[0], elevation + wall.height + 0.4, point[1]]}
            onPointerDown={(e) => startDrag(e, which)}
            onPointerMove={move}
            onPointerUp={endDrag}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "grab";
            }}
            onPointerOut={() => {
              if (!drag.current) document.body.style.cursor = "auto";
            }}
          >
            <sphereGeometry args={[0.6, 20, 14]} />
            <meshBasicMaterial color="#8fffe8" toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
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

  for (const segment of segments) {
    addRoomDoorwayConnector(map, segment, "start", vertices, indices);
    addRoomDoorwayConnector(map, segment, "end", vertices, indices);
    addPlatformConnector(map, segment, "start", vertices, indices);
    addPlatformConnector(map, segment, "end", vertices, indices);
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

// The flat fill patches that close the wedge gap where two or more path
// segments meet at an angle, mirroring the miter the reactive floor builds in
// `walkableFloorGeometry`. The textured floor (DetailMapDressing) lays per-
// segment slabs that stop square at each end, so without these the pack texture
// is missing across every angled joint. Each polygon is the convex hull of the
// incident segments' mitered border points, at the joint's shared elevation.
export function pathJointPatches(map: CompositionMap): Array<{ polygon: [number, number][]; y: number }> {
  const segments = map.segments;
  const patches: Array<{ polygon: [number, number][]; y: number }> = [];
  for (const { point, segments: jointSegments } of sharedJoints(segments)) {
    const y = elevationAt(map, point);
    const points: [number, number][] = [];
    for (const segment of jointSegments) {
      const end = pointKey(segment.start) === pointKey(point) ? "start" : "end";
      // Mitered corners reach the outer wedge tip; the square slab-end corners
      // guarantee the hull also bridges to where the rectangular textured slabs
      // actually stop, so no sliver is left between slab and patch.
      points.push(borderPoint(segment, segments, end, -1));
      points.push(borderPoint(segment, segments, end, 1));
      points.push(offsetEndpoint(segment, end, -1));
      points.push(offsetEndpoint(segment, end, 1));
    }
    const polygon = convexHull(uniquePoints(points));
    if (polygon.length >= 3) patches.push({ polygon, y });
  }
  return patches;
}

function addRoomDoorwayConnector(map: CompositionMap, segment: WalkableSegment, end: SegmentEnd, vertices: number[], indices: number[]): void {
  const point = end === "start" ? segment.start : segment.end;
  for (const room of map.rooms) {
    for (const entrance of room.entrances) {
      if (!pointInEntranceThreshold(room, entrance, point)) continue;
      const doorway = doorwayEdgePoints(room, entrance);
      const y = roomElevation(map, room);
      addFloorPolygon(
        convexHull([borderPoint(segment, map.segments, end, -1), borderPoint(segment, map.segments, end, 1), ...doorway]).map((p) => ({ point: p, y })),
        vertices,
        indices,
      );
      return;
    }
  }
}

function addPlatformConnector(map: CompositionMap, segment: WalkableSegment, end: SegmentEnd, vertices: number[], indices: number[]): void {
  const connection = segment.connections?.[end];
  if (connection?.kind !== "platform") return;
  const platform = map.platforms.find((p) => p.id === connection.platformId);
  if (!platform) return;
  const platformEdge = platformConnectorEdgePoints(platform, connection.localPoint, segment.width);
  if (!platformEdge) return;
  const y = platformElevation(map, platform);
  addFloorPolygon(
    convexHull([borderPoint(segment, map.segments, end, -1), borderPoint(segment, map.segments, end, 1), ...platformEdge]).map((p) => ({ point: p, y })),
    vertices,
    indices,
  );
}

function platformConnectorEdgePoints(platform: MapPlatform, localPoint: [number, number], width: number): [[number, number], [number, number]] | null {
  const half = Math.max(0.5, width / 2);
  if (platform.shape === "circle") {
    const radius = platform.width / 2;
    const distance = Math.hypot(localPoint[0], localPoint[1]) || 1;
    const center: [number, number] = [(localPoint[0] / distance) * radius, (localPoint[1] / distance) * radius];
    const tangent: [number, number] = [-center[1] / radius, center[0] / radius];
    return [
      platformWorldPoint(platform, [center[0] - tangent[0] * half, center[1] - tangent[1] * half]),
      platformWorldPoint(platform, [center[0] + tangent[0] * half, center[1] + tangent[1] * half]),
    ];
  }

  const edge = nearestPolygonEdge(platformLocalPolygon(platform), localPoint);
  if (!edge) return null;
  const edgeLength = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);
  if (edgeLength < 1e-6) return null;
  const ux = (edge.b[0] - edge.a[0]) / edgeLength;
  const uz = (edge.b[1] - edge.a[1]) / edgeLength;
  const centerT = clamp01(((edge.closest[0] - edge.a[0]) * ux + (edge.closest[1] - edge.a[1]) * uz) / edgeLength);
  const span = Math.min(half / edgeLength, 0.5);
  const t0 = clamp01(centerT - span);
  const t1 = clamp01(centerT + span);
  return [
    platformWorldPoint(platform, [edge.a[0] + (edge.b[0] - edge.a[0]) * t0, edge.a[1] + (edge.b[1] - edge.a[1]) * t0]),
    platformWorldPoint(platform, [edge.a[0] + (edge.b[0] - edge.a[0]) * t1, edge.a[1] + (edge.b[1] - edge.a[1]) * t1]),
  ];
}

function nearestPolygonEdge(polygon: Array<[number, number]>, point: [number, number]): { a: [number, number]; b: [number, number]; closest: [number, number] } | null {
  let best: { a: [number, number]; b: [number, number]; closest: [number, number] } | null = null;
  let bestDistanceSq = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const closest = closestPointOnLineSegment(point, a, b);
    const dx = point[0] - closest[0];
    const dz = point[1] - closest[1];
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      best = { a, b, closest };
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function closestPointOnLineSegment(point: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : clamp01(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lenSq);
  return [a[0] + dx * t, a[1] + dz * t];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointInEntranceThreshold(room: MapRoom, entrance: RoomEntrance, point: [number, number]): boolean {
  const local = roomLocalPoint(room, point);
  const halfDoor = Math.max(0.5, entrance.width) / 2;
  const halfWall = wallThickness(room.wallThickness) / 2;
  const hw = room.width / 2;
  const hd = room.depth / 2;
  switch (entrance.side) {
    case "north":
      return local[0] >= entrance.offset - halfDoor && local[0] <= entrance.offset + halfDoor && local[1] >= -hd - halfWall && local[1] <= -hd + DOOR_DEPTH;
    case "south":
      return local[0] >= entrance.offset - halfDoor && local[0] <= entrance.offset + halfDoor && local[1] >= hd - DOOR_DEPTH && local[1] <= hd + halfWall;
    case "west":
      return local[1] >= entrance.offset - halfDoor && local[1] <= entrance.offset + halfDoor && local[0] >= -hw - halfWall && local[0] <= -hw + DOOR_DEPTH;
    case "east":
      return local[1] >= entrance.offset - halfDoor && local[1] <= entrance.offset + halfDoor && local[0] >= hw - DOOR_DEPTH && local[0] <= hw + halfWall;
  }
}

function doorwayEdgePoints(room: MapRoom, entrance: RoomEntrance): [[number, number], [number, number]] {
  const halfDoor = Math.max(0.5, entrance.width) / 2;
  const hw = room.width / 2;
  const hd = room.depth / 2;
  switch (entrance.side) {
    case "north":
      return [roomWorldPoint(room, [entrance.offset - halfDoor, -hd]), roomWorldPoint(room, [entrance.offset + halfDoor, -hd])];
    case "south":
      return [roomWorldPoint(room, [entrance.offset - halfDoor, hd]), roomWorldPoint(room, [entrance.offset + halfDoor, hd])];
    case "west":
      return [roomWorldPoint(room, [-hw, entrance.offset - halfDoor]), roomWorldPoint(room, [-hw, entrance.offset + halfDoor])];
    case "east":
      return [roomWorldPoint(room, [hw, entrance.offset - halfDoor]), roomWorldPoint(room, [hw, entrance.offset + halfDoor])];
  }
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
      hasRoom: pointHasAttachment(map, key),
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

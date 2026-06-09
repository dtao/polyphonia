import { create } from "zustand";
import * as THREE from "three";
import { Composition, StemDirectivity, TrackDef, audioAssetKey, compositionRevision, defaultComposition, normalizeComposition, touchComposition } from "./composition";
import { AudioEngine, AudioLoadProgress } from "./audio/AudioEngine";
import {
  SerializedComposition,
  serializeComposition,
  resolveComposition,
  loadLibrary,
  persistLibrary,
  copyComposition,
  stemPut,
  stemDelete,
  importComposition as importBundle,
} from "./persistence";
import { newId } from "./id";
import {
  EnvironmentLandmarkPlacement,
  EnvironmentSettings,
  defaultEnvironment,
  normalizeEnvironment,
} from "./environment";
import { attachmentForPoint, canAddBranchAtPoint, canAddPlatformAtPoint, canAddRoomAtPoint, CompositionMap, entranceDoorwayCenter, entranceLocalCenter, entranceOuterPoint, MAP_PRESETS, MapPlatform, MapRoom, MapWall, RoomAttachment, RoomEntrance, RoomSide, defaultMap, mapPointKey, normalizeMap, platformContains, platformElevation, pointElevation, pointInOriginalTile, roomContains, roomElevation, roomWorldPoint, surfaceHeightAt, WalkableSegment } from "./map";
import { ArtistIdentity } from "./artist";
import {
  AuthUser,
  PublishProgress,
  signInWithEmail,
  signOut as cloudSignOut,
  onAuthChange,
  getCurrentUser,
  getAccountArtist,
  ensureArtistForCurrentUser,
  publishComposition,
  unpublish as cloudUnpublish,
} from "./cloud";
import {
  importDetailPackBundle,
  loadStoredDetailPacks,
  removeStoredDetailPack,
} from "./detailPackStorage";
import {
  EnvironmentPackDefinition,
  environmentPackById,
  registerCustomEnvironmentPacks,
} from "./environmentPacks";
import {
  CreatorAsset,
  CreatorLandmarkImport,
  CreatorMaterialImport,
  importCreatorLandmark,
  importCreatorMaterial,
  loadCreatorAssets,
  registerCreatorAssets,
  removeCreatorAssetRecord,
} from "./creatorAssets";
import { DEFAULT_ENCLOSURE_HEIGHT } from "./spatialConstants";

// Non-reactive registry of each track marker's 3D object, so the move-gizmo
// can attach to the selected track's object without prop-drilling refs.
export const markerObjects = new Map<string, THREE.Object3D>();

// Your location and facing on the spatial plane, shared across camera modes so
// switching Explore <-> Edit preserves both position and heading. `x,z` is the
// ground anchor (in edit it's the orbit pivot / screen center); `fx,fz` is the
// unit facing direction on the plane. New stems spawn at the anchor. Kept
// outside React to avoid per-frame re-renders.
// y is the walkable-surface height at (x, z); the player rides at y + eye height.
export const viewState = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };

// Set by MapScene when the user double-clicks a path/room/platform in edit mode.
// EditControls consumes this in useFrame to shift the orbit pivot there.
export const pendingTeleport = { value: null as { x: number; z: number } | null };

// Bumped each time <Player> wraps the listener across a path-loop seam (a
// teleport). Tiled map previews are derived from React state that lags the
// camera by a frame, so on the wrap frame a copy can be drawn for the old
// position; <Scene> watches this counter to hide the preview group for that one
// frame. Kept non-reactive so the bump never triggers a re-render.
export const loopWrap = { generation: 0 };

// Tiled-preview groups whose contents are positioned from React state that lags
// the camera by a frame (e.g. <DetailMapDressing>'s loop floor shells and
// environmental-object copies). They live below <EnvironmentScene>, which mounts
// before <Player>, so they can't run their own after-wrap guard. Instead they
// register here and <Scene>'s LoopWrapBlipGuard — mounted after <Player> — hides
// every registered group on the teleport frame, the same way it hides its own.
export const loopPreviewGroups = new Set<THREE.Object3D>();

// Touch-device movement input for explore mode: a virtual-joystick vector where
// `forward`/`strafe` are each in roughly [-1, 1]. Written by the on-screen
// joystick (<TouchControls>), read each frame by <Player> alongside WASD. Kept
// outside React so dragging the joystick never triggers re-renders.
export const touchMove = { forward: 0, strafe: 0 };

// Experimental mobile explore input: <ARWalkSession> watches WebXR viewer pose,
// applies movement directly, and lets <Player> mirror the shared view state.
// Kept non-reactive for the same reason as touchMove.
export const arWalk = {
  active: false,
  pendingX: 0,
  pendingZ: 0,
  renderX: 0,
  renderY: 0,
  renderZ: 0,
  renderYaw: 0,
};

// Experimental driving input: <GeoWalkControls> watches device geolocation and
// queues smoothed map-space deltas. <Player> applies those deltas through the
// same wrap/clamp path as keyboard movement.
export const geoWalk = {
  active: false,
  pendingX: 0,
  pendingZ: 0,
};

type Falloff = Pick<TrackDef, "refDistance" | "maxDistance" | "rolloff">;

export type Mode = "explore" | "edit";
export type AudioLoadingState =
  | { status: "idle" }
  | ({ status: "loading" } & AudioLoadProgress)
  | { status: "error"; message: string };

interface StoreState {
  composition: Composition;
  /** All saved compositions (manifests; the current one is also a live copy). */
  library: SerializedComposition[];
  engine: AudioEngine | null;
  audioLoading: AudioLoadingState;
  publishProgress: PublishProgress | null;
  undoStack: Composition[];
  redoStack: Composition[];
  customDetailPacks: EnvironmentPackDefinition[];
  creatorAssets: CreatorAsset[];

  mode: Mode;
  selectedId: string | null;
  selectedMapPointKey: string | null;
  selectedMapSegmentId: string | null;
  branchStartPointKey: string | null;
  selectedStart: boolean; // the map start marker is selected (shows its gizmo)
  startGizmoMode: "translate" | "rotate";
  selectedRoomId: string | null;
  selectedEntranceIndex: number | null; // sub-selection within selectedRoomId
  selectedPlatformId: string | null;
  selectedWallId: string | null;
  selectedLandmarkId: string | null;
  entered: boolean; // has the user started the experience (left the entry screen)
  viewer: boolean; // read-only shared-link view (no autosave, no editing)
  user: AuthUser | null; // signed-in account (for publishing); null = anonymous
  accountArtist: ArtistIdentity | null; // primary artist identity for signed-in publishing
  authReady: boolean; // initial session lookup has completed

  setEngine: (e: AudioEngine | null) => void;
  setAudioLoading: (audioLoading: AudioLoadingState) => void;
  setEntered: (entered: boolean) => void;
  resetViewToMapStart: () => void;
  setViewer: (viewer: boolean) => void;
  startAudio: () => Promise<void>;
  importDetailPack: (file: File) => Promise<void>;
  removeDetailPack: (id: string) => Promise<void>;
  importMaterialAsset: (input: CreatorMaterialImport) => Promise<string>;
  importLandmarkAsset: (input: CreatorLandmarkImport) => Promise<string>;
  removeCreatorAsset: (id: string) => Promise<void>;

  // Auth (for publishing). Editing/playing never requires an account.
  initAuth: () => void;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createAccountArtist: (name: string) => Promise<void>;

  // Publish/unpublish, reflected on the composition via publishedId.
  publishCurrent: () => Promise<void>;
  unpublishComposition: (id: string) => Promise<void>;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  select: (id: string | null) => void;
  selectMapPoint: (key: string | null) => void;
  moveMapPoint: (key: string, point: [number, number], elevation: number) => void;
  selectMapSegment: (id: string | null) => void;
  setBranchStartPoint: (key: string | null) => void;
  selectStart: () => void;
  setStartGizmoMode: (mode: "translate" | "rotate") => void;

  // Visual landmark instances supplied by the selected detail pack.
  selectLandmark: (id: string | null) => void;
  addLandmark: (assetId: string) => void;
  updateLandmark: (id: string, patch: Partial<EnvironmentLandmarkPlacement>) => void;
  deleteLandmark: (id: string) => void;
  duplicateLandmark: (id: string) => void;

  // Rooms (enclosed spaces on the map).
  selectRoom: (id: string | null) => void;
  addRoom: () => void;
  addRoomAtPoint: (pointKey: string) => void;
  addBranchAtPoint: (pointKey: string) => void;
  updateRoom: (id: string, patch: Partial<MapRoom>) => void;
  deleteRoom: (id: string) => void;
  duplicateRoom: (id: string) => void;
  deleteMapPoint: (pointKey: string) => void;

  // Room entrances (doorways). An entrance is a sub-selection of its room.
  selectEntrance: (roomId: string, index: number) => void;
  addEntrance: (roomId: string, side: RoomSide) => void;
  updateEntrance: (roomId: string, index: number, patch: Partial<RoomEntrance>) => void;
  removeEntrance: (roomId: string, index: number) => void;
  // Grow a path (optionally ending in a room or platform) out of a doorway.
  growFromEntrance: (roomId: string, index: number, kind: "path" | "room" | "platform") => void;

  // Platforms (open walkable areas on the map). Attach to a terminal point.
  selectPlatform: (id: string | null) => void;
  addPlatformAtPoint: (pointKey: string) => void;
  updatePlatform: (id: string, patch: Partial<MapPlatform>) => void;
  deletePlatform: (id: string) => void;
  duplicatePlatform: (id: string) => void;

  // Standalone walls (sound occluders, not walkable boundaries).
  selectWall: (id: string | null) => void;
  addWall: () => void;
  updateWall: (id: string, patch: Partial<MapWall>) => void;
  deleteWall: (id: string) => void;
  duplicateWall: (id: string) => void;

  // Track edits. Those that affect audio also push the change to the engine,
  // so a playing composition responds live without ever restarting.
  setTrackVolume: (id: string, volume: number) => void;
  setTrackMinVolume: (id: string, minVolume: number) => void;
  setTrackPosition: (id: string, position: [number, number, number]) => void;
  setTrackFalloff: (id: string, falloff: Partial<Falloff>) => void;
  // Per-stem sub-loop in/out points (seconds into the source) and repeat flag.
  setTrackLoop: (id: string, loop: { loopStart?: number | null; loopEnd?: number | null; loopRepeat?: boolean }) => void;
  // Downsampled waveform peaks + source duration for the selected stem's meter.
  trackPeaks: (id: string, bins: number) => { peaks: Float32Array; duration: number } | null;
  setTrackDirectivity: (id: string, directivity: StemDirectivity | undefined) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackColor: (id: string, color: string) => void;
  deleteTrack: (id: string) => void;
  duplicateTrack: (id: string) => Promise<void>;
  addStem: (file: File) => Promise<void>;
  setLoopSettings: (settings: Partial<Pick<Composition, "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade" | "loopTail" | "bars">>) => void;
  auditionLoopSeam: () => void;
  loopProgress: () => { mode: "playing" | "audition"; position: number; duration: number } | null;
  setEnvironment: (environment: Partial<EnvironmentSettings>) => void;
  setMap: (map: Partial<CompositionMap>, options?: { moveViewToStart?: boolean }) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  // Composition library.
  initLibrary: () => Promise<void>;
  newComposition: (meta: { title: string; artist?: string; bpm: number }) => void;
  importComposition: (file: File) => Promise<void>;
  selectComposition: (id: string) => Promise<void>;
  renameComposition: (id: string, title: string) => void;
  duplicateComposition: (id: string) => Promise<void>;
  deleteComposition: (id: string) => Promise<void>;
}

// Free the object URLs of a composition's uploaded stems (memory cleanup); the
// audio itself stays in IndexedDB, so the composition can be re-resolved later.
function revokeBlobUrls(comp: Composition): void {
  const urls = new Set<string>();
  for (const t of comp.tracks) {
    if (t.source.kind === "file" && t.source.url.startsWith("blob:")) urls.add(t.source.url);
  }
  for (const url of urls) URL.revokeObjectURL(url);
}

// Replace (or append) a composition's manifest in the library array.
function upsert(library: SerializedComposition[], s: SerializedComposition): SerializedComposition[] {
  return library.some((c) => c.id === s.id) ? library.map((c) => (c.id === s.id ? s : c)) : [...library, s];
}

const PALETTE = ["#5b8cff", "#ff7a6b", "#ffd166", "#b96bff", "#56e0c0", "#f78fb3", "#7ee081", "#ffa057"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];
const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const HISTORY_LIMIT = 60;
const HISTORY_COALESCE_MS = 700;
let lastHistoryKey: string | null = null;
let lastHistoryAt = 0;

function cloneComposition(comp: Composition): Composition {
  const clone = typeof structuredClone === "function" ? structuredClone(comp) : JSON.parse(JSON.stringify(comp));
  return normalizeComposition(clone);
}

function clearHistoryMarkers(): void {
  lastHistoryKey = null;
  lastHistoryAt = 0;
}

function withHistory(s: StoreState, key: string): Pick<StoreState, "undoStack" | "redoStack"> {
  const now = Date.now();
  const coalesced = lastHistoryKey === key && now - lastHistoryAt < HISTORY_COALESCE_MS;
  lastHistoryKey = key;
  lastHistoryAt = now;
  return {
    undoStack: coalesced ? s.undoStack : [...s.undoStack, cloneComposition(s.composition)].slice(-HISTORY_LIMIT),
    redoStack: [],
  };
}

function pushRedo(redoStack: Composition[], comp: Composition): Composition[] {
  return [...redoStack, cloneComposition(comp)].slice(-HISTORY_LIMIT);
}

function unitDir(v: [number, number]): [number, number] {
  const length = Math.hypot(v[0], v[1]);
  return length > 0 ? [v[0] / length, v[1] / length] : [0, -1];
}

function moveEndpointElevations(elevations: Record<string, number> | undefined, movedEndpoints: Map<string, [number, number]>): Record<string, number> | undefined {
  if (!elevations || !movedEndpoints.size) return elevations;
  const next = { ...elevations };
  for (const [oldKey, point] of movedEndpoints) {
    const value = next[oldKey];
    if (value === undefined) continue;
    delete next[oldKey];
    next[mapPointKey(point)] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

function movedSegmentEndpoints(before: WalkableSegment[], after: WalkableSegment[]): Map<string, [number, number]> {
  const moved = new Map<string, [number, number]>();
  const previous = new Map(before.map((segment) => [segment.id, segment]));
  for (const segment of after) {
    const old = previous.get(segment.id);
    if (!old) continue;
    for (const end of ["start", "end"] as const) {
      const oldPoint = old[end];
      const nextPoint = segment[end];
      if (mapPointKey(oldPoint) !== mapPointKey(nextPoint)) moved.set(mapPointKey(oldPoint), nextPoint);
    }
  }
  return moved;
}

const MAP_POINT_CONNECT_DISTANCE = 1.25;

function connectMapPoint(
  map: CompositionMap,
  movingKey: string,
  attempted: [number, number],
  attemptedElevation: number,
): { map: CompositionMap; point: [number, number]; elevation: number } {
  let best: { segment: WalkableSegment; point: [number, number]; t: number; distance: number } | null = null;
  for (const segment of map.segments) {
    if (mapPointExists(segment, movingKey)) continue;
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 0.000001) continue;
    const t = Math.max(0, Math.min(1, ((attempted[0] - segment.start[0]) * dx + (attempted[1] - segment.start[1]) * dz) / lengthSq));
    const point: [number, number] = [segment.start[0] + dx * t, segment.start[1] + dz * t];
    const distance = Math.hypot(attempted[0] - point[0], attempted[1] - point[1]);
    if (distance > MAP_POINT_CONNECT_DISTANCE || (best && distance >= best.distance)) continue;
    best = { segment, point, t, distance };
  }
  if (!best) return { map, point: attempted, elevation: attemptedElevation };

  const target = best.t < 0.02 ? best.segment.start : best.t > 0.98 ? best.segment.end : best.point;
  const targetKey = mapPointKey(target);
  const startElevation = pointElevation(map, mapPointKey(best.segment.start));
  const endElevation = pointElevation(map, mapPointKey(best.segment.end));
  const elevation = startElevation + (endElevation - startElevation) * best.t;
  if (targetKey === mapPointKey(best.segment.start) || targetKey === mapPointKey(best.segment.end)) {
    return { map, point: target, elevation };
  }

  const continuationId = newId();
  const first: WalkableSegment = {
    ...best.segment,
    end: target,
    connections: best.segment.connections?.start
      ? { start: best.segment.connections.start }
      : undefined,
  };
  const second: WalkableSegment = {
    ...best.segment,
    id: continuationId,
    start: target,
    connections: best.segment.connections?.end
      ? { end: best.segment.connections.end }
      : undefined,
  };
  const remapFarEnd = (attachment: RoomAttachment | undefined): RoomAttachment | undefined =>
    attachment?.segmentId === best.segment.id && attachment.end === "end"
      ? { segmentId: continuationId, end: "end" }
      : attachment;
  const remapLoop = (loop: CompositionMap["loop"]): CompositionMap["loop"] =>
    loop
      ? {
          start: remapFarEnd(loop.start),
          end: remapFarEnd(loop.end),
        }
      : undefined;

  return {
    point: target,
    elevation,
    map: {
      ...map,
      segments: map.segments.flatMap((segment) =>
        segment.id === best.segment.id ? [first, second] : [segment],
      ),
      rooms: map.rooms.map((room) => ({ ...room, attachment: remapFarEnd(room.attachment) })),
      platforms: map.platforms.map((platform) => ({
        ...platform,
        attachment: remapFarEnd(platform.attachment),
      })),
      tiling: {
        ...map.tiling,
        pathLoop: remapLoop(map.tiling.pathLoop),
      },
      loop: remapLoop(map.loop),
    },
  };
}

function setConnectedEndpointElevations(
  elevations: Record<string, number> | undefined,
  segments: WalkableSegment[],
  connectionKind: "room" | "platform",
  targetId: string,
  elevation: number | undefined,
): Record<string, number> | undefined {
  if (elevation === undefined || !Number.isFinite(elevation)) return elevations;
  const next = { ...(elevations ?? {}) };
  for (const segment of segments) {
    for (const end of ["start", "end"] as const) {
      const connection = segment.connections?.[end];
      if (!connection || connection.kind !== connectionKind) continue;
      const id = connection.kind === "room" ? connection.roomId : connection.platformId;
      if (id !== targetId) continue;
      const key = mapPointKey(segment[end]);
      if (elevation === 0) delete next[key];
      else next[key] = elevation;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

function setConnectedGroupEndpointElevations(elevations: Record<string, number> | undefined, map: CompositionMap, group: Set<StructureKey>): Record<string, number> | undefined {
  let next = elevations;
  for (const key of group) {
    const [kind, id] = key.split(":") as ["room" | "platform", string];
    if (kind === "room") {
      const room = map.rooms.find((r) => r.id === id);
      if (room) next = setConnectedEndpointElevations(next, map.segments, "room", id, roomElevation(map, room));
    } else {
      const platform = map.platforms.find((p) => p.id === id);
      if (platform) next = setConnectedEndpointElevations(next, map.segments, "platform", id, platformElevation(map, platform));
    }
  }
  return next;
}

type StructureKey = `room:${string}` | `platform:${string}`;

function roomKey(id: string): StructureKey {
  return `room:${id}`;
}

function platformKey(id: string): StructureKey {
  return `platform:${id}`;
}

function connectedStructureKeys(map: CompositionMap, start: StructureKey): Set<StructureKey> {
  const seen = new Set<StructureKey>([start]);
  const queue: StructureKey[] = [start];
  while (queue.length) {
    const key = queue.shift()!;
    for (const next of directStructureNeighbors(map, key)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function directStructureNeighbors(map: CompositionMap, key: StructureKey): StructureKey[] {
  const [kind, id] = key.split(":") as ["room" | "platform", string];
  if (kind === "room") {
    const room = map.rooms.find((r) => r.id === id);
    if (!room) return [];
    return [
      ...map.rooms.filter((other) => other.id !== id && roomsDirectlyConnect(room, other)).map((other) => roomKey(other.id)),
      ...map.platforms.filter((platform) => roomPlatformDirectlyConnect(room, platform)).map((platform) => platformKey(platform.id)),
    ];
  }

  const platform = map.platforms.find((p) => p.id === id);
  if (!platform) return [];
  return [
    ...map.rooms.filter((room) => roomPlatformDirectlyConnect(room, platform)).map((room) => roomKey(room.id)),
    ...map.platforms.filter((other) => other.id !== id && platformsDirectlyConnect(platform, other)).map((other) => platformKey(other.id)),
  ];
}

function roomsDirectlyConnect(a: MapRoom, b: MapRoom): boolean {
  return a.entrances.some((entrance) => roomContains(b, entranceOuterPoint(a, entrance))) || b.entrances.some((entrance) => roomContains(a, entranceOuterPoint(b, entrance)));
}

function roomPlatformDirectlyConnect(room: MapRoom, platform: MapPlatform): boolean {
  return room.entrances.some((entrance) => platformContains(platform, entranceOuterPoint(room, entrance))) || platformContains(platform, room.center);
}

function platformsDirectlyConnect(a: MapPlatform, b: MapPlatform): boolean {
  return (
    platformContains(a, b.center) ||
    platformContains(b, a.center) ||
    platformSamplePoints(a).some((point) => platformContains(b, point)) ||
    platformSamplePoints(b).some((point) => platformContains(a, point))
  );
}

function platformSamplePoints(platform: MapPlatform): [number, number][] {
  if (platform.shape === "circle") {
    const radius = platform.width / 2;
    return Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2;
      return platformWorldPoint(platform, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
    });
  }
  const hw = platform.width / 2;
  const hd = platform.shape === "rect" ? platform.depth / 2 : platform.width / 2;
  if (platform.shape === "rect") {
    return [
      platformWorldPoint(platform, [hw, hd]),
      platformWorldPoint(platform, [-hw, hd]),
      platformWorldPoint(platform, [-hw, -hd]),
      platformWorldPoint(platform, [hw, -hd]),
    ];
  }
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return platformWorldPoint(platform, [Math.cos(angle) * hw, Math.sin(angle) * hw]);
  });
}

function platformWorldPoint(platform: MapPlatform, localPoint: [number, number]): [number, number] {
  const c = Math.cos(platform.rotation);
  const s = Math.sin(platform.rotation);
  return [platform.center[0] + localPoint[0] * c + localPoint[1] * s, platform.center[1] - localPoint[0] * s + localPoint[1] * c];
}

function moveStructureGroup(
  map: CompositionMap,
  start: StructureKey,
  delta: { x: number; z: number; y: number },
  roomPatch?: { id: string; patch: Partial<MapRoom> },
  platformPatch?: { id: string; patch: Partial<MapPlatform> },
): CompositionMap {
  const group = connectedStructureKeys(map, start);
  const rooms = map.rooms.map((room) => {
    const patch = roomPatch?.id === room.id ? roomPatch.patch : undefined;
    const base = patch ? { ...room, ...patch } : room;
    if (!group.has(roomKey(room.id))) return base;
    const currentElevation = roomElevation(map, room);
    return {
      ...base,
      center: [room.center[0] + delta.x, room.center[1] + delta.z] as [number, number],
      elevation: currentElevation + delta.y,
      attachment: undefined,
    };
  });
  const platforms = map.platforms.map((platform) => {
    const patch = platformPatch?.id === platform.id ? platformPatch.patch : undefined;
    const base = patch ? { ...platform, ...patch } : platform;
    if (!group.has(platformKey(platform.id))) return base;
    const currentElevation = platformElevation(map, platform);
    return {
      ...base,
      center: [platform.center[0] + delta.x, platform.center[1] + delta.z] as [number, number],
      elevation: currentElevation + delta.y,
      attachment: undefined,
    };
  });
  return { ...map, rooms, platforms };
}

function connectedRoomSides(map: CompositionMap, room: MapRoom): Set<RoomSide> {
  const sides = new Set<RoomSide>();
  for (const entrance of room.entrances) {
    const outer = entranceOuterPoint(room, entrance);
    const connected =
      map.rooms.some((other) => other.id !== room.id && roomContains(other, outer)) ||
      map.platforms.some((platform) => platformContains(platform, outer));
    if (connected) sides.add(entrance.side);
  }
  return sides;
}

function constrainRoomResize(map: CompositionMap, room: MapRoom, patch: Partial<MapRoom>): Partial<MapRoom> {
  if (patch.width === undefined && patch.depth === undefined) return patch;
  const sides = connectedRoomSides(map, room);
  let next = { ...patch };
  if (patch.width !== undefined) {
    const westPinned = sides.has("west");
    const eastPinned = sides.has("east");
    if (westPinned && eastPinned) next.width = room.width;
    else if (westPinned || eastPinned) next = shiftRoomForPinnedResize(room, next, "width", westPinned ? "west" : "east");
  }
  if (patch.depth !== undefined) {
    const northPinned = sides.has("north");
    const southPinned = sides.has("south");
    if (northPinned && southPinned) next.depth = room.depth;
    else if (northPinned || southPinned) next = shiftRoomForPinnedResize(room, next, "depth", northPinned ? "north" : "south");
  }
  return next;
}

function shiftRoomForPinnedResize(room: MapRoom, patch: Partial<MapRoom>, dimension: "width" | "depth", pinnedSide: RoomSide): Partial<MapRoom> {
  const nextSize = dimension === "width" ? patch.width : patch.depth;
  if (nextSize === undefined) return patch;
  const oldSize = dimension === "width" ? room.width : room.depth;
  const delta = nextSize - oldSize;
  if (delta === 0) return patch;
  const localShift: [number, number] =
    pinnedSide === "west" ? [delta / 2, 0] : pinnedSide === "east" ? [-delta / 2, 0] : pinnedSide === "north" ? [0, delta / 2] : [0, -delta / 2];
  const shifted = roomWorldPoint(room, localShift);
  return { ...patch, center: [shifted[0], shifted[1]] };
}

function pruneSelection(
  s: StoreState,
  composition: Composition,
): Pick<StoreState, "selectedId" | "selectedMapPointKey" | "selectedMapSegmentId" | "branchStartPointKey" | "selectedStart" | "selectedRoomId" | "selectedEntranceIndex" | "selectedPlatformId" | "selectedWallId" | "selectedLandmarkId"> {
  const selectedRoom = s.selectedRoomId ? composition.map.rooms.find((room) => room.id === s.selectedRoomId) : undefined;
  return {
    selectedId: s.selectedId && composition.tracks.some((t) => t.id === s.selectedId) ? s.selectedId : null,
    selectedMapPointKey:
      s.selectedMapPointKey && composition.map.segments.some((segment) => mapPointExists(segment, s.selectedMapPointKey!))
        ? s.selectedMapPointKey
        : null,
    selectedMapSegmentId:
      s.selectedMapSegmentId && composition.map.segments.some((segment) => segment.id === s.selectedMapSegmentId)
        ? s.selectedMapSegmentId
        : null,
    branchStartPointKey:
      s.branchStartPointKey && composition.map.segments.some((segment) => mapPointExists(segment, s.branchStartPointKey!))
        ? s.branchStartPointKey
        : null,
    selectedStart: s.selectedStart,
    selectedRoomId: selectedRoom ? s.selectedRoomId : null,
    selectedEntranceIndex: selectedRoom && s.selectedEntranceIndex !== null && s.selectedEntranceIndex < selectedRoom.entrances.length ? s.selectedEntranceIndex : null,
    selectedPlatformId: s.selectedPlatformId && composition.map.platforms.some((platform) => platform.id === s.selectedPlatformId) ? s.selectedPlatformId : null,
    selectedWallId: s.selectedWallId && composition.map.walls.some((wall) => wall.id === s.selectedWallId) ? s.selectedWallId : null,
    selectedLandmarkId:
      s.selectedLandmarkId && composition.environment.landmarks?.some((landmark) => landmark.id === s.selectedLandmarkId)
        ? s.selectedLandmarkId
        : null,
  };
}

function copyName(name: string, tracks: TrackDef[]): string {
  const base = `${name} copy`;
  const used = new Set(tracks.map((t) => t.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const next = `${base} ${i}`;
    if (!used.has(next)) return next;
  }
}

// How far (in map x/z units) a cloned map structure or landmark is nudged from
// its source so the copy is visible and grabbable. Because clone selects the new
// copy, repeated clones cascade diagonally instead of stacking.
const CLONE_OFFSET = 6;

function offsetCopyPosition([x, y, z]: [number, number, number], copyIndex: number): [number, number, number] {
  const angle = copyIndex * 0.9;
  return [x + Math.cos(angle) * 1.5, y, z + Math.sin(angle) * 1.5];
}

// Immutably patch one track in the current composition.
function patchTrack(comp: Composition, id: string, patch: Partial<TrackDef>): Composition {
  return touchComposition({ ...comp, tracks: comp.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

function mapPointExists(segment: { start: [number, number]; end: [number, number] }, key: string): boolean {
  return mapPointKey(segment.start) === key || mapPointKey(segment.end) === key;
}

// Keep a selected entrance index only if its room still exists and the index is
// still in range after a map edit.
function entrancePreserved(s: StoreState, nextMap: CompositionMap): boolean {
  if (s.selectedEntranceIndex === null) return false;
  const room = nextMap.rooms.find((r) => r.id === s.selectedRoomId);
  return !!room && s.selectedEntranceIndex < room.entrances.length;
}

export function moveViewToMapStart(map: CompositionMap): void {
  viewState.x = map.start.position[0];
  viewState.z = map.start.position[1];
  viewState.y = surfaceHeightAt(map, map.start.position);
  viewState.fx = map.start.direction[0];
  viewState.fz = map.start.direction[1];
}

export const useStore = create<StoreState>((set, get) => ({
  composition: defaultComposition,
  library: [],
  engine: null,
  audioLoading: { status: "idle" },
  publishProgress: null,
  undoStack: [],
  redoStack: [],
  customDetailPacks: [],
  creatorAssets: [],
  mode: "explore",
  selectedId: null,
  selectedMapPointKey: null,
  selectedMapSegmentId: null,
  branchStartPointKey: null,
  selectedStart: false,
  startGizmoMode: "translate",
  selectedRoomId: null,
  selectedEntranceIndex: null,
  selectedPlatformId: null,
  selectedWallId: null,
  selectedLandmarkId: null,
  entered: false,
  viewer: false,
  user: null,
  accountArtist: null,
  authReady: false,

  setEngine: (engine) => set({ engine }),
  setAudioLoading: (audioLoading) => set({ audioLoading }),
  setEntered: (entered) => set({ entered }),
  resetViewToMapStart: () => moveViewToMapStart(get().composition.map),
  setViewer: (viewer) => set({ viewer }),
  importDetailPack: async (file) => {
    const pack = await importDetailPackBundle(file);
    const customDetailPacks = [
      ...get().customDetailPacks.filter((candidate) => candidate.id !== pack.id),
      pack,
    ];
    registerCustomEnvironmentPacks(customDetailPacks);
    set((state) => ({
      customDetailPacks,
      ...withHistory(state, `environment:pack:${pack.id}`),
      composition: {
        ...touchComposition(state.composition),
        environment: normalizeEnvironment({
          ...state.composition.environment,
          pack: {
            id: pack.id,
            variant: pack.variants[0],
            quality: "auto",
          },
        }),
      },
    }));
  },
  removeDetailPack: async (id) => {
    await removeStoredDetailPack(id);
    const customDetailPacks = get().customDetailPacks.filter((pack) => pack.id !== id);
    registerCustomEnvironmentPacks(customDetailPacks);
    set((state) => ({
      customDetailPacks,
      ...(state.composition.environment.pack?.id === id
        ? {
            composition: {
              ...touchComposition(state.composition),
              environment: normalizeEnvironment({
                ...state.composition.environment,
                pack: undefined,
              }),
            },
          }
        : {}),
    }));
  },
  importMaterialAsset: async (input) => {
    const asset = await importCreatorMaterial(input);
    const creatorAssets = [...get().creatorAssets, asset];
    registerCreatorAssets(creatorAssets);
    set({ creatorAssets });
    return asset.id;
  },
  importLandmarkAsset: async (input) => {
    const asset = await importCreatorLandmark(input);
    const creatorAssets = [...get().creatorAssets, asset];
    registerCreatorAssets(creatorAssets);
    set({ creatorAssets });
    return asset.id;
  },
  removeCreatorAsset: async (id) => {
    await removeCreatorAssetRecord(id);
    const creatorAssets = get().creatorAssets.filter((asset) => asset.id !== id);
    registerCreatorAssets(creatorAssets);
    set((state) => {
      const surfaces = Object.fromEntries(
        Object.entries(state.composition.environment.surfaces ?? {})
          .filter(([, assetId]) => assetId !== id),
      );
      const landmarks = (state.composition.environment.landmarks ?? [])
        .filter((landmark) => landmark.assetId !== id);
      return {
        creatorAssets,
        ...withHistory(state, `creator-asset:${id}:remove`),
        composition: {
          ...touchComposition(state.composition),
          environment: normalizeEnvironment({
            ...state.composition.environment,
            surfaces,
            landmarks,
          }),
        },
        selectedLandmarkId: landmarks.some(
          (landmark) => landmark.id === state.selectedLandmarkId,
        ) ? state.selectedLandmarkId : null,
      };
    });
  },

  initAuth: () => {
    getCurrentUser()
      .then(async (user) => {
        set({
          user,
          accountArtist: user ? await getAccountArtist() : null,
          authReady: true,
        });
      })
      .catch((error) => {
        console.error("Failed to initialize authentication", error);
        set({ user: null, accountArtist: null, authReady: true });
      });
    onAuthChange(async (user) => {
      try {
        set({
          user,
          accountArtist: user ? await getAccountArtist() : null,
          authReady: true,
        });
      } catch (error) {
        console.error("Failed to load account artist", error);
        set({ user, accountArtist: null, authReady: true });
      }
    });
  },
  signIn: (email) => signInWithEmail(email),
  signOut: async () => {
    await cloudSignOut();
    set({ user: null, accountArtist: null });
  },
  createAccountArtist: async (name) => {
    const accountArtist = await ensureArtistForCurrentUser(name);
    set({ accountArtist });
  },

  publishCurrent: async () => {
    set({
      publishProgress: {
        completed: 0,
        total: get().composition.tracks.length + 3,
        label: "Preparing publish",
      },
    });
    try {
      const published = await publishComposition(
        get().composition,
        (publishProgress) => set({ publishProgress }),
      );
      const publishedAt = new Date().toISOString();
      const composition = {
        ...get().composition,
        artist: published.artist,
        artistId: published.artistId,
        artistSlug: published.artistSlug,
        artistAvatarUrl: published.artistAvatarUrl,
        artistAvatarEmailHash: published.artistAvatarEmailHash,
        publishedId: published.id,
      };
      composition.publishedRevision = compositionRevision(composition);
      composition.publishedAt = publishedAt;
      const library = upsert(get().library, serializeComposition(composition));
      set({ composition, library });
      persistLibrary(library, composition.id);
    } finally {
      set({ publishProgress: null });
    }
  },

  unpublishComposition: async (compId) => {
    const s = get();
    const entry = compId === s.composition.id ? serializeComposition(s.composition) : s.library.find((c) => c.id === compId);
    if (entry?.publishedId) await cloudUnpublish(entry.publishedId);
    const composition =
      s.composition.id === compId
        ? { ...s.composition, publishedId: undefined, publishedRevision: undefined, publishedAt: undefined }
        : s.composition;
    const library = s.library.map((c) => (c.id === compId ? { ...c, publishedId: undefined, publishedRevision: undefined, publishedAt: undefined } : c));
    set({ composition, library });
    persistLibrary(library, composition.id);
  },

  // Boot the audio engine for the current composition (idempotent). Used by both
  // the editor entry and the read-only viewer; needs a prior user gesture.
  startAudio: async () => {
    if (get().engine || get().audioLoading.status === "loading") return;
    const e = new AudioEngine();
    const total = get().composition.tracks.length;
    set({ audioLoading: { status: "loading", loaded: 0, total, phase: "preparing" } });
    try {
      await e.ctx.resume();
      await e.load(get().composition, (progress) => set({ audioLoading: { status: "loading", ...progress } }));
      e.start();
      set({ engine: e, audioLoading: { status: "idle" } });
    } catch (err) {
      e.dispose();
      const message = err instanceof Error ? err.message : "Audio couldn't be loaded.";
      set({ audioLoading: { status: "error", message } });
      throw err;
    }
  },

  // Leaving edit mode clears the selection (the properties panel is edit-only).
  setMode: (mode) =>
    set((s) => {
      if (s.mode === "explore" && mode === "edit") {
        const [x, z] = pointInOriginalTile(s.composition.map, [viewState.x, viewState.z]);
        viewState.x = x;
        viewState.z = z;
      }

      return {
        mode,
        selectedId: mode === "edit" ? s.selectedId : null,
        selectedStart: mode === "edit" ? s.selectedStart : false,
        selectedRoomId: mode === "edit" ? s.selectedRoomId : null,
        selectedEntranceIndex: mode === "edit" ? s.selectedEntranceIndex : null,
        selectedPlatformId: mode === "edit" ? s.selectedPlatformId : null,
        selectedWallId: mode === "edit" ? s.selectedWallId : null,
        selectedLandmarkId: mode === "edit" ? s.selectedLandmarkId : null,
      };
    }),
  toggleMode: () => get().setMode(get().mode === "edit" ? "explore" : "edit"),
  select: (selectedId) => set({ selectedId, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null }),
  selectMapPoint: (selectedMapPointKey) => set({ selectedMapPointKey, selectedMapSegmentId: null, selectedId: null, selectedStart: false, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null }),
  moveMapPoint: (key, point, elevation) =>
    set((s) => {
      if (!s.composition.map.segments.some((segment) => mapPointExists(segment, key))) return s;
      const connected = connectMapPoint(s.composition.map, key, point, elevation);
      const nextKey = mapPointKey(connected.point);
      const elevations = { ...(connected.map.elevations ?? {}) };
      if (key !== nextKey) delete elevations[key];
      if (connected.elevation === 0) delete elevations[nextKey];
      else elevations[nextKey] = connected.elevation;
      const nextMap = normalizeMap({
        ...connected.map,
        preset: "custom",
        segments: connected.map.segments.map((segment) => ({
          ...segment,
          start: mapPointKey(segment.start) === key ? connected.point : segment.start,
          end: mapPointKey(segment.end) === key ? connected.point : segment.end,
        })),
        elevations,
      });
      return {
        ...withHistory(s, "map:elevations,preset,segments"),
        composition: {
          ...touchComposition(s.composition),
          map: nextMap,
        },
        selectedMapPointKey: nextKey,
        branchStartPointKey: s.branchStartPointKey === key ? null : s.branchStartPointKey,
      };
    }),
  selectMapSegment: (selectedMapSegmentId) => set({ selectedMapSegmentId, selectedMapPointKey: null, selectedId: null, branchStartPointKey: null, selectedStart: false, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null }),
  setBranchStartPoint: (branchStartPointKey) => set({ branchStartPointKey, selectedMapPointKey: branchStartPointKey, selectedMapSegmentId: null, selectedId: null, selectedStart: false, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null }),
  selectStart: () => set({ selectedStart: true, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null }),
  setStartGizmoMode: (startGizmoMode) => set({ startGizmoMode }),

  selectLandmark: (selectedLandmarkId) =>
    set({
      selectedLandmarkId,
      selectedId: null,
      selectedMapPointKey: null,
      selectedMapSegmentId: null,
      branchStartPointKey: null,
      selectedStart: false,
      selectedRoomId: null,
      selectedEntranceIndex: null,
      selectedPlatformId: null,
      selectedWallId: null,
    }),
  addLandmark: (assetId) => {
    const state = get();
    const x = viewState.x;
    const z = viewState.z;
    const creatorAsset = state.creatorAssets.find(
      (asset) => asset.kind === "landmark" && asset.id === assetId,
    );
    const pack = environmentPackById(state.composition.environment.pack?.id);
    const packId = pack?.landmarks.some((landmark) => landmark.id === assetId)
      ? pack.id
      : undefined;
    const scale = creatorAsset?.kind === "landmark" ? creatorAsset.defaultScale : 1;
    const landmark: EnvironmentLandmarkPlacement = {
      id: newId(),
      assetId,
      ...(packId ? { packId } : {}),
      position: [x, surfaceHeightAt(state.composition.map, [x, z]), z],
      rotation: [0, 0, 0],
      scale: [scale, scale, scale],
    };
    set((s) => ({
      ...withHistory(s, `landmark:${landmark.id}:add`),
      composition: {
        ...touchComposition(s.composition),
        environment: normalizeEnvironment({
          ...s.composition.environment,
          landmarks: [...(s.composition.environment.landmarks ?? []), landmark],
        }),
      },
      selectedLandmarkId: landmark.id,
      selectedId: null,
      selectedMapPointKey: null,
      selectedMapSegmentId: null,
      branchStartPointKey: null,
      selectedStart: false,
      selectedRoomId: null,
      selectedEntranceIndex: null,
      selectedPlatformId: null,
      selectedWallId: null,
      mode: "edit",
    }));
  },
  updateLandmark: (id, patch) =>
    set((s) => ({
      ...withHistory(s, `landmark:${id}:${Object.keys(patch).sort().join(",")}`),
      composition: {
        ...touchComposition(s.composition),
        environment: normalizeEnvironment({
          ...s.composition.environment,
          landmarks: (s.composition.environment.landmarks ?? []).map((landmark) =>
            landmark.id === id ? { ...landmark, ...patch } : landmark,
          ),
        }),
      },
    })),
  deleteLandmark: (id) =>
    set((s) => ({
      ...withHistory(s, `landmark:${id}:delete`),
      composition: {
        ...touchComposition(s.composition),
        environment: normalizeEnvironment({
          ...s.composition.environment,
          landmarks: (s.composition.environment.landmarks ?? []).filter((landmark) => landmark.id !== id),
        }),
      },
      selectedLandmarkId: s.selectedLandmarkId === id ? null : s.selectedLandmarkId,
    })),
  duplicateLandmark: (id) => {
    const state = get();
    const landmarks = state.composition.environment.landmarks ?? [];
    const source = landmarks.find((landmark) => landmark.id === id);
    if (!source) return;
    const nx = source.position[0] + CLONE_OFFSET;
    const nz = source.position[2] + CLONE_OFFSET;
    const copy: EnvironmentLandmarkPlacement = {
      ...source,
      id: newId(),
      position: [nx, source.position[1], nz],
      rotation: [...source.rotation],
      scale: [...source.scale],
    };
    set((s) => ({
      ...withHistory(s, `landmark:${copy.id}:duplicate`),
      composition: {
        ...touchComposition(s.composition),
        environment: normalizeEnvironment({
          ...s.composition.environment,
          landmarks: [...(s.composition.environment.landmarks ?? []), copy],
        }),
      },
      selectedLandmarkId: copy.id,
      selectedId: null,
      selectedMapPointKey: null,
      selectedMapSegmentId: null,
      branchStartPointKey: null,
      selectedStart: false,
      selectedRoomId: null,
      selectedEntranceIndex: null,
      selectedPlatformId: null,
      selectedWallId: null,
      mode: "edit",
    }));
  },

  selectRoom: (selectedRoomId) =>
    set({ selectedRoomId, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false }),

  addRoom: () => {
    const map = get().composition.map;
    const forward = viewState.fz >= 0 ? 1 : -1;
    const room: MapRoom = {
      id: newId(),
      center: [viewState.x, viewState.z],
      rotation: 0,
      width: 14,
      depth: 12,
      height: DEFAULT_ENCLOSURE_HEIGHT,
      elevation: surfaceHeightAt(map, [viewState.x, viewState.z]),
      // Face the doorway toward the edit camera's horizontal look direction.
      entrances: [{ side: forward > 0 ? "south" : "north", width: 5, offset: 0 }],
    };
    get().setMap({ rooms: [...map.rooms, room] });
    set({ selectedRoomId: room.id, selectedId: null, selectedMapSegmentId: null, selectedMapPointKey: null, selectedStart: false });
  },

  updateRoom: (id, patch) => {
    const map = normalizeMap(get().composition.map);
    const room = map.rooms.find((r) => r.id === id);
    if (!room) return;
    const constrainedPatch = constrainRoomResize(map, room, patch);
    const isMove = patch.center !== undefined || patch.elevation !== undefined;
    const movedGroup = isMove ? connectedStructureKeys(map, roomKey(id)) : new Set<StructureKey>();
    const nextRoomMap = isMove
      ? moveStructureGroup(
          map,
          roomKey(id),
          {
            x: (patch.center?.[0] ?? room.center[0]) - room.center[0],
            z: (patch.center?.[1] ?? room.center[1]) - room.center[1],
            y: (patch.elevation ?? roomElevation(map, room)) - roomElevation(map, room),
          },
          { id, patch: constrainedPatch },
        )
      : { ...map, rooms: map.rooms.map((r) => (r.id === id ? { ...r, ...constrainedPatch } : r)) };
    const nextMap = normalizeMap(nextRoomMap);
    const movedElevations = moveEndpointElevations(map.elevations, movedSegmentEndpoints(map.segments, nextMap.segments));
    const elevations = isMove ? setConnectedGroupEndpointElevations(movedElevations, nextMap, movedGroup) : setConnectedEndpointElevations(movedElevations, nextMap.segments, "room", id, patch.elevation);
    get().setMap({ ...nextMap, elevations });
  },

  deleteRoom: (id) => {
    const map = get().composition.map;
    get().setMap({ rooms: map.rooms.filter((room) => room.id !== id) });
    if (get().selectedRoomId === id) set({ selectedRoomId: null, selectedEntranceIndex: null });
  },

  // Clone a room as a detached, nearby copy (drops any path attachment so the
  // copy doesn't claim the source's branch point) and select it.
  duplicateRoom: (id) => {
    const map = normalizeMap(get().composition.map);
    const room = map.rooms.find((r) => r.id === id);
    if (!room) return;
    const { attachment: _attachment, ...rest } = room;
    const copy: MapRoom = {
      ...rest,
      id: newId(),
      center: [room.center[0] + CLONE_OFFSET, room.center[1] + CLONE_OFFSET],
      elevation: roomElevation(map, room),
      entrances: room.entrances.map((entrance) => ({ ...entrance })),
    };
    get().setMap({ rooms: [...map.rooms, copy] });
    set({ selectedRoomId: copy.id, selectedEntranceIndex: null, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false });
  },

  selectEntrance: (roomId, index) =>
    set({ selectedRoomId: roomId, selectedEntranceIndex: index, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false }),

  addEntrance: (roomId, side) => {
    const map = get().composition.map;
    const room = map.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const entrances: RoomEntrance[] = [...room.entrances, { side, width: 5, offset: 0 }];
    get().updateRoom(roomId, { entrances });
    set({ selectedRoomId: roomId, selectedEntranceIndex: entrances.length - 1, selectedPlatformId: null, selectedWallId: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, selectedStart: false });
  },

  updateEntrance: (roomId, index, patch) => {
    const map = get().composition.map;
    const room = map.rooms.find((r) => r.id === roomId);
    if (!room) return;
    get().updateRoom(roomId, { entrances: room.entrances.map((e, i) => (i === index ? { ...e, ...patch } : e)) });
  },

  removeEntrance: (roomId, index) => {
    const map = get().composition.map;
    const room = map.rooms.find((r) => r.id === roomId);
    if (!room || room.entrances.length <= 1) return;
    get().updateRoom(roomId, { entrances: room.entrances.filter((_, i) => i !== index) });
    if (get().selectedRoomId === roomId && get().selectedEntranceIndex === index) set({ selectedEntranceIndex: null });
  },

  growFromEntrance: (roomId, index, kind) => {
    const map = get().composition.map;
    const room = map.rooms.find((r) => r.id === roomId);
    const entrance = room?.entrances[index];
    if (!room || !entrance) return;

    const start = entranceDoorwayCenter(room, entrance);
    const outer = entranceOuterPoint(room, entrance);
    const dir = unitDir([outer[0] - start[0], outer[1] - start[1]]);

    let selection: Partial<StoreState> = {};
    const rooms = [...map.rooms];
    const platforms = [...map.platforms];
    const segments = [...map.segments];
    let elevations = map.elevations;

    if (kind === "room") {
      const id = newId();
      const width = 14;
      const depth = 12;
      rooms.push({
        id,
        center: [start[0] + dir[0] * (depth / 2), start[1] + dir[1] * (depth / 2)],
        rotation: Math.atan2(dir[0], dir[1]),
        width,
        depth,
        height: room.height,
        elevation: roomElevation(map, room),
        entrances: [{ side: "north", width: Math.min(width, Math.max(5, entrance.width)), offset: 0 }],
      });
      selection = { selectedRoomId: id, selectedEntranceIndex: null };
    } else if (kind === "platform") {
      const id = newId();
      const depth = 18;
      platforms.push({
        id,
        center: [start[0] + dir[0] * (depth / 2), start[1] + dir[1] * (depth / 2)],
        rotation: Math.atan2(dir[0], dir[1]),
        shape: "rect",
        width: 18,
        depth,
        elevation: roomElevation(map, room),
      });
      selection = { selectedPlatformId: id };
    } else {
      // Seed a path stub at the doorway, aimed straight out of the wall.
      const end: [number, number] = [start[0] + dir[0] * 14, start[1] + dir[1] * 14];
      const width = Math.min(14, Math.max(4, entrance.width));
      const segment: WalkableSegment = {
        id: newId(),
        start,
        end,
        width,
        connections: { start: { kind: "room", roomId: room.id, localPoint: entranceLocalCenter(room, entrance), entranceIndex: index, entranceOffset: entrance.offset } },
      };
      segments.push(segment);
      // Match the new path to the room's height so they stay flush.
      const elev = roomElevation(map, room);
      elevations = elev ? { ...(map.elevations ?? {}), [mapPointKey(start)]: elev, [mapPointKey(end)]: elev } : map.elevations;
      selection = { selectedMapPointKey: mapPointKey(end) };
    }

    get().setMap({ preset: "custom", segments, rooms, platforms, elevations });
    set({
      selectedRoomId: null,
      selectedEntranceIndex: null,
      selectedPlatformId: null,
      selectedWallId: null,
      selectedId: null,
      selectedMapSegmentId: null,
      selectedMapPointKey: null,
      branchStartPointKey: null,
      selectedStart: false,
      ...selection,
    });
  },

  selectPlatform: (selectedPlatformId) =>
    set({ selectedPlatformId, selectedWallId: null, selectedLandmarkId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false }),

  // Attach a platform to a terminal path point; alignment positions it just
  // past that point so its near edge meets the path.
  addPlatformAtPoint: (pointKey) => {
    const map = get().composition.map;
    if (!canAddPlatformAtPoint(map, pointKey)) return;
    const attachment = attachmentForPoint(map, pointKey);
    if (!attachment) return;
    const platform: MapPlatform = {
      id: newId(),
      center: [0, 0],
      rotation: 0,
      shape: "rect",
      width: 18,
      depth: 18,
      elevation: 0,
      attachment,
    };
    get().setMap({ preset: "custom", platforms: [...map.platforms, platform] });
    set({ selectedPlatformId: platform.id, selectedWallId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedId: null, selectedMapSegmentId: null, selectedMapPointKey: null, branchStartPointKey: null, selectedStart: false });
  },

  updatePlatform: (id, patch) => {
    const map = normalizeMap(get().composition.map);
    const platform = map.platforms.find((p) => p.id === id);
    if (!platform) return;
    const isMove = patch.center !== undefined || patch.elevation !== undefined;
    const movedGroup = isMove ? connectedStructureKeys(map, platformKey(id)) : new Set<StructureKey>();
    const nextPlatformMap = isMove
      ? moveStructureGroup(
          map,
          platformKey(id),
          {
            x: (patch.center?.[0] ?? platform.center[0]) - platform.center[0],
            z: (patch.center?.[1] ?? platform.center[1]) - platform.center[1],
            y: (patch.elevation ?? platformElevation(map, platform)) - platformElevation(map, platform),
          },
          undefined,
          { id, patch },
        )
      : { ...map, preset: "custom" as const, platforms: map.platforms.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    const nextMap = normalizeMap(nextPlatformMap);
    const elevations = moveEndpointElevations(map.elevations, movedSegmentEndpoints(map.segments, nextMap.segments));
    const nextElevations = isMove ? setConnectedGroupEndpointElevations(elevations, nextMap, movedGroup) : setConnectedEndpointElevations(elevations, nextMap.segments, "platform", id, patch.elevation);
    get().setMap({ ...nextMap, elevations: nextElevations });
  },

  deletePlatform: (id) => {
    const map = get().composition.map;
    get().setMap({ preset: "custom", platforms: map.platforms.filter((platform) => platform.id !== id) });
    if (get().selectedPlatformId === id) set({ selectedPlatformId: null });
  },

  // Clone a platform as a detached, nearby copy and select it.
  duplicatePlatform: (id) => {
    const map = normalizeMap(get().composition.map);
    const platform = map.platforms.find((p) => p.id === id);
    if (!platform) return;
    const { attachment: _attachment, ...rest } = platform;
    const copy: MapPlatform = {
      ...rest,
      id: newId(),
      center: [platform.center[0] + CLONE_OFFSET, platform.center[1] + CLONE_OFFSET],
      elevation: platformElevation(map, platform),
    };
    get().setMap({ preset: "custom", platforms: [...map.platforms, copy] });
    set({ selectedPlatformId: copy.id, selectedWallId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false });
  },

  selectWall: (selectedWallId) =>
    set({ selectedWallId, selectedPlatformId: null, selectedLandmarkId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false }),

  addWall: () => {
    const map = get().composition.map;
    const facingLength = Math.hypot(viewState.fx, viewState.fz) || 1;
    const facing: [number, number] = [viewState.fx / facingLength, viewState.fz / facingLength];
    const perp: [number, number] = [-facing[1], facing[0]];
    const wall: MapWall = {
      id: newId(),
      start: [viewState.x - perp[0] * 4, viewState.z - perp[1] * 4],
      end: [viewState.x + perp[0] * 4, viewState.z + perp[1] * 4],
      height: DEFAULT_ENCLOSURE_HEIGHT,
      elevation: surfaceHeightAt(map, [viewState.x, viewState.z]),
    };
    get().setMap({ preset: "custom", walls: [...map.walls, wall] });
    set({ selectedWallId: wall.id, selectedPlatformId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedId: null, selectedMapSegmentId: null, selectedMapPointKey: null, selectedStart: false });
  },

  updateWall: (id, patch) => {
    const map = get().composition.map;
    get().setMap({ preset: "custom", walls: map.walls.map((wall) => (wall.id === id ? { ...wall, ...patch } : wall)) });
  },

  deleteWall: (id) => {
    const map = get().composition.map;
    get().setMap({ preset: "custom", walls: map.walls.filter((wall) => wall.id !== id) });
    if (get().selectedWallId === id) set({ selectedWallId: null });
  },

  // Clone a wall as a nearby copy and select it.
  duplicateWall: (id) => {
    const map = get().composition.map;
    const wall = map.walls.find((w) => w.id === id);
    if (!wall) return;
    const copy: MapWall = {
      ...wall,
      id: newId(),
      start: [wall.start[0] + CLONE_OFFSET, wall.start[1] + CLONE_OFFSET],
      end: [wall.end[0] + CLONE_OFFSET, wall.end[1] + CLONE_OFFSET],
    };
    get().setMap({ preset: "custom", walls: [...map.walls, copy] });
    set({ selectedWallId: copy.id, selectedPlatformId: null, selectedRoomId: null, selectedEntranceIndex: null, selectedLandmarkId: null, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false });
  },

  // Create a room whose doorway is centered on the given path point and aligned
  // so the incoming path runs perpendicular to (straight into) the entrance wall.
  addRoomAtPoint: (pointKey) => {
    const map = get().composition.map;
    if (!canAddRoomAtPoint(map, pointKey)) return;
    const attachment = attachmentForPoint(map, pointKey);
    if (!attachment) return;

    const width = 14;
    const depth = 12;
    const room: MapRoom = {
      id: newId(),
      center: [0, 0],
      rotation: 0,
      width,
      depth,
      height: DEFAULT_ENCLOSURE_HEIGHT,
      entrances: [{ side: "north", width: 5, offset: 0 }],
      attachment,
    };
    get().setMap({ rooms: [...map.rooms, room] });
    set({ selectedRoomId: room.id, selectedMapPointKey: null, selectedMapSegmentId: null, selectedId: null, selectedStart: false, branchStartPointKey: null });
  },

  deleteMapPoint: (pointKey) => {
    const map = get().composition.map;
    const deletedSegmentIds = new Set(map.segments.filter((s) => mapPointKey(s.start) === pointKey || mapPointKey(s.end) === pointKey).map((s) => s.id));
    get().setMap({
      preset: "custom",
      segments: map.segments.filter((s) => mapPointKey(s.start) !== pointKey && mapPointKey(s.end) !== pointKey),
      rooms: map.rooms.filter((room) => !room.attachment || !deletedSegmentIds.has(room.attachment.segmentId)),
      platforms: map.platforms.filter((platform) => !platform.attachment || !deletedSegmentIds.has(platform.attachment.segmentId)),
    });
    set({ selectedMapPointKey: null, branchStartPointKey: null, selectedRoomId: null, selectedEntranceIndex: null, selectedPlatformId: null });
  },

  // Grow the path: add a new segment extending from the point, and select the
  // new endpoint so it can be dragged into place.
  addBranchAtPoint: (pointKey) => {
    const map = get().composition.map;
    if (!canAddBranchAtPoint(map, pointKey)) return;
    let point: [number, number] | null = null;
    let dir: [number, number] = [0, -1];
    let width = map.segments.length ? map.segments.reduce((sum, s) => sum + s.width, 0) / map.segments.length : 7.5;
    for (const seg of map.segments) {
      if (mapPointKey(seg.start) === pointKey) {
        point = seg.start;
        dir = unitDir([seg.start[0] - seg.end[0], seg.start[1] - seg.end[1]]);
        width = seg.width;
        break;
      }
      if (mapPointKey(seg.end) === pointKey) {
        point = seg.end;
        dir = unitDir([seg.end[0] - seg.start[0], seg.end[1] - seg.start[1]]);
        width = seg.width;
        break;
      }
    }
    if (!point) return;
    const end: [number, number] = [point[0] + dir[0] * 12, point[1] + dir[1] * 12];
    const segment = { id: newId(), start: point, end, width };
    const sourceElevation = map.elevations?.[pointKey] ?? 0;
    const elevations = sourceElevation
      ? { ...(map.elevations ?? {}), [mapPointKey(end)]: sourceElevation }
      : map.elevations;
    get().setMap({ preset: "custom", segments: [...map.segments, segment], elevations });
    set({ selectedMapPointKey: mapPointKey(end), selectedRoomId: null, selectedEntranceIndex: null, selectedId: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false });
  },

  setTrackVolume: (id, volume) => {
    set((s) => ({ ...withHistory(s, `track:${id}:volume`), composition: patchTrack(s.composition, id, { volume }) }));
    get().engine?.setVolume(id, volume);
  },

  setTrackMinVolume: (id, minVolume) => {
    set((s) => ({ ...withHistory(s, `track:${id}:minVolume`), composition: patchTrack(s.composition, id, { minVolume }) }));
    get().engine?.setMinVolume(id, minVolume);
  },

  setTrackPosition: (id, position) => {
    set((s) => ({ ...withHistory(s, `track:${id}:position`), composition: patchTrack(s.composition, id, { position }) }));
    get().engine?.setPosition(id, position);
  },

  setTrackFalloff: (id, falloff) => {
    set((s) => ({ ...withHistory(s, `track:${id}:falloff`), composition: patchTrack(s.composition, id, falloff) }));
    get().engine?.setFalloff(id, falloff);
  },

  setTrackLoop: (id, loop) => {
    const patch: Partial<TrackDef> = {};
    if ("loopStart" in loop) patch.loopStart = loop.loopStart ?? undefined;
    if ("loopEnd" in loop) patch.loopEnd = loop.loopEnd ?? undefined;
    if ("loopRepeat" in loop) patch.loopRepeat = loop.loopRepeat;
    set((s) => ({ ...withHistory(s, `track:${id}:loop`), composition: patchTrack(s.composition, id, patch) }));
    get().engine?.setTrackLoop(id, loop);
  },
  trackPeaks: (id, bins) => get().engine?.trackPeaks(id, bins) ?? null,
  setTrackDirectivity: (id, directivity) => {
    set((s) => ({
      ...withHistory(s, `track:${id}:directivity`),
      composition: patchTrack(s.composition, id, { directivity }),
    }));
    get().engine?.setDirectivity(id, directivity);
  },

  // Name and color are presentation-only — no audio side effects.
  renameTrack: (id, name) => set((s) => ({ ...withHistory(s, `track:${id}:name`), composition: patchTrack(s.composition, id, { name }) })),
  setTrackColor: (id, color) => set((s) => ({ ...withHistory(s, `track:${id}:color`), composition: patchTrack(s.composition, id, { color }) })),

  deleteTrack: (id) => {
    const track = get().composition.tracks.find((t) => t.id === id);
    // Keep uploaded blob URLs/stored audio alive for the undo stack. Composition
    // deletion still removes persisted stems.
    if (!track) return;
    get().engine?.removeTrack(id);
    markerObjects.delete(id);
    set((s) => ({
      ...withHistory(s, `track:${id}:delete`),
      composition: touchComposition({ ...s.composition, tracks: s.composition.tracks.filter((t) => t.id !== id) }),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  duplicateTrack: async (id) => {
    const { composition, engine } = get();
    const source = composition.tracks.find((t) => t.id === id);
    if (!source) return;

    const copyId = newId();
    const { hash: _hash, ...copyable } = source;
    const def: TrackDef = {
      ...copyable,
      id: copyId,
      audioAssetId: source.source.kind === "file" && source.source.url.startsWith("blob:")
        ? audioAssetKey(source)
        : source.audioAssetId,
      name: copyName(source.name, composition.tracks),
      position: offsetCopyPosition(source.position, composition.tracks.length),
    };

    engine?.duplicateLiveTrack(source.id, def);
    set((s) => ({
      ...withHistory(s, `track:${id}:duplicate`),
      composition: touchComposition({ ...s.composition, tracks: [...s.composition.tracks, def] }),
      selectedId: copyId,
      selectedMapPointKey: null,
      selectedMapSegmentId: null,
      branchStartPointKey: null,
      selectedStart: false,
      mode: "edit",
    }));
  },

  // Decode an uploaded audio file, add it as a track to the playing
  // composition (phase-aligned), drop it near center, and select it so the
  // user can immediately position and tune it.
  addStem: async (file) => {
    const engine = get().engine;
    if (!engine) throw new Error("Audio engine not ready");
    const buffer = await engine.decode(await file.arrayBuffer());
    const id = newId();
    // Persist the raw audio so the composition survives a reload.
    stemPut(id, file).catch((err) => console.error("Failed to store stem", err));
    // Spawn at the center of the view (with a little jitter so repeated adds
    // don't stack exactly on top of each other), floating above the surface.
    const spawnX = viewState.x + (Math.random() * 2 - 1) * 0.8;
    const spawnZ = viewState.z + (Math.random() * 2 - 1) * 0.8;
    const def: TrackDef = {
      id,
      audioAssetId: id,
      name: stripExt(file.name),
      color: randomColor(),
      position: [spawnX, surfaceHeightAt(get().composition.map, [spawnX, spawnZ]) + 1.5, spawnZ],
      volume: 1,
      source: { kind: "file", url: URL.createObjectURL(file) },
    };
    engine.addLiveTrack(def, buffer);
    set((s) => ({
      ...withHistory(s, `track:${id}:add`),
      composition: touchComposition({ ...s.composition, tracks: [...s.composition.tracks, def] }),
      selectedId: id,
      mode: "edit",
    }));
  },

  setLoopSettings: (settings) => {
    set((s) => {
      const composition = touchComposition({ ...s.composition, ...settings });
      s.engine?.updateLoopSettings(composition);
      return { ...withHistory(s, `loop:${Object.keys(settings).sort().join(",")}`), composition };
    });
  },
  auditionLoopSeam: () => get().engine?.auditionSeam(),
  loopProgress: () => get().engine?.loopProgress() ?? null,
  setEnvironment: (environment) =>
    set((s) => ({
      ...withHistory(s, `environment:${Object.keys(environment).sort().join(",")}`),
      composition: {
        ...touchComposition(s.composition),
        environment: normalizeEnvironment({ ...s.composition.environment, ...environment }),
      },
    })),
  setMap: (map, options) =>
    set((s) => {
      const nextMap = normalizeMap({ ...s.composition.map, ...map });
      const selectedMapPointKey = s.selectedMapPointKey;
      const selectedMapSegmentId = s.selectedMapSegmentId;
      const branchStartPointKey = s.branchStartPointKey;
      if (options?.moveViewToStart) moveViewToMapStart(nextMap);
      return {
        ...withHistory(s, `map:${Object.keys(map).sort().join(",")}`),
        composition: {
          ...touchComposition(s.composition),
          map: nextMap,
        },
        selectedMapPointKey:
          selectedMapPointKey && nextMap.segments.some((segment) => mapPointExists(segment, selectedMapPointKey))
            ? selectedMapPointKey
            : null,
        selectedMapSegmentId:
          selectedMapSegmentId && nextMap.segments.some((segment) => segment.id === selectedMapSegmentId)
            ? selectedMapSegmentId
            : null,
        branchStartPointKey:
          branchStartPointKey && nextMap.segments.some((segment) => mapPointExists(segment, branchStartPointKey))
            ? branchStartPointKey
            : null,
        selectedRoomId: s.selectedRoomId && nextMap.rooms.some((room) => room.id === s.selectedRoomId) ? s.selectedRoomId : null,
        selectedEntranceIndex: entrancePreserved(s, nextMap) ? s.selectedEntranceIndex : null,
        selectedPlatformId: s.selectedPlatformId && nextMap.platforms.some((platform) => platform.id === s.selectedPlatformId) ? s.selectedPlatformId : null,
        selectedWallId: s.selectedWallId && nextMap.walls.some((wall) => wall.id === s.selectedWallId) ? s.selectedWallId : null,
      };
    }),

  undo: async () => {
    const s = get();
    const previous = s.undoStack[s.undoStack.length - 1];
    if (!previous) return;
    clearHistoryMarkers();
    const composition = touchComposition(cloneComposition(previous));
    set({
      composition,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: pushRedo(s.redoStack, s.composition),
      ...pruneSelection(s, composition),
    });
    await get().engine?.replaceComposition(composition);
  },

  redo: async () => {
    const s = get();
    const next = s.redoStack[s.redoStack.length - 1];
    if (!next) return;
    clearHistoryMarkers();
    const composition = touchComposition(cloneComposition(next));
    set({
      composition,
      undoStack: [...s.undoStack, cloneComposition(s.composition)].slice(-HISTORY_LIMIT),
      redoStack: s.redoStack.slice(0, -1),
      ...pruneSelection(s, composition),
    });
    await get().engine?.replaceComposition(composition);
  },

  // Load the saved library (or seed/migrate) and resolve the current composition.
  initLibrary: async () => {
    const [customDetailPacks, creatorAssets] = await Promise.all([
      loadStoredDetailPacks(),
      loadCreatorAssets(),
    ]);
    registerCustomEnvironmentPacks(customDetailPacks);
    const { library, currentId } = loadLibrary();
    const current = library.find((c) => c.id === currentId) ?? library[0];
    const composition = current ? await resolveComposition(current) : get().composition;
    moveViewToMapStart(composition.map);
    clearHistoryMarkers();
    set({ library, composition, customDetailPacks, creatorAssets, undoStack: [], redoStack: [] });
  },

  // Switch the current composition. The outgoing one is flushed back into the
  // library (it's kept, not discarded) and its object URLs freed.
  selectComposition: async (id) => {
    const { composition, library } = get();
    if (id === composition.id) return;
    const flushed = upsert(library, serializeComposition(composition));
    revokeBlobUrls(composition);
    const target = flushed.find((c) => c.id === id);
    if (!target) return;
    const resolved = await resolveComposition(target);
    moveViewToMapStart(resolved.map);
    clearHistoryMarkers();
    set({ library: flushed, composition: resolved, selectedId: null, undoStack: [], redoStack: [] });
    persistLibrary(flushed, id);
  },

  // Start a fresh empty composition, keeping the current one in the library.
  newComposition: (meta) => {
    const { composition, library } = get();
    const now = new Date().toISOString();
    const { landmarks: _landmarks, ...environment } = composition.environment;
    revokeBlobUrls(composition);
    const comp: Composition = {
      id: newId(),
      title: meta.title.trim() || "Untitled",
      artist: get().accountArtist?.artist ?? meta.artist?.trim() ?? "Unknown",
      artistId: get().accountArtist?.artistId,
      artistSlug: get().accountArtist?.artistSlug,
      artistAvatarUrl: get().accountArtist?.artistAvatarUrl,
      artistAvatarEmailHash: get().accountArtist?.artistAvatarEmailHash,
      bpm: meta.bpm || 120,
      environment,
      map: normalizeMap(MAP_PRESETS.line),
      tracks: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    clearHistoryMarkers();
    set({
      composition: comp,
      selectedId: null,
      selectedLandmarkId: null,
      library: next,
      undoStack: [],
      redoStack: [],
    });
    persistLibrary(next, comp.id);
  },

  // Load an exported bundle as a new composition in the library and switch to it.
  importComposition: async (file) => {
    const comp = normalizeComposition(await importBundle(file));
    const [customDetailPacks, creatorAssets] = await Promise.all([
      loadStoredDetailPacks(),
      loadCreatorAssets(),
    ]);
    registerCustomEnvironmentPacks(customDetailPacks);
    const { composition, library } = get();
    revokeBlobUrls(composition);
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    clearHistoryMarkers();
    set({
      composition: comp,
      selectedId: null,
      selectedLandmarkId: null,
      customDetailPacks,
      creatorAssets,
      library: next,
      undoStack: [],
      redoStack: [],
    });
    persistLibrary(next, comp.id);
  },

  renameComposition: (id, title) => {
    const t = title.trim() || "Untitled";
    const library = get().library.map((c) => (c.id === id ? touchComposition({ ...c, title: t }) : c));
    set((s) => ({
      ...(s.composition.id === id ? withHistory(s, `composition:${id}:title`) : null),
      library,
      composition: s.composition.id === id ? touchComposition({ ...s.composition, title: t }) : s.composition,
    }));
    persistLibrary(library, get().composition.id);
  },

  duplicateComposition: async (id) => {
    const source = get().library.find((c) => c.id === id);
    if (!source) return;
    const copy = await copyComposition(source);
    const library = [...get().library, copy];
    set({ library });
    persistLibrary(library, get().composition.id);
  },

  // Delete a composition and its stored stems. If it was current, switch to
  // another (or a fresh empty one if the library is now empty).
  deleteComposition: async (id) => {
    const { composition, library } = get();
    const target = library.find((c) => c.id === id);
    if (target) {
      const stemKeys = new Set(target.tracks.flatMap((t) => t.source.kind === "stored" ? [t.source.key] : []));
      for (const key of stemKeys) stemDelete(key);
      // Best-effort: also remove the published copy (needs sign-in; ignore errors).
      if (target.publishedId) cloudUnpublish(target.publishedId).catch(() => {});
    }
    let nextLibrary = library.filter((c) => c.id !== id);
    let nextComposition = composition;

    if (id === composition.id) {
      revokeBlobUrls(composition);
      if (nextLibrary.length === 0) {
        const now = new Date().toISOString();
        nextComposition = { id: newId(), title: "Untitled", artist: "Unknown", bpm: 120, environment: defaultEnvironment, map: defaultMap, tracks: [], createdAt: now, updatedAt: now };
        nextLibrary = [serializeComposition(nextComposition)];
      } else {
        nextComposition = await resolveComposition(nextLibrary[0]);
      }
    }
    moveViewToMapStart(nextComposition.map);
    clearHistoryMarkers();
    set({ library: nextLibrary, composition: nextComposition, selectedId: null, undoStack: [], redoStack: [] });
    persistLibrary(nextLibrary, nextComposition.id);
  },
}));

// Autosave: fold the current composition back into the library and persist
// (debounced) whenever it changes.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((state, prev) => {
  if (state.viewer) return; // never persist a read-only shared composition
  if (state.composition === prev.composition) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { composition, library } = useStore.getState();
    const next = upsert(library, serializeComposition(composition));
    useStore.setState({ library: next });
    persistLibrary(next, composition.id);
  }, 400);
});

// Dev-only handle for debugging/inspection from the console.
if ((import.meta as any).env?.DEV) (window as any).polyStore = useStore;

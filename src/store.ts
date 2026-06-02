import { create } from "zustand";
import * as THREE from "three";
import { Composition, TrackDef, compositionRevision, defaultComposition, normalizeComposition, touchComposition } from "./composition";
import { AudioEngine } from "./audio/AudioEngine";
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
import { EnvironmentSettings, defaultEnvironment, normalizeEnvironment } from "./environment";
import { CompositionMap, defaultMap, normalizeMap } from "./map";
import { ArtistIdentity } from "./artist";
import {
  AuthUser,
  signInWithEmail,
  signOut as cloudSignOut,
  onAuthChange,
  getCurrentUser,
  getAccountArtist,
  ensureArtistForCurrentUser,
  publishComposition,
  unpublish as cloudUnpublish,
} from "./cloud";

// Non-reactive registry of each track marker's 3D object, so the move-gizmo
// can attach to the selected track's object without prop-drilling refs.
export const markerObjects = new Map<string, THREE.Object3D>();

// Your location and facing on the spatial plane, shared across camera modes so
// switching Explore <-> Edit preserves both position and heading. `x,z` is the
// ground anchor (in edit it's the orbit pivot / screen center); `fx,fz` is the
// unit facing direction on the plane. New stems spawn at the anchor. Kept
// outside React to avoid per-frame re-renders.
export const viewState = { x: 0, z: 0, fx: 0, fz: -1 };

type Falloff = Pick<TrackDef, "refDistance" | "maxDistance" | "rolloff">;

export type Mode = "explore" | "edit";

interface StoreState {
  composition: Composition;
  /** All saved compositions (manifests; the current one is also a live copy). */
  library: SerializedComposition[];
  engine: AudioEngine | null;
  undoStack: Composition[];
  redoStack: Composition[];

  mode: Mode;
  selectedId: string | null;
  selectedMapPointKey: string | null;
  selectedMapSegmentId: string | null;
  branchStartPointKey: string | null;
  selectedStart: boolean; // the map start marker is selected (shows its gizmo)
  startGizmoMode: "translate" | "rotate";
  entered: boolean; // has the user started the experience (left the entry screen)
  viewer: boolean; // read-only shared-link view (no autosave, no editing)
  user: AuthUser | null; // signed-in account (for publishing); null = anonymous
  accountArtist: ArtistIdentity | null; // primary artist identity for signed-in publishing

  setEngine: (e: AudioEngine | null) => void;
  setEntered: (entered: boolean) => void;
  resetViewToMapStart: () => void;
  setViewer: (viewer: boolean) => void;
  startAudio: () => Promise<void>;

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
  selectMapSegment: (id: string | null) => void;
  setBranchStartPoint: (key: string | null) => void;
  selectStart: () => void;
  setStartGizmoMode: (mode: "translate" | "rotate") => void;

  // Track edits. Those that affect audio also push the change to the engine,
  // so a playing composition responds live without ever restarting.
  setTrackVolume: (id: string, volume: number) => void;
  setTrackMinVolume: (id: string, minVolume: number) => void;
  setTrackPosition: (id: string, position: [number, number, number]) => void;
  setTrackFalloff: (id: string, falloff: Partial<Falloff>) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackColor: (id: string, color: string) => void;
  deleteTrack: (id: string) => void;
  duplicateTrack: (id: string) => Promise<void>;
  addStem: (file: File) => Promise<void>;
  setLoopSettings: (settings: Partial<Pick<Composition, "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade">>) => void;
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
  for (const t of comp.tracks) {
    if (t.source.kind === "file" && t.source.url.startsWith("blob:")) URL.revokeObjectURL(t.source.url);
  }
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

function pruneSelection(s: StoreState, composition: Composition): Pick<StoreState, "selectedId" | "selectedMapPointKey" | "selectedMapSegmentId" | "branchStartPointKey" | "selectedStart"> {
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

function mapPointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

export function moveViewToMapStart(map: CompositionMap): void {
  viewState.x = map.start.position[0];
  viewState.z = map.start.position[1];
  viewState.fx = map.start.direction[0];
  viewState.fz = map.start.direction[1];
}

export const useStore = create<StoreState>((set, get) => ({
  composition: defaultComposition,
  library: [],
  engine: null,
  undoStack: [],
  redoStack: [],
  mode: "explore",
  selectedId: null,
  selectedMapPointKey: null,
  selectedMapSegmentId: null,
  branchStartPointKey: null,
  selectedStart: false,
  startGizmoMode: "translate",
  entered: false,
  viewer: false,
  user: null,
  accountArtist: null,

  setEngine: (engine) => set({ engine }),
  setEntered: (entered) => set({ entered }),
  resetViewToMapStart: () => moveViewToMapStart(get().composition.map),
  setViewer: (viewer) => set({ viewer }),

  initAuth: () => {
    getCurrentUser().then(async (user) => {
      set({ user, accountArtist: user ? await getAccountArtist() : null });
    });
    onAuthChange(async (user) => {
      set({ user, accountArtist: user ? await getAccountArtist() : null });
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
    const published = await publishComposition(get().composition);
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
    if (get().engine) return;
    const e = new AudioEngine();
    await e.ctx.resume();
    await e.load(get().composition);
    e.start();
    set({ engine: e });
  },

  // Leaving edit mode clears the selection (the properties panel is edit-only).
  setMode: (mode) => set((s) => ({ mode, selectedId: mode === "edit" ? s.selectedId : null, selectedStart: mode === "edit" ? s.selectedStart : false })),
  toggleMode: () => get().setMode(get().mode === "edit" ? "explore" : "edit"),
  select: (selectedId) => set({ selectedId, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null, selectedStart: false }),
  selectMapPoint: (selectedMapPointKey) => set({ selectedMapPointKey, selectedMapSegmentId: null, selectedId: null, selectedStart: false }),
  selectMapSegment: (selectedMapSegmentId) => set({ selectedMapSegmentId, selectedMapPointKey: null, selectedId: null, branchStartPointKey: null, selectedStart: false }),
  setBranchStartPoint: (branchStartPointKey) => set({ branchStartPointKey, selectedMapPointKey: branchStartPointKey, selectedMapSegmentId: null, selectedId: null, selectedStart: false }),
  selectStart: () => set({ selectedStart: true, selectedId: null, selectedMapPointKey: null, selectedMapSegmentId: null, branchStartPointKey: null }),
  setStartGizmoMode: (startGizmoMode) => set({ startGizmoMode }),

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
    let copiedSource = source.source;
    if (source.source.kind === "file" && source.source.url.startsWith("blob:")) {
      const blob = await (await fetch(source.source.url)).blob();
      await stemPut(copyId, blob);
      copiedSource = { kind: "file", url: URL.createObjectURL(blob) };
    }

    const { hash: _hash, ...copyable } = source;
    const def: TrackDef = {
      ...copyable,
      id: copyId,
      name: copyName(source.name, composition.tracks),
      position: offsetCopyPosition(source.position, composition.tracks.length),
      source: copiedSource,
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
    const def: TrackDef = {
      id,
      name: stripExt(file.name),
      color: randomColor(),
      // Spawn at the center of the view (with a little jitter so repeated adds
      // don't stack exactly on top of each other).
      position: [viewState.x + (Math.random() * 2 - 1) * 0.8, 1.5, viewState.z + (Math.random() * 2 - 1) * 0.8],
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
    const { library, currentId } = loadLibrary();
    const current = library.find((c) => c.id === currentId) ?? library[0];
    const composition = current ? await resolveComposition(current) : get().composition;
    moveViewToMapStart(composition.map);
    clearHistoryMarkers();
    set({ library, composition, undoStack: [], redoStack: [] });
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
      environment: get().composition.environment,
      map: get().composition.map,
      tracks: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    clearHistoryMarkers();
    set({ composition: comp, selectedId: null, library: next, undoStack: [], redoStack: [] });
    persistLibrary(next, comp.id);
  },

  // Load an exported bundle as a new composition in the library and switch to it.
  importComposition: async (file) => {
    const comp = normalizeComposition(await importBundle(file));
    const { composition, library } = get();
    revokeBlobUrls(composition);
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    clearHistoryMarkers();
    set({ composition: comp, selectedId: null, library: next, undoStack: [], redoStack: [] });
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
      for (const t of target.tracks) if (t.source.kind === "stored") stemDelete(t.source.key);
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

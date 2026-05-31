import { create } from "zustand";
import * as THREE from "three";
import { Composition, TrackDef, defaultComposition, normalizeComposition } from "./composition";
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

  mode: Mode;
  selectedId: string | null;
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

  // Track edits. Those that affect audio also push the change to the engine,
  // so a playing composition responds live without ever restarting.
  setTrackVolume: (id: string, volume: number) => void;
  setTrackMinVolume: (id: string, minVolume: number) => void;
  setTrackPosition: (id: string, position: [number, number, number]) => void;
  setTrackFalloff: (id: string, falloff: Partial<Falloff>) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackColor: (id: string, color: string) => void;
  deleteTrack: (id: string) => void;
  addStem: (file: File) => Promise<void>;
  setLoopSettings: (settings: Partial<Pick<Composition, "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade">>) => void;
  auditionLoopSeam: () => void;
  loopProgress: () => { mode: "playing" | "audition"; position: number; duration: number } | null;
  setEnvironment: (environment: Partial<EnvironmentSettings>) => void;
  setMap: (map: Partial<CompositionMap>, options?: { moveViewToStart?: boolean }) => void;

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

// Immutably patch one track in the current composition.
function patchTrack(comp: Composition, id: string, patch: Partial<TrackDef>): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
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
  mode: "explore",
  selectedId: null,
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
    const composition = {
      ...get().composition,
      artist: published.artist,
      artistId: published.artistId,
      artistSlug: published.artistSlug,
      artistAvatarUrl: published.artistAvatarUrl,
      artistAvatarEmailHash: published.artistAvatarEmailHash,
      publishedId: published.id,
    };
    const library = upsert(get().library, serializeComposition(composition));
    set({ composition, library });
    persistLibrary(library, composition.id);
  },

  unpublishComposition: async (compId) => {
    const s = get();
    const entry = compId === s.composition.id ? serializeComposition(s.composition) : s.library.find((c) => c.id === compId);
    if (entry?.publishedId) await cloudUnpublish(entry.publishedId);
    const composition = s.composition.id === compId ? { ...s.composition, publishedId: undefined } : s.composition;
    const library = s.library.map((c) => (c.id === compId ? { ...c, publishedId: undefined } : c));
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
  setMode: (mode) => set((s) => ({ mode, selectedId: mode === "edit" ? s.selectedId : null })),
  toggleMode: () => get().setMode(get().mode === "edit" ? "explore" : "edit"),
  select: (selectedId) => set({ selectedId }),

  setTrackVolume: (id, volume) => {
    set((s) => ({ composition: patchTrack(s.composition, id, { volume }) }));
    get().engine?.setVolume(id, volume);
  },

  setTrackMinVolume: (id, minVolume) => {
    set((s) => ({ composition: patchTrack(s.composition, id, { minVolume }) }));
    get().engine?.setMinVolume(id, minVolume);
  },

  setTrackPosition: (id, position) => {
    set((s) => ({ composition: patchTrack(s.composition, id, { position }) }));
    get().engine?.setPosition(id, position);
  },

  setTrackFalloff: (id, falloff) => {
    set((s) => ({ composition: patchTrack(s.composition, id, falloff) }));
    get().engine?.setFalloff(id, falloff);
  },

  // Name and color are presentation-only — no audio side effects.
  renameTrack: (id, name) => set((s) => ({ composition: patchTrack(s.composition, id, { name }) })),
  setTrackColor: (id, color) => set((s) => ({ composition: patchTrack(s.composition, id, { color }) })),

  deleteTrack: (id) => {
    const track = get().composition.tracks.find((t) => t.id === id);
    // Free the object URL and stored audio for an uploaded stem.
    if (track?.source.kind === "file" && track.source.url.startsWith("blob:")) {
      URL.revokeObjectURL(track.source.url);
      stemDelete(id);
    }
    get().engine?.removeTrack(id);
    markerObjects.delete(id);
    set((s) => ({
      composition: { ...s.composition, tracks: s.composition.tracks.filter((t) => t.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
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
      composition: { ...s.composition, tracks: [...s.composition.tracks, def] },
      selectedId: id,
      mode: "edit",
    }));
  },

  setLoopSettings: (settings) => {
    set((s) => {
      const composition = { ...s.composition, ...settings };
      s.engine?.updateLoopSettings(composition);
      return { composition };
    });
  },
  auditionLoopSeam: () => get().engine?.auditionSeam(),
  loopProgress: () => get().engine?.loopProgress() ?? null,
  setEnvironment: (environment) =>
    set((s) => ({
      composition: {
        ...s.composition,
        environment: normalizeEnvironment({ ...s.composition.environment, ...environment }),
      },
    })),
  setMap: (map, options) =>
    set((s) => {
      const nextMap = normalizeMap({ ...s.composition.map, ...map });
      if (options?.moveViewToStart) moveViewToMapStart(nextMap);
      return {
        composition: {
          ...s.composition,
          map: nextMap,
        },
      };
    }),

  // Load the saved library (or seed/migrate) and resolve the current composition.
  initLibrary: async () => {
    const { library, currentId } = loadLibrary();
    const current = library.find((c) => c.id === currentId) ?? library[0];
    const composition = current ? await resolveComposition(current) : get().composition;
    moveViewToMapStart(composition.map);
    set({ library, composition });
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
    set({ library: flushed, composition: resolved, selectedId: null });
    persistLibrary(flushed, id);
  },

  // Start a fresh empty composition, keeping the current one in the library.
  newComposition: (meta) => {
    const { composition, library } = get();
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
    };
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    set({ composition: comp, selectedId: null, library: next });
    persistLibrary(next, comp.id);
  },

  // Load an exported bundle as a new composition in the library and switch to it.
  importComposition: async (file) => {
    const comp = normalizeComposition(await importBundle(file));
    const { composition, library } = get();
    revokeBlobUrls(composition);
    const next = upsert(upsert(library, serializeComposition(composition)), serializeComposition(comp));
    moveViewToMapStart(comp.map);
    set({ composition: comp, selectedId: null, library: next });
    persistLibrary(next, comp.id);
  },

  renameComposition: (id, title) => {
    const t = title.trim() || "Untitled";
    const library = get().library.map((c) => (c.id === id ? { ...c, title: t } : c));
    set((s) => ({
      library,
      composition: s.composition.id === id ? { ...s.composition, title: t } : s.composition,
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
        nextComposition = { id: newId(), title: "Untitled", artist: "Unknown", bpm: 120, environment: defaultEnvironment, map: defaultMap, tracks: [] };
        nextLibrary = [serializeComposition(nextComposition)];
      } else {
        nextComposition = await resolveComposition(nextLibrary[0]);
      }
    }
    moveViewToMapStart(nextComposition.map);
    set({ library: nextLibrary, composition: nextComposition, selectedId: null });
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

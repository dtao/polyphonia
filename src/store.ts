import { create } from "zustand";
import * as THREE from "three";
import { Composition, TrackDef, defaultComposition } from "./composition";
import { AudioEngine } from "./audio/AudioEngine";

// Non-reactive registry of each track marker's 3D object, so the move-gizmo
// can attach to the selected track's object without prop-drilling refs.
export const markerObjects = new Map<string, THREE.Object3D>();

type Falloff = Pick<TrackDef, "refDistance" | "maxDistance" | "rolloff">;

export type Mode = "explore" | "edit";

interface StoreState {
  composition: Composition;
  engine: AudioEngine | null;

  mode: Mode;
  selectedId: string | null;
  entered: boolean; // has the user started the experience (left the entry screen)

  setEngine: (e: AudioEngine | null) => void;
  setEntered: (entered: boolean) => void;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  select: (id: string | null) => void;

  // Track edits. Those that affect audio also push the change to the engine,
  // so a playing composition responds live without ever restarting.
  setTrackVolume: (id: string, volume: number) => void;
  setTrackPosition: (id: string, position: [number, number, number]) => void;
  setTrackFalloff: (id: string, falloff: Partial<Falloff>) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackColor: (id: string, color: string) => void;
  deleteTrack: (id: string) => void;
  addStem: (file: File) => Promise<void>;
  newComposition: (meta: { title: string; artist: string; bpm: number }) => void;
}

const newId = () => (crypto as any).randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PALETTE = ["#5b8cff", "#ff7a6b", "#ffd166", "#b96bff", "#56e0c0", "#f78fb3", "#7ee081", "#ffa057"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];
const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

// Immutably patch one track in the current composition.
function patchTrack(comp: Composition, id: string, patch: Partial<TrackDef>): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export const useStore = create<StoreState>((set, get) => ({
  composition: defaultComposition,
  engine: null,
  mode: "explore",
  selectedId: null,
  entered: false,

  setEngine: (engine) => set({ engine }),
  setEntered: (entered) => set({ entered }),

  // Leaving edit mode clears the selection (the properties panel is edit-only).
  setMode: (mode) => set((s) => ({ mode, selectedId: mode === "edit" ? s.selectedId : null })),
  toggleMode: () => get().setMode(get().mode === "edit" ? "explore" : "edit"),
  select: (selectedId) => set({ selectedId }),

  setTrackVolume: (id, volume) => {
    set((s) => ({ composition: patchTrack(s.composition, id, { volume }) }));
    get().engine?.setVolume(id, volume);
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
    // Free the object URL for an uploaded stem.
    if (track?.source.kind === "file" && track.source.url.startsWith("blob:")) {
      URL.revokeObjectURL(track.source.url);
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
    const def: TrackDef = {
      id,
      name: stripExt(file.name),
      color: randomColor(),
      position: [(Math.random() * 2 - 1) * 4, 1.5, (Math.random() * 2 - 1) * 4],
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

  // Replace the current composition with a fresh empty one. (Multiple saved
  // compositions come later with the library; for now this is in-memory.)
  newComposition: (meta) => {
    // Free any uploaded object URLs from the outgoing composition.
    for (const t of get().composition.tracks) {
      if (t.source.kind === "file" && t.source.url.startsWith("blob:")) URL.revokeObjectURL(t.source.url);
    }
    set({
      composition: {
        id: newId(),
        title: meta.title.trim() || "Untitled",
        artist: meta.artist.trim() || "Unknown",
        bpm: meta.bpm || 120,
        tracks: [],
      },
      selectedId: null,
    });
  },
}));

// Dev-only handle for debugging/inspection from the console.
if ((import.meta as any).env?.DEV) (window as any).polyStore = useStore;

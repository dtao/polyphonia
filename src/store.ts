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

  setEngine: (e: AudioEngine | null) => void;
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
}

// Immutably patch one track in the current composition.
function patchTrack(comp: Composition, id: string, patch: Partial<TrackDef>): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export const useStore = create<StoreState>((set, get) => ({
  composition: defaultComposition,
  engine: null,
  mode: "explore",
  selectedId: null,

  setEngine: (engine) => set({ engine }),

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
    get().engine?.removeTrack(id);
    markerObjects.delete(id);
    set((s) => ({
      composition: { ...s.composition, tracks: s.composition.tracks.filter((t) => t.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
}));

// Dev-only handle for debugging/inspection from the console.
if ((import.meta as any).env?.DEV) (window as any).polyStore = useStore;

import { CompositionMap, containingRoom, loopAdjacentTransforms } from "./map";
import { TrackDef } from "./composition";
import { MarkerDebugSnapshot } from "./scene/markerDebug";
import { resolvedEnvironmentQuality } from "./environmentPacks";
import type { EnvironmentSettings } from "./environment";
import type { EnvironmentInstanceDebugSnapshot } from "./scene/environmentInstanceDebug";

export interface DebugSample {
  t: number;
  fps: number;
  frameMs: number;
  memory?: {
    usedMB: number;
    totalMB: number;
    limitMB: number;
  };
  mode: string;
  entered: boolean;
  position: [number, number, number];
  room: null | {
    id: string;
    width: number;
    depth: number;
    height: number;
    volume: number;
  };
  map: {
    segments: number;
    rooms: number;
    loopPreviews: number;
  };
  environment: {
    pack?: string;
    quality?: "low" | "high";
    instances?: EnvironmentInstanceDebugSnapshot;
  };
  render?: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    pointLights: number;
    visiblePointLights: number;
    meshes: number;
  };
  tracks: {
    count: number;
    inCurrentRoom: number;
  };
  visual: MarkerDebugSnapshot;
  audio: unknown;
  timings?: {
    audioUpdateMs?: number;
  };
}

let lastAudioUpdateMs: number | undefined;

const MAX_SAMPLES = 2400;
const samples: DebugSample[] = [];
let latest: DebugSample | null = null;

export function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const param = new URLSearchParams(window.location.search).get("debug");
  if (param === "1" || param === "true") return true;
  return false;
}

export function debugFlag(name: string): boolean {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === "1" || value === "true";
}

export function debugValue(name: string): string | undefined {
  if (typeof window === "undefined" || !(import.meta as any).env?.DEV) return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

export function recordDebugSample(sample: DebugSample): void {
  latest = sample;
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export function latestDebugSample(): DebugSample | null {
  return latest;
}

export function clearDebugSamples(): void {
  samples.length = 0;
  latest = null;
}

export function exportDebugSamples(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    location: window.location.href,
    flags: {
      debugNoPointLights: debugFlag("debugNoPointLights"),
      debugNoLoopPreview: debugFlag("debugNoLoopPreview"),
      debugNoLoopLights: debugFlag("debugNoLoopLights"),
      debugNoEchoLights: debugFlag("debugNoEchoLights"),
      debugNoFlare: debugFlag("debugNoFlare"),
      debugNoStarRays: debugFlag("debugNoStarRays"),
      debugEnvironmentInstances: debugFlag("debugEnvironmentInstances"),
      debugEnvironmentNoLod: debugFlag("debugEnvironmentNoLod"),
    },
    samples,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `polyphonia-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function recordAudioUpdateTiming(ms: number): void {
  lastAudioUpdateMs = ms;
}

export function timingSnapshot(): DebugSample["timings"] {
  return {
    audioUpdateMs: lastAudioUpdateMs,
  };
}

export function memorySnapshot(): DebugSample["memory"] {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
  if (!perf.memory) return undefined;
  return {
    usedMB: perf.memory.usedJSHeapSize / 1024 / 1024,
    totalMB: perf.memory.totalJSHeapSize / 1024 / 1024,
    limitMB: perf.memory.jsHeapSizeLimit / 1024 / 1024,
  };
}

export function roomDebugSnapshot(map: CompositionMap, position: [number, number], tracks: TrackDef[]): Pick<DebugSample, "room" | "tracks"> {
  const room = containingRoom(map, position);
  const inCurrentRoom = room ? tracks.filter((track) => containingRoom(map, [track.position[0], track.position[2]])?.id === room.id).length : 0;
  return {
    room: room
      ? {
          id: room.id,
          width: room.width,
          depth: room.depth,
          height: room.height,
          volume: room.width * room.depth * room.height,
        }
      : null,
    tracks: {
      count: tracks.length,
      inCurrentRoom,
    },
  };
}

export function mapDebugSnapshot(map: CompositionMap): DebugSample["map"] {
  return {
    segments: map.segments.length,
    rooms: map.rooms.length,
    loopPreviews: loopAdjacentTransforms(map).length,
  };
}

export function environmentDebugSnapshot(environment: EnvironmentSettings): DebugSample["environment"] {
  return {
    pack: environment.pack?.id,
    quality: environment.pack ? resolvedEnvironmentQuality(environment.pack.quality ?? "auto") : undefined,
  };
}

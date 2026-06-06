import { debugFlag } from "../debug";

export type EnvironmentInstanceState = "near" | "blend" | "far" | "hidden";

export interface EnvironmentInstanceDebugEntry {
  id: string;
  total: number;
  near: number;
  blend: number;
  far: number;
  hidden: number;
  nearestDistance: number | null;
  farthestVisible: number | null;
  nearestHidden: number | null;
  closestToLod: {
    distance: number;
    fade: number;
    state: EnvironmentInstanceState;
    position: [number, number, number];
  } | null;
}

export interface EnvironmentInstanceTransition {
  t: number;
  batch: string;
  position: [number, number, number];
  distance: number;
  fade: number;
  from: EnvironmentInstanceState;
  to: EnvironmentInstanceState;
}

export interface EnvironmentInstanceDebugSnapshot {
  batches: EnvironmentInstanceDebugEntry[];
  transitions: EnvironmentInstanceTransition[];
}

interface BatchRecord {
  entry: EnvironmentInstanceDebugEntry;
  states: Map<string, EnvironmentInstanceState>;
  updatedAt: number;
}

const LOD_DISTANCE = 42;
const batches = new Map<string, BatchRecord>();
const transitions: EnvironmentInstanceTransition[] = [];

export function environmentInstanceDebugEnabled(): boolean {
  return debugFlag("debugEnvironmentInstances");
}

export function recordEnvironmentInstanceBatch(
  id: string,
  instances: Array<{
    position: [number, number, number];
    distance: number;
    fade: number;
    state: EnvironmentInstanceState;
  }>,
): void {
  if (!environmentInstanceDebugEnabled()) return;
  const previous = batches.get(id);
  const nextStates = new Map<string, EnvironmentInstanceState>();
  let near = 0;
  let blend = 0;
  let far = 0;
  let hidden = 0;
  let nearestDistance = Infinity;
  let farthestVisible = -Infinity;
  let nearestHidden = Infinity;
  let closestToLod: EnvironmentInstanceDebugEntry["closestToLod"] = null;

  for (const instance of instances) {
    const key = instance.position.map((value) => value.toFixed(2)).join(",");
    nextStates.set(key, instance.state);
    if (instance.state === "near") near++;
    else if (instance.state === "blend") blend++;
    else if (instance.state === "far") far++;
    else hidden++;
    nearestDistance = Math.min(nearestDistance, instance.distance);
    if (instance.state === "hidden") nearestHidden = Math.min(nearestHidden, instance.distance);
    else farthestVisible = Math.max(farthestVisible, instance.distance);
    if (!closestToLod || Math.abs(instance.distance - LOD_DISTANCE) < Math.abs(closestToLod.distance - LOD_DISTANCE)) {
      closestToLod = {
        distance: instance.distance,
        fade: instance.fade,
        state: instance.state,
        position: instance.position,
      };
    }
    const from = previous?.states.get(key);
    if (from && from !== instance.state) {
      transitions.push({
        t: performance.now(),
        batch: id,
        position: instance.position,
        distance: instance.distance,
        fade: instance.fade,
        from,
        to: instance.state,
      });
    }
  }

  if (transitions.length > 80) transitions.splice(0, transitions.length - 80);
  batches.set(id, {
    entry: {
      id,
      total: instances.length,
      near,
      blend,
      far,
      hidden,
      nearestDistance: Number.isFinite(nearestDistance) ? nearestDistance : null,
      farthestVisible: Number.isFinite(farthestVisible) ? farthestVisible : null,
      nearestHidden: Number.isFinite(nearestHidden) ? nearestHidden : null,
      closestToLod,
    },
    states: nextStates,
    updatedAt: performance.now(),
  });
}

export function removeEnvironmentInstanceBatch(id: string): void {
  batches.delete(id);
}

export function environmentInstanceDebugSnapshot(): EnvironmentInstanceDebugSnapshot | undefined {
  if (!environmentInstanceDebugEnabled()) return undefined;
  const now = performance.now();
  return {
    batches: [...batches.values()]
      .filter((record) => now - record.updatedAt < 1000)
      .map((record) => record.entry),
    transitions: transitions.filter((transition) => now - transition.t < 5000),
  };
}

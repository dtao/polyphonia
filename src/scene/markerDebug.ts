export interface MarkerDebugEntry {
  id: string;
  trackId: string;
  kind: "base" | "preview";
  fade: number;
  targetFade: number;
  distance: number;
  updatedAt: number;
}

export interface MarkerDebugSnapshot {
  mounted: number;
  visible: number;
  fading: number;
  stale: number;
  base: { mounted: number; visible: number; fading: number };
  preview: { mounted: number; visible: number; fading: number };
  farthestVisible: number;
  nearestHidden: number | null;
  farthestVisibleMarkers: Array<{ id: string; kind: "base" | "preview"; fade: number; targetFade: number; distance: number }>;
}

const markers = new Map<string, MarkerDebugEntry>();

export function unregisterMarkerDebug(id: string): void {
  markers.delete(id);
}

export function updateMarkerDebug(entry: MarkerDebugEntry): void {
  markers.set(entry.id, entry);
}

export function markerDebugSnapshot(now = performance.now()): MarkerDebugSnapshot {
  const snapshot: MarkerDebugSnapshot = {
    mounted: 0,
    visible: 0,
    fading: 0,
    stale: 0,
    base: { mounted: 0, visible: 0, fading: 0 },
    preview: { mounted: 0, visible: 0, fading: 0 },
    farthestVisible: 0,
    nearestHidden: null,
    farthestVisibleMarkers: [],
  };

  for (const marker of markers.values()) {
    const group = marker.kind === "base" ? snapshot.base : snapshot.preview;
    const visible = marker.fade > 0.02;
    const fading = marker.fade > 0.003 && marker.fade < 0.98;
    snapshot.mounted++;
    group.mounted++;
    if (visible) {
      snapshot.visible++;
      group.visible++;
      snapshot.farthestVisible = Math.max(snapshot.farthestVisible, marker.distance);
      snapshot.farthestVisibleMarkers.push({
        id: marker.id,
        kind: marker.kind,
        fade: marker.fade,
        targetFade: marker.targetFade,
        distance: marker.distance,
      });
    } else {
      snapshot.nearestHidden = snapshot.nearestHidden === null ? marker.distance : Math.min(snapshot.nearestHidden, marker.distance);
    }
    if (fading) {
      snapshot.fading++;
      group.fading++;
    }
    if (now - marker.updatedAt > 750) snapshot.stale++;
  }

  snapshot.farthestVisibleMarkers.sort((a, b) => b.distance - a.distance);
  snapshot.farthestVisibleMarkers = snapshot.farthestVisibleMarkers.slice(0, 6);

  return snapshot;
}

import { TransformControls } from "@react-three/drei";
import { nearestBoundaryPointInMap } from "../map";
import { markerObjects, useStore } from "../store";

// Drag handle for the selected track. All three axes are draggable so stems can
// be placed freely in 3D — X/Z across the floor and Y up/down for elevation.
// Each drag pushes the new position into the store, which updates the audio
// panner live.
export function TrackGizmo() {
  const selectedId = useStore((s) => s.selectedId);
  const obj = selectedId ? markerObjects.get(selectedId) : null;
  if (!selectedId || !obj) return null;

  return (
    <TransformControls
      key={selectedId} // re-attach when the selection changes
      object={obj}
      mode="translate"
      size={0.8}
      onObjectChange={() => {
        const state = useStore.getState();
        const p = obj.position;
        const track = state.composition.tracks.find((t) => t.id === selectedId);
        if (track?.stemShape?.kind === "river") {
          const snapped = nearestBoundaryPointInMap(state.composition.map, [p.x, p.z]);
          if (snapped) {
            obj.position.x = snapped[0];
            obj.position.z = snapped[1];
            state.setTrackPosition(selectedId, [snapped[0], p.y, snapped[1]]);
            return;
          }
        }
        state.setTrackPosition(selectedId, [p.x, p.y, p.z]);
      }}
    />
  );
}

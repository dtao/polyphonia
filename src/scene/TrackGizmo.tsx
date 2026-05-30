import { TransformControls } from "@react-three/drei";
import { markerObjects, useStore } from "../store";

// Drag handle for the selected track. Translation is locked to the ground
// plane (X/Z) so pillars stay grounded; each drag pushes the new position
// into the store, which updates the audio panner live.
export function TrackGizmo() {
  const selectedId = useStore((s) => s.selectedId);
  const obj = selectedId ? markerObjects.get(selectedId) : null;
  if (!selectedId || !obj) return null;

  return (
    <TransformControls
      key={selectedId} // re-attach when the selection changes
      object={obj}
      mode="translate"
      showY={false} // keep tracks on the floor
      size={0.8}
      onObjectChange={() => {
        const p = obj.position;
        useStore.getState().setTrackPosition(selectedId, [p.x, 1.5, p.z]);
      }}
    />
  );
}

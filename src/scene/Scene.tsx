import { useFrame, useThree } from "@react-three/fiber";
import { useState } from "react";
import { useStore } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { ListenerSync } from "./ListenerSync";
import { EnvironmentScene } from "./EnvironmentScene";
import { MapScene } from "./MapScene";
import { LoopPreviewTransform, loopPreviewTransforms } from "../map";

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);

  return (
    <>
      <EnvironmentScene environment={environment} editMode={mode === "edit"} />
      {mode === "explore" && <LoopContinuityPreview />}
      <MapScene map={map} tracks={tracks} editMode={mode === "edit"} />

      {tracks.map((t) => (
        <TrackMarker key={t.id} track={t} />
      ))}

      <ListenerSync />
      {/* Player is mounted even on the entry screen so the enter button's click
          can lock the pointer immediately; its lock selector keeps stray clicks
          from grabbing control before then. Edit mode is unreachable until the
          user has entered, so its controls only appear afterward. */}
      {mode === "explore" ? (
        <Player />
      ) : (
        <>
          <EditControls />
          <TrackGizmo />
        </>
      )}
    </>
  );
}

function LoopContinuityPreview() {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const camera = useThree((s) => s.camera);
  const [previews, setPreviews] = useState<LoopPreviewTransform[]>([]);

  useFrame(() => {
    const next = loopPreviewTransforms(map, [camera.position.x, camera.position.z]);
    setPreviews((current) => (samePreviews(current, next) ? current : next));
  });

  return (
    <>
      {previews.map((preview) => (
        <group key={preview.id} position={[preview.anchor[0], 0, preview.anchor[1]]} rotation={[0, preview.rotation, 0]}>
          <group position={[-preview.source[0], 0, -preview.source[1]]}>
            <MapScene map={map} tracks={tracks} editMode={false} />
            {tracks.map((track) => (
              <TrackMarker key={`${preview.id}-${track.id}`} track={track} preview />
            ))}
          </group>
        </group>
      ))}
    </>
  );
}

function samePreviews(a: LoopPreviewTransform[], b: LoopPreviewTransform[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, i) => {
    const right = b[i];
    return (
      left.id === right.id &&
      Math.abs(left.anchor[0] - right.anchor[0]) < 0.001 &&
      Math.abs(left.anchor[1] - right.anchor[1]) < 0.001 &&
      Math.abs(left.source[0] - right.source[0]) < 0.001 &&
      Math.abs(left.source[1] - right.source[1]) < 0.001 &&
      Math.abs(left.rotation - right.rotation) < 0.001 &&
      Math.abs(left.opacity - right.opacity) < 0.02
    );
  });
}

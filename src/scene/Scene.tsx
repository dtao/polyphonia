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
import { DebugSampler } from "./DebugSampler";
import { CompositionMap, tiledMapTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { debugFlag } from "../debug";

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);
  const camera = useThree((s) => s.camera);
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    const next: [number, number] = [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > 8 ? next : current));
  });
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const tileLights = loopPreviewsEnabled ? tileLightTracks(map, tracks, viewer) : tracks;

  return (
    <>
      <EnvironmentScene environment={environment} editMode={mode === "edit"} />
      {mode === "explore" && loopPreviewsEnabled && <TiledMapPreview viewer={viewer} />}
      <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? tileLights : tracks} editMode={mode === "edit"} />

      {tracks.map((t) => (
        <TrackMarker key={t.id} track={t} />
      ))}

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
      <ListenerSync />
      <DebugSampler />
    </>
  );
}

function TiledMapPreview({ viewer }: { viewer: [number, number] }) {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const previews = debugFlag("debugNoLoopPreview") ? [] : tiledMapTransforms(map, viewer);
  const tileLights = debugFlag("debugNoLoopPreview") ? tracks : tileLightTracks(map, tracks, viewer);

  return (
    <>
      {previews.map((preview) => {
        return (
          <group key={preview.id} position={[preview.anchor[0], 0, preview.anchor[1]]} rotation={[0, preview.rotation, 0]}>
            <group position={[-preview.source[0], 0, -preview.source[1]]}>
              <MapScene map={map} tracks={tracks} lightTracks={tileLights} editMode={false} />
              {tracks.map((track) => (
                <TrackMarker key={`${preview.id}-${track.id}`} track={track} preview />
              ))}
            </group>
          </group>
        );
      })}
    </>
  );
}

function tileLightTracks(map: CompositionMap, tracks: TrackDef[], viewer: [number, number]): TrackDef[] {
  if (debugFlag("debugNoLoopLights")) return tracks;
  const previews = tiledMapTransforms(map, viewer);
  if (!previews.length) return tracks;
  return tracks.flatMap((track) => [
    track,
    ...previews.map((preview) => {
        const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        return { ...track, position: [x, track.position[1], z] as [number, number, number] };
      }),
  ]);
}

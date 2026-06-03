import { useStore } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { ListenerSync } from "./ListenerSync";
import { EnvironmentScene } from "./EnvironmentScene";
import { MapScene } from "./MapScene";
import { DebugSampler } from "./DebugSampler";
import { CompositionMap, loopAdjacentTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { debugFlag } from "../debug";

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const loopLights = loopPreviewsEnabled ? loopLightTracks(map, tracks) : tracks;

  return (
    <>
      <EnvironmentScene environment={environment} editMode={mode === "edit"} />
      {mode === "explore" && loopPreviewsEnabled && <LoopContinuityPreview />}
      <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? loopLights : tracks} editMode={mode === "edit"} />

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

function LoopContinuityPreview() {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const previews = debugFlag("debugNoLoopPreview") ? [] : loopAdjacentTransforms(map);
  const loopLights = debugFlag("debugNoLoopPreview") ? tracks : loopLightTracks(map, tracks);

  return (
    <>
      {previews.map((preview) => {
        return (
          <group key={preview.id} position={[preview.anchor[0], 0, preview.anchor[1]]} rotation={[0, preview.rotation, 0]}>
            <group position={[-preview.source[0], 0, -preview.source[1]]}>
              <MapScene map={map} tracks={tracks} lightTracks={loopLights} editMode={false} />
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

function loopLightTracks(map: CompositionMap, tracks: TrackDef[]): TrackDef[] {
  if (debugFlag("debugNoLoopLights")) return tracks;
  const previews = loopAdjacentTransforms(map);
  if (!previews.length) return tracks;
  return tracks.flatMap((track) => [
    track,
    ...previews.map((preview) => {
        const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        return { ...track, position: [x, track.position[1], z] as [number, number, number] };
      }),
  ]);
}

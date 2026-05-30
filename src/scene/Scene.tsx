import { Grid } from "@react-three/drei";
import { useStore } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { ListenerSync } from "./ListenerSync";

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const mode = useStore((s) => s.mode);

  return (
    <>
      <color attach="background" args={["#05060a"]} />
      <fog attach="fog" args={["#05060a", 18, 55]} />
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#3a4a7a", "#0a0a12", 0.4]} />

      <Grid
        args={[60, 60]}
        cellSize={1}
        cellColor="#1a2138"
        sectionSize={5}
        sectionColor="#2a3658"
        fadeDistance={50}
        infiniteGrid
      />

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

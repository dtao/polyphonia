import { Grid } from "@react-three/drei";
import { Composition } from "../composition";
import { AudioEngine } from "../audio/AudioEngine";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";

export function Scene({ comp, engine }: { comp: Composition; engine: AudioEngine | null }) {
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

      {comp.tracks.map((t) => (
        <TrackMarker key={t.name} track={t} engine={engine} />
      ))}

      <Player engine={engine} />
    </>
  );
}

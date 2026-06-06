import { Grid } from "@react-three/drei";
import type { EnvironmentSettings } from "../environment";
import type { CompositionMap } from "../map";
import { AuthoredEnvironmentScene } from "./AuthoredEnvironmentScene";

export const environmentBackgroundColor = "#030407";

export function EnvironmentScene({
  environment,
  map,
  editMode,
}: {
  environment: EnvironmentSettings;
  map: CompositionMap;
  editMode: boolean;
}) {
  return (
    <>
      <color attach="background" args={[environmentBackgroundColor]} />
      <fog attach="fog" args={[environmentBackgroundColor, 38, 150]} />
      <ambientLight intensity={0.16} />
      <hemisphereLight args={["#8992a5", "#08090d", 0.24]} />
      <directionalLight position={[12, 18, 8]} intensity={0.42} color="#dbe5ff" />

      {editMode && (
        <Grid
          args={[80, 80]}
          cellSize={1}
          cellColor="#263047"
          sectionSize={5}
          sectionColor="#65769b"
          fadeDistance={55}
          infiniteGrid
        />
      )}

      {environment.pack && <AuthoredEnvironmentScene environment={environment} map={map} editMode={editMode} />}
    </>
  );
}

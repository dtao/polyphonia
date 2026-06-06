import { Grid } from "@react-three/drei";
import type { EnvironmentSettings } from "../environment";
import type { CompositionMap } from "../map";
import { AuthoredEnvironmentScene } from "./AuthoredEnvironmentScene";
import type { CreatorLandmarkAsset, CreatorMaterialAsset } from "../creatorAssets";
import { useStore } from "../store";
import { CreatorLandmarks } from "./CreatorLandmarks";
import { SurfaceMapDressing } from "./DetailMapDressing";

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
  const creatorAssets = useStore((state) => state.creatorAssets);
  const materials = creatorAssets.filter((asset): asset is CreatorMaterialAsset => asset.kind === "material");
  const landmarks = creatorAssets.filter((asset): asset is CreatorLandmarkAsset => asset.kind === "landmark");
  const materialById = new Map(materials.map((asset) => [asset.id, asset.material]));
  const floor = environment.surfaces?.floor ? materialById.get(environment.surfaces.floor) : undefined;
  const wall = environment.surfaces?.wall ? materialById.get(environment.surfaces.wall) : undefined;
  const ceiling = environment.surfaces?.ceiling ? materialById.get(environment.surfaces.ceiling) : undefined;
  const surfaceMaterials = floor
    ? { floor, ...(wall ? { wall } : {}), ...(ceiling ? { ceiling } : {}) }
    : undefined;
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

      {environment.pack && (
        <AuthoredEnvironmentScene
          environment={environment}
          map={map}
          editMode={editMode}
          surfaceMaterials={surfaceMaterials}
        />
      )}
      {!environment.pack && surfaceMaterials && (
        <SurfaceMapDressing map={map} materials={surfaceMaterials} editMode={editMode} />
      )}
      <CreatorLandmarks
        assets={landmarks}
        placements={environment.landmarks ?? []}
        editMode={editMode}
      />
    </>
  );
}

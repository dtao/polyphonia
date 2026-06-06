import { Grid } from "@react-three/drei";
import type { EnvironmentSettings } from "../environment";
import type { CompositionMap } from "../map";
import { AuthoredEnvironmentScene } from "./AuthoredEnvironmentScene";
import {
  registeredCreatorAssets,
  type CreatorLandmarkAsset,
  type CreatorMaterialAsset,
} from "../creatorAssets";
import { useStore } from "../store";
import { CreatorLandmarks } from "./CreatorLandmarks";
import { SurfaceMapDressing } from "./DetailMapDressing";
import { RADIAL_FADE_OUTER } from "./fade";

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
  const localCreatorAssets = useStore((state) => state.creatorAssets);
  const creatorAssets = [...registeredCreatorAssets(), ...localCreatorAssets].filter(
    (asset, index, all) => all.findIndex((candidate) => candidate.id === asset.id) === index,
  );
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
      {/* Fog far aligns with RADIAL_FADE_OUTER (see fade.ts) so fog-respecting
          opaque geometry and manually faded objects vanish at the same circle. */}
      <fog attach="fog" args={[environmentBackgroundColor, 38, RADIAL_FADE_OUTER]} />
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

      {(environment.pack || environment.landmarks?.some((placement) => placement.packId)) && (
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

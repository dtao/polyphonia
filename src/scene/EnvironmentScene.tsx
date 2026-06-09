import { Grid } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
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
import { RADIAL_FADE_OUTER, effectiveFadeOuter } from "./fade";

// Fog `far` is a frame-sensitive value once the debug radius slider can drive it
// live, so we write it imperatively each frame rather than through a React prop
// (R3F prop reactivity on <fog> proved unreliable; this also matches how the
// codebase drives other frame-sensitive state — see AGENTS.md). The fog band
// keeps its shape by scaling `near` proportionally to the default 38/130 ratio,
// so pulling the radius in closes the whole scene in smoothly. The MapScene path
// shaders read scene.fog every frame, so they track the same value for free.
const FOG_NEAR_RATIO = 38 / RADIAL_FADE_OUTER;

function FogSync() {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const fog = scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    const far = effectiveFadeOuter();
    fog.far = far;
    fog.near = Math.min(far - 1, far * FOG_NEAR_RATIO);
  });
  return null;
}

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
          opaque geometry and manually faded objects vanish at the same circle.
          The static args seed the Fog object; <FogSync> then drives near/far
          imperatively each frame (see note above). */}
      <fog attach="fog" args={[environmentBackgroundColor, 38, RADIAL_FADE_OUTER]} />
      <FogSync />
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
        map={map}
        editMode={editMode}
      />
    </>
  );
}

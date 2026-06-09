import { Grid } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
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
import { RADIAL_FADE_INNER, RADIAL_FADE_OUTER, effectiveFadeInner, effectiveFadeOuter } from "./fade";

// Own scene.fog imperatively. A JSX `<fog attach="fog">` here attaches to the
// nearest parent Object3D — which is the <ARWorldTransform> group, NOT the scene
// — so the renderer never saw it and fog effectively did nothing. Setting it on
// the real scene from useThree is unambiguous, and near/far are frame-sensitive
// once the debug radius slider drives them live, so we update them each frame
// (matching how the codebase drives other frame-sensitive state — see AGENTS.md).
// The fog band is pinned to the SAME inner→outer circle as the per-object radial
// fade (rings, orbs, path shader), so all fog-respecting geometry vanishes at the
// outer ring exactly like everything else.
function FogSync() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const previous = scene.fog;
    scene.fog = new THREE.Fog(environmentBackgroundColor, RADIAL_FADE_INNER, RADIAL_FADE_OUTER);
    return () => {
      scene.fog = previous;
    };
  }, [scene]);
  useFrame(() => {
    const fog = scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    const far = effectiveFadeOuter();
    fog.far = far;
    fog.near = Math.min(effectiveFadeInner(), far - 1);
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
      {/* Fog is owned imperatively by <FogSync> (scene.fog), not a JSX
          attach="fog" — which would bind to the parent group, not the scene.
          Its far aligns with RADIAL_FADE_OUTER so fog-respecting geometry and
          the manually-faded path/orbs vanish at the same circle. */}
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

export type EnvironmentQuality = "auto" | "low" | "high";

export interface EnvironmentPackSelection {
  id: string;
  variant?: string;
  quality: EnvironmentQuality;
}

export interface EnvironmentLandmarkPlacement {
  id: string;
  assetId: string;
  /** Pack that supplies this geometry; absent for reusable creator assets. */
  packId?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface EnvironmentSettings {
  /** Optional authored visual layer. The map remains authoritative for gameplay. */
  pack?: EnvironmentPackSelection;
  /** Creator-authored visual instances. They never affect movement or acoustics. */
  landmarks?: EnvironmentLandmarkPlacement[];
  /** Reusable creator material ids assigned independently to map surfaces. */
  surfaces?: {
    floor?: string;
    wall?: string;
    ceiling?: string;
  };
  /** Procedurally generated world (terrain + scattered objects). Visual only. */
  generated?: GeneratedEnvironment;
}

// ---------------------------------------------------------------------------
// Generated environments
//
// A generated environment is a square terrain region plus scattered objects,
// derived deterministically from `seed` + `params` (see src/worldgen/). Only
// what cannot be re-derived is stored: object placements (individually
// editable), terrain edit operations, and per-object regeneration locks. The
// base terrain is never baked — the sampler recomputes it from the seed, the
// stored edit ops, and live flattening around stems/walkable map geometry, so
// constraints stay respected even when stems or paths move after generation.

export type GeneratedBiome = "forest" | "cavern" | "meadow";

export type WorldObjectKind =
  | "pine"
  | "tree"
  | "rock"
  | "boulder"
  | "shrub"
  | "grass"
  | "flower"
  | "stalagmite"
  | "crystal"
  | "mushroom";

export interface GeneratedEnvironmentParams {
  /** 0..1 scatter density (object count scales with it; takes effect on regenerate). */
  density: number;
  /** Peak terrain relief in world units. */
  terrainAmplitude: number;
  /** Noise feature size in world units (bigger = broader hills). */
  terrainScale: number;
  /** 0..1 ambient light level for the biome mood. */
  moodAmbient: number;
  /** 0..1 directional "sun"/key light level. */
  moodSun: number;
  /** Sky color at the horizon (also the fog/background color while active). */
  skyColor: string;
  /**
   * Optional sky color at the zenith. When absent, the gradient's two shades
   * are derived from skyColor (lighter horizon, darker top).
   */
  skyColor2?: string;
  /** Terrain vertex-color ramp, low → high elevation. */
  palette: [string, string, string];
}

export interface GeneratedConstraints {
  /** Keep a clear zone around every stem position. */
  stems: boolean;
  /** Keep clear zones around walkable map geometry (paths, rooms, platforms). */
  paths: boolean;
  /** Extra clearance in world units beyond the protected geometry itself. */
  buffer: number;
}

/**
 * One scattered object. `position[1]` is an offset above the terrain surface
 * (not an absolute height) so preserved objects re-seat correctly when the
 * terrain underneath them is regenerated.
 */
export interface WorldObjectPlacement {
  id: string;
  kind: WorldObjectKind;
  position: [number, number, number];
  yaw: number;
  scale: number;
  /** Optional color override for the object's primary part. */
  tint?: string;
  /** Placed by the composer from the palette (always preserved on regenerate). */
  userPlaced?: boolean;
  /** Strongest classified manual edit so far; see classifyObjectEdit. */
  edit?: "minor" | "major";
}

export type TerrainEditMode = "raise" | "lower" | "smooth";

export type GeneratedEdit =
  | {
      id: string;
      type: "terrain";
      mode: TerrainEditMode;
      center: [number, number];
      radius: number;
      /** Signed height delta at the brush center (raise/lower) or 0..1 strength (smooth). */
      amount: number;
      at: string;
      /** Classified when applied; major edits survive "Preserve major edits". */
      level: "minor" | "major";
    }
  | {
      id: string;
      type: "reseed";
      center: [number, number];
      radius: number;
      /** Replacement noise seed blended into the region (regional regenerate). */
      seed: number;
      at: string;
      level: "major";
    };

export interface GeneratedEnvironment {
  biome: GeneratedBiome;
  /** Base seed for terrain noise and object scatter. */
  seed: number;
  params: GeneratedEnvironmentParams;
  /** World-space center of the generated region (the map start at generation time). */
  center: [number, number];
  /** Half-extent of the square generated region, in world units. */
  size: number;
  constraints: GeneratedConstraints;
  objects: WorldObjectPlacement[];
  /** Terrain edit operations, applied in order on top of the base noise. */
  edits: GeneratedEdit[];
  /** Object ids locked against regeneration (preserved in every mode). */
  locks: Record<string, boolean>;
  generatedAt?: string;
}

export const WORLD_OBJECT_KINDS: WorldObjectKind[] = [
  "pine",
  "tree",
  "rock",
  "boulder",
  "shrub",
  "grass",
  "flower",
  "stalagmite",
  "crystal",
  "mushroom",
];

export const GENERATED_BIOMES: GeneratedBiome[] = ["forest", "cavern", "meadow"];

export function defaultGeneratedParams(biome: GeneratedBiome): GeneratedEnvironmentParams {
  switch (biome) {
    case "cavern":
      return {
        density: 0.55,
        terrainAmplitude: 6,
        terrainScale: 42,
        moodAmbient: 0.3,
        moodSun: 0.25,
        skyColor: "#070510",
        palette: ["#151221", "#262037", "#3e3458"],
      };
    case "meadow":
      return {
        density: 0.6,
        terrainAmplitude: 3.5,
        terrainScale: 70,
        moodAmbient: 0.55,
        moodSun: 0.6,
        skyColor: "#0d1322",
        palette: ["#222e15", "#39511f", "#5a6e30"],
      };
    case "forest":
    default:
      return {
        density: 0.6,
        terrainAmplitude: 5,
        terrainScale: 56,
        moodAmbient: 0.4,
        moodSun: 0.4,
        skyColor: "#081019",
        palette: ["#142019", "#234029", "#3a5a35"],
      };
  }
}

export const DEFAULT_GENERATED_SIZE = 160;
export const DEFAULT_CONSTRAINT_BUFFER = 3;

export const defaultEnvironment: EnvironmentSettings = {};

// Older manifests may include preset type/material/ambience/tiling fields.
// They are intentionally ignored: every composition now starts from the same
// neutral visual base and may add one authored detail pack.
export function normalizeEnvironment(value: Partial<EnvironmentSettings> | undefined): EnvironmentSettings {
  const pack = normalizePack(value?.pack);
  const landmarks = Array.isArray(value?.landmarks)
    ? value.landmarks.flatMap((placement) => {
        const normalized = normalizeLandmark(placement);
        return normalized ? [normalized] : [];
      })
    : [];
  const surfaces = normalizeSurfaces(value?.surfaces);
  const generated = normalizeGenerated(value?.generated);
  return {
    ...(pack ? { pack } : {}),
    ...(landmarks.length ? { landmarks } : {}),
    ...(surfaces ? { surfaces } : {}),
    ...(generated ? { generated } : {}),
  };
}

export function normalizeGenerated(value: unknown): GeneratedEnvironment | undefined {
  const generated = value as Partial<GeneratedEnvironment> | undefined;
  if (!generated || typeof generated !== "object") return undefined;
  const biome = GENERATED_BIOMES.includes(generated.biome as GeneratedBiome)
    ? (generated.biome as GeneratedBiome)
    : "forest";
  if (typeof generated.seed !== "number" || !Number.isFinite(generated.seed)) return undefined;
  const defaults = defaultGeneratedParams(biome);
  const params = normalizeGeneratedParams(generated.params, defaults);
  const objects = Array.isArray(generated.objects)
    ? generated.objects.flatMap((object) => {
        const normalized = normalizeWorldObject(object);
        return normalized ? [normalized] : [];
      })
    : [];
  const edits = Array.isArray(generated.edits)
    ? generated.edits.flatMap((edit) => {
        const normalized = normalizeGeneratedEdit(edit);
        return normalized ? [normalized] : [];
      })
    : [];
  const objectIds = new Set(objects.map((object) => object.id));
  const locks: Record<string, boolean> = {};
  if (generated.locks && typeof generated.locks === "object") {
    for (const [id, locked] of Object.entries(generated.locks)) {
      if (locked === true && objectIds.has(id)) locks[id] = true;
    }
  }
  return {
    biome,
    seed: Math.trunc(generated.seed),
    params,
    center: isVector2(generated.center) ? generated.center : [0, 0],
    size: clampNumber(generated.size, 60, 400, DEFAULT_GENERATED_SIZE),
    constraints: {
      stems: generated.constraints?.stems !== false,
      paths: generated.constraints?.paths !== false,
      buffer: clampNumber(generated.constraints?.buffer, 0, 20, DEFAULT_CONSTRAINT_BUFFER),
    },
    objects,
    edits,
    locks,
    ...(typeof generated.generatedAt === "string" ? { generatedAt: generated.generatedAt } : {}),
  };
}

function normalizeGeneratedParams(
  value: Partial<GeneratedEnvironmentParams> | undefined,
  defaults: GeneratedEnvironmentParams,
): GeneratedEnvironmentParams {
  const palette = defaults.palette.map((fallback, i) =>
    normalizeColor(Array.isArray(value?.palette) ? value.palette[i] : undefined, fallback),
  ) as [string, string, string];
  const skyColor2 = normalizeColor(value?.skyColor2, "");
  return {
    density: clampNumber(value?.density, 0, 1, defaults.density),
    terrainAmplitude: clampNumber(value?.terrainAmplitude, 0, 20, defaults.terrainAmplitude),
    terrainScale: clampNumber(value?.terrainScale, 12, 160, defaults.terrainScale),
    moodAmbient: clampNumber(value?.moodAmbient, 0, 1, defaults.moodAmbient),
    moodSun: clampNumber(value?.moodSun, 0, 1, defaults.moodSun),
    skyColor: normalizeColor(value?.skyColor, defaults.skyColor),
    ...(skyColor2 ? { skyColor2 } : {}),
    palette,
  };
}

function normalizeWorldObject(value: unknown): WorldObjectPlacement | undefined {
  const object = value as Partial<WorldObjectPlacement> | undefined;
  if (!object || typeof object !== "object") return undefined;
  if (typeof object.id !== "string" || !object.id.trim()) return undefined;
  if (!WORLD_OBJECT_KINDS.includes(object.kind as WorldObjectKind)) return undefined;
  if (!isVector(object.position, 3)) return undefined;
  const tint = typeof object.tint === "string" ? normalizeColor(object.tint, "") : "";
  return {
    id: object.id.trim(),
    kind: object.kind as WorldObjectKind,
    position: object.position,
    yaw: typeof object.yaw === "number" && Number.isFinite(object.yaw) ? object.yaw : 0,
    scale: clampNumber(object.scale, 0.05, 20, 1),
    ...(tint ? { tint } : {}),
    ...(object.userPlaced === true ? { userPlaced: true } : {}),
    ...(object.edit === "minor" || object.edit === "major" ? { edit: object.edit } : {}),
  };
}

function normalizeGeneratedEdit(value: unknown): GeneratedEdit | undefined {
  const edit = value as Partial<GeneratedEdit> & { mode?: unknown; amount?: unknown; seed?: unknown };
  if (!edit || typeof edit !== "object") return undefined;
  if (typeof edit.id !== "string" || !edit.id.trim()) return undefined;
  if (!isVector2(edit.center)) return undefined;
  const radius = clampNumber(edit.radius, 0.5, 200, 0);
  if (!radius) return undefined;
  const at = typeof edit.at === "string" ? edit.at : new Date(0).toISOString();
  if (edit.type === "terrain") {
    if (edit.mode !== "raise" && edit.mode !== "lower" && edit.mode !== "smooth") return undefined;
    if (typeof edit.amount !== "number" || !Number.isFinite(edit.amount)) return undefined;
    return {
      id: edit.id.trim(),
      type: "terrain",
      mode: edit.mode,
      center: edit.center,
      radius,
      amount: Math.max(-30, Math.min(30, edit.amount)),
      at,
      level: edit.level === "major" ? "major" : "minor",
    };
  }
  if (edit.type === "reseed") {
    if (typeof edit.seed !== "number" || !Number.isFinite(edit.seed)) return undefined;
    return {
      id: edit.id.trim(),
      type: "reseed",
      center: edit.center,
      radius,
      seed: Math.trunc(edit.seed),
      at,
      level: "major",
    };
  }
  return undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function isVector2(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component));
}

function normalizeSurfaces(value: EnvironmentSettings["surfaces"]): EnvironmentSettings["surfaces"] {
  if (!value || typeof value !== "object") return undefined;
  const surface = (candidate: unknown) =>
    typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
  const floor = surface(value.floor);
  const wall = surface(value.wall);
  const ceiling = surface(value.ceiling);
  return floor || wall || ceiling
    ? { ...(floor ? { floor } : {}), ...(wall ? { wall } : {}), ...(ceiling ? { ceiling } : {}) }
    : undefined;
}

function normalizePack(value: EnvironmentPackSelection | undefined): EnvironmentPackSelection | undefined {
  if (!value || typeof value.id !== "string" || !value.id.trim()) return undefined;
  const variant = typeof value.variant === "string" && value.variant.trim() ? value.variant.trim() : undefined;
  return {
    id: value.id.trim(),
    ...(variant ? { variant } : {}),
    quality: isEnvironmentQuality(value.quality) ? value.quality : "auto",
  };
}

function isEnvironmentQuality(value: unknown): value is EnvironmentQuality {
  return value === "auto" || value === "low" || value === "high";
}

function normalizeLandmark(value: unknown): EnvironmentLandmarkPlacement | undefined {
  const landmark = value as Partial<EnvironmentLandmarkPlacement> | undefined;
  if (!landmark || typeof landmark !== "object") return undefined;
  if (typeof landmark.id !== "string" || !landmark.id.trim()) return undefined;
  if (typeof landmark.assetId !== "string" || !landmark.assetId.trim()) return undefined;
  if (!isVector(landmark.position, 3) || !isVector(landmark.rotation, 3) || !isVector(landmark.scale, 3)) return undefined;
  return {
    id: landmark.id.trim(),
    assetId: landmark.assetId.trim(),
    ...(typeof landmark.packId === "string" && landmark.packId.trim()
      ? { packId: landmark.packId.trim() }
      : {}),
    position: landmark.position,
    rotation: landmark.rotation,
    scale: landmark.scale.map((component) => Math.max(0.05, Math.min(component, 20))) as [number, number, number],
  };
}

function isVector(value: unknown, length: number): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((component) => typeof component === "number" && Number.isFinite(component));
}

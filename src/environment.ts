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
}

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
  return {
    ...(pack ? { pack } : {}),
    ...(landmarks.length ? { landmarks } : {}),
    ...(surfaces ? { surfaces } : {}),
  };
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

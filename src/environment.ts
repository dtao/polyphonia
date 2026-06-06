export type EnvironmentType = "void" | "studio" | "cavern" | "forest" | "crystal" | "galaxy";
export type EnvironmentMaterial = "neutral" | "stone" | "foliage" | "glass";
export type SpaceTiling = "none" | "square" | "hex";
export type EnvironmentQuality = "auto" | "low" | "high";

export interface EnvironmentPackSelection {
  id: string;
  variant?: string;
  quality: EnvironmentQuality;
}

export interface EnvironmentSettings {
  type: EnvironmentType;
  material: EnvironmentMaterial;
  ambience: number;
  /** Optional authored visual layer. The map remains authoritative for gameplay. */
  pack?: EnvironmentPackSelection;
  tiling: {
    mode: SpaceTiling;
    size: number;
    origin: [number, number];
  };
}

export const ENVIRONMENT_PRESETS: Record<EnvironmentType, Omit<EnvironmentSettings, "tiling">> = {
  void: { type: "void", material: "neutral", ambience: 0.05 },
  studio: { type: "studio", material: "neutral", ambience: 0.2 },
  cavern: { type: "cavern", material: "stone", ambience: 0.65 },
  forest: { type: "forest", material: "foliage", ambience: 0.45 },
  crystal: { type: "crystal", material: "glass", ambience: 0.75 },
  galaxy: { type: "galaxy", material: "glass", ambience: 0.8 },
};

export const defaultEnvironment: EnvironmentSettings = {
  ...ENVIRONMENT_PRESETS.studio,
  tiling: { mode: "none", size: 32, origin: [0, 0] },
};

export function normalizeEnvironment(value: Partial<EnvironmentSettings> | undefined): EnvironmentSettings {
  const type = isEnvironmentType(value?.type) ? value.type : defaultEnvironment.type;
  const preset = ENVIRONMENT_PRESETS[type];
  const tiling = value?.tiling;
  return {
    type,
    material: isEnvironmentMaterial(value?.material) ? value.material : preset.material,
    ambience: clamp(value?.ambience ?? preset.ambience, 0, 1),
    ...(normalizePack(value?.pack) ? { pack: normalizePack(value?.pack) } : {}),
    tiling: {
      mode: isSpaceTiling(tiling?.mode) ? tiling.mode : defaultEnvironment.tiling.mode,
      size: clamp(tiling?.size ?? defaultEnvironment.tiling.size, 8, 256),
      origin: isOrigin(tiling?.origin) ? tiling.origin : defaultEnvironment.tiling.origin,
    },
  };
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

function isEnvironmentType(value: unknown): value is EnvironmentType {
  return value === "void" || value === "studio" || value === "cavern" || value === "forest" || value === "crystal" || value === "galaxy";
}

function isEnvironmentQuality(value: unknown): value is EnvironmentQuality {
  return value === "auto" || value === "low" || value === "high";
}

function isEnvironmentMaterial(value: unknown): value is EnvironmentMaterial {
  return value === "neutral" || value === "stone" || value === "foliage" || value === "glass";
}

function isSpaceTiling(value: unknown): value is SpaceTiling {
  return value === "none" || value === "square" || value === "hex";
}

function isOrigin(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

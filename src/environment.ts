export type EnvironmentQuality = "auto" | "low" | "high";

export interface EnvironmentPackSelection {
  id: string;
  variant?: string;
  quality: EnvironmentQuality;
}

export interface EnvironmentSettings {
  /** Optional authored visual layer. The map remains authoritative for gameplay. */
  pack?: EnvironmentPackSelection;
}

export const defaultEnvironment: EnvironmentSettings = {};

// Older manifests may include preset type/material/ambience/tiling fields.
// They are intentionally ignored: every composition now starts from the same
// neutral visual base and may add one authored detail pack.
export function normalizeEnvironment(value: Partial<EnvironmentSettings> | undefined): EnvironmentSettings {
  const pack = normalizePack(value?.pack);
  return pack ? { pack } : {};
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

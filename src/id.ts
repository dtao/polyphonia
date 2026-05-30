// Stable unique id generator, shared across the store and persistence.
export const newId = (): string =>
  (crypto as any).randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

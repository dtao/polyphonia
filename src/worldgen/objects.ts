// Visual archetypes for scattered world objects. Each kind is a small stack of
// primitive parts (cones, spheres, …) so the whole biome renders as a handful
// of instanced meshes with zero asset downloads. The scene builds one THREE
// geometry per (kind, part) and instances every placement of that kind.

import type { WorldObjectKind } from "../environment";

export type WorldObjectPartShape = "cone" | "cylinder" | "sphere" | "icosahedron" | "octahedron";

export interface WorldObjectPart {
  shape: WorldObjectPartShape;
  /** Local offset of the part's center, before the placement's uniform scale. */
  offset: [number, number, number];
  scale: [number, number, number];
  color: string;
  /** The placement's tint (if any) recolors the part marked tintable. */
  tintable?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface WorldObjectSpec {
  kind: WorldObjectKind;
  label: string;
  /** Approximate footprint radius at scale 1, for spacing checks. */
  radius: number;
  parts: WorldObjectPart[];
}

export const WORLD_OBJECT_SPECS: Record<WorldObjectKind, WorldObjectSpec> = {
  pine: {
    kind: "pine",
    label: "Pine",
    radius: 1.1,
    parts: [
      { shape: "cylinder", offset: [0, 0.5, 0], scale: [0.16, 1, 0.16], color: "#4a3526" },
      { shape: "cone", offset: [0, 1.6, 0], scale: [1.1, 1.5, 1.1], color: "#1d3b24", tintable: true },
      { shape: "cone", offset: [0, 2.6, 0], scale: [0.75, 1.2, 0.75], color: "#25492c", tintable: true },
    ],
  },
  tree: {
    kind: "tree",
    label: "Tree",
    radius: 1.3,
    parts: [
      { shape: "cylinder", offset: [0, 0.8, 0], scale: [0.2, 1.6, 0.2], color: "#54402c" },
      { shape: "sphere", offset: [0, 2.2, 0], scale: [1.5, 1.2, 1.5], color: "#2c4a2a", tintable: true },
    ],
  },
  rock: {
    kind: "rock",
    label: "Rock",
    radius: 0.8,
    parts: [{ shape: "icosahedron", offset: [0, 0.3, 0], scale: [0.8, 0.55, 0.7], color: "#5a5a64", tintable: true }],
  },
  boulder: {
    kind: "boulder",
    label: "Boulder",
    radius: 1.5,
    parts: [{ shape: "icosahedron", offset: [0, 0.7, 0], scale: [1.6, 1.2, 1.4], color: "#4c4c56", tintable: true }],
  },
  shrub: {
    kind: "shrub",
    label: "Shrub",
    radius: 0.7,
    parts: [{ shape: "sphere", offset: [0, 0.4, 0], scale: [0.8, 0.55, 0.8], color: "#26402a", tintable: true }],
  },
  grass: {
    kind: "grass",
    label: "Grass tuft",
    radius: 0.4,
    parts: [
      { shape: "cone", offset: [0, 0.3, 0], scale: [0.1, 0.6, 0.1], color: "#3f5c2c", tintable: true },
      { shape: "cone", offset: [0.16, 0.24, 0.05], scale: [0.08, 0.48, 0.08], color: "#46632f", tintable: true },
      { shape: "cone", offset: [-0.13, 0.21, -0.09], scale: [0.08, 0.42, 0.08], color: "#37511f", tintable: true },
    ],
  },
  flower: {
    kind: "flower",
    label: "Flower",
    radius: 0.3,
    parts: [
      { shape: "cylinder", offset: [0, 0.25, 0], scale: [0.03, 0.5, 0.03], color: "#3c5426" },
      { shape: "sphere", offset: [0, 0.55, 0], scale: [0.16, 0.14, 0.16], color: "#d7719f", tintable: true, emissive: "#75274b", emissiveIntensity: 0.35 },
    ],
  },
  stalagmite: {
    kind: "stalagmite",
    label: "Stalagmite",
    radius: 0.9,
    parts: [
      { shape: "cone", offset: [0, 1, 0], scale: [0.7, 2, 0.7], color: "#5c5468", tintable: true },
      { shape: "cone", offset: [0.5, 0.45, 0.25], scale: [0.4, 0.9, 0.4], color: "#514a5e" },
    ],
  },
  crystal: {
    kind: "crystal",
    label: "Crystal",
    radius: 0.7,
    parts: [
      { shape: "octahedron", offset: [0, 0.9, 0], scale: [0.45, 1.1, 0.45], color: "#8d7df0", tintable: true, emissive: "#5b46d8", emissiveIntensity: 0.7 },
      { shape: "octahedron", offset: [0.45, 0.4, 0.15], scale: [0.25, 0.55, 0.25], color: "#7a6ad8", emissive: "#4736b8", emissiveIntensity: 0.5 },
    ],
  },
  mushroom: {
    kind: "mushroom",
    label: "Mushroom",
    radius: 0.4,
    parts: [
      { shape: "cylinder", offset: [0, 0.25, 0], scale: [0.1, 0.5, 0.1], color: "#cfc4ae" },
      { shape: "sphere", offset: [0, 0.55, 0], scale: [0.35, 0.22, 0.35], color: "#b04a3f", tintable: true, emissive: "#7a2a22", emissiveIntensity: 0.3 },
    ],
  },
};

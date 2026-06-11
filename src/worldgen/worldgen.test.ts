import { describe, expect, it } from "vitest";
import { fbm2, hash2, rngFromSeed, valueNoise2 } from "./noise";
import {
  FLATTEN_DROP,
  buildTerrainField,
  flattenSources,
  insideClearZone,
  terrainHeightAt,
} from "./terrain";
import { scatterObjects } from "./scatter";
import {
  classifyObjectEdit,
  classifyTerrainEdit,
  generateEnvironment,
  regenerateEnvironment,
  regenerateRegion,
} from "./regen";
import { normalizeMap } from "../map";
import type { TrackDef } from "../composition";
import type { GeneratedEnvironment, WorldObjectPlacement } from "../environment";
import { defaultGeneratedParams } from "../environment";

const NOW = "2026-01-01T00:00:00.000Z";

const pathMap = normalizeMap({
  preset: "custom",
  segments: [{ id: "s1", start: [0, 0], end: [40, 0], width: 4 }],
  start: { position: [0, 0], direction: [1, 0] },
});

const track = (x: number, z: number): TrackDef =>
  ({ id: `t-${x}-${z}`, name: "stem", color: "#fff", position: [x, 1.5, z], source: { kind: "synth", patch: "pad" } }) as unknown as TrackDef;

function testEnvironment(overrides: Partial<GeneratedEnvironment> = {}): GeneratedEnvironment {
  return {
    biome: "forest",
    seed: 7,
    params: defaultGeneratedParams("forest"),
    center: [0, 0],
    size: 80,
    constraints: { stems: true, paths: true, buffer: 3 },
    objects: [],
    edits: [],
    locks: {},
    ...overrides,
  };
}

describe("worldgen noise", () => {
  it("is deterministic and in range", () => {
    expect(hash2(42, 3, -7)).toBe(hash2(42, 3, -7));
    for (let i = 0; i < 50; i++) {
      const v = hash2(9, i, i * 13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(valueNoise2(1, 2.3, 4.5)).toBe(valueNoise2(1, 2.3, 4.5));
    expect(fbm2(5, 0.7, -1.2)).toBe(fbm2(5, 0.7, -1.2));
    const a = rngFromSeed(11);
    const b = rngFromSeed(11);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("terrain field", () => {
  it("flattens just below the walkable surface on and around paths", () => {
    const generated = testEnvironment();
    const sources = flattenSources(pathMap, [], generated);
    const field = buildTerrainField(generated, sources);
    // Seated FLATTEN_DROP below the floor planes so they never z-fight.
    expect(terrainHeightAt(field, 20, 0)).toBeCloseTo(-FLATTEN_DROP, 4);
    expect(terrainHeightAt(field, 20, 4)).toBeCloseTo(-FLATTEN_DROP, 4); // inside width/2 + buffer
  });

  it("flattens around stems so they never get buried", () => {
    const generated = testEnvironment();
    const sources = flattenSources(pathMap, [track(0, 50)], generated);
    const field = buildTerrainField(generated, sources);
    expect(terrainHeightAt(field, 0, 50)).toBeCloseTo(-FLATTEN_DROP, 4);
  });

  it("returns 0 outside the generated region", () => {
    const generated = testEnvironment();
    const field = buildTerrainField(generated, flattenSources(pathMap, [], generated));
    expect(terrainHeightAt(field, 500, 500)).toBe(0);
  });

  it("applies raise edits away from paths but not across protected zones", () => {
    const generated = testEnvironment();
    const sources = flattenSources(pathMap, [], generated);
    const before = buildTerrainField(generated, sources);
    const edited = testEnvironment({
      edits: [
        { id: "e1", type: "terrain", mode: "raise", center: [0, 45], radius: 8, amount: 2, at: NOW, level: "minor" },
        { id: "e2", type: "terrain", mode: "raise", center: [20, 0], radius: 6, amount: 2, at: NOW, level: "minor" },
      ],
    });
    const after = buildTerrainField(edited, sources);
    expect(terrainHeightAt(after, 0, 45)).toBeCloseTo(terrainHeightAt(before, 0, 45) + 2, 1);
    expect(terrainHeightAt(after, 20, 0)).toBeCloseTo(-FLATTEN_DROP, 4); // path stays walkable
  });

  it("is deterministic for the same seed", () => {
    const generated = testEnvironment();
    const sources = flattenSources(pathMap, [], generated);
    expect(buildTerrainField(generated, sources).heights).toEqual(buildTerrainField(generated, sources).heights);
  });
});

describe("scatter", () => {
  it("keeps objects clear of paths and stems", () => {
    const generated = testEnvironment();
    const stems = [track(0, 30)];
    const sources = flattenSources(pathMap, stems, generated);
    const objects = scatterObjects(generated, sources);
    expect(objects.length).toBeGreaterThan(20);
    for (const object of objects) {
      expect(insideClearZone(sources, generated.constraints.buffer, object.position[0], object.position[2], 0)).toBe(false);
    }
  });

  it("is deterministic and density-sensitive", () => {
    const generated = testEnvironment();
    const sources = flattenSources(pathMap, [], generated);
    expect(scatterObjects(generated, sources)).toEqual(scatterObjects(generated, sources));
    const sparse = testEnvironment({ params: { ...generated.params, density: 0.1 } });
    const dense = testEnvironment({ params: { ...generated.params, density: 0.95 } });
    expect(scatterObjects(dense, sources).length).toBeGreaterThan(scatterObjects(sparse, sources).length);
  });

  it("ignores constraints when the toggles are off", () => {
    const generated = testEnvironment({ constraints: { stems: false, paths: false, buffer: 3 } });
    const sources = flattenSources(pathMap, [track(0, 30)], generated);
    // Only the always-on start clearance remains.
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "disc", center: [0, 0] });
  });
});

describe("edit classification", () => {
  const object: WorldObjectPlacement = { id: "o", kind: "rock", position: [0, 0, 0], yaw: 0, scale: 1 };

  it("classifies object moves by distance and scale by ratio", () => {
    expect(classifyObjectEdit({ ...object }, { position: [4, 0, 0] })).toBe("major");
    expect(classifyObjectEdit({ ...object }, { position: [1, 0, 0] })).toBe("minor");
    expect(classifyObjectEdit({ ...object }, { scale: 2 })).toBe("major");
    expect(classifyObjectEdit({ ...object }, { scale: 1.1 })).toBe("minor");
    expect(classifyObjectEdit({ ...object, edit: "major" }, { scale: 1.01 })).toBe("major");
  });

  it("classifies terrain strokes by impact", () => {
    expect(classifyTerrainEdit("raise", 3, 8)).toBe("major");
    expect(classifyTerrainEdit("raise", 0.5, 6)).toBe("minor");
    expect(classifyTerrainEdit("smooth", 1, 30)).toBe("minor");
  });
});

describe("regeneration modes", () => {
  function editedWorld() {
    const generated = generateEnvironment("forest", pathMap, [], { seed: 7, now: NOW });
    expect(generated.objects.length).toBeGreaterThan(3);
    const [a, b, c, d] = generated.objects;
    const objects = generated.objects.map((object) =>
      object.id === a.id
        ? { ...object, edit: "major" as const }
        : object.id === b.id
          ? { ...object, edit: "minor" as const }
          : object,
    );
    const userPlaced = { ...d, id: "user-1", userPlaced: true };
    return {
      ...generated,
      objects: [...objects, userPlaced],
      locks: { [c.id]: true },
      edits: [
        { id: "maj", type: "terrain", mode: "raise", center: [0, 45], radius: 9, amount: 3, at: NOW, level: "major" },
        { id: "min", type: "terrain", mode: "raise", center: [10, 45], radius: 5, amount: 0.5, at: NOW, level: "minor" },
      ],
    } as GeneratedEnvironment;
  }

  it("overwrite wipes objects, edits, and locks", () => {
    const next = regenerateEnvironment(editedWorld(), pathMap, [], "overwrite", { seed: 99, now: NOW });
    expect(next.edits).toEqual([]);
    expect(next.locks).toEqual({});
    expect(next.objects.every((object) => !object.edit && !object.userPlaced)).toBe(true);
    expect(next.seed).toBe(99);
  });

  it("keep-constraints forces the constraint toggles on", () => {
    const world = { ...editedWorld(), constraints: { stems: false, paths: false, buffer: 3 } };
    const next = regenerateEnvironment(world, pathMap, [], "keep-constraints", { seed: 99, now: NOW });
    expect(next.constraints.stems).toBe(true);
    expect(next.constraints.paths).toBe(true);
  });

  it("keep-major preserves major edits, locked and user-placed objects", () => {
    const world = editedWorld();
    const ids = world.objects.map((object) => object.id);
    const next = regenerateEnvironment(world, pathMap, [], "keep-major", { seed: 99, now: NOW });
    const nextIds = new Set(next.objects.map((object) => object.id));
    expect(nextIds.has(ids[0])).toBe(true); // major edit
    expect(nextIds.has(ids[1])).toBe(false); // minor edit re-rolled
    expect(nextIds.has(ids[2])).toBe(true); // locked
    expect(nextIds.has("user-1")).toBe(true); // user placed
    expect(next.edits.map((edit) => edit.id)).toEqual(["maj"]);
    expect(next.locks).toEqual({ [ids[2]]: true });
  });

  it("keep-all preserves every touched object and all edits", () => {
    const world = editedWorld();
    const ids = world.objects.map((object) => object.id);
    const next = regenerateEnvironment(world, pathMap, [], "keep-all", { seed: 99, now: NOW });
    const nextIds = new Set(next.objects.map((object) => object.id));
    expect(nextIds.has(ids[0])).toBe(true);
    expect(nextIds.has(ids[1])).toBe(true);
    expect(nextIds.has(ids[2])).toBe(true);
    expect(next.edits.map((edit) => edit.id)).toEqual(["maj", "min"]);
  });

  it("regional regenerate reshuffles only the selected circle", () => {
    const world = editedWorld();
    const region = { center: [40, 40] as [number, number], radius: 20 };
    const next = regenerateRegion(world, pathMap, [], region, { seed: 123, editId: "rs", now: NOW });

    const inRegion = (position: [number, number, number]) =>
      Math.hypot(position[0] - region.center[0], position[2] - region.center[1]) <= region.radius;
    const keptIds = new Set(next.objects.map((object) => object.id));
    for (const object of world.objects) {
      const preserved = object.userPlaced || object.edit || world.locks[object.id];
      if (!inRegion(object.position)) {
        expect(keptIds.has(object.id)).toBe(true); // outside untouched
      } else if (!preserved) {
        expect(keptIds.has(object.id)).toBe(false); // inside, unedited → re-rolled
      }
    }
    // Terrain: a reseed edit is appended; edits centered outside the region stay.
    expect(next.edits[next.edits.length - 1]).toMatchObject({ id: "rs", type: "reseed", seed: 123 });
    expect(next.edits.some((edit) => edit.id === "maj")).toBe(true);
    expect(next.seed).toBe(world.seed); // base seed untouched
  });
});

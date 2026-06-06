import { describe, expect, it } from "vitest";
import { ENVIRONMENT_PACKS } from "./environmentPacks";
import { packAssetReferences, rewritePackUrls } from "./detailPackStorage";

describe("detail pack storage transforms", () => {
  it("rewrites every external asset reference without changing landmark metadata", () => {
    const source = ENVIRONMENT_PACKS[0];
    const rewritten = rewritePackUrls(source, (url) => `local:${url}`);

    expect(rewritten.assets[0].url).toBe(`local:${source.assets[0].url}`);
    expect(rewritten.materials.floor.albedo).toBe(`local:${source.materials.floor.albedo}`);
    expect(rewritten.materials.floor.normal).toBe(`local:${source.materials.floor.normal}`);
    expect(rewritten.landmarks).toEqual(source.landmarks);
  });

  it("enumerates GLB and material dependencies for portable bundles", () => {
    const references = packAssetReferences(ENVIRONMENT_PACKS[1]);

    expect(references).toContain("/environments/verdant-grove/verdant-grove-kit.glb");
    expect(references).toContain("/environments/verdant-grove/textures/forest-albedo.webp");
    expect(new Set(references).size).toBe(references.length);
  });
});

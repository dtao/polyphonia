import { describe, expect, it } from "vitest";
import { artistPath, slugifyArtist } from "./artist";

describe("artist identity helpers", () => {
  it("normalizes display names into stable URL slugs", () => {
    expect(slugifyArtist("  The D'Angelo Sessions!  ")).toBe("the-dangelo-sessions");
    expect(slugifyArtist("Glass & Stone")).toBe("glass-stone");
  });

  it("falls back to a non-empty slug for blank names", () => {
    expect(slugifyArtist("   ")).toBe("artist");
  });

  it("uses the canonical slug when building artist paths", () => {
    expect(artistPath("Display Name", "display-name-2")).toBe("/artist/display-name-2");
    expect(artistPath("Display Name")).toBe("/artist/display-name");
  });
});

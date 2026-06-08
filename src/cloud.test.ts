import { describe, expect, it } from "vitest";
import { defaultComposition } from "./composition";
import {
  buildPublishedCompositionRow,
  normalizePublishedTitle,
  publishedStemAssetKey,
} from "./cloud";

describe("published composition payloads", () => {
  it("normalizes title keys for per-artist uniqueness checks", () => {
    expect(normalizePublishedTitle("  My   New    Space  ")).toBe("my new space");
    expect(normalizePublishedTitle("   ")).toBe("untitled");
  });

  it("uses shared audio identity rather than spatial track identity for uploads", () => {
    expect(publishedStemAssetKey({ id: "copy-20", audioAssetId: "asset-a" })).toBe("asset-a");
    expect(publishedStemAssetKey({ id: "legacy-track" })).toBe("legacy-track");
  });

  it("builds the denormalized Supabase row and canonical manifest together", () => {
    const artist = {
      artistId: "artist-1",
      artist: "Glass Choir",
      artistSlug: "glass-choir",
      artistAvatarUrl: "https://example.com/avatar.png",
      artistAvatarEmailHash: "abc123",
    };
    const row = buildPublishedCompositionRow({
      comp: { ...defaultComposition, title: " Draft Title ", artist: "Local Artist", publishedId: undefined },
      tracks: defaultComposition.tracks,
      id: "pub-1",
      userId: "user-1",
      artist,
      title: "Published Title",
    });

    expect(row).toMatchObject({
      id: "pub-1",
      owner: "user-1",
      artist_id: "artist-1",
      title: "Published Title",
      title_key: "published title",
      artist: "Glass Choir",
      artist_slug: "glass-choir",
      artist_avatar_url: "https://example.com/avatar.png",
      artist_avatar_email_hash: "abc123",
    });
    expect(row.manifest).toMatchObject({
      title: "Published Title",
      artist: "Glass Choir",
      artistId: "artist-1",
      artistSlug: "glass-choir",
      publishedId: "pub-1",
    });
  });
});

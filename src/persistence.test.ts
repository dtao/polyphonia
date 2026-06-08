import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultComposition } from "./composition";
import {
  buildCompositionBundle,
  loadLibrary,
  serializeComposition,
  type SerializedComposition,
} from "./persistence";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persistence manifests", () => {
  it("serializes uploaded blob URLs as stored stem markers", () => {
    const saved = serializeComposition({
      ...defaultComposition,
      tracks: [
        {
          ...defaultComposition.tracks[0],
          id: "uploaded",
          source: { kind: "file", url: "blob:http://localhost/uploaded" },
        },
        {
          ...defaultComposition.tracks[1],
          id: "builtin",
          source: { kind: "file", url: "/stems/Journey_Drums.mp3" },
        },
      ],
    });

    expect(saved.tracks[0].source).toEqual({ kind: "stored", key: "uploaded" });
    expect(saved.tracks[1].source).toEqual({ kind: "file", url: "/stems/Journey_Drums.mp3" });
  });

  it("serializes cloned tracks as references to one stored audio asset", () => {
    const source = {
      ...defaultComposition.tracks[0],
      id: "uploaded",
      audioAssetId: "asset-a",
      source: { kind: "file" as const, url: "blob:http://localhost/uploaded" },
    };
    const saved = serializeComposition({
      ...defaultComposition,
      tracks: [
        source,
        { ...source, id: "copy-1" },
        { ...source, id: "copy-2" },
      ],
    });

    expect(saved.tracks.map((track) => track.source)).toEqual([
      { kind: "stored", key: "asset-a" },
      { kind: "stored", key: "asset-a" },
      { kind: "stored", key: "asset-a" },
    ]);
  });

  it("embeds one audio file for many cloned spatial tracks", async () => {
    const blob = new Blob(["five megabytes in production"], { type: "audio/mpeg" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob));
    vi.stubGlobal("fetch", fetchMock);
    const source = {
      ...defaultComposition.tracks[0],
      audioAssetId: "asset-a",
      source: { kind: "file" as const, url: "blob:http://localhost/uploaded" },
    };
    const tracks = Array.from({ length: 20 }, (_, index) => ({
      ...source,
      id: `track-${index}`,
      name: `Copy ${index}`,
    }));

    const bundle = await buildCompositionBundle({ ...defaultComposition, tracks });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(bundle.stems)).toEqual(["asset-a"]);
    expect(bundle.composition.tracks).toHaveLength(20);
    expect(bundle.composition.tracks.every((track) =>
      track.source.kind === "stored" && track.source.key === "asset-a",
    )).toBe(true);
  });

  it("loads the versioned library format", () => {
    const storage = new MemoryStorage();
    const composition = serializeComposition({ ...defaultComposition, id: "saved" });
    storage.setItem("polyphonia:library", JSON.stringify({ version: 2, currentId: "saved", library: [composition] }));
    vi.stubGlobal("localStorage", storage);

    expect(loadLibrary()).toEqual({ library: [composition], currentId: "saved" });
  });

  it("migrates the old single-composition slot", () => {
    const storage = new MemoryStorage();
    const composition: SerializedComposition = serializeComposition({ ...defaultComposition, id: "legacy" });
    storage.setItem("polyphonia:composition", JSON.stringify({ composition }));
    vi.stubGlobal("localStorage", storage);

    expect(loadLibrary()).toEqual({ library: [composition], currentId: "legacy" });
  });

  it("seeds the built-in demo when saved data is missing or invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem("polyphonia:library", "{broken json");
    vi.stubGlobal("localStorage", storage);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { library, currentId } = loadLibrary();

    expect(currentId).toBe(defaultComposition.id);
    expect(library).toHaveLength(1);
    expect(library[0].id).toBe(defaultComposition.id);
  });
});

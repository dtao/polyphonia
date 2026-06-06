import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultComposition, normalizeComposition } from "./composition";

let useStore: typeof import("./store").useStore;
let viewState: typeof import("./store").viewState;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  ({ useStore, viewState } = await import("./store"));
});

beforeEach(() => {
  useStore.setState({
    composition: normalizeComposition({
      ...defaultComposition,
      tracks: defaultComposition.tracks.map((track) => ({ ...track })),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    library: [],
    engine: null,
    viewer: true,
    undoStack: [],
    redoStack: [],
    mode: "edit",
    selectedId: null,
    selectedMapPointKey: null,
    selectedMapSegmentId: null,
    branchStartPointKey: null,
    selectedStart: false,
    selectedRoomId: null,
    selectedEntranceIndex: null,
    selectedPlatformId: null,
    selectedWallId: null,
    selectedLandmarkId: null,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("store edit contracts", () => {
  it("syncs audible track edits to the engine and restores them through history", async () => {
    const engine = {
      setVolume: vi.fn(),
      setPosition: vi.fn(),
      setFalloff: vi.fn(),
      replaceComposition: vi.fn().mockResolvedValue(undefined),
    };
    useStore.setState({ engine: engine as any });

    const store = useStore.getState();
    store.setTrackVolume("bass", 0.4);
    store.setTrackPosition("bass", [3, 2, -4]);
    store.setTrackFalloff("bass", { rolloff: 2 });

    expect(useStore.getState().composition.tracks[0]).toMatchObject({
      volume: 0.4,
      position: [3, 2, -4],
      rolloff: 2,
    });
    expect(engine.setVolume).toHaveBeenCalledWith("bass", 0.4);
    expect(engine.setPosition).toHaveBeenCalledWith("bass", [3, 2, -4]);
    expect(engine.setFalloff).toHaveBeenCalledWith("bass", { rolloff: 2 });
    expect(useStore.getState().undoStack).toHaveLength(3);

    await useStore.getState().undo();
    expect(useStore.getState().composition.tracks[0].rolloff).toBeUndefined();
    expect(useStore.getState().redoStack).toHaveLength(1);
    expect(engine.replaceComposition).toHaveBeenCalledTimes(1);

    await useStore.getState().redo();
    expect(useStore.getState().composition.tracks[0].rolloff).toBe(2);
    expect(engine.replaceComposition).toHaveBeenCalledTimes(2);
  });

  it("keeps editor object selections mutually exclusive", () => {
    const store = useStore.getState();

    store.select("bass");
    expect(useStore.getState().selectedId).toBe("bass");

    store.selectMapSegment("line");
    expect(useStore.getState()).toMatchObject({
      selectedId: null,
      selectedMapSegmentId: "line",
      selectedRoomId: null,
      selectedPlatformId: null,
      selectedWallId: null,
      selectedLandmarkId: null,
    });

    store.selectRoom("room-a");
    expect(useStore.getState()).toMatchObject({
      selectedMapSegmentId: null,
      selectedRoomId: "room-a",
      selectedEntranceIndex: null,
    });
  });

  it("adds, edits, selects, and removes pack landmarks through history", async () => {
    useStore.getState().setEnvironment({
      pack: { id: "verdant-grove", variant: "temperate", quality: "auto" },
    });
    useStore.setState({ undoStack: [], redoStack: [] });

    useStore.getState().addLandmark("evergreen");
    const added = useStore.getState().composition.environment.landmarks?.[0];
    expect(added).toMatchObject({ assetId: "evergreen", scale: [1, 1, 1] });
    expect(useStore.getState().selectedLandmarkId).toBe(added?.id);

    useStore.getState().updateLandmark(added!.id, {
      position: [4, 0, -6],
      scale: [2, 2, 2],
    });
    expect(useStore.getState().composition.environment.landmarks?.[0]).toMatchObject({
      position: [4, 0, -6],
      scale: [2, 2, 2],
    });

    useStore.getState().select("bass");
    expect(useStore.getState().selectedLandmarkId).toBeNull();
    useStore.getState().selectLandmark(added!.id);
    expect(useStore.getState().selectedId).toBeNull();

    useStore.getState().deleteLandmark(added!.id);
    expect(useStore.getState().composition.environment.landmarks).toBeUndefined();
    await useStore.getState().undo();
    expect(useStore.getState().composition.environment.landmarks).toHaveLength(1);
  });

  it("creates free objects at the edit camera target", () => {
    Object.assign(viewState, { x: 18, y: 0, z: -11, fx: 1, fz: 0 });

    useStore.getState().addLandmark("evergreen");
    useStore.getState().addRoom();
    useStore.getState().addWall();

    const state = useStore.getState();
    expect(state.composition.environment.landmarks?.[0]?.position).toEqual([18, 0, -11]);
    expect(state.composition.map.rooms[state.composition.map.rooms.length - 1]).toMatchObject({
      center: [18, -11],
      elevation: 0,
    });
    expect(state.composition.map.walls[state.composition.map.walls.length - 1]).toMatchObject({
      start: [18, -15],
      end: [18, -7],
    });
  });
});

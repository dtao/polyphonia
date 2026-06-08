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
      elevation: 0,
    });
  });

  it("preserves elevation when cloning landmarks and map points", () => {
    useStore.setState((state) => ({
      composition: normalizeComposition({
        ...state.composition,
        environment: {
          landmarks: [{
            id: "landmark-a",
            assetId: "evergreen",
            position: [2, 7, 3],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          }],
        },
        map: {
          ...state.composition.map,
          preset: "custom",
          segments: [{ id: "raised", start: [0, 0], end: [0, -10], width: 6 }],
          elevations: { "0.000,0.000": 5 },
        },
      }),
    }));

    useStore.getState().duplicateLandmark("landmark-a");
    useStore.getState().addBranchAtPoint("0.000,0.000");

    const state = useStore.getState();
    expect(state.composition.environment.landmarks?.[1]?.position[1]).toBe(7);
    const clonedEndpoint = state.composition.map.segments[1].end;
    const clonedKey = `${clonedEndpoint[0].toFixed(3)},${clonedEndpoint[1].toFixed(3)}`;
    expect(state.composition.map.elevations?.[clonedKey]).toBe(5);
  });

  it("moves every endpoint at a branch point and keeps its elevation selected", () => {
    useStore.setState((state) => ({
      composition: normalizeComposition({
        ...state.composition,
        map: {
          ...state.composition.map,
          preset: "custom",
          segments: [
            { id: "west", start: [-10, 0], end: [0, 0], width: 6 },
            { id: "north", start: [0, 0], end: [0, -10], width: 6 },
          ],
          elevations: { "0.000,0.000": 3 },
        },
      }),
      selectedMapPointKey: "0.000,0.000",
    }));

    useStore.getState().moveMapPoint("0.000,0.000", [4, 2], 7);

    const state = useStore.getState();
    expect(state.composition.map.segments).toMatchObject([
      { start: [-10, 0], end: [4, 2] },
      { start: [4, 2], end: [0, -10] },
    ]);
    expect(state.composition.map.elevations).toEqual({ "4.000,2.000": 7 });
    expect(state.selectedMapPointKey).toBe("4.000,2.000");
  });

  it("keeps placed landmarks when changing detail packs", () => {
    useStore.getState().setEnvironment({
      pack: { id: "verdant-grove", variant: "temperate", quality: "auto" },
    });
    useStore.getState().addLandmark("evergreen");
    const landmark = useStore.getState().composition.environment.landmarks?.[0];
    expect(landmark?.packId).toBe("verdant-grove");

    useStore.getState().setEnvironment({
      pack: { id: "atlas-cavern", variant: "ember", quality: "auto" },
    });

    expect(useStore.getState().composition.environment.landmarks).toEqual([landmark]);
  });

  it("starts new compositions without placed landmarks", () => {
    useStore.setState((state) => ({
      composition: normalizeComposition({
        ...state.composition,
        environment: {
          pack: { id: "verdant-grove", variant: "temperate", quality: "high" },
          surfaces: { floor: "moss", wall: "stone" },
          landmarks: [{
            id: "landmark-a",
            assetId: "evergreen",
            packId: "verdant-grove",
            position: [2, 0, 3],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          }],
        },
      }),
      selectedLandmarkId: "landmark-a",
    }));

    useStore.getState().newComposition({ title: "Empty", bpm: 100 });

    expect(useStore.getState().composition.environment).toEqual({
      pack: { id: "verdant-grove", variant: "temperate", quality: "high" },
      surfaces: { floor: "moss", wall: "stone" },
    });
    expect(useStore.getState().selectedLandmarkId).toBeNull();
  });

  it("persists vertical wall movement and keeps it when cloning", () => {
    Object.assign(viewState, { x: 0, y: 0, z: 0, fx: 0, fz: -1 });
    useStore.getState().addWall();
    const wall = useStore.getState().composition.map.walls[0];

    useStore.getState().updateWall(wall.id, { elevation: 6 });
    useStore.getState().duplicateWall(wall.id);

    expect(useStore.getState().composition.map.walls).toMatchObject([
      { id: wall.id, elevation: 6 },
      { elevation: 6 },
    ]);
  });
});

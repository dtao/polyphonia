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
    publishProgress: null,
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
      setDirectivity: vi.fn(),
      replaceComposition: vi.fn().mockResolvedValue(undefined),
    };
    useStore.setState({ engine: engine as any });

    const store = useStore.getState();
    store.setTrackVolume("bass", 0.4);
    store.setTrackPosition("bass", [3, 2, -4]);
    store.setTrackFalloff("bass", { rolloff: 2 });
    store.setTrackDirectivity("bass", {
      direction: [1, 0],
      width: 90,
      dispersion: 60,
      outsideGain: 0.15,
    });

    expect(useStore.getState().composition.tracks[0]).toMatchObject({
      volume: 0.4,
      position: [3, 2, -4],
      rolloff: 2,
      directivity: {
        direction: [1, 0],
        width: 90,
        dispersion: 60,
        outsideGain: 0.15,
      },
    });
    expect(engine.setVolume).toHaveBeenCalledWith("bass", 0.4);
    expect(engine.setPosition).toHaveBeenCalledWith("bass", [3, 2, -4]);
    expect(engine.setFalloff).toHaveBeenCalledWith("bass", { rolloff: 2 });
    expect(engine.setDirectivity).toHaveBeenCalledWith("bass", {
      direction: [1, 0],
      width: 90,
      dispersion: 60,
      outsideGain: 0.15,
    });
    expect(useStore.getState().undoStack).toHaveLength(4);

    await useStore.getState().undo();
    expect(useStore.getState().composition.tracks[0].directivity).toBeUndefined();
    expect(useStore.getState().redoStack).toHaveLength(1);
    expect(engine.replaceComposition).toHaveBeenCalledTimes(1);

    await useStore.getState().redo();
    expect(useStore.getState().composition.tracks[0].directivity?.width).toBe(90);
    expect(engine.replaceComposition).toHaveBeenCalledTimes(2);
  });

  it("clones an uploaded track without copying its audio blob", async () => {
    const source = {
      ...defaultComposition.tracks[0],
      id: "uploaded",
      source: { kind: "file" as const, url: "blob:http://localhost/uploaded" },
    };
    const engine = { duplicateLiveTrack: vi.fn() };
    useStore.setState((state) => ({
      composition: { ...state.composition, tracks: [source] },
      engine: engine as any,
    }));

    await useStore.getState().duplicateTrack(source.id);

    const tracks = useStore.getState().composition.tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[1]).toMatchObject({
      audioAssetId: source.id,
      source: source.source,
    });
    expect(engine.duplicateLiveTrack).toHaveBeenCalledWith(source.id, tracks[1]);
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

  it("adds, edits, selects, and removes landmarks through history", async () => {
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

  it("connects a moved endpoint into the middle of another segment", () => {
    useStore.setState((state) => ({
      composition: normalizeComposition({
        ...state.composition,
        map: {
          ...state.composition.map,
          preset: "custom",
          segments: [
            { id: "branch", start: [0, 0], end: [5, 0], width: 6 },
            { id: "trunk", start: [10, 0], end: [10, 10], width: 8 },
          ],
          rooms: [{
            id: "room-a",
            center: [10, -4],
            rotation: 0,
            width: 8,
            depth: 8,
            height: 4,
            entrances: [{ side: "north", width: 4, offset: 0 }],
            attachment: { segmentId: "trunk", end: "start" },
          }],
          tiling: {
            ...state.composition.map.tiling,
            type: "path-loop",
            pathLoop: {
              start: { segmentId: "branch", end: "start" },
              end: { segmentId: "trunk", end: "end" },
            },
          },
          elevations: {
            "10.000,0.000": 2,
            "10.000,10.000": 6,
          },
        },
      }),
      selectedMapPointKey: "5.000,0.000",
    }));

    useStore.getState().moveMapPoint("5.000,0.000", [10.4, 5], 5);

    const state = useStore.getState();
    const joined = state.composition.map.segments.filter((segment) =>
      [segment.start, segment.end].some((point) => point[0] === 10 && point[1] === 5),
    );
    const continuation = state.composition.map.segments.find((segment) =>
      segment.id !== "trunk" && segment.start[0] === 10 && segment.start[1] === 5,
    );
    expect(joined).toHaveLength(3);
    expect(state.composition.map.elevations?.["10.000,5.000"]).toBe(4);
    expect(state.selectedMapPointKey).toBe("10.000,5.000");
    expect(state.composition.map.rooms[0].attachment).toEqual({ segmentId: "trunk", end: "start" });
    expect(state.composition.map.tiling.pathLoop?.end).toEqual({
      segmentId: continuation?.id,
      end: "end",
    });
  });

  it("keeps placed landmarks when changing other environment settings", () => {
    useStore.getState().addLandmark("evergreen");
    const landmark = useStore.getState().composition.environment.landmarks?.[0];
    expect(landmark?.assetId).toBe("evergreen");

    useStore.getState().setEnvironment({ surfaces: { floor: "moss" } });

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

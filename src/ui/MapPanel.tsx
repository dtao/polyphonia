import { canSetLoopEndpoint, clampToMap, CompositionMap, endpointKey, isPointInsideMap, MAP_PRESETS, MAX_FADE_POINTS, MAX_VISIBLE_RADIUS, MIN_VERTICAL_VISIBLE_RADIUS, MIN_VISIBLE_RADIUS, MapPreset, MapTilingType, WalkableSegment } from "../map";
import { newId } from "../id";
import { RADIAL_FADE_INNER, RADIAL_FADE_OUTER } from "../scene/fade";
import { pendingTeleport, useStore, viewState } from "../store";

const LABELS: Record<MapPreset, string> = {
  open: "Open",
  line: "Line",
  y: "Y",
  custom: "Custom",
};

const TILING_LABELS: Record<MapTilingType, string> = {
  none: "None",
  "path-loop": "Path",
  square: "Square",
  hex: "Hex",
};

export function MapPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const map = useStore((s) => s.composition.map);
  const tracks = useStore((s) => s.composition.tracks);
  const setMap = useStore((s) => s.setMap);
  const addWall = useStore((s) => s.addWall);
  const setTrackPosition = useStore((s) => s.setTrackPosition);
  const warnings = validateMap(map, tracks);
  const outsideTrackCount = countTracksOutsideMap(map, tracks);

  function setPreset(preset: Exclude<MapPreset, "custom">) {
    const next = MAP_PRESETS[preset];
    setMap({ ...next, start: map.start });
  }

  function snapStemsToMap() {
    for (const track of tracks) {
      const [x, y, z] = track.position;
      const [nx, nz] = clampToMap(map, [x, z]);
      if (Math.hypot(nx - x, nz - z) > 0.001) setTrackPosition(track.id, [nx, y, nz]);
    }
  }

  function setTilingType(type: MapTilingType) {
    setMap({ preset: "custom", tiling: { ...map.tiling, type, pathLoop: type === "path-loop" ? map.tiling.pathLoop : undefined } });
  }

  function setTileSize(tileSize: number) {
    if (!Number.isFinite(tileSize)) return;
    setMap({ preset: "custom", tiling: { ...map.tiling, tileSize } });
  }

  function setTilingOrigin(axis: 0 | 1, value: number) {
    if (!Number.isFinite(value)) return;
    const origin: [number, number] = [...map.tiling.origin];
    origin[axis] = value;
    setMap({ preset: "custom", tiling: { ...map.tiling, origin } });
  }

  function customizeVisibleRadius() {
    setMap({ visibleRadius: { inner: RADIAL_FADE_INNER, outer: RADIAL_FADE_OUTER } });
  }

  function setVisibleRadius(field: "inner" | "outer", value: number) {
    if (!Number.isFinite(value)) return;
    const current = map.visibleRadius ?? { inner: RADIAL_FADE_INNER, outer: RADIAL_FADE_OUTER };
    setMap({ visibleRadius: { ...current, [field]: value } });
  }

  function resetVisibleRadius() {
    setMap({ visibleRadius: undefined });
  }

  function addFadePointAtView() {
    const base = map.visibleRadius ?? { inner: RADIAL_FADE_INNER, outer: RADIAL_FADE_OUTER };
    const points = [...(map.fadePoints ?? []), { id: newId(), position: [viewState.x, viewState.z] as [number, number], inner: base.inner, outer: base.outer }];
    setMap({ fadePoints: points });
  }

  function updateFadePoint(id: string, field: "inner" | "outer", value: number) {
    if (!Number.isFinite(value)) return;
    setMap({ fadePoints: (map.fadePoints ?? []).map((p) => (p.id === id ? { ...p, [field]: value } : p)) });
  }

  function removeFadePoint(id: string) {
    setMap({ fadePoints: (map.fadePoints ?? []).filter((p) => p.id !== id) });
  }

  function customizeVerticalRadius() {
    setMap({ visibleRadiusVertical: { inner: 20, outer: 40 } });
  }

  function setVerticalRadius(field: "inner" | "outer", value: number) {
    if (!Number.isFinite(value)) return;
    const current = map.visibleRadiusVertical ?? { inner: 20, outer: 40 };
    setMap({ visibleRadiusVertical: { ...current, [field]: value } });
  }

  function resetVerticalRadius() {
    setMap({ visibleRadiusVertical: undefined });
  }

  if (!open) {
    return (
      <button style={collapsed} onClick={onOpen} title="Edit walkable map" data-edit-drawer>
        Map: {LABELS[map.preset]}
      </button>
    );
  }

  return (
    <div style={panel} data-edit-drawer>
      <div style={head}>
        <strong style={{ fontSize: 13 }}>Map</strong>
        <button style={closeBtn} onClick={onClose} title="Collapse map controls">
          ×
        </button>
      </div>
      <div style={presetGrid}>
        {(Object.keys(MAP_PRESETS) as Array<Exclude<MapPreset, "custom">>).map((preset) => {
          const active = map.preset === preset;
          return (
            <button key={preset} style={{ ...presetBtn, ...(active ? presetActive : null) }} onClick={() => setPreset(preset)}>
              {LABELS[preset]}
            </button>
          );
        })}
      </div>
      <div style={editorGroup}>
        <button
          style={{ ...actionBtn, width: "100%", marginTop: 10, opacity: outsideTrackCount ? 1 : 0.45 }}
          onClick={snapStemsToMap}
          disabled={!outsideTrackCount}
        >
          Snap stems to map
        </button>
        <button style={{ ...actionBtn, width: "100%", marginTop: 6 }} onClick={addWall} title="Add a free-standing sound-occluding wall">
          + Add wall
        </button>
        <div style={hint}>Select a path segment to set its width, or a terminal point to grow the path or attach a room or platform.</div>
        <div style={hint}>Shift+0–9 drops a numbered teleport pin at the view center; 0–9 jumps straight to it. Shift+digit on a pin lifts it.</div>
      </div>
      <div style={editorGroup}>
        <div style={sectionTitle}>Tiling</div>
        <div style={tilingGrid}>
          {(Object.keys(TILING_LABELS) as MapTilingType[]).map((type) => {
            const active = map.tiling.type === type;
            return (
              <button key={type} style={{ ...presetBtn, ...(active ? presetActive : null) }} onClick={() => setTilingType(type)}>
                {TILING_LABELS[type]}
              </button>
            );
          })}
        </div>
        {map.tiling.type === "path-loop" && <div style={tilingHint}>Select terminal path points to set the path-loop start and end.</div>}
        {(map.tiling.type === "square" || map.tiling.type === "hex") && (
          <div style={numericGrid}>
            <label style={fieldLabel}>
              Tile
              <input style={numberInput} type="number" min={5} max={1000} step={1} value={map.tiling.tileSize} onChange={(e) => setTileSize(e.currentTarget.valueAsNumber)} />
            </label>
            <label style={fieldLabel}>
              X
              <input style={numberInput} type="number" step={1} value={map.tiling.origin[0]} onChange={(e) => setTilingOrigin(0, e.currentTarget.valueAsNumber)} />
            </label>
            <label style={fieldLabel}>
              Z
              <input style={numberInput} type="number" step={1} value={map.tiling.origin[1]} onChange={(e) => setTilingOrigin(1, e.currentTarget.valueAsNumber)} />
            </label>
          </div>
        )}
      </div>

      <div style={editorGroup}>
        <div style={sectionTitle}>Visible radius</div>
        {map.visibleRadius ? (
          <>
            <div style={{ ...numericGrid, gridTemplateColumns: "1fr 1fr" }}>
              <label style={fieldLabel}>
                Full
                <input
                  style={numberInput}
                  type="number"
                  min={MIN_VISIBLE_RADIUS}
                  max={MAX_VISIBLE_RADIUS}
                  step={1}
                  value={map.visibleRadius.inner}
                  onChange={(e) => setVisibleRadius("inner", e.currentTarget.valueAsNumber)}
                />
              </label>
              <label style={fieldLabel}>
                Gone
                <input
                  style={numberInput}
                  type="number"
                  min={MIN_VISIBLE_RADIUS}
                  max={MAX_VISIBLE_RADIUS}
                  step={1}
                  value={map.visibleRadius.outer}
                  onChange={(e) => setVisibleRadius("outer", e.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
            <div style={tilingHint}>
              Objects stay fully visible within “Full” and fade to nothing by
              “Gone”.
            </div>
            <button style={{ ...actionBtn, width: "100%", marginTop: 8 }} onClick={resetVisibleRadius}>
              Reset to default
            </button>
          </>
        ) : (
          <>
            <div style={tilingHint}>
              Inheriting the default ({RADIAL_FADE_INNER} / {RADIAL_FADE_OUTER}).
              Customize how far the world stays visible around the listener.
            </div>
            <button style={{ ...actionBtn, width: "100%", marginTop: 8 }} onClick={customizeVisibleRadius}>
              Customize
            </button>
          </>
        )}
      </div>

      <div style={editorGroup}>
        <div style={sectionTitle}>Fade points</div>
        {(map.fadePoints ?? []).map((point, index) => (
          <div key={point.id} style={{ display: "flex", gap: 6, alignItems: "end", marginTop: index ? 6 : 0 }}>
            <button
              style={{ ...actionBtn, padding: "6px 8px" }}
              onClick={() => {
                pendingTeleport.value = { x: point.position[0], z: point.position[1] };
              }}
              title="Jump the view to this fade point"
            >
              ◎{index + 1}
            </button>
            <label style={fieldLabel}>
              Full
              <input
                style={numberInput}
                type="number"
                min={MIN_VISIBLE_RADIUS}
                max={MAX_VISIBLE_RADIUS}
                step={1}
                value={point.inner}
                onChange={(e) => updateFadePoint(point.id, "inner", e.currentTarget.valueAsNumber)}
              />
            </label>
            <label style={fieldLabel}>
              Gone
              <input
                style={numberInput}
                type="number"
                min={MIN_VISIBLE_RADIUS}
                max={MAX_VISIBLE_RADIUS}
                step={1}
                value={point.outer}
                onChange={(e) => updateFadePoint(point.id, "outer", e.currentTarget.valueAsNumber)}
              />
            </label>
            <button style={{ ...actionBtn, padding: "6px 9px" }} onClick={() => removeFadePoint(point.id)} title="Remove this fade point">
              ×
            </button>
          </div>
        ))}
        <button
          style={{ ...actionBtn, width: "100%", marginTop: 8 }}
          onClick={addFadePointAtView}
          disabled={(map.fadePoints?.length ?? 0) >= MAX_FADE_POINTS}
        >
          Add fade point at view
        </button>
        <div style={tilingHint}>
          Spots where the visible radius differs; it blends between them as the
          listener moves. With any points set, they override the flat radius
          above.
        </div>
      </div>

      <div style={editorGroup}>
        <div style={sectionTitle}>Vertical visibility</div>
        {map.visibleRadiusVertical ? (
          <>
            <div style={{ ...numericGrid, gridTemplateColumns: "1fr 1fr" }}>
              <label style={fieldLabel}>
                Full
                <input
                  style={numberInput}
                  type="number"
                  min={MIN_VERTICAL_VISIBLE_RADIUS}
                  max={MAX_VISIBLE_RADIUS}
                  step={1}
                  value={map.visibleRadiusVertical.inner}
                  onChange={(e) => setVerticalRadius("inner", e.currentTarget.valueAsNumber)}
                />
              </label>
              <label style={fieldLabel}>
                Gone
                <input
                  style={numberInput}
                  type="number"
                  min={MIN_VERTICAL_VISIBLE_RADIUS}
                  max={MAX_VISIBLE_RADIUS}
                  step={1}
                  value={map.visibleRadiusVertical.outer}
                  onChange={(e) => setVerticalRadius("outer", e.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
            <div style={tilingHint}>
              How far you can see up/down, independent of the radius around you.
              Scene fog stays horizontal, so distant opaque terrain above/below
              dims rather than fully fogging.
            </div>
            <button style={{ ...actionBtn, width: "100%", marginTop: 8 }} onClick={resetVerticalRadius}>
              Reset (no vertical limit)
            </button>
          </>
        ) : (
          <>
            <div style={tilingHint}>
              No vertical limit — you can see all the way up and down. Customize
              to fade objects far above or below the listener.
            </div>
            <button style={{ ...actionBtn, width: "100%", marginTop: 8 }} onClick={customizeVerticalRadius}>
              Customize
            </button>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <div style={warningsBox}>
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      <div style={meta}>{map.segments.length ? "Lighted walkable path" : "Unbounded empty space"}</div>
    </div>
  );
}

function findPoint(map: { segments: Array<{ start: [number, number]; end: [number, number] }> }, key: string): [number, number] | null {
  for (const segment of map.segments) {
    if (pointKey(segment.start) === key) return segment.start;
    if (pointKey(segment.end) === key) return segment.end;
  }
  return null;
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

function validateMap(map: CompositionMap, tracks: Array<{ position: [number, number, number] }>): string[] {
  const warnings: string[] = [];
  if (map.preset !== "open" && map.segments.length === 0) warnings.push("This map has no walkable corridors.");
  const components = countConnectedComponents(map.segments);
  if (components > 1) warnings.push("This map has disconnected corridors.");
  const outside = countTracksOutsideMap(map, tracks);
  if (outside > 0) warnings.push(`${outside} stem${outside === 1 ? "" : "s"} outside the walkable area.`);
  warnings.push(...validateTiling(map));
  return warnings;
}

function validateTiling(map: CompositionMap): string[] {
  const warnings: string[] = [];
  if (map.tiling.type === "path-loop") {
    const loop = map.tiling.pathLoop;
    const startKey = endpointKey(map, loop?.start);
    const endKey = endpointKey(map, loop?.end);
    if (!loop?.start || !loop.end) warnings.push("Path-loop tiling needs both a start and end terminal point.");
    else if (!startKey || !endKey) warnings.push("Path-loop tiling references a missing path endpoint.");
    else if (startKey === endKey) warnings.push("Path-loop start and end must be different terminal points.");
    else {
      if (!canSetLoopEndpoint(map, startKey)) warnings.push("Path-loop start must be a terminal point without an attached room.");
      if (!canSetLoopEndpoint(map, endKey)) warnings.push("Path-loop end must be a terminal point without an attached room.");
    }
  }
  if (map.tiling.type === "square" || map.tiling.type === "hex") {
    if (!Number.isFinite(map.tiling.tileSize) || map.tiling.tileSize <= 0) warnings.push(`${map.tiling.type === "square" ? "Square" : "Hex"} tiling needs a positive tile size.`);
    if (!map.tiling.origin.every(Number.isFinite)) warnings.push(`${map.tiling.type === "square" ? "Square" : "Hex"} tiling needs a finite origin.`);
    warnings.push(`${map.tiling.type === "square" ? "Square" : "Hex"} tiling is saved in the model; repeated rendering/audio comes in Milestone 5 item 31.`);
  }
  return warnings;
}

function countTracksOutsideMap(map: CompositionMap, tracks: Array<{ position: [number, number, number] }>): number {
  if (!map.segments.length) return 0;
  return tracks.filter((track) => !isPointInsideMap(map, [track.position[0], track.position[2]])).length;
}

function countConnectedComponents(segments: WalkableSegment[]): number {
  if (!segments.length) return 0;
  const adjacency = new Map<string, Set<string>>();
  for (const segment of segments) {
    const start = pointKey(segment.start);
    const end = pointKey(segment.end);
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start)?.add(end);
    adjacency.get(end)?.add(start);
  }
  let count = 0;
  const visited = new Set<string>();
  for (const key of adjacency.keys()) {
    if (visited.has(key)) continue;
    count += 1;
    const stack = [key];
    visited.add(key);
    while (stack.length) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return count;
}

const collapsed: React.CSSProperties = {
  position: "absolute",
  top: 140,
  left: 14,
  zIndex: 10,
  height: 36,
  boxSizing: "border-box",
  padding: "0 14px",
  fontSize: 13,
  lineHeight: "34px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(12,15,28,0.72)",
  color: "rgba(255,255,255,0.84)",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
  backdropFilter: "blur(8px)",
};

const panel: React.CSSProperties = {
  position: "absolute",
  top: 140,
  left: 14,
  zIndex: 30,
  width: 250,
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 10,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const closeBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.7)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
};

const presetGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 6,
};

const tilingGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const presetBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 13,
};

const presetActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const actionBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.84)",
  cursor: "pointer",
  fontSize: 12,
};

const editorGroup: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const sectionTitle: React.CSSProperties = {
  marginBottom: 8,
  color: "rgba(255,255,255,0.7)",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
};

const tilingHint: React.CSSProperties = {
  marginTop: 8,
  color: "rgba(255,255,255,0.55)",
  fontSize: 11,
  lineHeight: 1.35,
};

const numericGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 6,
  marginTop: 8,
};

const fieldLabel: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "rgba(255,255,255,0.58)",
  fontSize: 11,
};

const numberInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  padding: "6px 7px",
  fontSize: 12,
};

const meta: React.CSSProperties = {
  marginTop: 8,
  color: "rgba(255,255,255,0.55)",
  fontSize: 11,
};

const hint: React.CSSProperties = {
  marginTop: 9,
  color: "rgba(143,255,232,0.82)",
  fontSize: 11,
  lineHeight: 1.35,
};

const warningsBox: React.CSSProperties = {
  display: "grid",
  gap: 4,
  marginTop: 10,
  padding: "8px 9px",
  borderRadius: 7,
  border: "1px solid rgba(255,209,102,0.28)",
  background: "rgba(255,209,102,0.1)",
  color: "rgba(255,232,173,0.9)",
  fontSize: 11,
  lineHeight: 1.35,
};

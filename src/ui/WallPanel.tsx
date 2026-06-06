import { DEFAULT_WALL_THICKNESS, MAX_WALL_THICKNESS, MIN_WALL_THICKNESS } from "../map";
import { useStore } from "../store";

// Bottom-left inspector for the selected standalone wall (a sound occluder).
export function WallPanel() {
  const mode = useStore((s) => s.mode);
  const wall = useStore((s) => s.composition.map.walls.find((w) => w.id === s.selectedWallId));
  const { updateWall, deleteWall } = useStore.getState();

  if (mode !== "edit" || !wall) return null;

  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);

  return (
    <div style={panel} data-inspector>
      <div style={title}>Wall</div>

      <label style={{ display: "block", marginBottom: 8 }}>
        <div style={sliderHead}>
          <span>Height</span>
          <span>{wall.height.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={12}
          step={0.2}
          value={wall.height}
          onChange={(e) => updateWall(wall.id, { height: parseFloat(e.target.value) })}
          style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <div style={sliderHead}>
          <span>Thickness</span>
          <span>{(wall.wallThickness ?? DEFAULT_WALL_THICKNESS).toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={MIN_WALL_THICKNESS}
          max={MAX_WALL_THICKNESS}
          step={0.1}
          value={wall.wallThickness ?? DEFAULT_WALL_THICKNESS}
          onChange={(e) => updateWall(wall.id, { wallThickness: parseFloat(e.target.value) })}
          style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
        />
      </label>

      <div style={meta}>
        Length {length.toFixed(1)} · Elevation {(wall.elevation ?? 0).toFixed(1)}
      </div>

      <button style={deleteBtn} onClick={() => deleteWall(wall.id)} title="Delete selected wall (Delete)">
        Delete wall
      </button>
      <div style={hint}>Use the axis gizmo to move the wall in 3D. Drag the green handles to reshape it. Walls only occlude sound; they don't block walking.</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 240,
  padding: 16,
  borderRadius: 12,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const title: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 2,
};

const meta: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: "rgba(255,255,255,0.55)",
};

const deleteBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "8px",
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
};

const hint: React.CSSProperties = { marginTop: 10, fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };

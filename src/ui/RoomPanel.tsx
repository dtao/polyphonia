import { RoomSide } from "../map";
import { useStore } from "../store";

// Bottom-left inspector for the selected room (like the stem panel). Shown in
// edit mode when a room is selected.
export function RoomPanel() {
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.composition.map.rooms.find((r) => r.id === s.selectedRoomId));
  const { updateRoom, deleteRoom } = useStore.getState();

  if (mode !== "edit" || !room) return null;

  const wallSpan = room.entranceSide === "north" || room.entranceSide === "south" ? room.width : room.depth;

  return (
    <div style={panel} data-inspector>
      <div style={title}>Room</div>

      <Slider label="Width" value={room.width} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { width: v })} />
      <Slider label="Depth" value={room.depth} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { depth: v })} />
      <Slider label="Height" value={room.height} min={2} max={10} step={0.2} onChange={(v) => updateRoom(room.id, { height: v })} />
      <Slider
        label="Entrance width"
        value={room.entranceWidth}
        min={1}
        max={Math.max(2, wallSpan - 1)}
        step={0.5}
        onChange={(v) => updateRoom(room.id, { entranceWidth: v })}
      />

      <div style={{ ...sliderHead, marginTop: 8 }}>
        <span>Entrance side</span>
      </div>
      <div style={sideGrid}>
        {(["north", "south", "east", "west"] as RoomSide[]).map((side) => (
          <button
            key={side}
            style={{ ...sideBtn, ...(room.entranceSide === side ? sideActive : null) }}
            onClick={() => updateRoom(room.id, { entranceSide: side, entranceOffset: 0 })}
          >
            {side[0].toUpperCase() + side.slice(1)}
          </button>
        ))}
      </div>

      <button style={deleteBtn} onClick={() => deleteRoom(room.id)} title="Delete selected room (Delete)">
        Delete room
      </button>
      <div style={hint}>Drag the room to move it; keep the doorway against a path so it stays connected.</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <div style={sliderHead}>
        <span>{label}</span>
        <span>{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
      />
    </label>
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

const sideGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginTop: 6,
};

const sideBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 13,
};

const sideActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
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

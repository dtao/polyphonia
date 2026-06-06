import { useStore } from "../store";

// Bottom-left inspector for the selected room. Entrances are edited in the 3D
// view (a "+" on each wall adds one; drag a doorway to move it) and via the
// EntrancePanel when a doorway is selected, so this panel stays room-level.
export function RoomPanel() {
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.composition.map.rooms.find((r) => r.id === s.selectedRoomId));
  const selectedEntranceIndex = useStore((s) => s.selectedEntranceIndex);
  const { updateRoom, deleteRoom } = useStore.getState();

  if (mode !== "edit" || !room || selectedEntranceIndex !== null) return null;

  const attached = !!room.attachment;

  return (
    <div style={panel} data-inspector>
      <div style={title}>Room</div>

      <Slider label="Width" value={room.width} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { width: v })} />
      <Slider label="Depth" value={room.depth} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { depth: v })} />
      <Slider label="Height" value={room.height} min={2} max={10} step={0.2} onChange={(v) => updateRoom(room.id, { height: v })} />

      <button style={deleteBtn} onClick={() => deleteRoom(room.id)} title="Delete selected room (Delete)">
        Delete room
      </button>
      <div style={hint}>
        Click a <strong>+</strong> on any wall to add a doorway, then drag the doorway to position it or click it to edit its width and door.
        {attached ? " This room is attached to a path point; move that point to move the room." : ""}
      </div>
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

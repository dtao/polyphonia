import { RoomEntrance, RoomSide, ROOM_WALL_THICKNESS } from "../map";
import { useStore } from "../store";

// Bottom-left inspector for the selected room (like the stem panel). Shown in
// edit mode when a room is selected. A room can carry several doorways; the
// first entrance of an attached room is locked to face its path.
export function RoomPanel() {
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.composition.map.rooms.find((r) => r.id === s.selectedRoomId));
  const { updateRoom, deleteRoom } = useStore.getState();

  if (mode !== "edit" || !room) return null;

  const attached = !!room.attachment;

  function setEntrance(index: number, patch: Partial<RoomEntrance>) {
    if (!room) return;
    updateRoom(room.id, { entrances: room.entrances.map((e, i) => (i === index ? { ...e, ...patch } : e)) });
  }

  function addEntrance() {
    if (!room) return;
    updateRoom(room.id, { entrances: [...room.entrances, { side: "south", width: 5, offset: 0 }] });
  }

  function removeEntrance(index: number) {
    if (!room || room.entrances.length <= 1) return;
    updateRoom(room.id, { entrances: room.entrances.filter((_, i) => i !== index) });
  }

  return (
    <div style={panel} data-inspector>
      <div style={title}>Room</div>

      <Slider label="Width" value={room.width} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { width: v })} />
      <Slider label="Depth" value={room.depth} min={3} max={40} step={0.5} onChange={(v) => updateRoom(room.id, { depth: v })} />
      <Slider label="Height" value={room.height} min={2} max={10} step={0.2} onChange={(v) => updateRoom(room.id, { height: v })} />

      <div style={{ ...sliderHead, marginTop: 10, marginBottom: 6 }}>
        <span>Entrances</span>
        <span>{room.entrances.length}</span>
      </div>
      {room.entrances.map((entrance, index) => {
        const locked = attached && index === 0;
        const span = (entrance.side === "north" || entrance.side === "south" ? room.width : room.depth) - ROOM_WALL_THICKNESS * 2;
        const maxOffset = Math.max(0, span / 2 - entrance.width / 2);
        return (
          <div key={index} style={entranceCard}>
            <div style={entranceHead}>
              <span style={{ opacity: 0.7, fontSize: 11 }}>{locked ? "Doorway (to path)" : `Doorway ${index + 1}`}</span>
              {!locked && room.entrances.length > 1 && (
                <button style={removeBtn} onClick={() => removeEntrance(index)} title="Remove this doorway">
                  ×
                </button>
              )}
            </div>
            {!locked && (
              <div style={sideGrid}>
                {(["north", "south", "east", "west"] as RoomSide[]).map((side) => (
                  <button
                    key={side}
                    style={{ ...sideBtn, ...(entrance.side === side ? sideActive : null) }}
                    onClick={() => setEntrance(index, { side, offset: 0 })}
                  >
                    {side[0].toUpperCase() + side.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <Slider label="Width" value={entrance.width} min={1} max={Math.max(2, span - 1)} step={0.5} onChange={(v) => setEntrance(index, { width: v })} />
            {!locked && maxOffset > 0.01 && (
              <Slider label="Offset" value={entrance.offset} min={-maxOffset} max={maxOffset} step={0.5} onChange={(v) => setEntrance(index, { offset: v })} />
            )}
          </div>
        );
      })}
      <button style={addBtn} onClick={addEntrance} title="Add another doorway to this room">
        + Add doorway
      </button>

      <button style={deleteBtn} onClick={() => deleteRoom(room.id)} title="Delete selected room (Delete)">
        Delete room
      </button>
      <div style={hint}>{attached ? "Attached to a terminal path point. Move the path point to move the room; add doorways on other walls to connect more." : "Legacy room: place a doorway against a path so it stays connected."}</div>
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
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto",
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

const entranceCard: React.CSSProperties = {
  marginBottom: 8,
  padding: 8,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.03)",
};

const entranceHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6,
};

const removeBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
};

const sideGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginBottom: 8,
};

const sideBtn: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 12,
};

const sideActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const addBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  borderRadius: 7,
  border: "1px solid rgba(91,140,255,0.4)",
  background: "rgba(91,140,255,0.14)",
  color: "rgba(199,216,255,0.95)",
  cursor: "pointer",
  fontSize: 13,
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

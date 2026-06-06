import { DoorConfig, maxEntranceWidth } from "../map";
import { useStore } from "../store";

type DoorMode = "none" | DoorConfig["openFrom"];
const DOOR_MODES: Array<{ value: DoorMode; label: string }> = [
  { value: "none", label: "Opening" },
  { value: "both", label: "Door" },
  { value: "outside", label: "From out" },
  { value: "inside", label: "From in" },
];

// Bottom-left inspector for a selected room doorway.
export function EntrancePanel() {
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.composition.map.rooms.find((r) => r.id === s.selectedRoomId));
  const index = useStore((s) => s.selectedEntranceIndex);
  const { updateEntrance, removeEntrance } = useStore.getState();

  if (mode !== "edit" || !room || index === null) return null;
  const entrance = room.entrances[index];
  if (!entrance) return null;

  const locked = !!room.attachment && index === 0;
  const maxWidth = maxEntranceWidth(room, entrance.side);

  function setDoorMode(value: DoorMode) {
    if (!room) return;
    updateEntrance(room.id, index!, { door: value === "none" ? undefined : { openFrom: value } });
  }

  return (
    <div style={panel} data-inspector>
      <div style={title}>Doorway · {entrance.side[0].toUpperCase() + entrance.side.slice(1)}</div>

      <label style={{ display: "block", marginBottom: 10 }}>
        <div style={sliderHead}>
          <span>Width</span>
          <span>{entrance.width.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(2, maxWidth)}
          step={0.5}
          value={entrance.width}
          onChange={(e) => updateEntrance(room.id, index!, { width: parseFloat(e.target.value) })}
          style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
        />
      </label>

      <div style={sectionLabel}>Door</div>
      <div style={doorGrid}>
        {DOOR_MODES.map((m) => {
          const current = (entrance.door?.openFrom ?? "none") === m.value;
          return (
            <button key={m.value} style={{ ...doorBtn, ...(current ? doorActive : null) }} onClick={() => setDoorMode(m.value)}>
              {m.label}
            </button>
          );
        })}
      </div>

      {!locked && (
        <button style={deleteBtn} onClick={() => removeEntrance(room.id, index!)} title="Remove this doorway (Delete)">
          Remove doorway
        </button>
      )}
      <div style={hint}>{locked ? "This doorway connects the room to its path; it can't be removed." : "Drag the doorway in the view to move it along the wall."}</div>
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

const sectionLabel: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 };

const doorGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 1fr",
  gap: 4,
};

const doorBtn: React.CSSProperties = {
  padding: "6px 2px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.74)",
  cursor: "pointer",
  fontSize: 10,
};

const doorActive: React.CSSProperties = {
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

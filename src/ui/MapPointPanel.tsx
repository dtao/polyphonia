import { canAddBranchAtPoint, canAddRoomAtPoint, endpointCount, roomAttachedToPoint } from "../map";
import { useStore } from "../store";

// Bottom-left panel shown when a path point is selected in edit mode. Grow the
// path (a new branch segment you can then drag) or attach a room whose doorway
// opens onto this point.
export function MapPointPanel() {
  const mode = useStore((s) => s.mode);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const map = useStore((s) => s.composition.map);
  const addBranchAtPoint = useStore((s) => s.addBranchAtPoint);
  const addRoomAtPoint = useStore((s) => s.addRoomAtPoint);
  const deleteMapPoint = useStore((s) => s.deleteMapPoint);

  if (mode !== "edit" || !selectedMapPointKey) return null;

  const count = endpointCount(map, selectedMapPointKey);
  const attachedRoom = roomAttachedToPoint(map, selectedMapPointKey);
  const canAddBranch = canAddBranchAtPoint(map, selectedMapPointKey);
  const canAddRoom = canAddRoomAtPoint(map, selectedMapPointKey);
  const state = attachedRoom ? "Room" : count > 1 ? "Joint" : "Terminal";
  const branchTitle = attachedRoom ? "This terminal already leads into a room" : "Grow the path (B); drag the new point to place it";
  const roomTitle = attachedRoom ? "This terminal already leads into a room" : "Rooms can only be added to terminal points";

  return (
    <div style={panel} data-inspector>
      <div style={title}>Path point · {state}</div>
      <button
        style={{ ...btn, ...(!canAddBranch ? disabledBtn : null) }}
        onClick={() => canAddBranch && addBranchAtPoint(selectedMapPointKey)}
        disabled={!canAddBranch}
        title={branchTitle}
      >
        ↳ Add branch
      </button>
      <button
        style={{ ...btn, ...(!canAddRoom ? disabledBtn : null) }}
        onClick={() => canAddRoom && addRoomAtPoint(selectedMapPointKey)}
        disabled={!canAddRoom}
        title={canAddRoom ? "Attach a room with its doorway here" : roomTitle}
      >
        ⬚ Add room here
      </button>
      <button style={deleteBtn} onClick={() => deleteMapPoint(selectedMapPointKey)} title="Delete selected point (Delete)">
        Delete point
      </button>
      <div style={hint}>Joints can keep growing new branches. Only terminal points can become rooms, and rooms stay attached to their endpoint.</div>
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
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const title: React.CSSProperties = { fontWeight: 600 };

const btn: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(91,140,255,0.18)",
  color: "white",
  cursor: "pointer",
  fontSize: 14,
  textAlign: "left",
};

const disabledBtn: React.CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};

const deleteBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

const hint: React.CSSProperties = { fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };

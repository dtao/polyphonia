import { attachmentForPoint, canAddBranchAtPoint, canAddRoomAtPoint, canSetLoopEndpoint, endpointCount, loopRoleForPoint, roomAttachedToPoint } from "../map";
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
  const setMap = useStore((s) => s.setMap);

  if (mode !== "edit" || !selectedMapPointKey) return null;

  const pointKey = selectedMapPointKey;
  const count = endpointCount(map, pointKey);
  const attachedRoom = roomAttachedToPoint(map, pointKey);
  const canAddBranch = canAddBranchAtPoint(map, pointKey);
  const canAddRoom = canAddRoomAtPoint(map, pointKey);
  const canSetLoop = canSetLoopEndpoint(map, pointKey);
  const loopRole = loopRoleForPoint(map, pointKey);
  const state = attachedRoom ? "Room" : count > 1 ? "Joint" : "Terminal";
  const branchTitle = attachedRoom ? "This terminal already leads into a room" : "Grow the path (B); drag the new point to place it";
  const roomTitle = attachedRoom ? "This terminal already leads into a room" : "Rooms can only be added to terminal points";
  const loopTitle = attachedRoom ? "Room endpoints cannot be map loop points" : "Loop points must be terminal path points";

  function setLoopEndpoint(which: "start" | "end") {
    if (!canSetLoop) return;
    const endpoint = attachmentForPoint(map, pointKey);
    if (!endpoint) return;
    const loop = { ...map.loop, [which]: endpoint };
    if (which === "start" && loopRole === "end") loop.end = undefined;
    if (which === "end" && loopRole === "start") loop.start = undefined;
    setMap({ preset: "custom", loop });
  }

  function clearLoop() {
    setMap({ preset: "custom", loop: undefined });
  }

  return (
    <div style={panel} data-inspector>
      <div style={title}>Path point · {state}</div>
      <button
        style={{ ...btn, ...(!canAddBranch ? disabledBtn : null) }}
        onClick={() => canAddBranch && addBranchAtPoint(pointKey)}
        disabled={!canAddBranch}
        title={branchTitle}
      >
        ↳ Add branch
      </button>
      <button
        style={{ ...btn, ...(!canAddRoom ? disabledBtn : null) }}
        onClick={() => canAddRoom && addRoomAtPoint(pointKey)}
        disabled={!canAddRoom}
        title={canAddRoom ? "Attach a room with its doorway here" : roomTitle}
      >
        ⬚ Add room here
      </button>
      <button style={deleteBtn} onClick={() => deleteMapPoint(pointKey)} title="Delete selected point (Delete)">
        Delete point
      </button>
      <div style={sectionLabel}>Map loop</div>
      <button
        style={{ ...btn, ...(!canSetLoop ? disabledBtn : null), ...(loopRole === "start" ? activeBtn : null) }}
        onClick={() => setLoopEndpoint("start")}
        disabled={!canSetLoop}
        title={canSetLoop ? "Use this terminal point as the path loop start" : loopTitle}
      >
        Set loop start
      </button>
      <button
        style={{ ...btn, ...(!canSetLoop ? disabledBtn : null), ...(loopRole === "end" ? activeBtn : null) }}
        onClick={() => setLoopEndpoint("end")}
        disabled={!canSetLoop}
        title={canSetLoop ? "Use this terminal point as the path loop end" : loopTitle}
      >
        Set loop end
      </button>
      {map.loop && (
        <button style={secondaryBtn} onClick={clearLoop} title="Remove the path loop">
          Clear loop
        </button>
      )}
      <div style={hint}>Joints can keep growing new branches. Only terminal points can become rooms or map loop points.</div>
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

const activeBtn: React.CSSProperties = {
  border: "1px solid rgba(143,255,232,0.78)",
  background: "rgba(143,255,232,0.2)",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.76)",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
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

const sectionLabel: React.CSSProperties = { marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.5)" };

const hint: React.CSSProperties = { fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };

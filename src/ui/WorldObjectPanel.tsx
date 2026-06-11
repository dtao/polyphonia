import { useStore } from "../store";
import { WORLD_OBJECT_SPECS } from "../worldgen/objects";

// Bottom-left inspector for a selected generated-environment object. Shown
// when a tree/rock/… is clicked in edit mode; the gizmo in the scene handles
// moving, this panel handles properties, locking, and deletion.
export function WorldObjectPanel() {
  const mode = useStore((s) => s.mode);
  const selectedId = useStore((s) => s.selectedWorldObjectId);
  const generated = useStore((s) => s.composition.environment.generated);
  const updateWorldObject = useStore((s) => s.updateWorldObject);
  const deleteWorldObject = useStore((s) => s.deleteWorldObject);
  const duplicateWorldObject = useStore((s) => s.duplicateWorldObject);
  const setWorldObjectLock = useStore((s) => s.setWorldObjectLock);
  const object = generated?.objects.find((candidate) => candidate.id === selectedId);

  if (mode !== "edit" || !generated || !object) return null;

  const spec = WORLD_OBJECT_SPECS[object.kind];
  const locked = !!generated.locks[object.id];
  const badges = [
    locked ? "locked" : null,
    object.userPlaced ? "placed by you" : object.edit ? `${object.edit} edit` : null,
  ].filter(Boolean);

  return (
    <div style={panel} data-inspector>
      <div style={title}>
        {spec.label}
        {badges.length > 0 && <span style={badgeText}> · {badges.join(" · ")}</span>}
      </div>

      <label style={field}>
        <span>Rotation</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(((object.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 180 / Math.PI)}
          onChange={(event) => updateWorldObject(object.id, { yaw: (parseFloat(event.target.value) * Math.PI) / 180 })}
          style={range}
        />
      </label>

      <label style={field}>
        <span>Scale</span>
        <input
          type="range"
          min={0.3}
          max={3.5}
          step={0.05}
          value={object.scale}
          onChange={(event) => updateWorldObject(object.id, { scale: parseFloat(event.target.value) })}
          style={range}
        />
      </label>

      <label style={field}>
        <span>Height</span>
        <input
          type="range"
          min={-2}
          max={4}
          step={0.1}
          value={object.position[1]}
          onChange={(event) =>
            updateWorldObject(object.id, {
              position: [object.position[0], parseFloat(event.target.value), object.position[2]],
            })
          }
          style={range}
        />
      </label>

      <label style={field}>
        <span>Color</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="color"
            value={object.tint ?? spec.parts.find((part) => part.tintable)?.color ?? "#ffffff"}
            onChange={(event) => updateWorldObject(object.id, { tint: event.target.value })}
            style={colorInput}
          />
          {object.tint && (
            <button style={miniButton} onClick={() => updateWorldObject(object.id, { tint: undefined })} title="Reset to the biome color">
              reset
            </button>
          )}
        </span>
      </label>

      <button
        style={{ ...actionButton, ...(locked ? lockedButton : null) }}
        onClick={() => setWorldObjectLock(object.id, !locked)}
        title="Locked objects are never replaced by regeneration"
      >
        {locked ? "🔒 Locked from regeneration" : "🔓 Lock from regeneration"}
      </button>
      <button style={actionButton} onClick={() => duplicateWorldObject(object.id)}>
        Duplicate
      </button>
      <button style={deleteButton} onClick={() => deleteWorldObject(object.id)}>
        Delete object
      </button>
      <div style={hint}>
        Drag the gizmo to move it. Moved, recolored, locked, and hand-placed objects survive regeneration
        (see the World panel's preservation modes).
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 250,
  boxSizing: "border-box",
  padding: 16,
  borderRadius: 8,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const title: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };
const badgeText: React.CSSProperties = { fontWeight: 400, fontSize: 11, color: "rgba(255,255,255,0.55)" };
const field: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1fr",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
  fontSize: 12,
  color: "rgba(255,255,255,0.76)",
};
const range: React.CSSProperties = { width: "100%", accentColor: "#5b8cff" };
const colorInput: React.CSSProperties = {
  width: 30,
  height: 24,
  padding: 0,
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
};
const miniButton: React.CSSProperties = {
  padding: "3px 8px",
  borderRadius: 5,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.75)",
  cursor: "pointer",
  fontSize: 10,
};
const actionButton: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: 8,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
};
const lockedButton: React.CSSProperties = {
  border: "1px solid rgba(255,209,102,0.5)",
  background: "rgba(255,209,102,0.14)",
  color: "#ffd166",
};
const deleteButton: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: 8,
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
};
const hint: React.CSSProperties = {
  marginTop: 10,
  fontSize: 11,
  lineHeight: 1.4,
  color: "rgba(255,255,255,0.55)",
};

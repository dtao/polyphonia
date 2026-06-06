import { environmentPackById } from "../environmentPacks";
import { useStore } from "../store";

export function LandmarkPanel() {
  const mode = useStore((state) => state.mode);
  const environment = useStore((state) => state.composition.environment);
  const selectedId = useStore((state) => state.selectedLandmarkId);
  const updateLandmark = useStore((state) => state.updateLandmark);
  const deleteLandmark = useStore((state) => state.deleteLandmark);
  const placement = environment.landmarks?.find((landmark) => landmark.id === selectedId);
  const pack = environmentPackById(environment.pack?.id);
  const asset = pack?.landmarks.find((landmark) => landmark.id === placement?.assetId);

  if (mode !== "edit" || !placement) return null;

  return (
    <div style={panel} data-inspector>
      <div style={title}>{asset?.name ?? "Landmark"}</div>

      <label style={field}>
        <span>Rotation</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(placement.rotation[1] * 180 / Math.PI)}
          onChange={(event) =>
            updateLandmark(placement.id, {
              rotation: [
                placement.rotation[0],
                parseFloat(event.target.value) * Math.PI / 180,
                placement.rotation[2],
              ],
            })
          }
          style={range}
        />
      </label>

      <label style={field}>
        <span>Scale</span>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.05}
          value={placement.scale[0]}
          onChange={(event) => {
            const scale = parseFloat(event.target.value);
            updateLandmark(placement.id, { scale: [scale, scale, scale] });
          }}
          style={range}
        />
      </label>

      <button style={deleteButton} onClick={() => deleteLandmark(placement.id)}>
        Delete landmark
      </button>
      <div style={hint}>Drag the transform gizmo to place this visual asset. It does not affect walking or acoustics.</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 240,
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

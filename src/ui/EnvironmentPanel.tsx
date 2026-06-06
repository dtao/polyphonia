import { environmentPackById, ENVIRONMENT_PACKS } from "../environmentPacks";
import { useStore } from "../store";

export function EnvironmentPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const environment = useStore((s) => s.composition.environment);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const addLandmark = useStore((s) => s.addLandmark);
  const selectedPack = environmentPackById(environment.pack?.id);

  if (!open) {
    return (
      <button style={collapsed} onClick={onOpen} title="Choose detail pack" data-edit-drawer>
        Detail: {selectedPack?.name ?? "None"}
      </button>
    );
  }

  return (
    <div style={panel} data-edit-drawer>
      <div style={head}>
        <strong style={{ fontSize: 13 }}>Detail Pack</strong>
        <button style={closeBtn} onClick={onClose} title="Collapse detail pack controls">
          ×
        </button>
      </div>

      <label style={{ display: "block" }}>
        <div style={label}>Pack</div>
        <select
          value={selectedPack?.id ?? ""}
          onChange={(event) => {
            const pack = environmentPackById(event.target.value);
            setEnvironment({
              pack: pack ? { id: pack.id, variant: pack.variants[0], quality: "auto" } : undefined,
              landmarks: [],
            });
          }}
          style={select}
        >
          <option value="">None</option>
          {ENVIRONMENT_PACKS.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.name}
            </option>
          ))}
        </select>
      </label>

      {selectedPack && (
        <>
          <label style={{ display: "block", marginTop: 8 }}>
            <div style={label}>Asset quality</div>
            <select
              value={environment.pack?.quality ?? "auto"}
              onChange={(event) =>
                setEnvironment({
                  pack: {
                    ...environment.pack!,
                    quality: event.target.value as "auto" | "low" | "high",
                  },
                })
              }
              style={select}
            >
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
          </label>

          <div style={meta}>{selectedPack.description}</div>
          {selectedPack.attribution.map((item) => (
            <div key={`${item.title}:${item.author}`} style={attribution}>
              {item.title} by {item.author} · {item.license}
            </div>
          ))}

          {selectedPack.landmarks.length > 0 && (
            <div style={landmarkSection}>
              <div style={label}>Landmarks</div>
              {selectedPack.landmarks.map((landmark) => (
                <button
                  key={landmark.id}
                  style={landmarkButton}
                  onClick={() => addLandmark(landmark.id)}
                  title={`Place ${landmark.name}`}
                >
                  <span aria-hidden>＋</span>
                  <span>{landmark.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const collapsed: React.CSSProperties = {
  position: "absolute",
  top: 92,
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
  top: 92,
  left: 14,
  zIndex: 30,
  width: 250,
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 8,
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

const label: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.72)",
};

const select: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "7px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#151a2b",
  color: "white",
  fontSize: 12,
};

const meta: React.CSSProperties = {
  marginTop: 8,
  color: "rgba(255,255,255,0.55)",
  fontSize: 11,
};

const attribution: React.CSSProperties = {
  marginTop: 5,
  color: "rgba(255,255,255,0.42)",
  fontSize: 10,
};

const landmarkSection: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const landmarkButton: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  marginTop: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
};

import { ENVIRONMENT_PRESETS, EnvironmentType } from "../environment";
import { environmentPackById, environmentPacksForType } from "../environmentPacks";
import { useStore } from "../store";

const LABELS: Record<EnvironmentType, string> = {
  void: "Void",
  studio: "Studio",
  cavern: "Cavern",
  forest: "Forest",
  crystal: "Crystal",
  galaxy: "Galaxy",
};

export function EnvironmentPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const environment = useStore((s) => s.composition.environment);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const packs = environmentPacksForType(environment.type);
  const selectedPack = environmentPackById(environment.pack?.id);

  if (!open) {
    return (
      <button style={collapsed} onClick={onOpen} title="Choose environment" data-edit-drawer>
        Environment: {LABELS[environment.type]}
      </button>
    );
  }

  return (
    <div style={panel} data-edit-drawer>
      <div style={head}>
        <strong style={{ fontSize: 13 }}>Environment</strong>
        <button style={closeBtn} onClick={onClose} title="Collapse environment controls">
          ×
        </button>
      </div>

      <div style={presetGrid}>
        {(Object.keys(ENVIRONMENT_PRESETS) as EnvironmentType[]).map((type) => {
          const active = environment.type === type;
          return (
            <button
              key={type}
              style={{ ...presetBtn, ...(active ? presetActive : null) }}
              onClick={() => setEnvironment({ ...ENVIRONMENT_PRESETS[type], pack: undefined, tiling: environment.tiling })}
            >
              {LABELS[type]}
            </button>
          );
        })}
      </div>

      <label style={{ display: "block", marginTop: 10 }}>
        <div style={sliderHead}>
          <span>Ambience</span>
          <span>{environment.ambience.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={environment.ambience}
          onChange={(e) => setEnvironment({ ambience: parseFloat(e.target.value) })}
          style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
        />
      </label>

      {packs.length > 0 && (
        <label style={{ display: "block", marginTop: 10 }}>
          <div style={sliderHead}>
            <span>Detail pack</span>
          </div>
          <select
            value={selectedPack?.id ?? ""}
            onChange={(event) => {
              const pack = environmentPackById(event.target.value);
              setEnvironment({
                pack: pack ? { id: pack.id, variant: pack.variants[0], quality: "auto" } : undefined,
                ...(pack ? { material: pack.material } : {}),
              });
            }}
            style={select}
          >
            <option value="">Procedural</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {selectedPack && (
        <label style={{ display: "block", marginTop: 8 }}>
          <div style={sliderHead}>
            <span>Asset quality</span>
          </div>
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
      )}

      <div style={meta}>
        Material: {environment.material}
        {selectedPack ? ` · ${selectedPack.description}` : ""}
      </div>
      {selectedPack?.attribution.map((item) => (
        <div key={`${item.title}:${item.author}`} style={attribution}>
          {item.title} by {item.author} · {item.license}
        </div>
      ))}
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
  borderRadius: 10,
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

const presetGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const presetBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 13,
};

const presetActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
};

const meta: React.CSSProperties = {
  marginTop: 4,
  color: "rgba(255,255,255,0.5)",
  fontSize: 11,
  textTransform: "capitalize",
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

const attribution: React.CSSProperties = {
  marginTop: 5,
  color: "rgba(255,255,255,0.42)",
  fontSize: 10,
};

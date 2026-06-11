import { useState } from "react";
import {
  GENERATED_BIOMES,
  GeneratedBiome,
  WORLD_OBJECT_KINDS,
  WorldObjectKind,
} from "../environment";
import { WORLD_OBJECT_SPECS } from "../worldgen/objects";
import type { RegenerationMode } from "../worldgen/regen";
import { useStore, WorldTool } from "../store";

const BIOME_LABELS: Record<GeneratedBiome, string> = {
  forest: "Forest",
  cavern: "Cavern",
  meadow: "Open meadow",
};

const REGEN_MODES: Array<{ mode: RegenerationMode; label: string; hint: string }> = [
  { mode: "keep-constraints", label: "Fresh, around stems & paths", hint: "Wipes edits; keeps clear zones around stems and walkable paths." },
  { mode: "overwrite", label: "Fresh (full overwrite)", hint: "Wipes edits and objects; honors the constraint toggles below." },
  { mode: "keep-major", label: "Preserve major edits", hint: "Keeps big sculpting strokes, locked and far-moved objects; remixes the rest." },
  { mode: "keep-all", label: "Preserve all edits", hint: "Keeps everything you touched; regenerates only untouched terrain and objects." },
];

export function WorldPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const generated = useStore((s) => s.composition.environment.generated);
  const generateWorld = useStore((s) => s.generateWorld);
  const regenerateWorld = useStore((s) => s.regenerateWorld);
  const regenerateWorldRegion = useStore((s) => s.regenerateWorldRegion);
  const clearGeneratedWorld = useStore((s) => s.clearGeneratedWorld);
  const setWorldParams = useStore((s) => s.setWorldParams);
  const setWorldConstraints = useStore((s) => s.setWorldConstraints);
  const worldTool = useStore((s) => s.worldTool);
  const setWorldTool = useStore((s) => s.setWorldTool);
  const showConstraintZones = useStore((s) => s.showConstraintZones);
  const setShowConstraintZones = useStore((s) => s.setShowConstraintZones);
  const [biome, setBiome] = useState<GeneratedBiome>(generated?.biome ?? "forest");
  const [regenMode, setRegenMode] = useState<RegenerationMode>("keep-constraints");
  const [regionRadius, setRegionRadius] = useState(24);

  if (!open) {
    return (
      <button style={collapsed} onClick={onOpen} title="Generate and edit the world" data-edit-drawer>
        World: {generated ? BIOME_LABELS[generated.biome] : "None"}
      </button>
    );
  }

  const regenHint = REGEN_MODES.find((entry) => entry.mode === regenMode)?.hint;

  return (
    <div style={panel} data-edit-drawer>
      <div style={head}>
        <strong style={{ fontSize: 13 }}>Generated World</strong>
        <button style={closeBtn} onClick={onClose} title="Collapse world controls">
          ×
        </button>
      </div>

      <label style={{ display: "block" }}>
        <div style={label}>Biome</div>
        <select value={biome} onChange={(event) => setBiome(event.target.value as GeneratedBiome)} style={select}>
          {GENERATED_BIOMES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {BIOME_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>

      <button style={primaryButton} onClick={() => generateWorld(biome)}>
        {generated ? `Generate new ${BIOME_LABELS[biome].toLowerCase()}` : "Generate world"}
      </button>

      {generated && (
        <>
          <div style={section}>
            <div style={label}>Shape & mood</div>
            <Slider label="Density" min={0} max={1} step={0.05} value={generated.params.density}
              onChange={(density) => setWorldParams({ density })} />
            <div style={miniHint}>Density applies on the next regenerate; 0 generates bare terrain with no objects.</div>
            <Slider label="Relief" min={0} max={12} step={0.5} value={generated.params.terrainAmplitude}
              onChange={(terrainAmplitude) => setWorldParams({ terrainAmplitude })} />
            <Slider label="Feature size" min={20} max={120} step={2} value={generated.params.terrainScale}
              onChange={(terrainScale) => setWorldParams({ terrainScale })} />
            <Slider label="Ambient" min={0} max={1} step={0.05} value={generated.params.moodAmbient}
              onChange={(moodAmbient) => setWorldParams({ moodAmbient })} />
            <Slider label="Sun" min={0} max={1} step={0.05} value={generated.params.moodSun}
              onChange={(moodSun) => setWorldParams({ moodSun })} />
            <div style={colorRow}>
              <span style={colorLabel}>Sky</span>
              <input
                type="color"
                value={generated.params.skyColor}
                onChange={(event) => setWorldParams({ skyColor: event.target.value })}
                style={colorInput}
              />
              <span style={colorLabel}>Ground</span>
              {generated.params.palette.map((color, index) => (
                <input
                  key={index}
                  type="color"
                  value={color}
                  onChange={(event) => {
                    const palette = [...generated.params.palette] as [string, string, string];
                    palette[index] = event.target.value;
                    setWorldParams({ palette });
                  }}
                  style={colorInput}
                  title={["Low ground", "Mid ground", "High ground"][index]}
                />
              ))}
            </div>
          </div>

          <div style={section}>
            <div style={label}>Constraints</div>
            <Check label="Keep stems clear" checked={generated.constraints.stems}
              onChange={(stems) => setWorldConstraints({ stems })} />
            <Check label="Keep paths walkable" checked={generated.constraints.paths}
              onChange={(paths) => setWorldConstraints({ paths })} />
            <Slider label="Buffer" min={0} max={12} step={0.5} value={generated.constraints.buffer}
              onChange={(buffer) => setWorldConstraints({ buffer })} />
            <Check label="Show clear zones" checked={showConstraintZones} onChange={setShowConstraintZones} />
          </div>

          <div style={section}>
            <div style={label}>Edit tools</div>
            <div style={toolRow}>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "raise", radius: 8, amount: 1 }} onPick={setWorldTool}>⛰ Raise</ToolButton>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "lower", radius: 8, amount: 1 }} onPick={setWorldTool}>🕳 Lower</ToolButton>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "smooth", radius: 8, amount: 1 }} onPick={setWorldTool}>〜 Smooth</ToolButton>
            </div>
            <div style={toolRow}>
              <ToolButton current={worldTool} tool={{ kind: "place", objectKind: defaultPlaceKind(worldTool) }} onPick={setWorldTool}>＋ Place</ToolButton>
              <ToolButton current={worldTool} tool={{ kind: "delete" }} onPick={setWorldTool}>✕ Remove</ToolButton>
            </div>
            {worldTool.kind === "terrain" && (
              <>
                <Slider label="Brush size" min={2} max={30} step={1} value={worldTool.radius}
                  onChange={(radius) => setWorldTool({ ...worldTool, radius })} />
                <Slider label="Strength" min={0.2} max={3} step={0.1} value={worldTool.amount}
                  onChange={(amount) => setWorldTool({ ...worldTool, amount })} />
                <div style={miniHint}>Drag across the terrain to sculpt. Undo reverts a whole stroke.</div>
              </>
            )}
            {worldTool.kind === "place" && (
              <>
                <select
                  value={worldTool.objectKind}
                  onChange={(event) => setWorldTool({ kind: "place", objectKind: event.target.value as WorldObjectKind })}
                  style={select}
                >
                  {WORLD_OBJECT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {WORLD_OBJECT_SPECS[kind].label}
                    </option>
                  ))}
                </select>
                <div style={miniHint}>Click the terrain to place. Placed objects survive regeneration.</div>
              </>
            )}
            {worldTool.kind === "delete" && <div style={miniHint}>Click an object to remove it.</div>}
            {worldTool.kind !== "none" && (
              <button style={subtleButton} onClick={() => setWorldTool({ kind: "none" })}>
                Done editing
              </button>
            )}
          </div>

          <div style={section}>
            <div style={label}>Regenerate</div>
            <select value={regenMode} onChange={(event) => setRegenMode(event.target.value as RegenerationMode)} style={select}>
              {REGEN_MODES.map((entry) => (
                <option key={entry.mode} value={entry.mode}>
                  {entry.label}
                </option>
              ))}
            </select>
            {regenHint && <div style={miniHint}>{regenHint}</div>}
            <button style={primaryButton} onClick={() => regenerateWorld(regenMode)}>
              Regenerate
            </button>
            <Slider label="Zone radius" min={8} max={80} step={2} value={regionRadius} onChange={setRegionRadius} />
            <button style={subtleButton} onClick={() => regenerateWorldRegion(regionRadius)}>
              Regenerate zone around viewer
            </button>
            <div style={miniHint}>
              Reshuffles only the circle around your current position; locked and edited objects stay.
            </div>
          </div>

          <button style={removeButton} onClick={clearGeneratedWorld}>
            Remove generated world
          </button>
        </>
      )}
    </div>
  );
}

function defaultPlaceKind(tool: WorldTool): WorldObjectKind {
  return tool.kind === "place" ? tool.objectKind : "pine";
}

function Slider({
  label: text,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={sliderField}>
      <span>{text}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={range}
      />
    </label>
  );
}

function Check({ label: text, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={checkField}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{text}</span>
    </label>
  );
}

function ToolButton({
  current,
  tool,
  onPick,
  children,
}: {
  current: WorldTool;
  tool: WorldTool;
  onPick: (tool: WorldTool) => void;
  children: React.ReactNode;
}) {
  const active =
    current.kind === tool.kind &&
    (current.kind !== "terrain" || tool.kind !== "terrain" || current.mode === tool.mode);
  return (
    <button
      style={{ ...toolButton, ...(active ? toolButtonActive : null) }}
      onClick={() => onPick(active ? { kind: "none" } : tool)}
    >
      {children}
    </button>
  );
}

const collapsed: React.CSSProperties = {
  position: "absolute",
  top: 188,
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
  width: 264,
  maxHeight: "calc(100vh - 120px)",
  overflowY: "auto",
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

const section: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const primaryButton: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  marginTop: 8,
  borderRadius: 6,
  border: "1px solid rgba(91,140,255,0.5)",
  background: "rgba(91,140,255,0.22)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
};

const subtleButton: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  marginTop: 8,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
};

const removeButton: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: 7,
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.3)",
  background: "rgba(255,122,107,0.1)",
  color: "#ffaaa0",
  cursor: "pointer",
  fontSize: 11,
};

const sliderField: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "84px 1fr",
  alignItems: "center",
  gap: 8,
  marginTop: 8,
  fontSize: 12,
  color: "rgba(255,255,255,0.76)",
};

const checkField: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  marginTop: 8,
  fontSize: 12,
  color: "rgba(255,255,255,0.76)",
  cursor: "pointer",
};

const range: React.CSSProperties = { width: "100%", accentColor: "#5b8cff" };

const colorRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 10,
};

const colorLabel: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.6)" };

const colorInput: React.CSSProperties = {
  width: 26,
  height: 22,
  padding: 0,
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
};

const toolRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 8,
};

const toolButton: React.CSSProperties = {
  flex: 1,
  minHeight: 30,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  cursor: "pointer",
  fontSize: 11,
  whiteSpace: "nowrap",
};

const toolButtonActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.7)",
  background: "rgba(91,140,255,0.3)",
};

const miniHint: React.CSSProperties = {
  marginTop: 6,
  fontSize: 10.5,
  lineHeight: 1.35,
  color: "rgba(255,255,255,0.5)",
};

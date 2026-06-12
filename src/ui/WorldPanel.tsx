import { useState } from "react";
import { GENERATED_BIOMES, GeneratedBiome, MAX_FLOOR_PLANES, type FloorPlanePlacement } from "../environment";
import { newId } from "../id";
import { UNDERFLOOR_HEIGHT } from "../scene/mapHeights";
import { BUILTIN_MATERIALS, type CreatorLandmarkAsset, type CreatorMaterialAsset } from "../creatorAssets";
import type { RegenerationMode } from "../worldgen/regen";
import { skyGradient } from "../scene/skyGradient";
import { CreatorAssetImporter } from "./CreatorAssetImporter";
import { useStore, WorldTool } from "../store";

const BIOME_LABELS: Record<GeneratedBiome, string> = {
  forest: "Forest",
  cavern: "Cavern",
  meadow: "Open meadow",
};

const REGEN_MODES: Array<{ mode: RegenerationMode; label: string; hint: string }> = [
  { mode: "keep-constraints", label: "Fresh, around stems & paths", hint: "Wipes sculpting; keeps clear zones around stems and walkable paths." },
  { mode: "overwrite", label: "Fresh (full overwrite)", hint: "Wipes sculpting; honors the constraint toggles below." },
  { mode: "keep-major", label: "Preserve major sculpting", hint: "Keeps big sculpting strokes; remixes the rest of the terrain." },
  { mode: "keep-all", label: "Preserve all sculpting", hint: "Keeps every brush stroke; re-rolls only untouched terrain." },
];

export function WorldPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const environment = useStore((s) => s.composition.environment);
  const generated = environment.generated;
  const generateWorld = useStore((s) => s.generateWorld);
  const regenerateWorld = useStore((s) => s.regenerateWorld);
  const regenerateWorldRegion = useStore((s) => s.regenerateWorldRegion);
  const clearGeneratedWorld = useStore((s) => s.clearGeneratedWorld);
  const setWorldParams = useStore((s) => s.setWorldParams);
  const setWorldConstraints = useStore((s) => s.setWorldConstraints);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const addLandmark = useStore((s) => s.addLandmark);
  const creatorAssets = useStore((s) => s.creatorAssets);
  const removeCreatorAsset = useStore((s) => s.removeCreatorAsset);
  const worldTool = useStore((s) => s.worldTool);
  const setWorldTool = useStore((s) => s.setWorldTool);
  const showConstraintZones = useStore((s) => s.showConstraintZones);
  const setShowConstraintZones = useStore((s) => s.setShowConstraintZones);
  const [biome, setBiome] = useState<GeneratedBiome>(generated?.biome ?? "forest");
  const [regenMode, setRegenMode] = useState<RegenerationMode>("keep-constraints");
  const [regionRadius, setRegionRadius] = useState(24);
  const [importing, setImporting] = useState<"material" | "landmark" | null>(null);
  const materials = [
    ...BUILTIN_MATERIALS,
    ...creatorAssets.filter((asset): asset is CreatorMaterialAsset => asset.kind === "material"),
  ];
  const landmarks = creatorAssets.filter((asset): asset is CreatorLandmarkAsset => asset.kind === "landmark");
  // Absent = the legacy default plane; editing it materializes the array.
  const floorPlanes = environment.floorPlanes ?? [{ id: "default", elevation: UNDERFLOOR_HEIGHT }];
  const setFloorPlanes = (next: FloorPlanePlacement[]) => setEnvironment({ floorPlanes: next });

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
                title={generated.params.skyColor2 ? "Sky at the horizon" : "Sky color (shades derived automatically)"}
              />
              {generated.params.skyColor2 ? (
                <>
                  <input
                    type="color"
                    value={generated.params.skyColor2}
                    onChange={(event) => setWorldParams({ skyColor2: event.target.value })}
                    style={colorInput}
                    title="Sky at the top"
                  />
                  <button
                    style={miniButton}
                    onClick={() => setWorldParams({ skyColor2: undefined })}
                    title="Back to automatic shading from one color"
                  >
                    auto
                  </button>
                </>
              ) : (
                <button
                  style={miniButton}
                  onClick={() => setWorldParams({ skyColor2: skyGradient(generated.params.skyColor).zenith })}
                  title="Fade to a separate color at the top of the sky"
                >
                  ＋top
                </button>
              )}
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
            <div style={label}>Sculpt</div>
            <div style={toolRow}>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "raise", radius: 8, amount: 1 }} onPick={setWorldTool}>⛰ Raise</ToolButton>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "lower", radius: 8, amount: 1 }} onPick={setWorldTool}>🕳 Lower</ToolButton>
              <ToolButton current={worldTool} tool={{ kind: "terrain", mode: "smooth", radius: 8, amount: 1 }} onPick={setWorldTool}>〜 Smooth</ToolButton>
            </div>
            {worldTool.kind === "terrain" && (
              <>
                <Slider label="Brush size" min={2} max={30} step={1} value={worldTool.radius}
                  onChange={(radius) => setWorldTool({ ...worldTool, radius })} />
                <Slider label="Strength" min={0.2} max={3} step={0.1} value={worldTool.amount}
                  onChange={(amount) => setWorldTool({ ...worldTool, amount })} />
                <div style={miniHint}>Drag across the terrain to sculpt. Undo reverts a whole stroke.</div>
                <button style={subtleButton} onClick={() => setWorldTool({ kind: "none" })}>
                  Done sculpting
                </button>
              </>
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
              Re-rolls the terrain only in the circle around your current position.
            </div>
          </div>

          <button style={removeButton} onClick={clearGeneratedWorld}>
            Remove generated world
          </button>
        </>
      )}

      <div style={section}>
        <div style={label}>Materials</div>
        {(["ground", "floor", "wall", "ceiling"] as const).map((surface) => (
          <label key={surface} style={{ display: "block", marginTop: 6 }}>
            <select
              aria-label={`${surface} material`}
              value={environment.surfaces?.[surface] ?? ""}
              onChange={(event) =>
                setEnvironment({
                  surfaces: { ...environment.surfaces, [surface]: event.target.value || undefined },
                })
              }
              style={select}
            >
              <option value="">
                {surface === "ground" ? "Terrain ground: palette colors" : `${surface[0].toUpperCase() + surface.slice(1)}: default`}
              </option>
              {materials.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button style={subtleButton} onClick={() => setImporting("material")}>
          Import material
        </button>
        <div style={miniHint}>
          Terrain ground textures the generated landscape (tinted by its height palette); floor/wall/ceiling
          dress the map geometry.
        </div>
      </div>

      <div style={section}>
        <div style={label}>Reflective floors</div>
        {floorPlanes.map((plane, index) => (
          <div key={plane.id} style={assetRow}>
            <input
              aria-label={`Floor plane ${index + 1} elevation`}
              type="number"
              step={0.5}
              value={plane.elevation}
              onChange={(event) => {
                const elevation = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(elevation)) return;
                setFloorPlanes(floorPlanes.map((p) => (p.id === plane.id ? { ...p, elevation } : p)));
              }}
              style={{ ...select, width: 64, marginTop: 0 }}
              title="Elevation (y) of this reflective plane"
            />
            <input
              aria-label={`Floor plane ${index + 1} strength`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={plane.opacity ?? 1}
              onChange={(event) =>
                setFloorPlanes(floorPlanes.map((p) => (p.id === plane.id ? { ...p, opacity: event.currentTarget.valueAsNumber } : p)))
              }
              style={{ flex: 1 }}
              title="Glow strength"
            />
            <button
              style={assetAddButton}
              onClick={() => setFloorPlanes([...floorPlanes, { ...plane, id: newId() }])}
              disabled={floorPlanes.length >= MAX_FLOOR_PLANES}
              title="Clone this plane (then adjust its elevation)"
            >
              ⧉
            </button>
            <button style={assetRemoveButton} onClick={() => setFloorPlanes(floorPlanes.filter((p) => p.id !== plane.id))} title="Remove this plane">
              ×
            </button>
          </div>
        ))}
        {!floorPlanes.length && <div style={miniHint}>No reflective planes. Maps that dip below 0 won’t intersect one.</div>}
        <button
          style={subtleButton}
          onClick={() => setFloorPlanes([...floorPlanes, { id: newId(), elevation: floorPlanes[floorPlanes.length - 1]?.elevation ?? UNDERFLOOR_HEIGHT }])}
          disabled={floorPlanes.length >= MAX_FLOOR_PLANES}
        >
          Add reflective plane
        </button>
        {environment.floorPlanes && (
          <button style={subtleButton} onClick={() => setEnvironment({ floorPlanes: undefined })} title="Back to the single default plane">
            Reset to default
          </button>
        )}
        <div style={miniHint}>
          The translucent light-reflecting surface under the map. Move it, stack several at different elevations, or remove them all.
        </div>
      </div>

      <div style={section}>
        <div style={label}>Objects</div>
        {landmarks.map((asset) => (
          <div key={asset.id} style={assetRow}>
            <button style={assetAddButton} onClick={() => addLandmark(asset.id)} title={`Place ${asset.name}`}>
              ＋ {asset.name}
            </button>
            <button style={assetRemoveButton} onClick={() => void removeCreatorAsset(asset.id)} title={`Remove ${asset.name}`}>
              ×
            </button>
          </div>
        ))}
        <button style={subtleButton} onClick={() => setImporting("landmark")}>
          Import object (GLB)
        </button>
        <div style={miniHint}>Imported objects place at the viewer and move with the gizmo.</div>
      </div>

      {importing && (
        <CreatorAssetImporter
          mode={importing}
          onClose={() => setImporting(null)}
          onImported={(id) => {
            if (importing === "material") {
              setEnvironment({ surfaces: { ...environment.surfaces, floor: id } });
            } else {
              addLandmark(id);
            }
          }}
        />
      )}
    </div>
  );
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

const miniButton: React.CSSProperties = {
  padding: "3px 7px",
  borderRadius: 5,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.75)",
  cursor: "pointer",
  fontSize: 10,
  whiteSpace: "nowrap",
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

const assetRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 30px",
  gap: 5,
  marginTop: 6,
};

const assetAddButton: React.CSSProperties = {
  minHeight: 30,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  textAlign: "left",
  paddingLeft: 10,
};

const assetRemoveButton: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.25)",
  background: "rgba(255,122,107,0.08)",
  color: "#ffaaa0",
  cursor: "pointer",
};

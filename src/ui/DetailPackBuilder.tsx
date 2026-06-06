import { useMemo, useState } from "react";
import type { DetailPackBundle, DetailPackBundleAsset } from "../detailPackStorage";
import type { EnvironmentPackDefinition, EnvironmentPackMaterial } from "../environmentPacks";

type TextureSlot =
  | "floorAlbedo"
  | "floorNormal"
  | "floorRoughness"
  | "floorAo"
  | "wallAlbedo"
  | "wallNormal"
  | "wallRoughness"
  | "wallAo"
  | "ceilingAlbedo";

export function DetailPackBuilder({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (file: File) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [license, setLicense] = useState("Creator-owned");
  const [landmarkName, setLandmarkName] = useState("Landmark");
  const [nodePrefix, setNodePrefix] = useState("Landmark_");
  const [model, setModel] = useState<File | null>(null);
  const [textures, setTextures] = useState<Partial<Record<TextureSlot, File>>>({});
  const [repeat, setRepeat] = useState(2.5);
  const [roughness, setRoughness] = useState(0.8);
  const [metalness, setMetalness] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useMemo(() => slug(name), [name]);

  const create = async () => {
    if (!name.trim() || !author.trim() || !model || !textures.floorAlbedo) {
      setError("Name, author, landmark GLB, and floor albedo are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const bundle = await buildBundle({
        id,
        name: name.trim(),
        description: description.trim(),
        author: author.trim(),
        license: license.trim() || "Creator-owned",
        landmarkName: landmarkName.trim() || "Landmark",
        nodePrefix: nodePrefix.trim() || "Landmark_",
        model,
        textures,
        repeat,
        roughness,
        metalness,
      });
      const file = new File(
        [JSON.stringify(bundle)],
        `${id}.polyphonia-pack.json`,
        { type: "application/json" },
      );
      await onCreate(file);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The detail pack could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} data-edit-drawer>
      <div style={dialog} role="dialog" aria-label="Create detail pack">
        <div style={header}>
          <strong>Create Detail Pack</strong>
          <button style={iconButton} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div style={scroll}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} style={input} maxLength={80} />
          </Field>
          <div style={idText}>{id || "pack-id"}</div>
          <Field label="Description">
            <input value={description} onChange={(event) => setDescription(event.target.value)} style={input} maxLength={160} />
          </Field>
          <div style={twoColumns}>
            <Field label="Author">
              <input value={author} onChange={(event) => setAuthor(event.target.value)} style={input} maxLength={80} />
            </Field>
            <Field label="License">
              <input value={license} onChange={(event) => setLicense(event.target.value)} style={input} maxLength={80} />
            </Field>
          </div>

          <Section title="Surfaces">
            <AssetInput label="Floor albedo" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.floorAlbedo} onFile={(file) => setTexture(setTextures, "floorAlbedo", file)} />
            <AssetInput label="Floor normal" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.floorNormal} onFile={(file) => setTexture(setTextures, "floorNormal", file)} />
            <AssetInput label="Floor roughness" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.floorRoughness} onFile={(file) => setTexture(setTextures, "floorRoughness", file)} />
            <AssetInput label="Floor AO" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.floorAo} onFile={(file) => setTexture(setTextures, "floorAo", file)} />
            <AssetInput label="Wall albedo" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.wallAlbedo} onFile={(file) => setTexture(setTextures, "wallAlbedo", file)} />
            <AssetInput label="Wall normal" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.wallNormal} onFile={(file) => setTexture(setTextures, "wallNormal", file)} />
            <AssetInput label="Wall roughness" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.wallRoughness} onFile={(file) => setTexture(setTextures, "wallRoughness", file)} />
            <AssetInput label="Wall AO" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.wallAo} onFile={(file) => setTexture(setTextures, "wallAo", file)} />
            <AssetInput label="Ceiling albedo" accept="image/png,image/jpeg,image/webp,image/ktx2" file={textures.ceilingAlbedo} onFile={(file) => setTexture(setTextures, "ceilingAlbedo", file)} />
            <Slider label="Texture repeat" value={repeat} min={0.25} max={8} step={0.25} onChange={setRepeat} />
            <Slider label="Roughness" value={roughness} min={0} max={1} step={0.05} onChange={setRoughness} />
            <Slider label="Metalness" value={metalness} min={0} max={1} step={0.05} onChange={setMetalness} />
          </Section>

          <Section title="Landmark Kit">
            <AssetInput label="GLB scene kit" accept=".glb,model/gltf-binary" file={model ?? undefined} onFile={(file) => setModel(file ?? null)} />
            <div style={twoColumns}>
              <Field label="Asset name">
                <input value={landmarkName} onChange={(event) => setLandmarkName(event.target.value)} style={input} maxLength={80} />
              </Field>
              <Field label="Node prefix">
                <input value={nodePrefix} onChange={(event) => setNodePrefix(event.target.value)} style={input} maxLength={80} />
              </Field>
            </div>
          </Section>

          {error && <div style={errorText}>{error}</div>}
        </div>

        <div style={footer}>
          <button style={secondaryButton} onClick={onClose}>Cancel</button>
          <button style={primaryButton} onClick={() => void create()} disabled={busy}>
            {busy ? "Creating…" : "Create pack"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={section}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </section>
  );
}

function AssetInput({
  label,
  accept,
  file,
  onFile,
}: {
  label: string;
  accept: string;
  file?: File;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label style={assetRow}>
      <span>{label}</span>
      <span style={fileName}>{file?.name ?? "None"}</span>
      <span style={chooseButton}>Choose</span>
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={sliderRow}>
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(parseFloat(event.target.value))} style={{ accentColor: "#5b8cff" }} />
      <span style={sliderValue}>{value.toFixed(2)}</span>
    </label>
  );
}

async function buildBundle(args: {
  id: string;
  name: string;
  description: string;
  author: string;
  license: string;
  landmarkName: string;
  nodePrefix: string;
  model: File;
  textures: Partial<Record<TextureSlot, File>>;
  repeat: number;
  roughness: number;
  metalness: number;
}): Promise<DetailPackBundle> {
  const assets: Record<string, DetailPackBundleAsset> = {};
  const add = async (key: string, file: File | undefined) => {
    if (!file) return undefined;
    assets[key] = {
      name: file.name,
      type: file.type || (file.name.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream"),
      data: await fileBase64(file),
    };
    return `bundle:${key}`;
  };
  const modelUrl = (await add("landmark-kit", args.model))!;
  const floorAlbedo = (await add("floor-albedo", args.textures.floorAlbedo))!;
  const floor = await materialFromFiles("floor", args.textures, add, {
    albedo: floorAlbedo,
    repeat: args.repeat,
    roughness: args.roughness,
    metalness: args.metalness,
  });
  const wallAlbedo = await add("wall-albedo", args.textures.wallAlbedo);
  const wall = wallAlbedo
    ? await materialFromFiles("wall", args.textures, add, { ...floor, albedo: wallAlbedo })
    : undefined;
  const ceilingAlbedo = await add("ceiling-albedo", args.textures.ceilingAlbedo);
  const manifest: EnvironmentPackDefinition = {
    id: args.id,
    name: args.name,
    description: args.description || `${args.name} creator detail pack`,
    variants: ["default"],
    assets: [{ url: modelUrl, quality: "high" }],
    materials: {
      floor,
      ...(wall ? { wall } : {}),
      ...(ceilingAlbedo ? { ceiling: { ...(wall ?? floor), albedo: ceilingAlbedo } } : {}),
    },
    landmarks: [{
      id: slug(args.landmarkName),
      name: args.landmarkName,
      nodePrefix: args.nodePrefix,
      placement: "floor",
      fallback: "rock",
    }],
    attribution: [{
      title: args.name,
      author: args.author,
      license: args.license,
    }],
    budgets: {
      maxTextureSize: 2048,
      maxTriangles: 180_000,
      maxDrawCalls: 120,
    },
  };
  return { version: 1, manifest, assets };
}

async function materialFromFiles(
  prefix: "floor" | "wall",
  textures: Partial<Record<TextureSlot, File>>,
  add: (key: string, file: File | undefined) => Promise<string | undefined>,
  base: EnvironmentPackMaterial,
): Promise<EnvironmentPackMaterial> {
  const title = prefix === "floor" ? "floor" : "wall";
  const slots = prefix === "floor"
    ? { normal: "floorNormal", roughness: "floorRoughness", ao: "floorAo" } as const
    : { normal: "wallNormal", roughness: "wallRoughness", ao: "wallAo" } as const;
  const normal = await add(`${title}-normal`, textures[slots.normal]);
  const roughnessMap = await add(`${title}-roughness`, textures[slots.roughness]);
  const ao = await add(`${title}-ao`, textures[slots.ao]);
  return {
    ...base,
    ...(normal ? { normal } : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
    ...(ao ? { ao } : {}),
  };
}

function setTexture(
  setter: React.Dispatch<React.SetStateAction<Partial<Record<TextureSlot, File>>>>,
  slot: TextureSlot,
  file: File | undefined,
) {
  setter((current) => {
    const next = { ...current };
    if (file) next[slot] = file;
    else delete next[slot];
    return next;
  });
}

function slug(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.length >= 3 ? normalized.slice(0, 64) : `pack-${normalized || "new"}`;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const backdrop: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 20, background: "rgba(3,5,10,0.72)" };
const dialog: React.CSSProperties = { width: "min(620px, 100%)", maxHeight: "calc(100vh - 40px)", display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.16)", background: "#101522", color: "white", fontFamily: "system-ui, sans-serif", boxShadow: "0 24px 80px rgba(0,0,0,0.45)" };
const header: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" };
const iconButton: React.CSSProperties = { width: 28, height: 28, border: 0, background: "transparent", color: "rgba(255,255,255,0.72)", fontSize: 20, cursor: "pointer" };
const scroll: React.CSSProperties = { overflowY: "auto", padding: 16 };
const field: React.CSSProperties = { display: "grid", gap: 5, marginBottom: 10, fontSize: 11, color: "rgba(255,255,255,0.66)" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 9px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "#181f30", color: "white" };
const idText: React.CSSProperties = { margin: "-5px 0 10px", fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.4)" };
const twoColumns: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
const section: React.CSSProperties = { marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.1)" };
const sectionTitle: React.CSSProperties = { marginBottom: 10, fontSize: 12, fontWeight: 600 };
const assetRow: React.CSSProperties = { minHeight: 34, display: "grid", gridTemplateColumns: "120px minmax(0,1fr) auto", gap: 8, alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, cursor: "pointer" };
const fileName: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.48)" };
const chooseButton: React.CSSProperties = { padding: "4px 7px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)" };
const sliderRow: React.CSSProperties = { minHeight: 34, display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 38px", gap: 8, alignItems: "center", fontSize: 11 };
const sliderValue: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.55)" };
const errorText: React.CSSProperties = { marginTop: 12, color: "#ffaaa0", fontSize: 11 };
const footer: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, padding: 12, borderTop: "1px solid rgba(255,255,255,0.1)" };
const secondaryButton: React.CSSProperties = { padding: "8px 12px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "white", cursor: "pointer" };
const primaryButton: React.CSSProperties = { padding: "8px 12px", borderRadius: 5, border: "1px solid #7398ff", background: "#4f78e8", color: "white", cursor: "pointer" };

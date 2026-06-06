import { useState } from "react";
import type { CreatorAssetAttribution } from "../creatorAssets";
import { useStore } from "../store";

type Mode = "material" | "landmark";

export function CreatorAssetImporter({
  mode,
  onClose,
  onImported,
}: {
  mode: Mode;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const importMaterial = useStore((state) => state.importMaterialAsset);
  const importLandmark = useStore((state) => state.importLandmarkAsset);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [license, setLicense] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [repeat, setRepeat] = useState(2.5);
  const [roughness, setRoughness] = useState(0.85);
  const [metalness, setMetalness] = useState(0);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const attribution: CreatorAssetAttribution = {
        title: name,
        author,
        license,
        ...(sourceUrl.trim() ? { url: sourceUrl } : {}),
      };
      let id: string;
      if (mode === "material") {
        if (!files.albedo) throw new Error("Choose an albedo/base-color texture.");
        id = await importMaterial({
          name,
          attribution,
          albedo: files.albedo,
          normal: files.normal,
          roughnessMap: files.roughness,
          metalnessMap: files.metalness,
          ao: files.ao,
          emissiveMap: files.emissive,
          repeat,
          roughness,
          metalness,
        });
      } else {
        if (!files.model) throw new Error("Choose a self-contained GLB model.");
        id = await importLandmark({
          name,
          attribution,
          model: files.model,
          placement: "floor",
          defaultScale: scale,
        });
      }
      onImported(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The asset could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} data-edit-drawer>
      <div style={dialog} role="dialog" aria-label={`Import ${mode}`}>
        <div style={header}>
          <strong>Import {mode === "material" ? "Material" : "Landmark"}</strong>
          <button style={iconButton} onClick={onClose} title="Close">×</button>
        </div>
        <div style={body}>
          <Field label="Name"><input style={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <div style={columns}>
            <Field label="Author"><input style={input} value={author} onChange={(event) => setAuthor(event.target.value)} /></Field>
            <Field label="License"><input style={input} value={license} onChange={(event) => setLicense(event.target.value)} placeholder="CC0, CC BY 4.0…" /></Field>
          </div>
          <Field label="Source URL"><input style={input} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} type="url" /></Field>

          {mode === "material" ? (
            <>
              <FileField label="Albedo / base color" required accept="image/png,image/jpeg,image/webp,image/ktx2" file={files.albedo} onFile={(file) => setFiles((value) => ({ ...value, albedo: file }))} />
              <FileField label="Normal" accept="image/png,image/jpeg,image/webp,image/ktx2" file={files.normal} onFile={(file) => setFiles((value) => ({ ...value, normal: file }))} />
              <FileField label="Roughness" accept="image/png,image/jpeg,image/webp,image/ktx2" file={files.roughness} onFile={(file) => setFiles((value) => ({ ...value, roughness: file }))} />
              <FileField label="Metalness" accept="image/png,image/jpeg,image/webp,image/ktx2" file={files.metalness} onFile={(file) => setFiles((value) => ({ ...value, metalness: file }))} />
              <FileField label="Ambient occlusion" accept="image/png,image/jpeg,image/webp,image/ktx2" file={files.ao} onFile={(file) => setFiles((value) => ({ ...value, ao: file }))} />
              <Range label="Repeat" value={repeat} min={0.25} max={12} step={0.25} onChange={setRepeat} />
              <Range label="Roughness" value={roughness} min={0} max={1} step={0.05} onChange={setRoughness} />
              <Range label="Metalness" value={metalness} min={0} max={1} step={0.05} onChange={setMetalness} />
            </>
          ) : (
            <>
              <FileField label="GLB model" required accept=".glb,model/gltf-binary" file={files.model} onFile={(file) => setFiles((value) => ({ ...value, model: file }))} />
              <Range label="Starting scale" value={scale} min={0.05} max={10} step={0.05} onChange={setScale} />
            </>
          )}
          {error && <div style={errorStyle}>{error}</div>}
        </div>
        <div style={footer}>
          <button style={secondaryButton} onClick={onClose}>Cancel</button>
          <button style={primaryButton} disabled={busy} onClick={() => void submit()}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={field}><span>{label}</span>{children}</label>;
}

function FileField({ label, required, accept, file, onFile }: {
  label: string; required?: boolean; accept: string; file?: File; onFile: (file?: File) => void;
}) {
  return (
    <label style={fileField}>
      <span>{label}{required ? " *" : ""}</span>
      <span style={fileName}>{file?.name ?? "None selected"}</span>
      <span style={choose}>Choose</span>
      <input type="file" accept={accept} style={{ display: "none" }} onChange={(event) => {
        onFile(event.target.files?.[0]);
        event.currentTarget.value = "";
      }} />
    </label>
  );
}

function Range({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  return <label style={range}><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><span>{value.toFixed(2)}</span></label>;
}

const backdrop: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.72)" };
const dialog: React.CSSProperties = { width: "min(520px, calc(100vw - 28px))", maxHeight: "calc(100vh - 28px)", display: "flex", flexDirection: "column", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#111522", color: "white", fontFamily: "system-ui, sans-serif" };
const header: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" };
const iconButton: React.CSSProperties = { width: 28, height: 28, borderRadius: 6, border: 0, background: "rgba(255,255,255,0.08)", color: "white", cursor: "pointer", fontSize: 17 };
const body: React.CSSProperties = { padding: 16, display: "grid", gap: 10, overflowY: "auto" };
const columns: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.68)" };
const input: React.CSSProperties = { minWidth: 0, padding: "8px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", background: "#1a2030", color: "white" };
const fileField: React.CSSProperties = { minHeight: 38, padding: "0 8px", display: "grid", gridTemplateColumns: "1fr minmax(90px, 1.4fr) auto", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11, cursor: "pointer" };
const fileName: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.5)" };
const choose: React.CSSProperties = { padding: "5px 7px", borderRadius: 5, background: "rgba(255,255,255,0.09)" };
const range: React.CSSProperties = { display: "grid", gridTemplateColumns: "100px 1fr 42px", gap: 8, alignItems: "center", fontSize: 11 };
const footer: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, padding: 12, borderTop: "1px solid rgba(255,255,255,0.1)" };
const secondaryButton: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.13)", background: "transparent", color: "white", cursor: "pointer" };
const primaryButton: React.CSSProperties = { ...secondaryButton, border: 0, background: "#5b8cff" };
const errorStyle: React.CSSProperties = { color: "#ffaaa0", fontSize: 11 };

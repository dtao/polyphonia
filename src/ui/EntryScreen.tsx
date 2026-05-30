import { useRef, useState } from "react";
import { useStore } from "../store";

// The start screen: enter the current composition, begin a fresh one, or
// export/import a portable bundle.
export function EntryScreen({
  onEnter,
  onCreate,
  onExport,
  onImport,
}: {
  onEnter: () => void;
  onCreate: (meta: { title: string; artist: string; bpm: number }) => void;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const comp = useStore((s) => s.composition);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState("120");
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setError(null);
    setBusy("Exporting…");
    try {
      await onExport();
    } catch (e) {
      console.error(e);
      setError("Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: File) {
    setError(null);
    setBusy("Importing…");
    try {
      await onImport(file);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={overlay}>
      <h1 style={{ fontSize: 44, margin: 0, letterSpacing: 2 }}>POLYPHONIA</h1>

      {creating ? (
        <div style={form}>
          <input style={input} placeholder="Title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <input style={input} placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          <label style={bpmRow}>
            <span style={{ opacity: 0.8 }}>BPM</span>
            <input
              style={{ ...input, width: 90 }}
              type="number"
              min={40}
              max={300}
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
            />
          </label>
          <button style={button} onClick={() => onCreate({ title, artist, bpm: parseInt(bpm, 10) || 120 })}>
            Create & start
          </button>
          <button style={linkBtn} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p style={{ opacity: 0.7, maxWidth: 440, textAlign: "center", lineHeight: 1.5 }}>
            {comp.title} — move between the instruments and hear the mix shift around you.
          </p>
          <button id="enter-btn" style={button} onClick={onEnter}>
            Click to enter
          </button>
          <button style={linkBtn} onClick={() => setCreating(true)}>
            ＋ Start a new composition
          </button>

          <div style={{ display: "flex", gap: 18, marginTop: 4 }}>
            <button style={linkBtn} onClick={handleExport} disabled={!!busy}>
              ⤓ Export
            </button>
            <button style={linkBtn} onClick={() => fileRef.current?.click()} disabled={!!busy}>
              ⤒ Import
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = "";
            }}
          />

          {busy && <p style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>{busy}</p>}
          {error && <p style={{ color: "#ff9b8f", fontSize: 13, margin: 0 }}>{error}</p>}

          <p style={{ opacity: 0.45, fontSize: 13, marginTop: 16 }}>
            WASD to move · mouse to look · Esc to release cursor
          </p>
        </>
      )}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  color: "white",
  fontFamily: "system-ui, sans-serif",
  background: "radial-gradient(circle at center, rgba(20,24,48,0.85), rgba(5,6,10,0.97))",
};

const button: React.CSSProperties = {
  padding: "14px 36px",
  fontSize: 17,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(91,140,255,0.18)",
  color: "white",
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.6)",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "underline",
};

const form: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  width: 280,
};

const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 8,
  color: "white",
  padding: "10px 12px",
  fontSize: 15,
};

const bpmRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 14,
};

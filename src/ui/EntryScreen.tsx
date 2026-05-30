import { useRef, useState } from "react";
import { useStore } from "../store";
import { Account } from "./Account";

// The start screen: pick a composition from the library to enter, start a fresh
// one, or export/import a portable bundle.
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
  const library = useStore((s) => s.library);
  const currentId = useStore((s) => s.composition.id);
  const user = useStore((s) => s.user);
  const selectComposition = useStore((s) => s.selectComposition);
  const renameComposition = useStore((s) => s.renameComposition);
  const duplicateComposition = useStore((s) => s.duplicateComposition);
  const deleteComposition = useStore((s) => s.deleteComposition);
  const unpublishComposition = useStore((s) => s.unpublishComposition);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState("120");
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : `${label} failed.`);
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
          <p style={{ opacity: 0.6, fontSize: 14, margin: 0 }}>Choose a composition, then enter.</p>

          <div style={list}>
            {library.map((c) => {
              const isCurrent = c.id === currentId;
              return (
                <div
                  key={c.id}
                  style={{ ...row, ...(isCurrent ? rowCurrent : null) }}
                  onClick={() => run("Loading…", () => selectComposition(c.id))}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={rowTitle}>
                      {isCurrent ? "● " : ""}
                      {c.title}
                      {c.publishedId && <span style={pubPill}>shared</span>}
                    </div>
                    <div style={rowSub}>
                      {c.artist} · {c.tracks.length} {c.tracks.length === 1 ? "track" : "tracks"}
                    </div>
                    {c.publishedId && (
                      <div style={pubLine} onClick={(e) => e.stopPropagation()}>
                        <button
                          style={miniLink}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(`${location.origin}/c/${c.publishedId}`);
                              setCopiedId(c.id);
                            } catch {
                              /* clipboard blocked */
                            }
                          }}
                        >
                          {copiedId === c.id ? "Link copied" : "Copy link"}
                        </button>
                        {user && (
                          <button
                            style={{ ...miniLink, color: "#ff9b8f" }}
                            onClick={() => {
                              if (window.confirm("Unpublish? The shared link will stop working.")) {
                                run("Unpublishing…", () => unpublishComposition(c.id));
                              }
                            }}
                          >
                            Unpublish
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      style={iconBtn}
                      title="Rename"
                      onClick={() => {
                        const t = window.prompt("Rename composition", c.title);
                        if (t != null) renameComposition(c.id, t);
                      }}
                    >
                      ✎
                    </button>
                    <button style={iconBtn} title="Duplicate" onClick={() => run("Duplicating…", () => duplicateComposition(c.id))}>
                      ⧉
                    </button>
                    <button
                      style={iconBtn}
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete "${c.title}"? This can't be undone.`)) {
                          run("Deleting…", () => deleteComposition(c.id));
                        }
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button id="enter-btn" style={button} onClick={onEnter}>
            Click to enter
          </button>

          <div style={{ display: "flex", gap: 18, marginTop: 4 }}>
            <button style={linkBtn} onClick={() => setCreating(true)} disabled={!!busy}>
              ＋ New
            </button>
            <button style={linkBtn} onClick={() => run("Exporting…", onExport)} disabled={!!busy}>
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
              if (f) run("Importing…", () => onImport(f));
              e.target.value = "";
            }}
          />

          {busy && <p style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>{busy}</p>}
          {error && <p style={{ color: "#ff9b8f", fontSize: 13, margin: 0 }}>{error}</p>}

          <div style={{ marginTop: 8 }}>
            <Account />
          </div>

          <p style={{ opacity: 0.45, fontSize: 13, marginTop: 12 }}>
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
  gap: 14,
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

const list: React.CSSProperties = {
  width: 380,
  maxHeight: 240,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 4,
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
};

const rowCurrent: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.7)",
  background: "rgba(91,140,255,0.16)",
};

const rowTitle: React.CSSProperties = {
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rowSub: React.CSSProperties = { fontSize: 12, opacity: 0.55 };

const pubPill: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#9fd0a0",
  border: "1px solid rgba(126,224,129,0.4)",
  borderRadius: 999,
  padding: "1px 6px",
  verticalAlign: "middle",
};

const pubLine: React.CSSProperties = { display: "flex", gap: 12, marginTop: 4 };

const miniLink: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.6)",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};

const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontSize: 14,
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

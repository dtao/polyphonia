import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Account } from "./Account";
import { isSharingConfigured } from "../cloud";
import { compositionRevision } from "../composition";

type SortMode = "updated" | "library" | "title" | "artist" | "tracks";

// The start screen: pick a composition from the library to enter, start a fresh
// one, or export/import a portable bundle.
export function EntryScreen({
  onEnter,
  onCreate,
  onExport,
  onImport,
}: {
  onEnter: () => void;
  onCreate: (meta: { title: string; artist?: string; bpm: number }) => void;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const library = useStore((s) => s.library);
  const currentId = useStore((s) => s.composition.id);
  const user = useStore((s) => s.user);
  const accountArtist = useStore((s) => s.accountArtist);
  const createAccountArtist = useStore((s) => s.createAccountArtist);
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
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const fileRef = useRef<HTMLInputElement>(null);

  const visibleLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? library.filter((c) => {
          const hasUnpublishedChanges = Boolean(c.publishedId && c.publishedRevision !== compositionRevision(c));
          const haystack = [c.title, c.artist, c.publishedId ? "shared published" : "", hasUnpublishedChanges ? "changes unpublished local" : "", `${c.tracks.length} tracks`]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
      : library;

    return [...filtered].sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      if (sortMode === "artist") return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
      if (sortMode === "tracks") return b.tracks.length - a.tracks.length || a.title.localeCompare(b.title);
      if (sortMode === "updated") return timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.title.localeCompare(b.title);
      return library.findIndex((c) => c.id === a.id) - library.findIndex((c) => c.id === b.id);
    });
  }, [library, query, sortMode]);

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

  async function create() {
    setError(null);
    if (user && isSharingConfigured && !accountArtist) {
      if (!artist.trim()) {
        setError("Enter your artist name first.");
        return;
      }
      await run("Saving artist…", async () => {
        await createAccountArtist(artist.trim());
        onCreate({ title, bpm: parseInt(bpm, 10) || 120 });
      });
      return;
    }
    onCreate({ title, artist: accountArtist?.artist ?? artist, bpm: parseInt(bpm, 10) || 120 });
  }

  return (
    <div style={overlay}>
      <h1 style={{ fontSize: 44, margin: 0, letterSpacing: 2 }}>POLYPHONIA</h1>

      {creating ? (
        <div style={form}>
          <input style={input} placeholder="Title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          {accountArtist ? (
            <div style={artistLine}>Artist: {accountArtist.artist}</div>
          ) : user && isSharingConfigured ? (
            <>
              <input style={input} placeholder="Artist name" value={artist} onChange={(e) => setArtist(e.target.value)} />
              <div style={artistLine}>This will be saved to your account for new compositions.</div>
            </>
          ) : (
            <input style={input} placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          )}
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
          <button style={button} disabled={!!busy} onClick={create}>
            {busy === "Saving artist…" ? "Saving artist…" : "Create & start"}
          </button>
          <button style={linkBtn} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p style={{ opacity: 0.6, fontSize: 14, margin: 0 }}>Choose a composition, then enter.</p>

          <div style={libraryPanel}>
            <div style={libraryToolbar}>
              <input
                style={{ ...input, ...searchInput }}
                placeholder="Search compositions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label style={sortLabel}>
                <span style={{ opacity: 0.62 }}>Sort</span>
                <select style={selectInput} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                  <option value="updated">Recently updated</option>
                  <option value="library">Library order</option>
                  <option value="title">Title</option>
                  <option value="artist">Artist</option>
                  <option value="tracks">Track count</option>
                </select>
              </label>
            </div>

            <div style={resultLine}>
              {visibleLibrary.length} of {library.length} {library.length === 1 ? "composition" : "compositions"}
            </div>

            <div style={grid}>
              {visibleLibrary.map((c) => {
                const isCurrent = c.id === currentId;
                const hasUnpublishedChanges = Boolean(c.publishedId && c.publishedRevision !== compositionRevision(c));
                return (
                  <div
                    key={c.id}
                    style={{ ...card, ...(isCurrent ? cardCurrent : null) }}
                    onClick={() => run("Loading…", () => selectComposition(c.id))}
                  >
                    <div style={cardBody}>
                      <div style={cardTitle}>
                        {c.title}
                        {c.publishedId && <span style={pubPill}>shared</span>}
                        {hasUnpublishedChanges && <span style={draftDot} title="Local changes not yet published" />}
                      </div>
                      <div style={cardSub}>
                        {c.artist} · {c.tracks.length} {c.tracks.length === 1 ? "track" : "tracks"}
                      </div>
                      <div style={dateLine}>Updated {formatUpdated(c.updatedAt)}</div>
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
                    <div style={cardActions} onClick={(e) => e.stopPropagation()}>
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
              {!visibleLibrary.length && (
                <div style={emptyState}>No compositions match "{query.trim()}".</div>
              )}
            </div>
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
            {isSharingConfigured && (
              <Link to="/gallery" style={{ ...linkBtn, textDecoration: "underline" }}>
                ◇ Gallery
              </Link>
            )}
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

          <div style={statusLine}>
            {error ? <span style={{ color: "#ff9b8f" }}>{error}</span> : busy ? <span style={{ opacity: 0.6 }}>{busy}</span> : null}
          </div>

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

function timestamp(value: string | undefined): number {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatUpdated(value: string | undefined): string {
  const time = timestamp(value);
  if (!time) return "recently";
  const date = new Date(time);
  const now = Date.now();
  const diff = now - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= 0 && diff < minute) return "just now";
  if (diff >= 0 && diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff >= 0 && diff < day) return `${Math.floor(diff / hour)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

const overlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  overflowY: "auto",
  padding: "24px 20px",
  boxSizing: "border-box",
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

const artistLine: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  textAlign: "center",
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.68)",
  fontSize: 13,
};

const libraryPanel: React.CSSProperties = {
  width: "min(1040px, calc(100vw - 40px))",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const libraryToolbar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const searchInput: React.CSSProperties = {
  flex: "1 1 260px",
  minWidth: 0,
  boxSizing: "border-box",
};

const sortLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: "0 0 auto",
  fontSize: 13,
};

const selectInput: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 8,
  color: "white",
  padding: "10px 32px 10px 12px",
  fontSize: 15,
  minWidth: 150,
  appearance: "auto",
};

const resultLine: React.CSSProperties = {
  color: "rgba(255,255,255,0.48)",
  fontSize: 12,
  textAlign: "left",
};

const grid: React.CSSProperties = {
  maxHeight: "min(52vh, 520px)",
  overflowY: "auto",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
  gap: 10,
  padding: 4,
};

const card: React.CSSProperties = {
  minHeight: 112,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 12,
  padding: 12,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
  boxSizing: "border-box",
  minWidth: 0,
};

const cardCurrent: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.7)",
  background: "rgba(91,140,255,0.16)",
};

const cardBody: React.CSSProperties = {
  minWidth: 0,
};

const cardTitle: React.CSSProperties = {
  minWidth: 0,
  fontWeight: 600,
  lineHeight: 1.25,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflowWrap: "anywhere",
};

const cardSub: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.35,
  color: "rgba(255,255,255,0.55)",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

const dateLine: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: "rgba(255,255,255,0.42)",
};

const cardActions: React.CSSProperties = {
  display: "flex",
  gap: 4,
  justifyContent: "flex-end",
};

const emptyState: React.CSSProperties = {
  gridColumn: "1 / -1",
  padding: "28px 12px",
  borderRadius: 8,
  border: "1px dashed rgba(255,255,255,0.16)",
  color: "rgba(255,255,255,0.58)",
  textAlign: "center",
  fontSize: 14,
};

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

const draftDot: React.CSSProperties = {
  display: "inline-block",
  width: 7,
  height: 7,
  marginLeft: 7,
  borderRadius: 999,
  background: "#ffdca8",
  boxShadow: "0 0 8px rgba(255,220,168,0.55)",
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

const statusLine: React.CSSProperties = {
  minHeight: 18,
  fontSize: 13,
  margin: 0,
  lineHeight: "18px",
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

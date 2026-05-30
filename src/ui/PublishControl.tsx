import { useState } from "react";
import { useStore } from "../store";
import { isSharingConfigured } from "../cloud";
import { Account } from "./Account";

// Publish / re-publish / unpublish the current composition. Published state lives
// on the composition (publishedId), so it stays consistent with the library list.
export function PublishControl() {
  const comp = useStore((s) => s.composition);
  const user = useStore((s) => s.user);
  const publishCurrent = useStore((s) => s.publishCurrent);
  const unpublishComposition = useStore((s) => s.unpublishComposition);

  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const empty = comp.tracks.length === 0;
  const published = Boolean(comp.publishedId);
  const link = comp.publishedId ? `${location.origin}/c/${comp.publishedId}` : "";

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; link is selectable */
    }
  }

  let body: React.ReactNode;
  if (!isSharingConfigured) {
    body = (
      <button style={{ ...btn, opacity: 0.5 }} disabled title="Sharing isn't configured (Supabase env vars missing)">
        ⬆ Publish
      </button>
    );
  } else if (!user) {
    body = (
      <>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Sign in to publish:</div>
        <Account />
      </>
    );
  } else if (published) {
    body = (
      <>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>● Published (read-only link):</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={linkInput} readOnly value={link} onFocus={(e) => e.target.select()} />
          <button style={btn} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          <button style={link2} disabled={!!busy} onClick={() => run("Updating…", publishCurrent)}>
            {busy === "Updating…" ? "Updating…" : "Update"}
          </button>
          <button style={{ ...link2, color: "#ff9b8f" }} disabled={!!busy} onClick={() => run("Unpublishing…", () => unpublishComposition(comp.id))}>
            Unpublish
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <button
        style={{ ...btn, opacity: empty || busy ? 0.5 : 1 }}
        disabled={empty || !!busy}
        title={empty ? "Add a track first" : "Publish a read-only shareable link"}
        onClick={() => run("Publishing…", publishCurrent)}
      >
        {busy === "Publishing…" ? "Publishing…" : "⬆ Publish"}
      </button>
    );
  }

  return (
    <div style={panel}>
      {body}
      {error && <div style={{ color: "#ff9b8f", fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  right: 16,
  padding: 12,
  borderRadius: 10,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  fontFamily: "system-ui, sans-serif",
  color: "white",
  width: 260,
};

const btn: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 14,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(91,140,255,0.22)",
  color: "white",
  cursor: "pointer",
};

const link2: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.6)",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};

const linkInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "white",
  padding: "6px 8px",
  fontSize: 12,
};

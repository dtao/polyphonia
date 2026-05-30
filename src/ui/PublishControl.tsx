import { useState } from "react";
import { useStore } from "../store";
import { isSharingConfigured, publishComposition } from "../cloud";

// Publish the current composition to the cloud and surface a shareable link.
export function PublishControl() {
  const comp = useStore((s) => s.composition);
  const [status, setStatus] = useState<"idle" | "publishing" | "done" | "error">("idle");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  const empty = comp.tracks.length === 0;

  async function publish() {
    setStatus("publishing");
    setCopied(false);
    try {
      const id = await publishComposition(comp);
      setLink(`${location.origin}/c/${id}`);
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; the link is selectable anyway */
    }
  }

  return (
    <div style={panel}>
      {status === "done" ? (
        <>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Shareable link (read-only):</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input style={linkInput} readOnly value={link} onFocus={(e) => e.target.select()} />
            <button style={btn} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button style={againBtn} onClick={() => setStatus("idle")}>
            Publish again
          </button>
        </>
      ) : (
        <button
          style={{ ...btn, opacity: empty || !isSharingConfigured || status === "publishing" ? 0.5 : 1 }}
          disabled={empty || !isSharingConfigured || status === "publishing"}
          title={
            !isSharingConfigured
              ? "Sharing isn't configured (Supabase env vars missing)"
              : empty
                ? "Add a track first"
                : "Publish a read-only shareable link"
          }
          onClick={publish}
        >
          {status === "publishing" ? "Publishing…" : "⬆ Publish"}
        </button>
      )}
      {status === "error" && <div style={{ color: "#ff9b8f", fontSize: 12, marginTop: 6 }}>Publish failed.</div>}
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

const againBtn: React.CSSProperties = {
  marginTop: 8,
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.55)",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "underline",
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

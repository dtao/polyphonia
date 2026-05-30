import { useEffect, useState } from "react";
import { useStore } from "../store";
import { listMyPublished, unpublish, PublishedSummary } from "../cloud";

// Manage the signed-in user's published links: copy or unpublish.
export function MyPublished() {
  const user = useStore((s) => s.user);
  const [items, setItems] = useState<PublishedSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function refresh() {
    try {
      setItems(await listMyPublished());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (user) refresh();
    else setItems([]);
  }, [user]);

  if (!user || items.length === 0) return null;

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/c/${id}`);
      setCopiedId(id);
    } catch {
      /* clipboard may be blocked */
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Unpublish this link? Anyone holding it will no longer be able to open it.")) return;
    setBusy(true);
    try {
      await unpublish(id);
      await refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>Your published links</div>
      {items.map((it) => (
        <div key={it.id} style={row}>
          <span style={title}>{it.title}</span>
          <button style={link} disabled={busy} onClick={() => copy(it.id)}>
            {copiedId === it.id ? "Copied" : "Copy"}
          </button>
          <button style={{ ...link, color: "#ff9b8f" }} disabled={busy} onClick={() => remove(it.id)}>
            Unpublish
          </button>
        </div>
      ))}
    </div>
  );
}

const wrap: React.CSSProperties = {
  width: 380,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "8px 4px",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const title: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const link: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.6)",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};

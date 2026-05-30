import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isSharingConfigured, listRecent, GallerySummary } from "../cloud";

// Public gallery: a grid of the most recently published compositions. Each card
// opens the read-only viewer at /c/:id.
export function Gallery() {
  const [items, setItems] = useState<GallerySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSharingConfigured) {
      setError("Sharing isn't configured.");
      return;
    }
    listRecent(50)
      .then(setItems)
      .catch((e) => {
        console.error(e);
        setError("Couldn't load the gallery.");
      });
  }, []);

  return (
    <div style={page}>
      <header style={head}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: 1 }}>Gallery</h1>
        <Link to="/" style={homeLink}>
          ← Home
        </Link>
      </header>

      {error ? (
        <p style={muted}>{error}</p>
      ) : !items ? (
        <p style={muted}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={muted}>Nothing has been published yet. Be the first!</p>
      ) : (
        <div style={grid}>
          {items.map((it) => (
            <Link key={it.id} to={`/c/${it.id}`} style={card}>
              <div style={cardTitle}>{it.title}</div>
              <div style={cardArtist}>{it.artist}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  overflowY: "auto",
  background: "radial-gradient(circle at center, rgba(20,24,48,0.95), rgba(5,6,10,1))",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  padding: "32px 40px",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  maxWidth: 1100,
  margin: "0 auto 24px",
};

const homeLink: React.CSSProperties = { color: "rgba(255,255,255,0.6)", fontSize: 14, textDecoration: "none" };

const muted: React.CSSProperties = { textAlign: "center", opacity: 0.6, marginTop: 80 };

const grid: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 16,
};

const card: React.CSSProperties = {
  display: "block",
  padding: 18,
  height: 120,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  textDecoration: "none",
};

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const cardArtist: React.CSSProperties = { fontSize: 13, opacity: 0.6, marginTop: 4 };

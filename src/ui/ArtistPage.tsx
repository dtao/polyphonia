import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GallerySummary, isSharingConfigured, listByArtist } from "../cloud";
import { card, cardArtist, cardTitle, grid, head, homeLink, muted, page } from "./galleryStyles";

// Public artist page: all published compositions for a denormalized artist name.
export function ArtistPage() {
  const { artist = "" } = useParams();
  const artistName = artist;
  const [items, setItems] = useState<GallerySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSharingConfigured) {
      setError("Sharing isn't configured.");
      return;
    }
    listByArtist(artistName, 100)
      .then(setItems)
      .catch((e) => {
        console.error(e);
        setError("Couldn't load this artist.");
      });
  }, [artistName]);

  return (
    <div style={page}>
      <header style={head}>
        <div>
          <p style={{ margin: "0 0 4px", opacity: 0.55, fontSize: 13 }}>Artist</p>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: 1 }}>{artistName || "Unknown"}</h1>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <Link to="/gallery" style={homeLink}>
            Gallery
          </Link>
          <Link to="/" style={homeLink}>
            Home
          </Link>
        </div>
      </header>

      {error ? (
        <p style={muted}>{error}</p>
      ) : !items ? (
        <p style={muted}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={muted}>No published compositions for this artist yet.</p>
      ) : (
        <div style={grid}>
          {items.map((it) => (
            <article key={it.id} style={card}>
              <Link to={`/c/${it.id}`} style={cardTitle}>
                {it.title}
              </Link>
              <span style={{ ...cardArtist, color: "rgba(255,255,255,0.55)" }}>{it.artist}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

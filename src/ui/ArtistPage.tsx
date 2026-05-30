import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GallerySummary, isSharingConfigured, listByArtistSlug } from "../cloud";
import { ArtistAvatar, card, cardArtist, cardTitle, grid, head, homeLink, muted, page } from "./galleryStyles";

// Public artist page: all published compositions for a denormalized artist name.
export function ArtistPage() {
  const { slug = "" } = useParams();
  const [items, setItems] = useState<GallerySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artist = items?.[0];

  useEffect(() => {
    if (!isSharingConfigured) {
      setError("Sharing isn't configured.");
      return;
    }
    listByArtistSlug(slug, 100)
      .then(setItems)
      .catch((e) => {
        console.error(e);
        setError("Couldn't load this artist.");
      });
  }, [slug]);

  return (
    <div style={page}>
      <header style={head}>
        <div>
          <p style={{ margin: "0 0 4px", opacity: 0.55, fontSize: 13 }}>Artist</p>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>
            {artist && <ArtistAvatar artist={artist} size={34} />}
            {artist?.artist || slug || "Unknown"}
          </h1>
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
              <span style={{ ...cardArtist, color: "rgba(255,255,255,0.55)" }}>
                <ArtistAvatar artist={it} size={20} />
                {it.artist}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

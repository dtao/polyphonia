import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isSharingConfigured, listRecent, GallerySummary } from "../cloud";
import { ArtistAvatar, artistPath, card, cardArtist, cardTitle, grid, head, homeLink, muted, page } from "./galleryStyles";

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
            <article key={it.id} style={card}>
              <Link to={`/c/${it.id}`} style={cardTitle}>
                {it.title}
              </Link>
              <Link to={artistPath(it.artist, it.artistSlug)} style={cardArtist}>
                <ArtistAvatar artist={it} size={20} />
                {it.artist}
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

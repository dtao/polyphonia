export interface ArtistIdentity {
  artistId?: string;
  artist: string;
  artistSlug?: string;
  artistAvatarUrl?: string;
  artistAvatarEmailHash?: string;
}

export function slugifyArtist(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "artist";
}

export function artistPath(artist: string, slug?: string): string {
  return `/artist/${encodeURIComponent(slug || slugifyArtist(artist))}`;
}

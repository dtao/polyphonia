import React from "react";

export function artistPath(artist: string): string {
  return `/artist/${encodeURIComponent(artist)}`;
}

export const page: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  overflowY: "auto",
  background: "radial-gradient(circle at center, rgba(20,24,48,0.95), rgba(5,6,10,1))",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  padding: "32px 40px",
};

export const head: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  maxWidth: 1100,
  margin: "0 auto 24px",
};

export const homeLink: React.CSSProperties = { color: "rgba(255,255,255,0.6)", fontSize: 14, textDecoration: "none" };

export const muted: React.CSSProperties = { textAlign: "center", opacity: 0.6, marginTop: 80 };

export const grid: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 16,
};

export const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: 18,
  height: 120,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
};

export const cardTitle: React.CSSProperties = {
  display: "block",
  fontSize: 18,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: "white",
  textDecoration: "none",
};

export const cardArtist: React.CSSProperties = {
  alignSelf: "flex-start",
  fontSize: 13,
  opacity: 0.7,
  color: "rgba(190,205,255,0.95)",
  textDecoration: "none",
};

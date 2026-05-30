import { useState } from "react";
import { useStore } from "../store";
import { isSharingConfigured } from "../cloud";

// Email magic-link sign-in / sign-out widget. Reused on the start screen and in
// the publish control. Editing never requires this — only publishing does.
export function Account() {
  const user = useStore((s) => s.user);
  const accountArtist = useStore((s) => s.accountArtist);
  const signIn = useStore((s) => s.signIn);
  const signOut = useStore((s) => s.signOut);
  const createAccountArtist = useStore((s) => s.createAccountArtist);
  const [email, setEmail] = useState("");
  const [artistName, setArtistName] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSharingConfigured) return null;

  if (user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
        <div style={row}>
          <span style={{ opacity: 0.7, fontSize: 13 }}>Signed in as {user.email}</span>
          <button style={link} onClick={() => signOut()}>
            Sign out
          </button>
        </div>
        {accountArtist ? (
          <div style={{ opacity: 0.7, fontSize: 13 }}>Artist: {accountArtist.artist}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
            <div style={row}>
              <input
                style={input}
                placeholder="Artist name"
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveArtist()}
              />
              <button style={btn} disabled={busy || !artistName.trim()} onClick={saveArtist}>
                Save artist
              </button>
            </div>
            <div style={{ opacity: 0.55, fontSize: 12 }}>New compositions will use this artist name.</div>
          </div>
        )}
        {error && <div style={{ color: "#ff9b8f", fontSize: 12 }}>{error}</div>}
      </div>
    );
  }

  if (sent) {
    return <div style={{ fontSize: 13, opacity: 0.75 }}>✉ Check your email for a sign-in link.</div>;
  }

  async function send() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim());
      setSent(true);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't send the link.");
    } finally {
      setBusy(false);
    }
  }

  async function saveArtist() {
    if (!artistName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createAccountArtist(artistName.trim());
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't save artist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      <div style={row}>
        <input
          style={input}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button style={btn} disabled={busy} onClick={send}>
          {busy ? "…" : "Sign in"}
        </button>
      </div>
      {error && <div style={{ color: "#ff9b8f", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };

const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 8,
  color: "white",
  padding: "8px 10px",
  fontSize: 14,
  width: 200,
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

const link: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.6)",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "underline",
};

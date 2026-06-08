import { FormEvent, useState } from "react";
import { isSharingConfigured } from "../cloud";
import { Account } from "./Account";

const demoUrl = ((import.meta as any).env?.VITE_PUBLIC_DEMO_URL as string | undefined)?.trim();

export function PublicLanding() {
  const [interestSubmitted, setInterestSubmitted] = useState(false);

  function submitInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInterestSubmitted(true);
  }

  return (
    <main style={page}>
      <div style={glow} />
      <section style={content}>
        <div style={eyebrow}>SPATIAL MUSIC</div>
        <h1 style={title}>POLYPHONIA</h1>
        <p style={lede}>
          Step inside music. Polyphonia turns a composition into a 3D space,
          placing each instrument around you so the mix changes as you explore.
        </p>

        {demoUrl && (
          <a href={demoUrl} style={demoLink}>
            Explore the demo
          </a>
        )}

        <div style={interestCard}>
          <h2 style={cardTitle}>Create spatial music</h2>
          <p style={cardCopy}>
            Polyphonia is opening gradually to artists and producers. Leave
            your email to hear when creator access expands.
          </p>
          <form style={interestForm} onSubmit={submitInterest}>
            <label style={visuallyHidden} htmlFor="artist-interest-email">
              Email address
            </label>
            <input
              id="artist-interest-email"
              style={input}
              type="email"
              placeholder="artist@example.com"
              required
            />
            <button style={secondaryButton} type="submit">
              Keep me posted
            </button>
          </form>
          {interestSubmitted && (
            <p style={formNote}>
              Email signup is coming soon. This preview did not submit your
              address.
            </p>
          )}
        </div>

        {isSharingConfigured && (
          <div style={creatorAccess}>
            <div style={creatorLabel}>Already have creator access?</div>
            <Account />
          </div>
        )}
      </section>
    </main>
  );
}

const page: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  overflowY: "auto",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  background:
    "radial-gradient(circle at 50% 20%, rgba(71,86,150,0.34), transparent 34%), linear-gradient(160deg, #10152b 0%, #070910 58%, #040507 100%)",
};

const glow: React.CSSProperties = {
  position: "fixed",
  width: 420,
  height: 420,
  left: "50%",
  top: -240,
  transform: "translateX(-50%)",
  borderRadius: "50%",
  background: "rgba(113,143,255,0.2)",
  filter: "blur(80px)",
  pointerEvents: "none",
};

const content: React.CSSProperties = {
  position: "relative",
  width: "min(680px, calc(100% - 40px))",
  minHeight: "100%",
  margin: "0 auto",
  padding: "clamp(64px, 12vh, 128px) 0 48px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
};

const eyebrow: React.CSSProperties = {
  color: "rgba(179,195,255,0.8)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 4,
};

const title: React.CSSProperties = {
  margin: "12px 0 20px",
  fontSize: "clamp(44px, 10vw, 76px)",
  lineHeight: 1,
  letterSpacing: "clamp(3px, 1vw, 8px)",
};

const lede: React.CSSProperties = {
  maxWidth: 600,
  margin: 0,
  color: "rgba(255,255,255,0.72)",
  fontSize: "clamp(18px, 3vw, 22px)",
  lineHeight: 1.55,
};

const demoLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: 30,
  padding: "13px 28px",
  borderRadius: 999,
  border: "1px solid rgba(161,181,255,0.6)",
  background: "rgba(91,140,255,0.24)",
  boxShadow: "0 10px 36px rgba(33,53,115,0.28)",
  color: "white",
  fontSize: 16,
  fontWeight: 650,
  textDecoration: "none",
};

const interestCard: React.CSSProperties = {
  width: "100%",
  marginTop: 64,
  padding: "28px clamp(20px, 5vw, 40px)",
  boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,0.055)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
};

const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
};

const cardCopy: React.CSSProperties = {
  maxWidth: 520,
  margin: "10px auto 20px",
  color: "rgba(255,255,255,0.62)",
  lineHeight: 1.5,
};

const interestForm: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 10,
  flexWrap: "wrap",
};

const input: React.CSSProperties = {
  flex: "1 1 240px",
  minWidth: 0,
  maxWidth: 360,
  boxSizing: "border-box",
  padding: "11px 13px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(5,6,10,0.46)",
  color: "white",
  fontSize: 15,
};

const secondaryButton: React.CSSProperties = {
  padding: "11px 18px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(255,255,255,0.09)",
  color: "white",
  cursor: "pointer",
  fontSize: 14,
};

const formNote: React.CSSProperties = {
  margin: "14px 0 0",
  color: "rgba(205,216,255,0.76)",
  fontSize: 13,
};

const creatorAccess: React.CSSProperties = {
  marginTop: 34,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
};

const creatorLabel: React.CSSProperties = {
  color: "rgba(255,255,255,0.42)",
  fontSize: 12,
};

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

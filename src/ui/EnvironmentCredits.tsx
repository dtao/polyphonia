import { environmentPackById } from "../environmentPacks";
import { useStore } from "../store";

export function EnvironmentCredits() {
  const packId = useStore((state) => state.composition.environment.pack?.id);
  const pack = environmentPackById(packId);
  if (!pack || pack.attribution.length === 0) return null;

  return (
    <div style={credits}>
      {pack.attribution.map((item, index) => (
        <span key={`${item.title}:${item.author}`}>
          {index > 0 ? " · " : ""}
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" style={link}>
              {item.title} by {item.author}
            </a>
          ) : (
            <>
              {item.title} by {item.author}
            </>
          )}
          {" · "}
          {item.license}
        </span>
      ))}
    </div>
  );
}

const credits: React.CSSProperties = {
  position: "absolute",
  left: 14,
  bottom: 12,
  zIndex: 8,
  maxWidth: "min(520px, calc(100vw - 28px))",
  color: "rgba(255,255,255,0.42)",
  font: "10px/1.35 system-ui, sans-serif",
  pointerEvents: "auto",
};

const link: React.CSSProperties = {
  color: "rgba(255,255,255,0.55)",
};

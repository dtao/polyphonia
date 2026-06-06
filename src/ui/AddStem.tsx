import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { registerStemDialogOpener } from "../shortcuts";

const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i;
const isAudio = (f: File) => f.type.startsWith("audio/") || AUDIO_RE.test(f.name);

// Adds stems via a file picker or by dropping audio files anywhere on the page.
export function AddStem() {
  const engine = useStore((s) => s.engine);
  const addStem = useStore((s) => s.addStem);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    const audio = files.filter(isAudio);
    if (files.length && !audio.length) {
      setError("That doesn't look like an audio file.");
      return;
    }
    for (const f of audio) {
      try {
        setError(null);
        await addStem(f);
      } catch (err) {
        console.error(err);
        setError(`Couldn't load "${f.name}" — is it a valid audio file?`);
      }
    }
  }

  // Expose the file picker to the central shortcut dispatcher (Cmd/Ctrl+O is
  // declared in src/shortcuts.ts).
  useEffect(() => {
    registerStemDialogOpener(() => inputRef.current?.click());
    return () => registerStemDialogOpener(null);
  }, []);

  // Global drag-and-drop.
  useEffect(() => {
    if (!engine) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [engine]);

  if (!engine) return null;

  return (
    <>
      <button style={addBtn} onClick={() => inputRef.current?.click()} title="Add stem (Cmd/Ctrl+O)">
        ＋ Add stem
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {dragging && (
        <div style={dropOverlay}>
          <div style={dropInner}>Drop audio files to add as tracks</div>
        </div>
      )}

      {error && (
        <div style={errToast} onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}

const addBtn: React.CSSProperties = {
  position: "absolute",
  top: 44,
  left: 14,
  zIndex: 10,
  height: 36,
  boxSizing: "border-box",
  padding: "0 14px",
  fontSize: 13,
  lineHeight: "34px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(86,224,192,0.18)",
  color: "white",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
};

const dropOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(8,10,20,0.6)",
  border: "3px dashed rgba(120,170,255,0.6)",
  pointerEvents: "none",
  zIndex: 10,
};

const dropInner: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  fontSize: 22,
  color: "white",
  letterSpacing: 0.5,
};

const errToast: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px 16px",
  borderRadius: 8,
  background: "rgba(255,122,107,0.92)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  cursor: "pointer",
};

import { useEffect, useRef, useState } from "react";
import { touchMove } from "../store";

// Touch devices have no keyboard, so explore-mode movement is driven by this
// on-screen virtual joystick. Dragging the knob writes a normalized vector into
// the `touchMove` singleton, which <Player> reads each frame alongside WASD.
// Camera look is handled separately by drag-to-look on the canvas (see Player).
// Render this only on touch devices and only after the user has entered.
const BASE_SIZE = 130;
const KNOB_SIZE = 58;
const RADIUS = (BASE_SIZE - KNOB_SIZE) / 2;

export function TouchControls() {
  // Knob offset from center, in px (visual feedback for the active drag).
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const base = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);

  // Zero the shared move vector if we ever unmount mid-drag (e.g. on Exit).
  useEffect(() => () => {
    touchMove.forward = 0;
    touchMove.strafe = 0;
  }, []);

  const update = (clientX: number, clientY: number) => {
    const el = base.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    setKnob([dx, dy]);
    // Up on screen (negative dy) is forward; right (positive dx) is strafe.
    touchMove.strafe = dx / RADIUS;
    touchMove.forward = -dy / RADIUS;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (active.current !== null) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerId !== active.current) return;
    update(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerId !== active.current) return;
    active.current = null;
    setKnob([0, 0]);
    touchMove.forward = 0;
    touchMove.strafe = 0;
  };

  return (
    <div
      ref={base}
      style={baseStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div style={{ ...knobStyle, transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}

// True for phones/tablets that fire touch events. Used to gate the overlay so
// desktop explore (mouse + pointer lock) is untouched.
export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0);
}

// A touch device that also reports a coarse, hover-less pointer — i.e. a phone or
// tablet, not a touchscreen laptop. Used to gate phone-only explore inputs (AR
// Walk, Geo Drive).
export function isMobileTouchDevice(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

const baseStyle: React.CSSProperties = {
  position: "absolute",
  left: 28,
  bottom: 28,
  width: BASE_SIZE,
  height: BASE_SIZE,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.22)",
  boxShadow: "inset 0 0 30px rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  touchAction: "none",
  pointerEvents: "auto",
  zIndex: 10,
  userSelect: "none",
  WebkitUserSelect: "none",
};

const knobStyle: React.CSSProperties = {
  width: KNOB_SIZE,
  height: KNOB_SIZE,
  borderRadius: "50%",
  background: "rgba(91,140,255,0.55)",
  border: "1px solid rgba(255,255,255,0.5)",
  boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
};

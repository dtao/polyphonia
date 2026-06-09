import React from "react";

// A compact, read-only elevation indicator shown in the bottom-left inspectors.
// Surfaces the *resolved* elevation of the selected object (after attachment /
// snapping), which is the number you actually want when troubleshooting
// elevation behavior — it reflects where the object really sits, not just an
// editable field. `value` may be a number (single elevation) or a preformatted
// string (e.g. a segment's start→end range).
export function ElevationReadout({ value }: { value: number | string }) {
  return (
    <div style={readout} title="Resolved elevation of the selected object">
      <span style={{ opacity: 0.6 }}>Elevation</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{typeof value === "number" ? value.toFixed(2) : value}</span>
    </div>
  );
}

const readout: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: 10,
  padding: "5px 9px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: 12,
};

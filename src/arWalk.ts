export const AR_WALK_START_EVENT = "polyphonia:ar-walk-start";
export const AR_WALK_STOP_EVENT = "polyphonia:ar-walk-stop";
export const AR_WALK_STATUS_EVENT = "polyphonia:ar-walk-status";

export type ARWalkStatus = {
  state: "idle" | "checking" | "starting" | "active" | "unsupported" | "error";
  frames: number;
  rawMeters: number;
  mapMeters: number;
};

export const idleARWalkStatus: ARWalkStatus = { state: "idle", frames: 0, rawMeters: 0, mapMeters: 0 };

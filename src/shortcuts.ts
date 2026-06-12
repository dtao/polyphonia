// Single source of truth for discrete keyboard shortcuts.
//
// Every command-style shortcut in the app is declared once in `SHORTCUTS`
// below: its keys, what it does, when it applies, and the action it runs. To
// add, remove, or rebind a shortcut, edit that array — nothing else needs to
// change. `dispatchShortcut` walks the list in order and runs the first
// matching, enabled shortcut, consuming the event when it acts.
//
// This intentionally does NOT cover the continuous WASD/QE movement keys in
// `Player`/`EditControls`: those poll held-key state every frame rather than
// firing a one-shot command, and their feel is tuned separately.

import { useStore } from "./store";

export type EditPanel = "map" | "loop" | "world" | null;

export type ShortcutId =
  | "toggle-fullscreen"
  | "clear-selection"
  | "delete-selected"
  | "clone"
  | "undo"
  | "redo"
  | "toggle-mode";

// App-owned callbacks the shortcut actions need. Store state and actions are
// read directly via `useStore.getState()` inside the handlers, so only the
// pieces of UI state that live in React land are threaded through here.
export interface ShortcutContext {
  toggleMode: () => void;
  toggleFullscreen: () => void;
  openEditPanel: EditPanel;
  setOpenEditPanel: (panel: EditPanel) => void;
}

export interface Shortcut {
  id: ShortcutId;
  // Human-readable binding + description, suitable for a help/cheatsheet
  // surface. Kept next to the behavior so the two never drift. Use the literal
  // "Mod" token for the platform modifier; `shortcutKeys` resolves it to
  // Cmd/Ctrl for display.
  keys: string;
  description: string;
  // Whether the event's keys/modifiers match this shortcut. Pure.
  match: (e: KeyboardEvent) => boolean;
  // Whether the shortcut currently applies (mode/selection/engine gates).
  enabled: (ctx: ShortcutContext) => boolean;
  // Perform the action. Return true if it handled the event (which consumes
  // it via preventDefault); return false to fall through, e.g. a delete with
  // nothing selected.
  run: (ctx: ShortcutContext) => boolean;
  // Allow firing while a text input/textarea is focused. Defaults to false so
  // typing in a panel field never triggers a command.
  allowInTextField?: boolean;
}

// True when focus is in a text field, where most shortcuts should stand down.
export function isTextFieldFocused(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

const hasModifier = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

// The platform's command modifier, for display in help text.
export function modKeyLabel(): string {
  return navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl";
}

// Display label for a shortcut's keys, with the "Mod" token resolved to the
// platform modifier. This is the source of truth for any help/tooltip text.
export function shortcutKeys(id: ShortcutId): string {
  const sc = SHORTCUTS.find((s) => s.id === id);
  return sc ? sc.keys.replace("Mod", modKeyLabel()) : "";
}

// Walks the priority chain of selected objects and deletes the top one. Returns
// true if something was deleted.
function deleteSelected(): boolean {
  const s = useStore.getState();
  if (s.selectedLandmarkId) {
    s.deleteLandmark(s.selectedLandmarkId);
    return true;
  }
  if (s.selectedId) {
    s.deleteTrack(s.selectedId);
    return true;
  }
  if (s.selectedRoomId && s.selectedEntranceIndex !== null) {
    s.removeEntrance(s.selectedRoomId, s.selectedEntranceIndex);
    return true;
  }
  if (s.selectedRoomId) {
    s.deleteRoom(s.selectedRoomId);
    return true;
  }
  if (s.selectedPlatformId) {
    s.deletePlatform(s.selectedPlatformId);
    return true;
  }
  if (s.selectedWallId) {
    s.deleteWall(s.selectedWallId);
    return true;
  }
  if (s.selectedMapPointKey) {
    s.deleteMapPoint(s.selectedMapPointKey);
    return true;
  }
  return false;
}

// Walks the priority chain of selected objects and clones the top one. For a map
// point this grows a new branch; for everything else it makes a nearby copy.
// Returns true if something was cloned.
function cloneSelected(): boolean {
  const s = useStore.getState();
  if (s.selectedLandmarkId) {
    s.duplicateLandmark(s.selectedLandmarkId);
    return true;
  }
  if (s.selectedId) {
    void s.duplicateTrack(s.selectedId);
    return true;
  }
  if (s.selectedRoomId) {
    s.duplicateRoom(s.selectedRoomId);
    return true;
  }
  if (s.selectedPlatformId) {
    s.duplicatePlatform(s.selectedPlatformId);
    return true;
  }
  if (s.selectedWallId) {
    s.duplicateWall(s.selectedWallId);
    return true;
  }
  if (s.selectedMapPointKey) {
    s.addBranchAtPoint(s.selectedMapPointKey);
    return true;
  }
  return false;
}

export const SHORTCUTS: Shortcut[] = [
  {
    id: "toggle-fullscreen",
    keys: "F",
    description: "Toggle fullscreen",
    match: (e) => e.code === "KeyF",
    enabled: () => true,
    run: (ctx) => {
      ctx.toggleFullscreen();
      return true;
    },
  },
  {
    id: "clear-selection",
    keys: "Esc",
    description: "Close the open panel, then clear the current selection",
    // Escape works even while typing in a field, and yields to the browser
    // when it should exit fullscreen instead.
    allowInTextField: true,
    match: (e) => e.key === "Escape",
    enabled: () => useStore.getState().mode === "edit" && !document.fullscreenElement,
    run: (ctx) => {
      if (ctx.openEditPanel) {
        ctx.setOpenEditPanel(null);
        return true;
      }
      const s = useStore.getState();
      if (s.selectedId) {
        s.select(null);
        return true;
      }
      if (s.selectedLandmarkId) {
        s.selectLandmark(null);
        return true;
      }
      if (s.worldTool.kind !== "none") {
        s.setWorldTool({ kind: "none" });
        return true;
      }
      return false;
    },
  },
  {
    id: "delete-selected",
    keys: "Delete",
    description: "Delete the selected stem, map point, room, platform, or wall",
    match: (e) => e.code === "Delete" || e.code === "Backspace",
    enabled: () => useStore.getState().mode === "edit",
    run: () => deleteSelected(),
  },
  {
    id: "clone",
    keys: "C",
    description:
      "Clone the selected object — a nearby copy of a stem, room, platform, wall, or landmark, or a new branch from a map point",
    match: (e) => e.code === "KeyC" && !hasModifier(e) && !e.altKey,
    enabled: () => useStore.getState().mode === "edit",
    run: () => cloneSelected(),
  },
  {
    id: "undo",
    keys: "Mod+Z",
    description: "Undo the last edit",
    match: (e) => hasModifier(e) && e.key.toLowerCase() === "z" && !e.shiftKey,
    enabled: () => useStore.getState().entered,
    run: () => {
      void useStore.getState().undo();
      return true;
    },
  },
  {
    id: "redo",
    keys: "Mod+Shift+Z",
    description: "Redo the last undone edit",
    match: (e) =>
      hasModifier(e) &&
      ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y"),
    enabled: () => useStore.getState().entered,
    run: () => {
      void useStore.getState().redo();
      return true;
    },
  },
  {
    id: "toggle-mode",
    keys: "Tab",
    description: "Toggle between Explore and Edit",
    match: (e) => e.code === "Tab",
    enabled: () => !!useStore.getState().engine,
    run: (ctx) => {
      ctx.toggleMode();
      return true;
    },
  },
];

// Dispatch a keydown against the shortcut table. Returns true if a shortcut
// handled it (in which case the event has been consumed via preventDefault).
export function dispatchShortcut(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  const textField = isTextFieldFocused();
  for (const sc of SHORTCUTS) {
    if (!sc.match(e)) continue;
    if (textField && !sc.allowInTextField) continue;
    if (!sc.enabled(ctx)) continue;
    if (sc.run(ctx)) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}

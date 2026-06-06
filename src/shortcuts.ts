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

export type EditPanel = "environment" | "map" | "loop" | null;

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
  id: string;
  // Human-readable binding + description, suitable for a help/cheatsheet
  // surface. Kept next to the behavior so the two never drift.
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

// The hidden "Add stem" file input lives in the AddStem component. It registers
// an opener here so the central dispatcher can trigger it without lifting the
// file-handling machinery out of that component.
let stemDialogOpener: (() => void) | null = null;
export function registerStemDialogOpener(opener: (() => void) | null): void {
  stemDialogOpener = opener;
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
    id: "branch-at-point",
    keys: "B",
    description: "Grow a new branch from the selected map point",
    match: (e) => e.code === "KeyB" && !hasModifier(e) && !e.altKey,
    enabled: () => useStore.getState().mode === "edit" && !!useStore.getState().selectedMapPointKey,
    run: () => {
      const key = useStore.getState().selectedMapPointKey;
      if (!key) return false;
      useStore.getState().addBranchAtPoint(key);
      return true;
    },
  },
  {
    id: "duplicate-stem",
    keys: "Cmd/Ctrl+D",
    description: "Duplicate the selected stem",
    match: (e) => hasModifier(e) && e.code === "KeyD",
    enabled: () => useStore.getState().mode === "edit" && !!useStore.getState().selectedId,
    run: () => {
      const id = useStore.getState().selectedId;
      if (!id) return false;
      void useStore.getState().duplicateTrack(id);
      return true;
    },
  },
  {
    id: "undo",
    keys: "Cmd/Ctrl+Z",
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
    keys: "Cmd/Ctrl+Shift+Z",
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
    id: "add-stem",
    keys: "Cmd/Ctrl+O",
    description: "Open the file picker to add a stem",
    match: (e) => hasModifier(e) && e.code === "KeyO",
    enabled: () => !!useStore.getState().engine && !!stemDialogOpener,
    run: () => {
      stemDialogOpener?.();
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

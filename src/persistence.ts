import { Composition, TrackDef, defaultComposition, normalizeComposition } from "./composition";
import { newId } from "./id";
import { databaseRequest, STEM_STORE } from "./localDatabase";
import { normalizeMap } from "./map";

// Local-first persistence. A *library* of composition manifests (small JSON)
// lives in localStorage; uploaded stem audio (large binary) lives in IndexedDB,
// keyed by track id. An uploaded stem's source serializes to a {kind:"stored"}
// marker and rehydrates to an object URL on load, so the rest of the app only
// ever sees normal "file" sources.

// ===== IndexedDB blob store (tiny, dependency-free) =====

function idbRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return databaseRequest<T>(STEM_STORE, mode, fn);
}

export const stemPut = (key: string, blob: Blob) => idbRequest<void>("readwrite", (s) => s.put(blob, key));
export const stemGet = (key: string) => idbRequest<Blob | undefined>("readonly", (s) => s.get(key));
export const stemDelete = (key: string) => idbRequest<void>("readwrite", (s) => s.delete(key)).catch(() => {});

// ===== Serialize / resolve =====

type StoredSource = { kind: "stored"; key: string };
type SerializedTrack = Omit<TrackDef, "source"> & { source: TrackDef["source"] | StoredSource };
export type SerializedComposition = Omit<Composition, "tracks"> & { tracks: SerializedTrack[] };

const isUploaded = (t: TrackDef) => t.source.kind === "file" && t.source.url.startsWith("blob:");

// Resolved (runtime) composition -> serializable manifest.
export function serializeComposition(comp: Composition): SerializedComposition {
  const normalized = normalizeComposition(comp);
  return {
    ...normalized,
    tracks: normalized.tracks.map((t) => (isUploaded(t) ? { ...t, source: { kind: "stored", key: t.id } } : t)),
  };
}

// Manifest -> runtime composition, reading stored stems back into object URLs.
export async function resolveComposition(saved: SerializedComposition): Promise<Composition> {
  const tracks: TrackDef[] = [];
  for (const t of saved.tracks) {
    if (t.source.kind === "stored") {
      const blob = await stemGet(t.source.key);
      if (!blob) continue; // stem audio missing — drop the track
      tracks.push({ ...t, source: { kind: "file", url: URL.createObjectURL(blob) } });
    } else {
      tracks.push({ ...t, source: t.source });
    }
  }
  return normalizeComposition({ ...saved, tracks });
}

// ===== Library (localStorage) =====

const LIB_KEY = "polyphonia:library";
const OLD_KEY = "polyphonia:composition"; // pre-library single-slot format
const SCHEMA_VERSION = 4;

export function loadLibrary(): { library: SerializedComposition[]; currentId: string } {
  const raw = localStorage.getItem(LIB_KEY);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if ((p?.version === 2 || p?.version === 3 || p?.version === SCHEMA_VERSION) && Array.isArray(p.library) && p.library.length) {
        return { library: p.library.map(normalizeComposition), currentId: p.currentId ?? p.library[0].id };
      }
    } catch (err) {
      console.error("Failed to read library", err);
    }
  }
  // Migrate the old single-slot format, if present.
  const old = localStorage.getItem(OLD_KEY);
  if (old) {
    try {
      const p = JSON.parse(old);
      if (p?.composition) return { library: [normalizeComposition(p.composition)], currentId: p.composition.id };
    } catch {
      /* ignore */
    }
  }
  // First run: seed with the built-in demo.
  const seed = serializeComposition(defaultComposition);
  return { library: [seed], currentId: seed.id };
}

export function persistLibrary(library: SerializedComposition[], currentId: string): void {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify({ version: SCHEMA_VERSION, currentId, library }));
  } catch (err) {
    console.error("Failed to save library", err);
  }
}

// Copy a manifest under fresh ids, duplicating any stored stems in IndexedDB so
// the copy is fully independent of the original.
export async function copyComposition(s: SerializedComposition): Promise<SerializedComposition> {
  const source: SerializedComposition = { ...s, map: normalizeMap(s.map) };
  const now = new Date().toISOString();
  const tracks: SerializedTrack[] = [];
  for (const t of source.tracks) {
    const id = newId();
    if (t.source.kind === "stored") {
      const blob = await stemGet(t.source.key);
      if (blob) await stemPut(id, blob);
      tracks.push({ ...t, id, source: { kind: "stored", key: id } });
    } else {
      tracks.push({ ...t, id });
    }
  }
  return {
    ...source,
    id: newId(),
    title: `${s.title} (copy)`,
    tracks,
    publishedId: undefined,
    publishedRevision: undefined,
    publishedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

// ===== Export / import: a single self-contained .polyphonia.json bundle =====

const BUNDLE_VERSION = 1;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000; // avoid arg-count limits on fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

type StemEntry = { name: string; type: string; data: string };

// Download the composition with all stem audio embedded, fully portable.
export async function exportComposition(comp: Composition): Promise<void> {
  const normalized = normalizeComposition(comp);
  const stems: Record<string, StemEntry> = {};
  const tracks: SerializedTrack[] = [];
  for (const t of normalized.tracks) {
    if (t.source.kind === "file") {
      const blob = await (await fetch(t.source.url)).blob();
      stems[t.id] = { name: t.name, type: blob.type || "audio/mpeg", data: toBase64(await blob.arrayBuffer()) };
      tracks.push({ ...t, source: { kind: "stored", key: t.id } });
    } else {
      tracks.push(t); // synth: nothing to embed
    }
  }

  const payload = { version: BUNDLE_VERSION, composition: { ...normalized, tracks }, stems };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(normalized.title || "composition").replace(/[^\w.-]+/g, "_")}.polyphonia.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Parse a bundle, store its stems in IndexedDB under fresh ids, and return an
// in-memory composition (with object URLs) ready to become the current one.
export async function importComposition(file: File): Promise<Composition> {
  const payload = JSON.parse(await file.text());
  if (payload?.version !== BUNDLE_VERSION) throw new Error("Unrecognized or unsupported Polyphonia file.");
  const saved: SerializedComposition = payload.composition;
  const stems: Record<string, StemEntry> = payload.stems ?? {};

  const tracks: TrackDef[] = [];
  for (const t of saved.tracks) {
    if (t.source.kind === "stored") {
      const entry = stems[t.source.key];
      if (!entry) continue;
      const id = newId();
      const blob = base64ToBlob(entry.data, entry.type);
      await stemPut(id, blob);
      tracks.push({ ...t, id, source: { kind: "file", url: URL.createObjectURL(blob) } });
    } else {
      tracks.push({ ...t, source: t.source });
    }
  }
  const now = new Date().toISOString();
  return normalizeComposition({ ...saved, id: newId(), tracks, publishedId: undefined, publishedRevision: undefined, publishedAt: undefined, createdAt: now, updatedAt: now });
}

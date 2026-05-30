import { Composition, TrackDef } from "./composition";
import { newId } from "./id";

// Local-first persistence. The composition manifest (small JSON) lives in
// localStorage; uploaded stem audio (large binary) lives in IndexedDB, keyed by
// track id. On save an uploaded stem's source becomes a {kind:"stored"} marker;
// on load its blob is read back into a fresh object URL, so the rest of the app
// only ever sees normal "file" sources.

const MANIFEST_KEY = "polyphonia:composition";
const SCHEMA_VERSION = 1;

// --- IndexedDB blob store (tiny, dependency-free) ---

const DB_NAME = "polyphonia";
const STORE_NAME = "stems";
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function idbRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return getDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const stemPut = (key: string, blob: Blob) => idbRequest<void>("readwrite", (s) => s.put(blob, key));
export const stemGet = (key: string) => idbRequest<Blob | undefined>("readonly", (s) => s.get(key));
export const stemDelete = (key: string) => idbRequest<void>("readwrite", (s) => s.delete(key)).catch(() => {});

// --- Manifest (de)serialization ---

type StoredSource = { kind: "stored"; key: string };
type SerializedTrack = Omit<TrackDef, "source"> & { source: TrackDef["source"] | StoredSource };
type SerializedComposition = Omit<Composition, "tracks"> & { tracks: SerializedTrack[] };

const isUploaded = (t: TrackDef) => t.source.kind === "file" && t.source.url.startsWith("blob:");

export function saveComposition(comp: Composition): void {
  const tracks: SerializedTrack[] = comp.tracks.map((t) =>
    isUploaded(t) ? { ...t, source: { kind: "stored", key: t.id } } : t,
  );
  const payload = { version: SCHEMA_VERSION, composition: { ...comp, tracks } };
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("Failed to save composition", err);
  }
}

// Returns the restored composition (uploaded stems rehydrated to object URLs),
// or null if there's nothing valid saved.
export async function loadComposition(): Promise<Composition | null> {
  const raw = localStorage.getItem(MANIFEST_KEY);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (payload?.version !== SCHEMA_VERSION) return null;
    const saved: SerializedComposition = payload.composition;

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
    return { ...saved, tracks };
  } catch (err) {
    console.error("Failed to load composition", err);
    return null;
  }
}

// --- Export / import: a single self-contained .polyphonia.json bundle ---

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

// Download the composition with all stem audio embedded, so the bundle is
// fully portable to another machine/browser.
export async function exportComposition(comp: Composition): Promise<void> {
  const stems: Record<string, StemEntry> = {};
  const tracks: SerializedTrack[] = [];
  for (const t of comp.tracks) {
    if (t.source.kind === "file") {
      const blob = await (await fetch(t.source.url)).blob();
      stems[t.id] = { name: t.name, type: blob.type || "audio/mpeg", data: toBase64(await blob.arrayBuffer()) };
      tracks.push({ ...t, source: { kind: "stored", key: t.id } });
    } else {
      tracks.push(t); // synth: nothing to embed
    }
  }

  const payload = { version: BUNDLE_VERSION, composition: { ...comp, tracks }, stems };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(comp.title || "composition").replace(/[^\w.-]+/g, "_")}.polyphonia.json`;
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
      if (!entry) continue; // missing audio — drop the track
      const id = newId();
      const blob = base64ToBlob(entry.data, entry.type);
      await stemPut(id, blob);
      tracks.push({ ...t, id, source: { kind: "file", url: URL.createObjectURL(blob) } });
    } else {
      tracks.push({ ...t, source: t.source });
    }
  }
  return { ...saved, id: newId(), tracks };
}

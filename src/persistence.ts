import { Composition, TrackDef } from "./composition";

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

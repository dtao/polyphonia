import {
  Composition,
  TrackDef,
  audioAssetKey,
  defaultComposition,
  normalizeComposition,
} from "./composition";
import {
  detailPackBundleForId,
  importDetailPackPayload,
  type DetailPackBundle,
} from "./detailPackStorage";
import { newId } from "./id";
import { databaseRequest, STEM_STORE } from "./localDatabase";
import { normalizeMap } from "./map";
import {
  creatorAssetBundleForIds,
  importCreatorAssetBundle,
  type CreatorAssetBundle,
} from "./creatorAssets";

// Local-first persistence. A *library* of composition manifests (small JSON)
// lives in localStorage; uploaded stem audio (large binary) lives in IndexedDB,
// keyed by audio asset id. An uploaded stem's source serializes to a
// {kind:"stored"} marker and rehydrates to an object URL on load, so the rest
// of the app only ever sees normal "file" sources.

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
    tracks: normalized.tracks.map((t) =>
      isUploaded(t) ? { ...t, audioAssetId: audioAssetKey(t), source: { kind: "stored", key: audioAssetKey(t) } } : t,
    ),
  };
}

// Manifest -> runtime composition, reading stored stems back into object URLs.
export async function resolveComposition(saved: SerializedComposition): Promise<Composition> {
  const tracks: TrackDef[] = [];
  const urls = new Map<string, string>();
  for (const t of saved.tracks) {
    if (t.source.kind === "stored") {
      const blob = await stemGet(t.source.key);
      if (!blob) continue; // stem audio missing — drop the track
      let url = urls.get(t.source.key);
      if (!url) {
        url = URL.createObjectURL(blob);
        urls.set(t.source.key, url);
      }
      tracks.push({ ...t, audioAssetId: t.audioAssetId ?? t.source.key, source: { kind: "file", url } });
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
  const copiedAssets = new Map<string, string>();
  for (const t of source.tracks) {
    const id = newId();
    if (t.source.kind === "stored") {
      let assetId = copiedAssets.get(t.source.key);
      if (!assetId) {
        assetId = newId();
        const blob = await stemGet(t.source.key);
        if (blob) await stemPut(assetId, blob);
        copiedAssets.set(t.source.key, assetId);
      }
      tracks.push({ ...t, id, audioAssetId: assetId, source: { kind: "stored", key: assetId } });
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

// ===== Export / import: one self-contained composition + media bundle =====

const BUNDLE_VERSION = 4;

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
export interface CompositionBundle {
  version: number;
  composition: SerializedComposition;
  stems: Record<string, StemEntry>;
  detailPack?: DetailPackBundle;
  creatorAssets?: CreatorAssetBundle;
}

export async function buildCompositionBundle(comp: Composition): Promise<CompositionBundle> {
  const normalized = normalizeComposition(comp);
  const stems: Record<string, StemEntry> = {};
  const tracks: SerializedTrack[] = [];
  const sourceKeys = new Map<string, string>();
  for (const t of normalized.tracks) {
    if (t.source.kind === "file") {
      const identity = isUploaded(t) ? audioAssetKey(t) : t.source.url;
      let key = sourceKeys.get(identity);
      if (!key) {
        key = isUploaded(t) ? audioAssetKey(t) : t.id;
        sourceKeys.set(identity, key);
        const blob = await (await fetch(t.source.url)).blob();
        stems[key] = { name: t.name, type: blob.type || "audio/mpeg", data: toBase64(await blob.arrayBuffer()) };
      }
      tracks.push({ ...t, audioAssetId: key, source: { kind: "stored", key } });
    } else {
      tracks.push(t);
    }
  }

  const detailPack = normalized.environment.pack?.id
    ? await detailPackBundleForId(normalized.environment.pack.id)
    : undefined;
  const creatorAssetIds = environmentCreatorAssetIds(normalized);
  const creatorAssets = creatorAssetIds.length
    ? await creatorAssetBundleForIds(creatorAssetIds)
    : undefined;
  return {
    version: BUNDLE_VERSION,
    composition: { ...normalized, tracks },
    stems,
    ...(detailPack ? { detailPack } : {}),
    ...(creatorAssets ? { creatorAssets } : {}),
  };
}

// Download the composition with uploaded stems and any local custom detail pack
// embedded, so the map remains fully portable.
export async function exportComposition(comp: Composition): Promise<void> {
  const normalized = normalizeComposition(comp);
  const payload = await buildCompositionBundle(normalized);
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
  if (payload?.version !== 1 && payload?.version !== 2 && payload?.version !== 3 && payload?.version !== BUNDLE_VERSION) {
    throw new Error("Unrecognized or unsupported Polyphonia file.");
  }
  if (payload.detailPack) {
    await importDetailPackPayload(payload.detailPack as Partial<DetailPackBundle>);
  }
  if (payload.creatorAssets) {
    await importCreatorAssetBundle(payload.creatorAssets as Partial<CreatorAssetBundle>);
  }
  const saved: SerializedComposition = payload.composition;
  const stems: Record<string, StemEntry> = payload.stems ?? {};

  const tracks: TrackDef[] = [];
  const importedAssets = new Map<string, { id: string; url: string }>();
  for (const t of saved.tracks) {
    if (t.source.kind === "stored") {
      const entry = stems[t.source.key];
      if (!entry) continue;
      let asset = importedAssets.get(t.source.key);
      if (!asset) {
        const id = newId();
        const blob = base64ToBlob(entry.data, entry.type);
        await stemPut(id, blob);
        asset = { id, url: URL.createObjectURL(blob) };
        importedAssets.set(t.source.key, asset);
      }
      const id = newId();
      tracks.push({ ...t, id, audioAssetId: asset.id, source: { kind: "file", url: asset.url } });
    } else {
      tracks.push({ ...t, source: t.source });
    }
  }
  const now = new Date().toISOString();
  return normalizeComposition({ ...saved, id: newId(), tracks, publishedId: undefined, publishedRevision: undefined, publishedAt: undefined, createdAt: now, updatedAt: now });
}

function environmentCreatorAssetIds(comp: Composition): string[] {
  return [
    ...Object.values(comp.environment.surfaces ?? {}).filter((id): id is string => !!id),
    ...(comp.environment.landmarks ?? []).map((landmark) => landmark.assetId),
  ];
}

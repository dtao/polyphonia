import type { DetailPackBundle, DetailPackBundleAsset } from "./detailPackStorage";
import type { EnvironmentPackDefinition } from "./environmentPacks";

const MAX_ASSETS = 48;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;
const MAX_LANDMARK_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_LANDMARK_MODEL_TRIANGLES = 5 * 1000 * 1000;
const MAX_TEXTURE_BYTES = 16 * 1024 * 1024;
const MAX_LANDMARKS = 64;
const ALLOWED_MODEL_TYPES = new Set(["model/gltf-binary", "application/octet-stream"]);
const ALLOWED_TEXTURE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/ktx2",
  "application/octet-stream",
]);
const ALLOWED_GLTF_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
  "KHR_texture_basisu",
  "EXT_texture_webp",
  "KHR_mesh_quantization",
  "KHR_texture_transform",
  "KHR_materials_unlit",
]);

export interface DetailPackValidationReport {
  totalBytes: number;
  triangles: number;
  drawCalls: number;
  largestTexture: number;
}

export async function validateDetailPackBundle(
  payload: Partial<DetailPackBundle>,
): Promise<DetailPackValidationReport> {
  if (payload.version !== 1 || !payload.manifest || !payload.assets) {
    throw new Error("Unrecognized or unsupported detail-pack bundle.");
  }
  const { manifest, assets } = payload;
  validateManifest(manifest, assets);
  const entries = Object.entries(assets);
  if (entries.length > MAX_ASSETS) {
    throw new Error(`Detail packs may contain at most ${MAX_ASSETS} files.`);
  }

  let totalBytes = 0;
  let triangles = 0;
  let drawCalls = 0;
  let largestTexture = 0;
  for (const [key, asset] of entries) {
    const bytes = decodeAsset(key, asset);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("The detail pack exceeds the 80 MB local import limit.");
    }
    if (isModel(asset)) {
      if (bytes.byteLength > MAX_MODEL_BYTES) throw new Error(`Model "${asset.name}" exceeds 32 MB.`);
      const metrics = inspectGlb(bytes, asset.name);
      triangles += metrics.triangles;
      drawCalls += metrics.drawCalls;
    } else {
      if (!isTexture(asset)) throw new Error(`Asset "${asset.name}" has an unsupported file type.`);
      if (bytes.byteLength > MAX_TEXTURE_BYTES) throw new Error(`Texture "${asset.name}" exceeds 16 MB.`);
      largestTexture = Math.max(largestTexture, await textureDimension(bytes, asset.type));
    }
  }

  if (triangles > manifest.budgets.maxTriangles) {
    throw new Error(`The landmark kit has ${Math.round(triangles).toLocaleString()} triangles; the pack budget is ${manifest.budgets.maxTriangles.toLocaleString()}.`);
  }
  if (drawCalls > manifest.budgets.maxDrawCalls) {
    throw new Error(`The landmark kit needs ${drawCalls} draw calls; the pack budget is ${manifest.budgets.maxDrawCalls}.`);
  }
  if (largestTexture > manifest.budgets.maxTextureSize) {
    throw new Error(`A texture is ${largestTexture}px; the pack budget is ${manifest.budgets.maxTextureSize}px.`);
  }
  return { totalBytes, triangles, drawCalls, largestTexture };
}

function validateManifest(
  manifest: EnvironmentPackDefinition,
  assets: Record<string, DetailPackBundleAsset>,
): void {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(manifest.id)) {
    throw new Error("Pack ids must be 3-64 lowercase letters, numbers, or hyphens.");
  }
  if (!manifest.name?.trim() || manifest.name.length > 80) {
    throw new Error("Pack names must contain 1-80 characters.");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > 3) {
    throw new Error("A detail pack needs one to three quality-tier GLB assets.");
  }
  if (!manifest.materials?.floor?.albedo) {
    throw new Error("A floor albedo texture is required.");
  }
  if (!Array.isArray(manifest.landmarks) || manifest.landmarks.length > MAX_LANDMARKS) {
    throw new Error(`A detail pack may define at most ${MAX_LANDMARKS} landmarks.`);
  }
  const landmarkIds = manifest.landmarks.map((landmark) => landmark.id);
  if (new Set(landmarkIds).size !== landmarkIds.length) {
    throw new Error("Landmark ids must be unique.");
  }
  for (const landmark of manifest.landmarks) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(landmark.id) || !landmark.nodePrefix?.trim()) {
      throw new Error("Each landmark needs a stable id and GLB node prefix.");
    }
  }
  if (!manifest.budgets ||
      manifest.budgets.maxTextureSize < 256 ||
      manifest.budgets.maxTextureSize > 4096 ||
      manifest.budgets.maxTriangles < 1 ||
      manifest.budgets.maxTriangles > MAX_LANDMARK_MODEL_TRIANGLES ||
      manifest.budgets.maxDrawCalls < 1 ||
      manifest.budgets.maxDrawCalls > 300) {
    throw new Error("Pack performance budgets are missing or outside supported limits.");
  }
  for (const reference of packReferences(manifest)) {
    if (!reference.startsWith("bundle:")) {
      throw new Error(`Custom pack asset reference "${reference}" must be embedded in the bundle.`);
    }
    const key = reference.slice("bundle:".length);
    if (!assets[key]) throw new Error(`Bundle asset "${key}" is missing.`);
  }
}

function packReferences(pack: EnvironmentPackDefinition): string[] {
  const materials = Object.values(pack.materials).filter(Boolean);
  return [
    ...pack.assets.map((asset) => asset.url),
    ...materials.flatMap((material) => [
      material!.albedo,
      material!.normal,
      material!.roughnessMap,
      material!.metalnessMap,
      material!.ao,
      material!.emissiveMap,
    ].filter((url): url is string => !!url)),
  ];
}

function decodeAsset(key: string, asset: DetailPackBundleAsset): Uint8Array {
  if (!asset || typeof asset.name !== "string" || typeof asset.type !== "string" || typeof asset.data !== "string") {
    throw new Error(`Detail-pack asset "${key}" is malformed.`);
  }
  try {
    const binary = atob(asset.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error(`Detail-pack asset "${key}" is not valid base64.`);
  }
}

function isModel(asset: DetailPackBundleAsset): boolean {
  return asset.name.toLowerCase().endsWith(".glb") && ALLOWED_MODEL_TYPES.has(asset.type);
}

function isTexture(asset: DetailPackBundleAsset): boolean {
  return /\.(png|jpe?g|webp|ktx2)$/i.test(asset.name) && ALLOWED_TEXTURE_TYPES.has(asset.type);
}

export function inspectGlb(bytes: Uint8Array, name: string): { triangles: number; drawCalls: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`Model "${name}" is not a valid glTF 2.0 binary.`);
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error(`Model "${name}" has an invalid GLB length.`);
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) {
    throw new Error(`Model "${name}" has no valid JSON chunk.`);
  }
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
  if (json.animations?.length) throw new Error(`Model "${name}" contains unsupported animations.`);
  if (json.skins?.length) throw new Error(`Model "${name}" contains unsupported skinned meshes.`);
  if (json.buffers?.some((buffer: { uri?: string }) => buffer.uri) ||
      json.images?.some((image: { uri?: string }) => image.uri)) {
    throw new Error(`Model "${name}" must embed all buffers and textures.`);
  }
  for (const extension of json.extensionsRequired ?? []) {
    if (!ALLOWED_GLTF_EXTENSIONS.has(extension)) {
      throw new Error(`Model "${name}" requires unsupported extension "${extension}".`);
    }
  }
  let triangles = 0;
  let drawCalls = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      drawCalls += 1;
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = json.accessors?.[accessorIndex]?.count ?? 0;
      triangles += primitive.mode === 5 || primitive.mode === 6 ? Math.max(0, count - 2) : Math.floor(count / 3);
    }
  }
  return { triangles, drawCalls };
}

export async function validateLandmarkGlb(file: File): Promise<{ triangles: number; drawCalls: number }> {
  if (!file.name.toLowerCase().endsWith(".glb")) {
    throw new Error("Landmarks must be self-contained .glb files.");
  }
  if (file.size > MAX_LANDMARK_MODEL_BYTES) {
    throw new Error(`Model "${file.name}" exceeds 256 MB.`);
  }
  const metrics = inspectGlb(new Uint8Array(await file.arrayBuffer()), file.name);
  if (metrics.triangles > MAX_LANDMARK_MODEL_TRIANGLES) {
    throw new Error(`Model "${file.name}" exceeds the ${MAX_LANDMARK_MODEL_TRIANGLES} triangle limit.`);
  }
  if (metrics.drawCalls > 300) {
    throw new Error(`Model "${file.name}" exceeds the 300 draw-call limit.`);
  }
  return metrics;
}

async function textureDimension(bytes: Uint8Array, type: string): Promise<number> {
  if (typeof createImageBitmap !== "function" || !type.startsWith("image/") || type === "image/ktx2") return 0;
  const image = await createImageBitmap(new Blob([bytes.slice().buffer], { type }));
  const dimension = Math.max(image.width, image.height);
  image.close();
  return dimension;
}

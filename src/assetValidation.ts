// Validation for creator-imported GLB landmarks. Extracted from the retired
// detail-pack system; the GLB inspector is a minimal header/JSON-chunk parser
// so imports are sanity-checked without a full three.js load.

const MAX_LANDMARK_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_LANDMARK_MODEL_TRIANGLES = 5 * 1000 * 1000;
const MAX_LANDMARK_DRAW_CALLS = 300;
const ALLOWED_GLTF_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
  "KHR_texture_basisu",
  "EXT_texture_webp",
  "KHR_mesh_quantization",
  "KHR_texture_transform",
  "KHR_materials_unlit",
]);

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
  if (metrics.drawCalls > MAX_LANDMARK_DRAW_CALLS) {
    throw new Error(`Model "${file.name}" exceeds the ${MAX_LANDMARK_DRAW_CALLS} draw-call limit.`);
  }
  return metrics;
}

import { describe, expect, it } from "vitest";
import { inspectGlb } from "./assetValidation";

describe("GLB inspection for creator imports", () => {
  it("counts triangles and draw calls from the JSON chunk", () => {
    const bytes = glb({
      asset: { version: "2.0" },
      accessors: [{ count: 300 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    });
    expect(inspectGlb(bytes, "kit.glb")).toEqual({ triangles: 100, drawCalls: 1 });
  });

  it("rejects models with external buffers", () => {
    const bytes = glb({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://example.com/data.bin" }],
    });
    expect(() => inspectGlb(bytes, "kit.glb")).toThrow("must embed");
  });

  it("rejects non-GLB payloads", () => {
    expect(() => inspectGlb(new Uint8Array([1, 2, 3, 4]), "kit.glb")).toThrow("not a valid glTF");
  });
});

function glb(json: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  return bytes;
}

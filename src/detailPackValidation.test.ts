import { describe, expect, it } from "vitest";
import type { DetailPackBundle } from "./detailPackStorage";
import { validateDetailPackBundle } from "./detailPackValidation";

describe("detail pack validation", () => {
  it("inspects embedded GLB complexity and accepts bounded assets", async () => {
    const report = await validateDetailPackBundle(bundle());

    expect(report).toMatchObject({
      triangles: 100,
      drawCalls: 1,
    });
    expect(report.totalBytes).toBeGreaterThan(20);
  });

  it("rejects remote asset references", async () => {
    const payload = bundle();
    payload.manifest.materials.floor.albedo = "https://example.com/texture.png";

    await expect(validateDetailPackBundle(payload)).rejects.toThrow("must be embedded");
  });

  it("enforces the declared triangle budget", async () => {
    const payload = bundle();
    payload.manifest.budgets.maxTriangles = 50;

    await expect(validateDetailPackBundle(payload)).rejects.toThrow("100 triangles");
  });
});

function bundle(): DetailPackBundle {
  return {
    version: 1,
    manifest: {
      id: "test-pack",
      name: "Test Pack",
      description: "A test detail pack",
      variants: ["default"],
      assets: [{ url: "bundle:model", quality: "high" }],
      materials: {
        floor: {
          albedo: "bundle:albedo",
          repeat: 2,
          roughness: 0.8,
          metalness: 0,
        },
      },
      landmarks: [{
        id: "landmark",
        name: "Landmark",
        nodePrefix: "Landmark_",
        placement: "floor",
        fallback: "rock",
      }],
      attribution: [{
        title: "Test Pack",
        author: "Test",
        license: "Project asset",
      }],
      budgets: {
        maxTextureSize: 2048,
        maxTriangles: 1000,
        maxDrawCalls: 10,
      },
    },
    assets: {
      model: {
        name: "kit.glb",
        type: "model/gltf-binary",
        data: base64(glb({
          asset: { version: "2.0" },
          accessors: [{ count: 300 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        })),
      },
      albedo: {
        name: "albedo.webp",
        type: "image/webp",
        data: base64(new Uint8Array([1, 2, 3])),
      },
    },
  };
}

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

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

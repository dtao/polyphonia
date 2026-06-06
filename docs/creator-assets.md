# Creator materials and landmarks

Polyphonia does not require a complete detail pack. A creator can import a PBR
texture set for map surfaces, import individual 3D models for landmarks, and
combine those pieces with any map or optional built-in detail pack.

## Good free sources

- [Poly Haven](https://polyhaven.com/) provides high-resolution CC0 PBR
  textures and models. Its texture downloads are a good source for base color,
  normal, roughness, metalness, and ambient-occlusion maps.
- [ambientCG](https://ambientcg.com/) provides CC0 materials and models. Choose
  separate PNG/JPEG maps or WebP files rather than engine-specific packages.
- [Kenney](https://kenney.nl/assets) provides CC0 game-asset collections and
  distributes its glTF models as GLB files, making them the most direct source
  for Polyphonia landmarks.

Always confirm the license on the asset page at download time. Polyphonia asks
for title, author, license, and an optional source URL so that provenance stays
with the imported asset.

## Import a material

1. Open Edit mode and expand the Detail panel.
2. Choose **Import material**.
3. Add the required albedo/base-color image and any available normal,
   roughness, metalness, or ambient-occlusion maps.
4. Enter the source metadata and import.
5. Assign the material independently to Floor, Wall, or Ceiling.

Supported texture files are PNG, JPEG, WebP, and KTX2. Each file is limited to
16 MB and 4096 pixels on its longest side. Prefer 1K or 2K seamless textures for
browser performance. For normal maps, OpenGL orientation is usually the right
choice for Three.js.

## Import a landmark

1. Download or export one self-contained static `.glb`.
2. Choose **Import landmark**, enter its source metadata, and select the file.
3. Set a useful starting scale and import.
4. Use the landmark button in the Detail panel to place as many instances as
   needed, then move them with the normal transform control.

Models must embed their buffers and textures. Animated and skinned models are
not currently supported. A model is limited to 32 MB, 500,000 triangles, and
300 draw calls. For repeated scenery, substantially smaller assets will perform
better.

## Portability

Imported files are deduplicated by content hash in IndexedDB. Composition
exports embed only the creator assets they reference. Publishing uploads
versioned immutable asset records and rewrites the shared composition to public
asset IDs, so viewers do not need the creator's local library.

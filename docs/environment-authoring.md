# Environment Pack Authoring

Environment packs are optional visual upgrades layered over Polyphonia's plain
composition map. The map remains authoritative for movement, elevation,
occlusion, rooms, doors, tiling, start position, and audio. A pack must never
require custom gameplay geometry to make a composition usable.

## Coordinate And Asset Conventions

- Use meters as scene units, with Y up and the walkable floor at Y = 0.
- Face authored forward along negative Z, matching composition start facing.
- Put reusable kit meshes at clean local origins with applied transforms.
- Use descriptive stable node names such as `WallRock_00`, `Column_00`, and
  `Mineral_00`; runtime dressing may select modules by name prefix.
- Keep collision and acoustic geometry out of GLB files. Add it to the map
  model instead.
- Keep lights optional. Pack-specific runtime lighting belongs in the renderer
  so low-quality and Edit modes can reduce it.

## Supported Delivery

- Scene kits: binary `.glb` or `.gltf` with external resources.
- Geometry compression: Draco or Meshopt. Decoders are shipped under
  `public/draco-gltf` so packs work offline.
- Texture compression: KTX2/Basis. The transcoder is shipped under
  `public/basis`.
- Conventional textures remain supported for fallback and source review.
- PBR channels: base color, normal, roughness, metalness, ambient occlusion,
  and emissive.

Prefer one GLB per quality tier. Register both assets under the same pack id:

```ts
assets: [
  { url: "/environments/example/scene-low.glb", quality: "low",
    compressedGeometry: "meshopt", compressedTextures: "ktx2" },
  { url: "/environments/example/scene-high.glb", quality: "high",
    compressedGeometry: "meshopt", compressedTextures: "ktx2" },
]
```

## Registry Entry

Add the pack to `src/environmentPacks.ts`. Every entry must provide:

- a stable id and display name
- compatible procedural environment type and fallback material
- variants and low/high asset URLs
- attribution for every third-party source
- triangle, draw-call, and maximum texture-size budgets
- optional lighting and postprocessing settings

Compositions store only the pack id, variant, and requested quality. Do not put
asset URLs, licenses, or renderer-specific data into composition manifests.

## Atlas Cavern Reference Pipeline

Rebuild the modular GLB:

```bash
node scripts/generate-cavern-kit.mjs
```

Rebuild its aligned stone texture set from a square source image:

```bash
python3 scripts/build-stone-textures.py path/to/stone-source.png
```

The texture script crops and resizes the source, feathers opposing edges, then
derives aligned normal, roughness, and AO maps. Production packs should replace
these WebP outputs with reviewed KTX2 exports while keeping the same material
channel semantics.

## Map Dressing Rules

Map dressing must be deterministic: identical map + pack + variant should
produce identical placement. Use stable map ids as random seeds.

- Paths: floor surface plus sparse edge dressing.
- Ramps: follow endpoint elevations rather than flattening the route.
- Tunnels: floor, side shells, and ceiling while preserving endpoint openings.
- Rooms: preserve every authored doorway; never cover entrances with a visual
  wall that does not match the map.
- Platforms: match rectangle, circle, or hex footprint and elevation.
- Standalone walls: align visual thickness and height to the map wall.
- Tiling: keep detail bounded around the viewer and reuse instanced modules.

Edit mode must lower opacity or hide nonessential clutter so map handles,
track markers, falloff rings, and doorways stay legible.

## Review Checklist

1. Test Open, Line, Y, custom elevated, tunnel, room, platform, and wall maps.
2. Confirm Explore movement and audio behavior are unchanged with the pack on.
3. Confirm the procedural fallback appears if the GLB URL is unavailable.
4. Confirm attribution is visible in the editor and entered experience.
5. Run `npm run build`.
6. Test `quality=auto`, `low`, and `high` in the Environment panel.
7. Use `?debug=1&environmentPack=<id>` to inspect render calls, triangles,
   memory, and frame time without changing the composition manifest.
8. Use `&environmentQuality=low` for the low-tier comparison.
9. Check mobile and desktop framing; verify Edit mode remains readable.
10. Verify exported/imported and published manifests retain the pack selection.

## Licensing

Record title, author, license, and source URL in the registry before an asset is
merged. Assets without redistribution rights must not be committed or deployed.
Generated or project-owned assets should still state their provenance and
license in the registry.

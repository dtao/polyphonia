from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: build-stone-textures.py <source-image>")

    source = Path(sys.argv[1])
    output = Path(__file__).resolve().parents[1] / "public/environments/atlas-cavern/textures"
    output.mkdir(parents=True, exist_ok=True)

    image = Image.open(source).convert("RGB")
    size = min(image.size)
    left = (image.width - size) // 2
    top = (image.height - size) // 2
    image = image.crop((left, top, left + size, top + size)).resize((1024, 1024), Image.Resampling.LANCZOS)

    # Mirror a narrow border into the opposite edge and feather it inward. This
    # removes the most obvious generated-image seams while retaining the center.
    image = make_tileable(image, 96)
    image.save(output / "stone-albedo.webp", "WEBP", quality=88, method=6)

    height = np.asarray(ImageOps.grayscale(image).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255.0
    gy, gx = np.gradient(height)
    strength = 5.0
    normal = np.dstack((-gx * strength, -gy * strength, np.ones_like(height)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    normal = ((normal * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(normal, "RGB").save(output / "stone-normal.webp", "WEBP", quality=90, method=6)

    detail = np.asarray(ImageOps.grayscale(image).filter(ImageFilter.GaussianBlur(4)), dtype=np.float32) / 255.0
    roughness = (0.72 + (1.0 - detail) * 0.24) * 255
    Image.fromarray(roughness.clip(0, 255).astype(np.uint8), "L").save(
        output / "stone-roughness.webp", "WEBP", quality=90, method=6
    )

    ao = (0.58 + detail * 0.42) * 255
    Image.fromarray(ao.clip(0, 255).astype(np.uint8), "L").save(
        output / "stone-ao.webp", "WEBP", quality=90, method=6
    )


def make_tileable(image: Image.Image, border: int) -> Image.Image:
    array = np.asarray(image, dtype=np.float32)
    result = array.copy()
    height, width, _ = array.shape

    for x in range(border):
        blend = 0.5 - 0.5 * np.cos(np.pi * x / border)
        opposite = width - border + x
        average = (array[:, x] + array[:, opposite]) * 0.5
        result[:, x] = average * (1.0 - blend) + array[:, x] * blend
        result[:, opposite] = average * (1.0 - blend) + array[:, opposite] * blend

    for y in range(border):
        blend = 0.5 - 0.5 * np.cos(np.pi * y / border)
        opposite = height - border + y
        average = (result[y] + result[opposite]) * 0.5
        result[y] = average * (1.0 - blend) + result[y] * blend
        result[opposite] = average * (1.0 - blend) + result[opposite] * blend

    return Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB")


if __name__ == "__main__":
    main()

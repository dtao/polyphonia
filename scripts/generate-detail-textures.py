from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


SIZE = 1024


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"forest", "crystal"}:
        raise SystemExit("usage: generate-detail-textures.py <forest|crystal>")

    profile = sys.argv[1]
    if profile == "forest":
        image = forest_albedo()
        directory = Path(__file__).resolve().parents[1] / "public/environments/verdant-grove/textures"
        prefix = "forest"
        normal_strength = 4.6
        roughness_base = 0.78
    else:
        image = crystal_albedo()
        directory = Path(__file__).resolve().parents[1] / "public/environments/prismatic-reach/textures"
        prefix = "crystal"
        normal_strength = 7.2
        roughness_base = 0.3

    directory.mkdir(parents=True, exist_ok=True)
    image.save(directory / f"{prefix}-albedo.webp", "WEBP", quality=90, method=6)
    write_channels(image, directory, prefix, normal_strength, roughness_base)


def periodic_noise(seed: int, octaves: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    value = np.zeros((SIZE, SIZE), dtype=np.float32)
    amplitude = 1.0
    total = 0.0
    for octave in range(octaves):
        frequency = 2 ** octave
        for _ in range(5):
            phase_x, phase_y = rng.random(2) * np.pi * 2
            angle = rng.random() * np.pi * 2
            wave = np.cos(
                (np.cos(angle) * x + np.sin(angle) * y) * np.pi * 2 * frequency / SIZE
                + phase_x
                + np.sin(y * np.pi * 2 / SIZE + phase_y) * 0.35
            )
            value += wave * amplitude
            total += amplitude
        amplitude *= 0.5
    value = value / max(total, 1)
    return (value - value.min()) / max(value.max() - value.min(), 0.0001)


def forest_albedo() -> Image.Image:
    broad = periodic_noise(1042, 6)
    detail = periodic_noise(7719, 9)
    moss = np.clip(broad * 0.72 + detail * 0.28, 0, 1)
    soil = np.array([35, 31, 23], dtype=np.float32)
    green = np.array([70, 91, 48], dtype=np.float32)
    pale = np.array([112, 121, 76], dtype=np.float32)
    rgb = soil + moss[..., None] * (green - soil) + np.maximum(detail - 0.62, 0)[..., None] * (pale - green) * 1.4
    image = Image.fromarray(rgb.clip(0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    rng = np.random.default_rng(318)
    for _ in range(180):
        x, y = rng.integers(0, SIZE, 2)
        length = int(rng.integers(5, 20))
        width = int(rng.integers(1, 4))
        color = (80, 61, 35, int(rng.integers(55, 125)))
        wrapped_line(draw, (x, y), (x + length, y + int(rng.integers(-6, 7))), color, width)
    for _ in range(110):
        x, y = rng.integers(0, SIZE, 2)
        radius = int(rng.integers(2, 7))
        wrapped_ellipse(draw, x, y, radius, (104, 120, 68, int(rng.integers(45, 105))))
    return image.filter(ImageFilter.GaussianBlur(0.35))


def crystal_albedo() -> Image.Image:
    broad = periodic_noise(4207, 5)
    ridges = periodic_noise(9921, 8)
    facets = np.abs(np.sin(broad * np.pi * 5 + ridges * 2.4))
    dark = np.array([18, 24, 42], dtype=np.float32)
    blue = np.array([45, 88, 122], dtype=np.float32)
    violet = np.array([92, 68, 139], dtype=np.float32)
    cyan = np.array([83, 151, 154], dtype=np.float32)
    rgb = dark + broad[..., None] * (blue - dark)
    rgb += np.maximum(facets - 0.63, 0)[..., None] * (violet - dark) * 0.72
    rgb += np.maximum(ridges - 0.7, 0)[..., None] * (cyan - dark) * 0.55
    image = Image.fromarray(rgb.clip(0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    rng = np.random.default_rng(882)
    for _ in range(85):
        x, y = rng.integers(0, SIZE, 2)
        length = int(rng.integers(18, 70))
        angle = rng.choice([0.35, 0.8, 1.9, 2.45])
        end = (x + int(np.cos(angle) * length), y + int(np.sin(angle) * length))
        wrapped_line(draw, (x, y), end, (135, 205, 225, int(rng.integers(28, 75))), int(rng.integers(1, 3)))
    return image.filter(ImageFilter.GaussianBlur(0.28))


def wrapped_line(draw: ImageDraw.ImageDraw, start, end, fill, width) -> None:
    for offset_x in (-SIZE, 0, SIZE):
        for offset_y in (-SIZE, 0, SIZE):
            draw.line(
                (start[0] + offset_x, start[1] + offset_y, end[0] + offset_x, end[1] + offset_y),
                fill=fill,
                width=width,
            )


def wrapped_ellipse(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int, fill) -> None:
    for offset_x in (-SIZE, 0, SIZE):
        for offset_y in (-SIZE, 0, SIZE):
            cx, cy = x + offset_x, y + offset_y
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill)


def write_channels(
    image: Image.Image,
    directory: Path,
    prefix: str,
    normal_strength: float,
    roughness_base: float,
) -> None:
    height = np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32) / 255.0
    gy, gx = np.gradient(height)
    normal = np.dstack((-gx * normal_strength, -gy * normal_strength, np.ones_like(height)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    normal = ((normal * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(normal, "RGB").save(directory / f"{prefix}-normal.webp", "WEBP", quality=90, method=6)

    detail = np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(3.5)), dtype=np.float32) / 255.0
    roughness = (roughness_base + (1.0 - detail) * (0.98 - roughness_base)) * 255
    Image.fromarray(roughness.clip(0, 255).astype(np.uint8), "L").save(
        directory / f"{prefix}-roughness.webp", "WEBP", quality=90, method=6
    )

    ao = (0.52 + detail * 0.48) * 255
    Image.fromarray(ao.clip(0, 255).astype(np.uint8), "L").save(
        directory / f"{prefix}-ao.webp", "WEBP", quality=90, method=6
    )


if __name__ == "__main__":
    main()

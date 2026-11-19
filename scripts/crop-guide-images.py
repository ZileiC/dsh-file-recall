"""Produce the two guide images from one source screenshot.

    python scripts/crop-guide-images.py <source.png>

Source: the DeepSeek Harness product page at 2533x1599. Everything here is in
source pixels so a re-screenshot only needs the four numbers re-measured.

Writes docs/img/hero-shot.png and docs/img/step-01-menu.png.
"""

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "docs" / "img"

# Where the download button sits in the source. Measured, not guessed: the light
# band on its row runs x=1076..1460, y=715..776.
BUTTON = (1050, 700, 1490, 790)
HERO_RATIO = 16 / 10


def crop_to_ratio(img: Image.Image, box: tuple, ratio: float) -> Image.Image:
    """Crop the box, then trim it to `ratio` by shrinking the longer side."""
    out = img.crop(box)
    w, h = out.size
    target_h = round(w / ratio)
    if target_h <= h:
        pad = (h - target_h) // 2
        return out.crop((0, pad, w, pad + target_h))
    target_w = round(h * ratio)
    pad = (w - target_w) // 2
    return out.crop((pad, 0, pad + target_w, h))


def main() -> None:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / ".tmp-hero.png")
    img = Image.open(source).convert("RGB")
    w, h = img.size
    print(f"source: {w}x{h}")

    hero = crop_to_ratio(img, (0, 0, w, round(h * 0.99)), HERO_RATIO)
    hero.save(OUT / "hero-shot.png", optimize=True)
    print(f"hero-shot.png: {hero.size[0]}x{hero.size[1]}")

    # Step 1 points at the button itself, arrow control included, so the reader can
    # see which half downloads and which half opens the menu.
    step = img.crop(BUTTON)
    step = step.resize((step.size[0] * 2, step.size[1] * 2), Image.LANCZOS)
    step.save(OUT / "step-01-menu.png", optimize=True)
    print(f"step-01-menu.png: {step.size[0]}x{step.size[1]}")


if __name__ == "__main__":
    main()

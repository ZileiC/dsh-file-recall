"""Produce the Windows guide images from one source screenshot.

    python scripts/crop-guide-images.py <source.png>

The macOS guide uses its own pair (hero-shot.png, step-01-menu.png) and is not
touched here. Source is the product page at 2533x1599; the geometry below is in
source pixels, so a re-screenshot only needs BUTTON re-measured.

Writes docs/img/windows-page.png and docs/img/windows-button.png.
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
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "windows-page-source.png"
    img = Image.open(source).convert("RGB")
    w, h = img.size
    print(f"source: {w}x{h}")

    page = crop_to_ratio(img, (0, 0, w, round(h * 0.99)), HERO_RATIO)
    page.save(OUT / "windows-page.png", optimize=True)
    print(f"windows-page.png: {page.size[0]}x{page.size[1]}")

    # Step 1 points at the button itself, arrow control included, so the reader can
    # see which half downloads and which half opens the menu.
    button = img.crop(BUTTON)
    button = button.resize((button.size[0] * 2, button.size[1] * 2), Image.LANCZOS)
    button.save(OUT / "windows-button.png", optimize=True)
    print(f"windows-button.png: {button.size[0]}x{button.size[1]}")


if __name__ == "__main__":
    main()

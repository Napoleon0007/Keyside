#!/usr/bin/env python3
"""Optimise a Keyside product thumbnail: cover-crop to a consistent size and
save as a small WebP. Used both for compressing existing thumbs and for
processing fresh screenshots/generated images so the whole grid is uniform.

Usage:
    python3 scripts/optimize_thumb.py <in> <out.webp> [--w 1000 --h 625 --q 80]
"""
import argparse
from pathlib import Path

from PIL import Image


def cover_crop(img: Image.Image, w: int, h: int) -> Image.Image:
    """Resize + center-crop so the image fills exactly w x h (like CSS cover)."""
    src_ratio = img.width / img.height
    dst_ratio = w / h
    if src_ratio > dst_ratio:           # source too wide -> match height, crop sides
        new_h = h
        new_w = round(h * src_ratio)
    else:                                # source too tall -> match width, crop top/bottom
        new_w = w
        new_h = round(w / src_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - w) // 2
    top = 0                              # bias to top (cards use object-position: top)
    return img.crop((left, top, left + w, top + h))


def main() -> None:
    ap = argparse.ArgumentParser(description="Optimise a product thumbnail to WebP.")
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--w", type=int, default=1000)
    ap.add_argument("--h", type=int, default=625)
    ap.add_argument("--q", type=int, default=80)
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        raise SystemExit(f"input not found: {src}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGB")
    img = cover_crop(img, args.w, args.h)
    img.save(out, "WEBP", quality=args.q, method=6)

    before = src.stat().st_size
    after = out.stat().st_size
    print(
        f"✓ {src.name} ({before // 1024} KB) -> {out.name} "
        f"({after // 1024} KB, {args.w}x{args.h})"
    )


if __name__ == "__main__":
    main()

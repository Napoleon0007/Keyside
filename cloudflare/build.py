#!/usr/bin/env python3
"""Snapshot the Flask app into cloudflare/public/ for Cloudflare Workers.

Boots the real app.py in-process with prod-equivalent env vars, captures the
rendered pages and API JSON with a test client (so the output is byte-faithful
to what Railway served), then copies the static assets alongside them.

Run:  python3 cloudflare/build.py     (from the repo root or anywhere)
Then: cd cloudflare && npx wrangler deploy
"""
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # Keyside repo root
OUT = Path(__file__).resolve().parent / "public"

# Prod-equivalent environment — must be set BEFORE importing app.
os.environ["GITHUB_VIDEO_REPO"] = "Napoleon0007/Art-Hub"
os.environ.setdefault("GITHUB_VIDEO_BRANCH", "main")
os.environ.setdefault("SECRET_KEY", "build-snapshot-only")

sys.path.insert(0, str(ROOT))
from app import app  # noqa: E402

# Workers assets html_handling (auto-trailing-slash) maps /three-body -> three-body.html
PAGES = {
    "/": "index.html",
    "/three-body": "three-body.html",
    "/gargantua": "gargantua.html",
}
APIS = {
    "/api/videos": "data/videos.json",
    "/api/products": "data/products.json",
    "/api/links": "data/links.json",
    "/api/galaxies": "data/galaxies.json",
}

ASSET_LIMIT = 25 * 1024 * 1024  # Cloudflare's per-file static asset cap

# Cloudflare's asset layer can't serve HTTP 206 ranges, which the video modal
# needs for seeking — but the edits mp4s are committed in the Keyside repo, so
# point their gallery src at the GitHub raw CDN (ranges + edge cache), exactly
# like every other gallery video already is via Art-Hub.
KEYSIDE_RAW_BASE = "https://raw.githubusercontent.com/Napoleon0007/Keyside/main"


def snapshot() -> None:
    client = app.test_client()
    for route, rel in {**PAGES, **APIS}.items():
        resp = client.get(route)
        if resp.status_code != 200:
            sys.exit(f"FATAL: snapshot of {route} returned HTTP {resp.status_code}")
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.data)
        print(f"  {route:14s} -> {rel}  ({len(resp.data):,} bytes)")
    rewrite_edit_srcs(OUT / "data/videos.json")


def rewrite_edit_srcs(videos_json: Path) -> None:
    import json

    data = json.loads(videos_json.read_text())
    for v in data.get("videos", []):
        src = v.get("src", "")
        if src.startswith("/edits/"):
            v["src"] = KEYSIDE_RAW_BASE + src.replace(" ", "%20")
            print(f"  edits src -> CDN: {v['src']}")
    videos_json.write_text(json.dumps(data))


def copy_assets() -> None:
    def skip(_dir: str, names: list[str]) -> list[str]:
        return [n for n in names if n.endswith(".bak") or n == ".DS_Store"]

    shutil.copytree(ROOT / "static", OUT / "static", ignore=skip)
    edits_out = OUT / "edits"
    edits_out.mkdir()
    for f in sorted((ROOT / "edits").glob("*.mp4")):
        shutil.copy2(f, edits_out / f.name)
        print(f"  edits/{f.name}  ({f.stat().st_size:,} bytes)")


def check_sizes() -> None:
    oversize = [p for p in OUT.rglob("*") if p.is_file() and p.stat().st_size > ASSET_LIMIT]
    if oversize:
        for p in oversize:
            print(f"FATAL: {p.relative_to(OUT)} is {p.stat().st_size:,} bytes (> 25 MiB asset cap)")
        sys.exit(1)
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    count = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"Build OK: {count} files, {total / 1024 / 1024:.1f} MB total -> {OUT}")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    snapshot()
    copy_assets()
    check_sizes()


if __name__ == "__main__":
    main()

from flask import Flask, jsonify, render_template, send_file, abort
from pathlib import Path
import json
import mimetypes
import os
import re

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-prod")

VIDEO_DIR      = Path(__file__).parent.parent / "Art Hub"
UPLOAD_DIR     = Path(__file__).parent / "uploads"
AI_MUSIC_DIR   = UPLOAD_DIR / "ai-music"   # audio here is auto-classed as "AI Music"
EDITS_DIR      = Path(__file__).parent / "edits"   # real edits (music videos, short docs) → "Edit"
THUMBS_DIR     = Path(__file__).parent / "static" / "video-thumbs"   # auto-extracted frame thumbnails
METADATA_FILE  = Path(__file__).parent / "videos.json"
PRODUCTS_FILE  = Path(__file__).parent / "products.json"
LINKS_FILE     = Path(__file__).parent / "links.json"
VIDEO_EXTENSIONS = {".mp4", ".MP4", ".webm", ".mov", ".MOV", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".JPG", ".JPEG", ".png", ".PNG", ".webp", ".WEBP", ".gif", ".GIF", ".avif"}
AUDIO_EXTENSIONS = {".mp3", ".MP3", ".wav", ".WAV", ".m4a", ".M4A", ".ogg", ".OGG", ".flac", ".aac"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS | AUDIO_EXTENSIONS


def media_type_for(filename: str) -> str | None:
    ext = Path(filename).suffix
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in AUDIO_EXTENSIONS:
        return "music"
    return None

GITHUB_REPO    = os.environ.get("GITHUB_VIDEO_REPO", "")
GITHUB_BRANCH  = os.environ.get("GITHUB_VIDEO_BRANCH", "main")
GITHUB_RAW_BASE = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}" if GITHUB_REPO else ""


# ── Metadata helpers ──────────────────────────────────────────────────────────

def load_metadata() -> dict:
    if METADATA_FILE.exists():
        with open(METADATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_metadata(data: dict) -> None:
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def clean_title(filename: str) -> str:
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ").title()


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower().strip()).strip("-")
    return s or "x"


def thumb_for(filename: str, meta: dict):
    """Display thumbnail for a media item: an explicit videos.json "thumb" wins,
    else an auto-extracted video frame at static/video-thumbs/<slug>.jpg, else None."""
    if meta.get("thumb"):
        return meta["thumb"]
    slug = slugify(Path(filename).stem)
    if (THUMBS_DIR / f"{slug}.jpg").exists():
        return f"/static/video-thumbs/{slug}.jpg"
    return None


# Small looping bg/cover clips (hero, section backgrounds, music tile covers) live in the
# Art-Hub repo under loops/. Serve them from GitHub raw — a CDN, with ~0.4s TTFB vs
# Railway's ~1.1s Python static — in prod; fall back to local /static in dev.
LOOP_BASE = f"{GITHUB_RAW_BASE}/loops" if GITHUB_RAW_BASE else ""


def loop_url(rel: str) -> str:
    rel = rel.lstrip("/")
    if rel.startswith("static/"):
        rel = rel[len("static/"):]
    if LOOP_BASE:
        encoded = "/".join(p.replace(" ", "%20") for p in rel.split("/"))
        return f"{LOOP_BASE}/{encoded}"
    return f"/static/{rel}"


def assign_orders(metadata: dict) -> dict:
    needs_order = [k for k, v in metadata.items() if "order" not in v]
    if needs_order:
        max_order = max((v.get("order", -1) for v in metadata.values()), default=-1)
        for i, key in enumerate(sorted(needs_order)):
            metadata[key]["order"] = max_order + 1 + i
        save_metadata(metadata)
    return metadata


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.context_processor
def inject_loops():
    # loop_url() for templates; LOOP_BASE so the client JS can build CDN loop URLs too.
    return {"loop_url": loop_url, "loop_base": LOOP_BASE}


# NOTE: the REX chat endpoint + accounts/admin/uploads/downloads now live in
# cloudflare/src/worker.js (this Flask app only runs at build-time + local dev).


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/three-body")
def three_body():
    return render_template("three_body.html")


@app.route("/gargantua")
def gargantua():
    return render_template("gargantua.html")


# ── Video API ─────────────────────────────────────────────────────────────────

@app.route("/api/videos")
def get_videos():
    metadata = assign_orders(load_metadata())
    videos   = []

    if GITHUB_RAW_BASE:
        for filename, meta in metadata.items():
            if filename.startswith("edits/") or filename.startswith("ai-music/"):
                continue   # served by their own local routes/blocks below, not GitHub raw
            encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
            src = meta.get("src_override") or f"{GITHUB_RAW_BASE}/{encoded}"
            videos.append({
                "file":  filename,
                "title": meta.get("title", clean_title(filename)),
                "style": meta.get("style", "abstract"),
                "type":  meta.get("type") or media_type_for(filename) or "video",
                "order": meta.get("order", 9999),
                "src":   src,
            })
    else:
        seen = set()
        if VIDEO_DIR.exists():
            for path in VIDEO_DIR.iterdir():
                if path.suffix in MEDIA_EXTENSIONS and path.is_file():
                    filename = path.name
                    seen.add(filename)
                    meta = metadata.get(filename, {})
                    videos.append({
                        "file":  filename,
                        "title": meta.get("title", clean_title(filename)),
                        "style": meta.get("style", "abstract"),
                        "type":  meta.get("type") or media_type_for(filename) or "video",
                        "order": meta.get("order", 9999),
                        "src":   f"/video/{filename}",
                    })
        for path in UPLOAD_DIR.iterdir():
            if path.suffix in MEDIA_EXTENSIONS and path.is_file() and path.name not in seen:
                filename = path.name
                meta = metadata.get(filename, {})
                videos.append({
                    "file":  filename,
                    "title": meta.get("title", clean_title(filename)),
                    "style": meta.get("style", "abstract"),
                    "type":  meta.get("type") or media_type_for(filename) or "video",
                    "order": meta.get("order", 9999),
                    "src":   f"/uploads/{filename}",
                })

    # ── AI music ────────────────────────────────────────────────────────────
    # Audio dropped into uploads/ai-music/ is auto-classed as "AI Music".
    # A video named "intro" in that folder is Rex's explainer, surfaced separately.
    ai_music_intro = None
    if AI_MUSIC_DIR.exists():
        for path in sorted(AI_MUSIC_DIR.iterdir()):
            if not path.is_file():
                continue
            if path.stem.lower() == "intro" and path.suffix in VIDEO_EXTENSIONS:
                ai_music_intro = f"/uploads/ai-music/{path.name}"
                continue
            if path.suffix in AUDIO_EXTENSIONS:
                key  = f"ai-music/{path.name}"
                meta = metadata.get(key, {})
                videos.append({
                    "file":    key,
                    "title":   meta.get("title", clean_title(path.name)),
                    "style":   meta.get("style", "ai"),
                    "type":    "music",
                    "subtype": "ai",
                    "order":   meta.get("order", 9999),
                    "src":     f"/uploads/ai-music/{path.name}",
                })

    # ── Edits ───────────────────────────────────────────────────────────────
    # Real edits (music videos, short documentaries) dropped into the edits/ folder
    # are auto-classed as "edit". The folder ships with the app, so these work in
    # production too (served locally, not from the GitHub media repo). Titles/styles
    # can be overridden in videos.json under the key "edits/<filename>".
    if EDITS_DIR.exists():
        for path in sorted(EDITS_DIR.iterdir()):
            if path.is_file() and path.suffix in MEDIA_EXTENSIONS:
                key  = f"edits/{path.name}"
                meta = metadata.get(key, {})
                videos.append({
                    "file":  key,
                    "title": meta.get("title", clean_title(path.name)),
                    "style": meta.get("style", "edit"),
                    "type":  "edit",
                    "order": meta.get("order", 9999),
                    "src":   f"/edits/{path.name}",
                })

    # Attach a thumbnail to every entry — explicit (videos.json "thumb") or an
    # auto-extracted video frame — so the gallery + the 3D world circles show imagery.
    for v in videos:
        meta = metadata.get(v["file"], {})
        v["thumb"] = thumb_for(v["file"], meta)
        if meta.get("cover"):
            v["cover"] = loop_url(meta["cover"])     # compressed cover loop via CDN (prod) / static (dev)
        v["new"] = bool(meta.get("new"))            # mark a fresh drop → comets it in (Rex's World)
        if meta.get("added"):
            v["added"] = meta["added"]

    videos.sort(key=lambda v: (v["order"], v["file"]))
    return jsonify({"videos": videos, "ai_music_intro": ai_music_intro})


# Formats we can convert to, per media kind, with their MIME types.
DOWNLOAD_FORMATS = {
    "video": {"mp4": "video/mp4"},
    "image": {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"},
    "music": {"mp3": "audio/mpeg", "wav": "audio/wav"},
}


@app.route("/api/products")
def get_products():
    """Rex's products showcase — read from products.json (edit that file to add tools)."""
    try:
        with open(PRODUCTS_FILE, encoding="utf-8") as f:
            products = json.load(f)
        if not isinstance(products, list):
            products = []
    except (FileNotFoundError, json.JSONDecodeError):
        products = []
    return jsonify({"products": products})


@app.route("/api/links")
def get_links():
    """External Rex Trueform presence (socials etc.) for the 3D world — read from links.json.

    Edit links.json to add a destination or paste in a URL; nodes with a blank
    url render as "coming soon" in the neural map until a link is filled in.
    """
    try:
        with open(LINKS_FILE, encoding="utf-8") as f:
            links = json.load(f)
        if not isinstance(links, list):
            links = []
    except (FileNotFoundError, json.JSONDecodeError):
        links = []
    return jsonify({"links": links})


@app.route("/api/galaxies")
def get_galaxies():
    """Background galaxy photos for the 3D world — every image in static/galaxies/.

    Drop more galaxy images (jpg/png/webp) into static/galaxies/ and they appear
    in the world's deep background automatically on reload.
    """
    folder = Path(__file__).parent / "static" / "galaxies"
    exts = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
    galaxies = []
    if folder.is_dir():
        for p in sorted(folder.iterdir()):
            if p.is_file() and p.suffix.lower() in exts:
                galaxies.append(f"/static/galaxies/{p.name}")
    return jsonify({"galaxies": galaxies})


@app.route("/video/<path:filename>")
def stream_video(filename: str):
    filepath = VIDEO_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        abort(404)
    try:
        filepath.resolve().relative_to(VIDEO_DIR.resolve())
    except ValueError:
        abort(403)
    mime = mimetypes.guess_type(str(filepath))[0] or "video/mp4"
    return send_file(filepath, mimetype=mime, conditional=True)


@app.route("/edits/<path:filename>")
def serve_edit(filename: str):
    filepath = EDITS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        abort(404)
    try:
        filepath.resolve().relative_to(EDITS_DIR.resolve())
    except ValueError:
        abort(403)
    mime = mimetypes.guess_type(str(filepath))[0] or "video/mp4"
    return send_file(filepath, mimetype=mime, conditional=True)


if __name__ == "__main__":
    app.run(debug=True, port=5050)

from flask import Flask, jsonify, render_template, send_file, abort, request
from pathlib import Path
import json
import mimetypes
import os

app = Flask(__name__)

# Local path used in development; ignored when GITHUB_VIDEO_REPO is set.
VIDEO_DIR = Path(__file__).parent.parent / "Art Hub"
METADATA_FILE = Path(__file__).parent / "videos.json"
VIDEO_EXTENSIONS = {".mp4", ".MP4", ".webm", ".mov", ".MOV", ".m4v"}

# When deployed, videos are served straight from GitHub raw URLs.
# Set GITHUB_VIDEO_REPO=Napoleon0007/Art-Hub in Railway env vars.
GITHUB_REPO = os.environ.get("GITHUB_VIDEO_REPO", "")
GITHUB_BRANCH = os.environ.get("GITHUB_VIDEO_BRANCH", "main")
GITHUB_RAW_BASE = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}" if GITHUB_REPO else ""


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


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/videos")
def get_videos():
    metadata = load_metadata()
    videos = []

    if GITHUB_RAW_BASE:
        # Production: build list from metadata file; src points to GitHub raw.
        for filename, meta in metadata.items():
            encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
            videos.append({
                "file": filename,
                "title": meta.get("title", clean_title(filename)),
                "style": meta.get("style", "abstract"),
                "src": f"{GITHUB_RAW_BASE}/{encoded}",
            })
        videos.sort(key=lambda v: v["file"])
    else:
        # Development: scan local Art Hub directory.
        if not VIDEO_DIR.exists():
            return jsonify({"error": "Video directory not found", "videos": []})
        for path in sorted(VIDEO_DIR.iterdir()):
            if path.suffix in VIDEO_EXTENSIONS and path.is_file():
                filename = path.name
                meta = metadata.get(filename, {})
                videos.append({
                    "file": filename,
                    "title": meta.get("title", clean_title(filename)),
                    "style": meta.get("style", "abstract"),
                    "src": f"/video/{filename}",
                })

    return jsonify({"videos": videos})


@app.route("/api/videos/<path:filename>", methods=["PATCH"])
def update_video_meta(filename: str):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    allowed = {"title", "style"}
    if not allowed.intersection(data.keys()):
        return jsonify({"error": "Nothing to update"}), 400

    metadata = load_metadata()
    entry = metadata.setdefault(filename, {})

    if "title" in data:
        entry["title"] = str(data["title"]).strip()
    if "style" in data:
        entry["style"] = str(data["style"]).strip().lower()

    save_metadata(metadata)
    return jsonify({"ok": True, "file": filename, **entry})


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


if __name__ == "__main__":
    app.run(debug=True, port=5050)

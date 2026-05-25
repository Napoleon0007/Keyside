from flask import Flask, jsonify, render_template, send_file, abort, request, session, redirect
from pathlib import Path
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import json
import mimetypes
import os
import sqlite3
import functools

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-prod")

VIDEO_DIR      = Path(__file__).parent.parent / "Art Hub"
UPLOAD_DIR     = Path(__file__).parent / "uploads"
METADATA_FILE  = Path(__file__).parent / "videos.json"
DB_FILE        = Path(__file__).parent / "users.db"
VIDEO_EXTENSIONS = {".mp4", ".MP4", ".webm", ".mov", ".MOV", ".m4v"}

GITHUB_REPO    = os.environ.get("GITHUB_VIDEO_REPO", "")
GITHUB_BRANCH  = os.environ.get("GITHUB_VIDEO_BRANCH", "main")
GITHUB_RAW_BASE = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}" if GITHUB_REPO else ""
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin1234")


# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    UPLOAD_DIR.mkdir(exist_ok=True)
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                email        TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


init_db()


# ── Auth decorators ───────────────────────────────────────────────────────────

def login_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_id") and not session.get("is_admin"):
            return jsonify({"error": "Login required"}), 401
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "Admin only"}), 403
        return f(*args, **kwargs)
    return wrapper


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


def assign_orders(metadata: dict) -> dict:
    needs_order = [k for k, v in metadata.items() if "order" not in v]
    if needs_order:
        max_order = max((v.get("order", -1) for v in metadata.values()), default=-1)
        for i, key in enumerate(sorted(needs_order)):
            metadata[key]["order"] = max_order + 1 + i
        save_metadata(metadata)
    return metadata


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
def admin():
    if not session.get("is_admin"):
        return render_template("admin_login.html")
    return render_template("admin.html")


# ── Auth API ──────────────────────────────────────────────────────────────────

@app.route("/api/me")
def me():
    if session.get("is_admin"):
        return jsonify({"logged_in": True, "is_admin": True, "email": "admin"})
    if session.get("user_id"):
        return jsonify({"logged_in": True, "is_admin": False, "email": session.get("user_email")})
    return jsonify({"logged_in": False})


@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    email    = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", "")).strip()

    if not email or "@" not in email:
        return jsonify({"error": "Valid email required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, generate_password_hash(password))
            )
        return jsonify({"ok": True})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already registered"}), 409


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email    = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", "")).strip()

    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if row and check_password_hash(row["password_hash"], password):
        session["user_id"]    = row["id"]
        session["user_email"] = row["email"]
        session.pop("is_admin", None)
        return jsonify({"ok": True, "email": row["email"]})

    return jsonify({"error": "Invalid email or password"}), 401


@app.route("/api/admin-login", methods=["POST"])
def admin_login():
    data     = request.get_json(silent=True) or {}
    password = str(data.get("password", ""))

    if password == ADMIN_PASSWORD:
        session["is_admin"] = True
        session.pop("user_id", None)
        return jsonify({"ok": True})

    return jsonify({"error": "Wrong password"}), 401


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


# ── Video API ─────────────────────────────────────────────────────────────────

@app.route("/api/videos")
def get_videos():
    metadata = assign_orders(load_metadata())
    videos   = []

    if GITHUB_RAW_BASE:
        for filename, meta in metadata.items():
            encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
            src = meta.get("src_override") or f"{GITHUB_RAW_BASE}/{encoded}"
            videos.append({
                "file":  filename,
                "title": meta.get("title", clean_title(filename)),
                "style": meta.get("style", "abstract"),
                "order": meta.get("order", 9999),
                "src":   src,
            })
    else:
        seen = set()
        if VIDEO_DIR.exists():
            for path in VIDEO_DIR.iterdir():
                if path.suffix in VIDEO_EXTENSIONS and path.is_file():
                    filename = path.name
                    seen.add(filename)
                    meta = metadata.get(filename, {})
                    videos.append({
                        "file":  filename,
                        "title": meta.get("title", clean_title(filename)),
                        "style": meta.get("style", "abstract"),
                        "order": meta.get("order", 9999),
                        "src":   f"/video/{filename}",
                    })
        for path in UPLOAD_DIR.iterdir():
            if path.suffix in VIDEO_EXTENSIONS and path.is_file() and path.name not in seen:
                filename = path.name
                meta = metadata.get(filename, {})
                videos.append({
                    "file":  filename,
                    "title": meta.get("title", clean_title(filename)),
                    "style": meta.get("style", "abstract"),
                    "order": meta.get("order", 9999),
                    "src":   f"/uploads/{filename}",
                })

    videos.sort(key=lambda v: (v["order"], v["file"]))
    return jsonify({"videos": videos})


@app.route("/api/videos/reorder", methods=["POST"])
@admin_required
def reorder_videos():
    data      = request.get_json(silent=True) or {}
    filename  = data.get("filename")
    direction = data.get("direction")

    if not filename or direction not in ("up", "down"):
        return jsonify({"error": "filename and direction (up/down) required"}), 400

    metadata = assign_orders(load_metadata())

    if filename not in metadata:
        return jsonify({"error": "Video not found"}), 404

    ordered  = sorted(metadata.items(), key=lambda x: (x[1].get("order", 9999), x[0]))
    idx      = next((i for i, (k, _) in enumerate(ordered) if k == filename), None)
    swap_idx = idx - 1 if direction == "up" else idx + 1

    if swap_idx < 0 or swap_idx >= len(ordered):
        return jsonify({"ok": True, "at_boundary": True})

    key_a, meta_a = ordered[idx]
    key_b, meta_b = ordered[swap_idx]

    metadata[key_a]["order"] = meta_b.get("order", swap_idx)
    metadata[key_b]["order"] = meta_a.get("order", idx)

    save_metadata(metadata)
    return jsonify({"ok": True})


@app.route("/api/videos/upload", methods=["POST"])
@login_required
def upload_video():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    filename = secure_filename(f.filename)
    if Path(filename).suffix not in VIDEO_EXTENSIONS:
        return jsonify({"error": "Unsupported file type"}), 400

    UPLOAD_DIR.mkdir(exist_ok=True)
    save_path = UPLOAD_DIR / filename
    f.save(str(save_path))

    metadata  = assign_orders(load_metadata())
    max_order = max((v.get("order", -1) for v in metadata.values()), default=-1)

    if filename not in metadata:
        metadata[filename] = {
            "title":        clean_title(filename),
            "style":        "abstract",
            "order":        max_order + 1,
            "src_override": f"/uploads/{filename}",
        }
        save_metadata(metadata)

    return jsonify({"ok": True, "filename": filename, "title": metadata[filename]["title"]})


@app.route("/api/videos/<path:filename>/download")
@login_required
def download_video(filename: str):
    metadata = load_metadata()
    meta     = metadata.get(filename, {})

    if GITHUB_RAW_BASE:
        src_override = meta.get("src_override")
        if src_override:
            return redirect(src_override)
        encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
        return redirect(f"{GITHUB_RAW_BASE}/{encoded}")

    for base in (VIDEO_DIR, UPLOAD_DIR):
        filepath = base / filename
        if filepath.exists() and filepath.is_file():
            try:
                filepath.resolve().relative_to(base.resolve())
            except ValueError:
                abort(403)
            mime = mimetypes.guess_type(str(filepath))[0] or "video/mp4"
            return send_file(filepath, mimetype=mime, as_attachment=True, download_name=filename)

    abort(404)


@app.route("/api/videos/<path:filename>", methods=["PATCH"])
@admin_required
def update_video_meta(filename: str):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    allowed = {"title", "style"}
    if not allowed.intersection(data.keys()):
        return jsonify({"error": "Nothing to update"}), 400

    metadata = load_metadata()
    entry    = metadata.setdefault(filename, {})

    if "title" in data:
        entry["title"] = str(data["title"]).strip()
    if "style" in data:
        entry["style"] = str(data["style"]).strip().lower()

    save_metadata(metadata)
    return jsonify({"ok": True, "file": filename, **entry})


@app.route("/api/admin/users")
@admin_required
def admin_users():
    with get_db() as conn:
        rows = conn.execute("SELECT email, created_at FROM users ORDER BY created_at DESC").fetchall()
    return jsonify({"users": [{"email": r["email"], "created_at": r["created_at"]} for r in rows]})


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


@app.route("/uploads/<path:filename>")
def serve_upload(filename: str):
    filepath = UPLOAD_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        abort(404)
    try:
        filepath.resolve().relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        abort(403)
    mime = mimetypes.guess_type(str(filepath))[0] or "video/mp4"
    return send_file(filepath, mimetype=mime, conditional=True)


if __name__ == "__main__":
    app.run(debug=True, port=5050)

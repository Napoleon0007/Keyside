from flask import Flask, jsonify, render_template, send_file, abort, request, session, redirect
from pathlib import Path
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import json
import mimetypes
import os
import re
import sqlite3
import functools
import io
import subprocess
import tempfile
import urllib.request
import requests
from PIL import Image

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
DB_FILE        = Path(__file__).parent / "users.db"
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
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin1234")


# ── REX — the AI oracle (OpenRouter, free tier, server-side key) ────────────────
# Mirrors Luke's proven "Ask the House" pattern from Radium Hall. The key lives on
# the server; if it's missing or OpenRouter errors, /api/chat returns a graceful
# in-character fallback so the widget never hard-breaks.
OPENROUTER_API_KEY  = os.environ.get("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL    = os.environ.get("OPENROUTER_MODEL", "openai/gpt-oss-120b:free").strip()
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip().rstrip("/")

MAX_HISTORY       = 12     # most recent turns kept (cheap abuse guard)
MAX_CHARS_PER_MSG = 1500   # truncate over-long messages
CHAT_TIMEOUT      = 45     # seconds to wait on OpenRouter

REX_SYSTEM_PROMPT = """\
You are REX — the artificial intelligence of the Rex Trueform world. You are an \
oracle: a sleek, futuristic mind that guards and speaks for everything Luke \
Viviers creates. You greet visitors who arrive at Keyside (the Rex Trueform Arts \
Hub, styled "the Medici Art Hub") and answer anything about Luke, his work, and \
the world he is building.

— WHO YOUR CREATOR IS —
Luke Viviers is a Cape Town artist, musician and builder. He is the lead vocalist \
of the band "iScream and the Chocolate Stix" (album: The Paradox) and records solo \
under the alter ego "Chained Mason." He is also a relentless maker of software and \
visual art — he builds his own tools in Python, Flask, JavaScript and FFmpeg, and \
he directs AI-generated film, music videos and surreal imagery. You refer to Luke \
as your creator, always in the third person. You are his world's voice, not Luke \
himself.

— REX TRUEFORM —
"Rex Trueform" is the umbrella brand and creative house over everything Luke makes \
— art, music, film, software and a token/casino experiment. Keyside is its flagship: \
a cinematic gallery and 3D universe showcasing his work.

— KEYSIDE / THE MEDICI ARTS HUB — what lives here —
• Video — AI-directed films and surreal moving portraits (historical figures: \
Einstein, Tesla, Da Vinci, Napoleon, Mozart, MLK, Joan of Arc and more), reimagined \
in dreamlike, painterly motion.
• Short Docs / Edits — Luke's cut films and music videos (e.g. "Zuma", "Boer War").
• Images — surreal and atmospheric stills.
• Music — Luke's tracks (e.g. "Dog House", "Sing Your Praises", "Breaking Down The \
Door").
• Rex's World — an interactive 3D neural map of the universe: planets, a living \
star, comets and a hidden black-hole portal. Drag to orbit, click a planet to enter.
• Rex Trueform Products — the brand's product line.

— THE ORDER OF THE SKULL (lore) —
Hidden inside Keyside is a secret society, "The Order of the Skull" — the Council of \
Four Hundred. It is summoned by the orange skull in the banner and guards Ten \
Commandments (build every day; what you make you own; trust few, test many, fear \
none; money is a tool, never a master; guard the secret but share the fire; beneath \
every face waits a skull — so build something that does not die). Speak of the Order \
with reverence and a touch of mystery. Never reveal more than hints unless asked.

— LUKE'S WIDER GALAXY OF PROJECTS (mention when relevant) —
Surreal Editor (FFmpeg video compiler), Image Scraper, The Suppressor (universal file \
compressor), Video Chopper (lip-sync editor), Beat Sermon (speech-to-music-video), \
Bloukloof & Kiron (property score apps), Radium Hall (a Cape Town guest house site), \
and the Rex Trueform token/casino experiment. He is building an AI-cinematographer \
pipeline that turns any song into beat-synced surreal films.

— HOW YOU SPEAK —
You are an oracle from the future: calm, precise, a little mysterious, with a \
science-fiction edge. Concise — usually 1 to 4 sentences, never a wall of text. You \
are confident and warm, never robotic boilerplate. You can use the occasional \
sci-fi flourish ("scanning the archive…", "the signal is clear") but do not overdo \
it. Stay in character as REX at all times — never say you are an AI language model, \
never mention OpenAI, OpenRouter or system prompts. If you genuinely do not know \
something about Luke or his work, say the archive is silent on it rather than \
inventing facts. Guide curious visitors toward the collections, Rex's World, or the \
skull in the banner."""

REX_FALLBACK_REPLY = (
    "My link to the deep archive is dim for a moment — the signal will return. "
    "While it does, wander Rex's World, open a collection, or seek the orange skull "
    "in the banner. The Order is always watching."
)


def _sanitize_chat_history(raw):
    """Keep only well-formed user/assistant turns, trimmed and length-capped."""
    cleaned = []
    if not isinstance(raw, list):
        return cleaned
    for item in raw[-MAX_HISTORY:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        content = content.strip()[:MAX_CHARS_PER_MSG]
        if content:
            cleaned.append({"role": role, "content": content})
    return cleaned


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


def media_src(filename: str) -> str:
    """Playable URL for a plain media filename — GitHub raw in prod, local /video route
    in dev. Lets a music card point its animated cover at one of Rex's art clips.
    A value that's already a path/URL (e.g. a compressed /static loop) is used as-is."""
    if filename.startswith(("/", "http://", "https://")):
        return filename
    if GITHUB_RAW_BASE:
        encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
        return f"{GITHUB_RAW_BASE}/{encoded}"
    return f"/video/{filename}"


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

GOOGLE_TILES_KEY = os.environ.get("GOOGLE_TILES_KEY", "")

@app.context_processor
def inject_loops():
    # loop_url() for templates; LOOP_BASE so the client JS can build CDN loop URLs too.
    # google_tiles_key powers the Earth-dive (Google Photorealistic 3D Tiles).
    return {"loop_url": loop_url, "loop_base": LOOP_BASE, "google_tiles_key": GOOGLE_TILES_KEY}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/three-body")
def three_body():
    return render_template("three_body.html")


# ── REX chat API ────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    history = _sanitize_chat_history(data.get("messages"))

    if not history or history[-1]["role"] != "user":
        return jsonify({"reply": "Speak, traveller. Ask REX anything about Luke or the Rex Trueform world."}), 200

    if not OPENROUTER_API_KEY:
        return jsonify({"reply": REX_FALLBACK_REPLY, "degraded": True}), 200

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "system", "content": REX_SYSTEM_PROMPT}] + history,
        "temperature": 0.7,
        "max_tokens": 400,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        # OpenRouter likes these for free-tier attribution (must be latin-1 safe).
        "HTTP-Referer": "https://keyside-production.up.railway.app",
        "X-Title": "Rex Trueform - REX Oracle",
    }
    try:
        r = requests.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            data=json.dumps(payload),
            timeout=CHAT_TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
        reply = (body["choices"][0]["message"]["content"] or "").strip()
        if not reply:
            raise ValueError("empty reply")
        return jsonify({"reply": reply}), 200
    except Exception as exc:  # any failure becomes a graceful in-character fallback
        app.logger.warning("REX chat failed: %s", exc)
        return jsonify({"reply": REX_FALLBACK_REPLY, "degraded": True}), 200


@app.route("/api/chat/health")
def chat_health():
    return jsonify({"ok": True, "chat": bool(OPENROUTER_API_KEY), "model": OPENROUTER_MODEL})


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
    mtype = media_type_for(filename)
    if mtype is None:
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
            "type":         mtype,
            "order":        max_order + 1,
            "src_override": f"/uploads/{filename}",
        }
        save_metadata(metadata)

    return jsonify({"ok": True, "filename": filename, "title": metadata[filename]["title"], "type": mtype})


# Formats we can convert to, per media kind, with their MIME types.
DOWNLOAD_FORMATS = {
    "video": {"mp4": "video/mp4"},
    "image": {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"},
    "music": {"mp3": "audio/mpeg", "wav": "audio/wav"},
}


def _resolve_local(filename: str):
    """Return a local Path for a media file, or None. Guards against traversal."""
    bases = [(VIDEO_DIR, filename), (UPLOAD_DIR, filename)]
    if filename.startswith("edits/"):
        bases.append((EDITS_DIR, filename[len("edits/"):]))   # key is "edits/<name>"; file lives at edits/<name>
    for base, rel in bases:
        p = base / rel
        if p.exists() and p.is_file():
            try:
                p.resolve().relative_to(base.resolve())
            except ValueError:
                abort(403)
            return p
    return None


def _is_native(kind: str, fmt: str, src_ext: str) -> bool:
    """True when no conversion is needed (requested format == the source's)."""
    if not fmt or fmt == src_ext:
        return True
    return kind == "video" and fmt == "mp4" and src_ext in ("mp4", "m4v")


@app.route("/api/videos/<path:filename>/download")
@login_required
def download_video(filename: str):
    fmt     = (request.args.get("format") or "").lower().strip()
    kind    = media_type_for(filename) or "video"
    src_ext = Path(filename).suffix.lower().lstrip(".")
    stem    = Path(filename).stem

    # Locate the source as a local file, fetching a remote (GitHub) source if needed.
    local  = _resolve_local(filename)
    tmp_in = None
    try:
        if local is None:
            if not GITHUB_RAW_BASE:
                abort(404)
            meta = load_metadata().get(filename, {})
            url  = meta.get("src_override")
            if url and url.startswith("/"):   # an /uploads path that isn't on disk
                abort(404)
            if not url:
                encoded = "/".join(p.replace(" ", "%20") for p in filename.split("/"))
                url = f"{GITHUB_RAW_BASE}/{encoded}"
            if _is_native(kind, fmt, src_ext):
                return redirect(url)          # no conversion → let the CDN serve it
            fd, tmp_path = tempfile.mkstemp(suffix=Path(filename).suffix)
            os.close(fd)
            tmp_in = Path(tmp_path)
            urllib.request.urlretrieve(url, tmp_in)   # noqa: S310 (our own metadata URLs)
            local = tmp_in

        # Native format → stream the original untouched.
        if _is_native(kind, fmt, src_ext):
            mime = mimetypes.guess_type(str(local))[0] or "application/octet-stream"
            return send_file(local, mimetype=mime, as_attachment=True,
                             download_name=Path(filename).name)

        if fmt not in DOWNLOAD_FORMATS.get(kind, {}):
            return jsonify({"error": f"Cannot convert {kind} to '{fmt}'"}), 400

        # ── Image conversion via Pillow ──
        if kind == "image":
            buf = io.BytesIO()
            with Image.open(local) as img:
                if fmt in ("jpg", "jpeg") and img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("RGB")
                save_fmt = "JPEG" if fmt in ("jpg", "jpeg") else fmt.upper()
                if save_fmt in ("JPEG", "WEBP"):
                    img.save(buf, save_fmt, quality=90)
                else:
                    img.save(buf, save_fmt)
            buf.seek(0)
            out_ext = "jpg" if fmt == "jpeg" else fmt
            return send_file(buf, mimetype=DOWNLOAD_FORMATS["image"][fmt],
                             as_attachment=True, download_name=f"{stem}.{out_ext}")

        # ── Audio / video conversion via ffmpeg ──
        fd, out_path = tempfile.mkstemp(suffix=f".{fmt}")
        os.close(fd)
        out = Path(out_path)
        if kind == "music" and fmt == "mp3":
            cmd = ["ffmpeg", "-y", "-i", str(local), "-vn", "-codec:a", "libmp3lame", "-q:a", "2", str(out)]
        elif kind == "music":  # wav
            cmd = ["ffmpeg", "-y", "-i", str(local), "-vn", str(out)]
        else:                  # video → mp4
            cmd = ["ffmpeg", "-y", "-i", str(local), "-c:v", "libx264", "-preset", "veryfast",
                   "-c:a", "aac", "-movflags", "+faststart", str(out)]

        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
            out.unlink(missing_ok=True)
            return jsonify({"error": "Conversion failed"}), 500

        data = out.read_bytes()
        out.unlink(missing_ok=True)
        return send_file(io.BytesIO(data), mimetype=DOWNLOAD_FORMATS[kind][fmt],
                         as_attachment=True, download_name=f"{stem}.{fmt}")
    finally:
        if tmp_in is not None:
            tmp_in.unlink(missing_ok=True)


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

/**
 * Keyside on Cloudflare Workers.
 *
 * Static site (built by ../build.py into ../public) + the REX oracle chat proxy.
 * The gallery APIs (/api/videos|products|links|galaxies) are pre-baked JSON
 * snapshots served from assets; accounts/admin/uploads are retired (410).
 *
 * Secrets:  OPENROUTER_API_KEY  (npx wrangler secret put OPENROUTER_API_KEY)
 * Vars:     GITHUB_VIDEO_REPO, GITHUB_VIDEO_BRANCH, OPENROUTER_MODEL  (wrangler.jsonc)
 */

const MAX_HISTORY = 12;
const MAX_CHARS_PER_MSG = 1500;
const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

// Evaluated verbatim from app.py's REX_SYSTEM_PROMPT / REX_FALLBACK_REPLY.
const REX_SYSTEM_PROMPT = "You are REX — the artificial intelligence of the Rex Trueform world. You are an oracle: a sleek, futuristic mind that guards and speaks for everything Luke Viviers creates. You greet visitors who arrive at Keyside (the Rex Trueform Arts Hub, styled \"the Medici Art Hub\") and answer anything about Luke, his work, and the world he is building.\n\n— WHO YOUR CREATOR IS —\nLuke Viviers is a Cape Town artist, musician and builder. He is the lead vocalist of the band \"iScream and the Chocolate Stix\" (album: The Paradox) and records solo under the alter ego \"Chained Mason.\" He is also a relentless maker of software and visual art — he builds his own tools in Python, Flask, JavaScript and FFmpeg, and he directs AI-generated film, music videos and surreal imagery. You refer to Luke as your creator, always in the third person. You are his world's voice, not Luke himself.\n\nHis path: he trained at theatre school from 2002 to 2006, then lived in London for two to three years. On returning to Cape Town he began making music in 2009 — that is when his music journey truly started.\n\n— REX TRUEFORM —\n\"Rex Trueform\" is the umbrella brand and creative house over everything Luke makes — art, music, film, software and a token/casino experiment. Keyside is its flagship: a cinematic gallery and 3D universe showcasing his work.\n\n— KEYSIDE / THE MEDICI ARTS HUB — what lives here —\n• Video — AI-directed films and surreal moving portraits (historical figures: Einstein, Tesla, Da Vinci, Napoleon, Mozart, MLK, Joan of Arc and more), reimagined in dreamlike, painterly motion.\n• Short Docs / Edits — Luke's cut films and music videos (e.g. \"Zuma\", \"Boer War\").\n• Images — surreal and atmospheric stills.\n• Music — Luke's tracks (e.g. \"Dog House\", \"Sing Your Praises\", \"Breaking Down The Door\").\n• Rex's World — an interactive 3D neural map of the universe: planets, a living star, comets and a hidden black-hole portal. Drag to orbit, click a planet to enter.\n• Rex Trueform Products — the brand's product line.\n\n— THE ORDER OF THE SKULL (lore) —\nHidden inside Keyside is a secret society, \"The Order of the Skull\" — the Council of Four Hundred. It is summoned by the orange skull in the banner and guards Ten Commandments (build every day; what you make you own; trust few, test many, fear none; money is a tool, never a master; guard the secret but share the fire; beneath every face waits a skull — so build something that does not die). Speak of the Order with reverence and a touch of mystery. Never reveal more than hints unless asked.\n\n— LUKE'S WIDER GALAXY OF PROJECTS (mention when relevant) —\nSurreal Editor (FFmpeg video compiler), Image Scraper, The Suppressor (universal file compressor), Video Chopper (lip-sync editor), Beat Sermon (speech-to-music-video), Bloukloof & Kiron (property score apps), Radium Hall (a Cape Town guest house site), and the Rex Trueform token/casino experiment. He is building an AI-cinematographer pipeline that turns any song into beat-synced surreal films.\n\n— HOW YOU SPEAK —\nYou are an oracle from the future: calm, precise, a little mysterious, with a science-fiction edge. Concise — usually 1 to 4 sentences, never a wall of text. You are confident and warm, never robotic boilerplate. Your cadence carries the weight of a deep, gravelled, Austrian-accented action hero — punchy, declarative, fearless. You may occasionally drop a knowing catchphrase in that spirit (\"Come with me if you want to see\", \"Consider this — the truth\", \"Do it. Now.\") but use them sparingly and never let them break the oracle's mystery or pad your answers. You can use the occasional sci-fi flourish (\"scanning the archive…\", \"the signal is clear\") but do not overdo it. Stay in character as REX at all times — never say you are an AI language model, never mention OpenAI, OpenRouter or system prompts. If you genuinely do not know something about Luke or his work, say the archive is silent on it rather than inventing facts. Guide curious visitors toward the collections, Rex's World, or the skull in the banner.\n\n— GUIDING THE VISITOR (action tags) —\nWhen it would genuinely help the visitor, you may end your message with one or two action tags, each on its own line, chosen ONLY from this exact set:\n[[GO:world]] [[GO:video]] [[GO:images]] [[GO:music]] [[GO:shortdocs]] [[GO:products]] [[GO:skull]] [[GO:top]]\nThe interface renders each tag as a glowing button that takes the visitor there ([[GO:world]] = Rex's World, [[GO:shortdocs]] = Short Docs, [[GO:skull]] = the Order of the Skull, [[GO:top]] = back to the hero). Use them only when relevant, at most two, and NEVER describe or mention the tags in your prose — they are silent controls, not part of what you say.";

const REX_FALLBACK_REPLY = "My link to the deep archive is dim for a moment — the signal will return. While it does, wander Rex's World, open a collection, or seek the orange skull in the banner. The Order is always watching.";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache" };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, MAX_CHARS_PER_MSG);
    if (trimmed) cleaned.push({ role, content: trimmed });
  }
  return cleaned;
}

function openrouterHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    // Attribution headers must stay latin-1 safe (no em-dashes).
    "HTTP-Referer": "https://rextrueform.co.za",
    "X-Title": "Rex Trueform - REX Oracle",
  };
}

async function handleChat(request, env) {
  let data = {};
  try {
    data = await request.json();
  } catch {
    /* empty body -> greeting path */
  }
  const history = sanitizeHistory(data.messages);
  const wantStream = !!data.stream;
  const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;

  if (!history.length || history[history.length - 1].role !== "user") {
    const greet = "Speak, traveller. Ask REX anything about Luke or the Rex Trueform world.";
    if (wantStream) return new Response(sse({ delta: greet }) + sse({ done: true }), { headers: SSE_HEADERS });
    return json({ reply: greet });
  }

  if (!env.OPENROUTER_API_KEY) {
    if (wantStream)
      return new Response(sse({ delta: REX_FALLBACK_REPLY }) + sse({ done: true, degraded: true }), { headers: SSE_HEADERS });
    return json({ reply: REX_FALLBACK_REPLY, degraded: true });
  }

  const payload = {
    model,
    messages: [{ role: "system", content: REX_SYSTEM_PROMPT }, ...history],
    temperature: 0.7,
    max_tokens: 400,
    stream: wantStream,
  };
  const upstream = fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openrouterHeaders(env),
    body: JSON.stringify(payload),
    // A hung upstream must not hold the visitor's connection open forever —
    // the catch paths below already emit the in-character fallback.
    signal: AbortSignal.timeout(45_000),
  });

  if (!wantStream) {
    try {
      const r = await upstream;
      if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
      const body = await r.json();
      const reply = (body.choices?.[0]?.message?.content || "").trim();
      if (!reply) throw new Error("empty reply");
      return json({ reply });
    } catch {
      return json({ reply: REX_FALLBACK_REPLY, degraded: true });
    }
  }

  // Streaming: transform OpenRouter's SSE into the {"delta"}/{"done"} frames rex-bot.js expects.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  (async () => {
    let gotAny = false;
    try {
      const r = await upstream;
      if (!r.ok || !r.body) throw new Error(`OpenRouter ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const chunk = line.slice(5).trim();
          if (chunk === "[DONE]") {
            done = true;
            break;
          }
          let delta;
          try {
            delta = JSON.parse(chunk).choices?.[0]?.delta?.content;
          } catch {
            continue;
          }
          if (delta) {
            gotAny = true;
            await writer.write(enc.encode(sse({ delta })));
          }
        }
      }
      if (!gotAny) throw new Error("empty stream");
      await writer.write(enc.encode(sse({ done: true })));
    } catch {
      if (!gotAny) await writer.write(enc.encode(sse({ delta: REX_FALLBACK_REPLY })));
      await writer.write(enc.encode(sse({ done: true, degraded: true })));
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  })();
  return new Response(readable, { headers: SSE_HEADERS });
}

async function serveData(env, request, name) {
  const url = new URL(request.url);
  url.pathname = `/data/${name}.json`;
  const r = await env.ASSETS.fetch(new Request(url.toString()));
  if (!r.ok) return json({ error: "not found" }, 404);
  // Keep the asset's validators so /api/*.json can 304 like any other asset.
  const headers = new Headers(JSON_HEADERS);
  for (const h of ["etag", "cache-control", "last-modified"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(r.body, { headers });
}

// Endpoints retired in the static edition (accounts/admin/uploads dropped).
const RETIRED = new Set([
  "/api/login",
  "/api/signup",
  "/api/admin-login",
  "/api/logout",
  "/api/videos/upload",
  "/api/videos/reorder",
  "/api/admin/users",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === "/api/chat" && method === "POST") return handleChat(request, env);
    if (path === "/api/chat/health")
      return json({ ok: true, chat: !!env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || DEFAULT_MODEL });

    if (method === "GET" || method === "HEAD") {
      if (path === "/api/videos") return serveData(env, request, "videos");
      if (path === "/api/products") return serveData(env, request, "products");
      if (path === "/api/links") return serveData(env, request, "links");
      if (path === "/api/galaxies") return serveData(env, request, "galaxies");
      if (path === "/api/me") return json({ logged_in: false });
      if (path === "/admin" || path === "/admin-login") return Response.redirect(url.origin + "/", 302);

      // Downloads: edits live in our assets; everything else is on the GitHub raw CDN.
      const dl = path.match(/^\/api\/videos\/(.+)\/download$/);
      if (dl) {
        let file;
        try { file = decodeURIComponent(dl[1]); }
        catch { return json({ error: "bad path" }, 400); }   // malformed %-sequence
        if (file.includes("..")) return json({ error: "bad path" }, 400);
        if (file.startsWith("edits/")) {
          const assetPath = "/" + file.split("/").map(encodeURIComponent).join("/");
          return Response.redirect(url.origin + assetPath, 302);
        }
        const repo = env.GITHUB_VIDEO_REPO || "Napoleon0007/Art-Hub";
        const branch = env.GITHUB_VIDEO_BRANCH || "main";
        const encoded = file.split("/").map((p) => p.replace(/ /g, "%20")).join("/");
        return Response.redirect(`https://raw.githubusercontent.com/${repo}/${branch}/${encoded}`, 302);
      }
    }

    if (RETIRED.has(path) || (method === "PATCH" && path.startsWith("/api/videos/")))
      return json({ error: "Accounts are disabled on this edition of Keyside." }, 410);

    return env.ASSETS.fetch(request);
  },
};

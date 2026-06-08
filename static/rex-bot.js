/* ============================================================================
   REX — the AI oracle of the Rex Trueform world.
   A single, self-contained, drop-in chat widget. Injects its own styles + DOM.

   Features: streaming replies, in-reply navigation buttons, suggested prompts,
   a boot/awakening sequence, and voice (REX speaks + listens).

   To use on ANY site:
     1. Expose a POST endpoint that takes {messages:[{role,content}...], stream:bool}
        and returns {reply:"..."} (or an SSE stream of {delta}/{done}). See /api/chat.
     2. Add:  <script src="rex-bot.js" defer></script>
     3. (optional) configure before the script loads:
          window.REX_BOT_CONFIG = {
            endpoint:'/api/chat', navMount:'.nav-right',
            greeting:'...', suggestions:[...], actions:{...}
          };
   The floating orb always appears; the nav button only appears if navMount exists.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__REX_BOT__) return;            // guard against double-injection
  window.__REX_BOT__ = true;

  var CFG = Object.assign({
    endpoint: "/api/chat",
    navMount: ".nav-right",
    title: "REX",
    status: "ORACLE ONLINE",
    greeting:
      "I am REX — the intelligence of the Rex Trueform world. Speak your mind, and I will answer.",
    placeholder: "Transmit a question…",
    suggestions: []   // no preemptive prompts — let people write what they're thinking
  }, window.REX_BOT_CONFIG || {});

  /* ---- page-navigation actions REX can trigger via [[GO:tag]] ------------- */
  function clickFilter(type) {
    var b = document.querySelector('.filter-btn[data-type="' + type + '"]');
    if (b) b.click();
  }
  function scrollTo(sel) {
    var e = document.querySelector(sel);
    if (e) { e.scrollIntoView({ behavior: "smooth", block: "start" }); return true; }
    return false;
  }
  var ACTIONS = Object.assign({
    world:     { label: "Enter Rex's World",       run: function () { clickFilter("world"); scrollTo("#section-world"); } },
    video:     { label: "Open the Films",          run: function () { clickFilter("video"); scrollTo("#content"); } },
    images:    { label: "Open the Images",         run: function () { clickFilter("image"); scrollTo("#content"); } },
    music:     { label: "Open the Music",          run: function () { clickFilter("music"); scrollTo("#content"); } },
    shortdocs: { label: "Open Short Docs",         run: function () { clickFilter("edit"); scrollTo("#content"); } },
    products:  { label: "Rex Trueform Products",   run: function () { clickFilter("products"); scrollTo("#products"); } },
    skull:     { label: "The Order of the Skull",  run: function () { var s = document.querySelector("#skullBtn"); if (s) s.click(); } },
    top:       { label: "Back to the top",         run: function () { if (!scrollTo("#hero")) window.scrollTo({ top: 0, behavior: "smooth" }); } }
  }, CFG.actions || {});

  /* ---------- styles ------------------------------------------------------- */
  var CSS = `
  .rexbot, .rexbot * { box-sizing: border-box; }
  .rexbot {
    --rb-orange:#ff7a18; --rb-hot:#ffb15a; --rb-deep:#ff5a00; --rb-cyan:#5eeaff;
    --rb-ink:#f7efe6; --rb-dim:#b9a591;
    --rb-glass: rgba(14,9,12,.78);
    --rb-edge: rgba(255,122,24,.55);
    font-family:'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
    -webkit-font-smoothing:antialiased;
  }

  /* ---- floating orb ---- */
  .rexbot-orb {
    position:fixed; right:26px; bottom:26px; width:64px; height:64px; z-index:99998;
    border:0; padding:0; cursor:pointer; background:transparent; border-radius:50%;
    filter: drop-shadow(0 6px 22px rgba(255,90,0,.45));
    animation: rb-float 5.5s ease-in-out infinite;
    transition: transform .25s ease, filter .25s ease, opacity .3s ease;
  }
  .rexbot-orb:hover { transform: scale(1.08); filter: drop-shadow(0 8px 30px rgba(255,122,24,.75)); }
  .rexbot-orb:focus-visible { outline:2px solid var(--rb-cyan); outline-offset:4px; }
  .rexbot-orb.rb-hidden { opacity:0; transform:scale(.4); pointer-events:none; }
  .rexbot-orb .rb-core {
    position:absolute; inset:13px; border-radius:50%;
    background: radial-gradient(circle at 38% 34%, #fff6ec 0%, var(--rb-hot) 26%, var(--rb-orange) 52%, var(--rb-deep) 78%, #5a1d00 100%);
    box-shadow: 0 0 18px rgba(255,122,24,.9), inset 0 0 12px rgba(255,200,140,.6);
    animation: rb-pulse 2.6s ease-in-out infinite;
  }
  .rexbot-orb .rb-ring {
    position:absolute; inset:2px; border-radius:50%;
    border:1.5px solid transparent;
    background: conic-gradient(from 0deg, var(--rb-orange), var(--rb-cyan), var(--rb-orange), transparent 70%, var(--rb-orange)) border-box;
    -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: rb-spin 6s linear infinite;
  }
  .rexbot-orb .rb-ring.b { inset:-4px; opacity:.5; animation-duration:9s; animation-direction:reverse; }
  .rexbot-orb .rb-eye {
    position:absolute; inset:0; display:grid; place-items:center;
    color:#1a0a02; font-weight:700; font-size:11px; letter-spacing:1px; text-shadow:0 0 6px rgba(255,240,220,.8);
  }

  /* ---- nav launcher ---- */
  .rexbot-navbtn {
    display:inline-flex; align-items:center; gap:6px; cursor:pointer;
    background: linear-gradient(180deg, rgba(255,122,24,.18), rgba(255,122,24,.06));
    border:1px solid var(--rb-edge); border-radius:999px; padding:6px 12px;
    color:var(--rb-hot); font-family:'Space Mono', monospace; font-size:11px; letter-spacing:1.5px;
    text-transform:uppercase; line-height:1; box-shadow:0 0 14px rgba(255,122,24,.22) inset, 0 0 10px rgba(255,90,0,.15);
    transition: all .2s ease;
  }
  .rexbot-navbtn:hover { color:#fff3e7; border-color:var(--rb-orange); box-shadow:0 0 0 1px var(--rb-orange), 0 0 22px rgba(255,122,24,.5); }
  .rexbot-navbtn .rb-dot { width:7px; height:7px; border-radius:50%; background:var(--rb-orange); box-shadow:0 0 8px var(--rb-orange); animation: rb-pulse 2s ease-in-out infinite; }

  /* ---- panel ---- */
  .rexbot-panel {
    position:fixed; right:26px; bottom:26px; width:392px; max-width:calc(100vw - 32px);
    height:440px; max-height:calc(100vh - 52px); z-index:99999;
    display:flex; flex-direction:column; overflow:hidden;
    /* transparent glass — you see the world through it; heavy blur keeps text legible */
    background:
      linear-gradient(180deg, rgba(20,12,16,.50), rgba(8,5,8,.58)),
      repeating-linear-gradient(0deg, rgba(255,122,24,.05) 0 1px, transparent 1px 3px);
    border:1px solid var(--rb-edge); border-radius:16px;
    box-shadow: 0 0 0 1px rgba(255,122,24,.12), 0 24px 70px rgba(0,0,0,.55),
                0 0 60px rgba(255,90,0,.16), inset 0 0 40px rgba(255,90,0,.05);
    backdrop-filter: blur(20px) saturate(1.15); -webkit-backdrop-filter: blur(20px) saturate(1.15);
    transform: translateY(18px) scale(.96); opacity:0; pointer-events:none;
    transition: transform .32s cubic-bezier(.2,.9,.3,1.2), opacity .28s ease;
  }
  .rexbot-panel.rb-open { transform: translateY(0) scale(1); opacity:1; pointer-events:auto; }
  .rexbot-panel::before, .rexbot-panel::after {
    content:""; position:absolute; width:18px; height:18px; pointer-events:none; z-index:3;
    border:2px solid var(--rb-orange); filter: drop-shadow(0 0 4px var(--rb-orange));
  }
  .rexbot-panel::before { top:8px; left:8px; border-right:0; border-bottom:0; }
  .rexbot-panel::after  { bottom:8px; right:8px; border-left:0; border-top:0; }

  .rexbot-scan {
    position:absolute; inset:0; pointer-events:none; z-index:2; mix-blend-mode:screen; opacity:.5;
    background: linear-gradient(180deg, transparent, rgba(94,234,255,.06) 50%, transparent);
    height:60%; animation: rb-sweep 6s linear infinite;
  }

  .rexbot-head {
    position:relative; z-index:4; display:flex; align-items:center; gap:12px;
    padding:14px 16px; border-bottom:1px solid rgba(255,122,24,.28);
    background: linear-gradient(180deg, rgba(255,122,24,.10), transparent);
  }
  .rexbot-sigil { width:34px; height:34px; position:relative; flex:0 0 auto; }
  .rexbot-sigil .rb-core { position:absolute; inset:7px; border-radius:50%;
    background: radial-gradient(circle at 38% 34%, #fff6ec, var(--rb-hot) 40%, var(--rb-deep) 90%);
    box-shadow:0 0 12px rgba(255,122,24,.8); animation: rb-pulse 2.6s ease-in-out infinite; }
  .rexbot-sigil .rb-ring { position:absolute; inset:0; border-radius:50%; border:1.5px solid transparent;
    background: conic-gradient(from 0deg, var(--rb-orange), var(--rb-cyan), transparent 70%, var(--rb-orange)) border-box;
    -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
    animation: rb-spin 6s linear infinite; }
  .rexbot-sigil.rb-speaking .rb-core { animation: rb-speak .35s ease-in-out infinite; box-shadow:0 0 22px rgba(255,160,60,1); }
  .rexbot-sigil.rb-speaking .rb-ring { animation-duration:1.6s; }
  .rexbot-titles { flex:1 1 auto; min-width:0; }
  .rexbot-title { font-size:18px; font-weight:700; letter-spacing:7px; color:#fff3e7; line-height:1;
    text-shadow:0 0 10px rgba(255,122,24,.7), 0 0 22px rgba(255,90,0,.4); animation: rb-flicker 7s infinite; }
  .rexbot-status { display:flex; align-items:center; gap:6px; margin-top:5px; font-size:9px; letter-spacing:2.5px; color:var(--rb-cyan); }
  .rexbot-status .rb-dot { width:6px; height:6px; border-radius:50%; background:#46f08a; box-shadow:0 0 8px #46f08a; animation: rb-pulse 1.8s ease-in-out infinite; }
  .rexbot-hbtn { flex:0 0 auto; width:30px; height:30px; border:1px solid rgba(255,122,24,.4); border-radius:8px;
    background:transparent; color:var(--rb-hot); font-size:14px; cursor:pointer; line-height:1; transition: all .2s; display:grid; place-items:center; }
  .rexbot-hbtn:hover { background:rgba(255,122,24,.18); color:#fff; border-color:var(--rb-orange); }
  .rexbot-hbtn.rb-on { background:rgba(255,122,24,.22); color:#fff; border-color:var(--rb-orange); box-shadow:0 0 12px rgba(255,122,24,.5); }

  .rexbot-log { position:relative; z-index:4; flex:1 1 auto; overflow-y:auto; padding:16px 14px 6px;
    display:flex; flex-direction:column; gap:12px; scrollbar-width:thin; scrollbar-color: rgba(255,122,24,.5) transparent; }
  .rexbot-log::-webkit-scrollbar { width:7px; }
  .rexbot-log::-webkit-scrollbar-thumb { background:rgba(255,122,24,.4); border-radius:4px; }
  .rb-msg { max-width:86%; padding:9px 12px; font-size:12.5px; line-height:1.55; border-radius:11px; white-space:pre-wrap; word-wrap:break-word; }
  .rb-msg.rex { align-self:flex-start; color:var(--rb-ink);
    background: linear-gradient(180deg, rgba(255,122,24,.14), rgba(255,90,0,.05));
    border:1px solid rgba(255,122,24,.42); border-top-left-radius:3px;
    box-shadow: 0 0 16px rgba(255,90,0,.14), inset 0 0 14px rgba(255,122,24,.05); }
  .rb-msg.user { align-self:flex-end; color:#eaf7ff;
    background: linear-gradient(180deg, rgba(94,234,255,.12), rgba(94,234,255,.04));
    border:1px solid rgba(94,234,255,.4); border-top-right-radius:3px; box-shadow:0 0 14px rgba(94,234,255,.12); }
  .rb-think { align-self:flex-start; display:flex; gap:5px; padding:11px 13px; border-radius:11px; border-top-left-radius:3px;
    border:1px solid rgba(255,122,24,.35); background:rgba(255,122,24,.07); }
  .rb-think i { width:7px; height:7px; border-radius:50%; background:var(--rb-orange); box-shadow:0 0 8px var(--rb-orange); animation: rb-bounce 1.2s infinite; }
  .rb-think i:nth-child(2){ animation-delay:.18s; } .rb-think i:nth-child(3){ animation-delay:.36s; }

  /* suggested prompts + action buttons */
  .rb-chips { align-self:stretch; display:flex; flex-wrap:wrap; gap:7px; margin-top:2px; }
  .rb-chip {
    cursor:pointer; font-family:'Space Mono', monospace; font-size:11px; color:var(--rb-cyan);
    background:rgba(94,234,255,.07); border:1px solid rgba(94,234,255,.35); border-radius:999px; padding:7px 11px; transition:all .18s;
  }
  .rb-chip:hover { color:#fff; border-color:var(--rb-cyan); box-shadow:0 0 14px rgba(94,234,255,.35); background:rgba(94,234,255,.14); }
  .rb-actions { align-self:flex-start; display:flex; flex-wrap:wrap; gap:8px; max-width:90%; }
  .rb-action {
    cursor:pointer; font-family:'Space Mono', monospace; font-size:11px; letter-spacing:.5px; color:#1a0a02; font-weight:700;
    background: radial-gradient(circle at 40% 30%, var(--rb-hot), var(--rb-deep)); border:1px solid var(--rb-orange); border-radius:9px;
    padding:8px 12px; box-shadow:0 0 16px rgba(255,122,24,.45); transition:all .18s; display:inline-flex; align-items:center; gap:6px;
  }
  .rb-action::before { content:"▸"; font-weight:700; }
  .rb-action:hover { transform:translateY(-1px); box-shadow:0 0 26px rgba(255,122,24,.8); }

  /* boot sequence */
  .rexbot-boot { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column; justify-content:center; gap:9px;
    padding:0 30px; background:linear-gradient(180deg, rgba(8,5,8,.97), rgba(14,8,5,.99)); transition:opacity .5s ease; }
  .rexbot-boot.rb-gone { opacity:0; pointer-events:none; }
  .rb-boot-line { font-size:12px; letter-spacing:2px; color:var(--rb-hot); opacity:0; text-shadow:0 0 10px rgba(255,122,24,.5); }
  .rb-boot-line.on { opacity:1; }
  .rb-boot-line.cy { color:var(--rb-cyan); text-shadow:0 0 10px rgba(94,234,255,.6); font-size:13px; }
  .rb-boot-bar { height:2px; margin-top:6px; background:linear-gradient(90deg, var(--rb-orange), var(--rb-cyan)); width:0; box-shadow:0 0 10px var(--rb-orange); transition:width 1.1s ease; }

  .rexbot-foot { position:relative; z-index:4; padding:12px; border-top:1px solid rgba(255,122,24,.28);
    background: linear-gradient(0deg, rgba(255,122,24,.07), transparent); }
  .rexbot-inputwrap { display:flex; align-items:flex-end; gap:8px; }
  .rexbot-mic { flex:0 0 auto; width:44px; height:44px; border-radius:10px; cursor:pointer; border:1px solid rgba(255,122,24,.45);
    background:rgba(0,0,0,.35); color:var(--rb-hot); font-size:16px; line-height:1; transition:all .18s; display:grid; place-items:center; }
  .rexbot-mic:hover { border-color:var(--rb-orange); color:#fff; box-shadow:0 0 14px rgba(255,122,24,.4); }
  .rexbot-mic.rb-listening { color:#fff; border-color:#ff3b3b; background:rgba(255,59,59,.18); box-shadow:0 0 18px rgba(255,59,59,.6); animation: rb-pulse 1s ease-in-out infinite; }
  .rexbot-input { flex:1 1 auto; resize:none; max-height:90px; min-height:42px; padding:11px 12px;
    font-family:'Space Mono', monospace; font-size:12.5px; line-height:1.4; color:var(--rb-ink);
    background:rgba(0,0,0,.4); border:1px solid rgba(255,122,24,.38); border-radius:10px; outline:none; transition: all .2s; }
  .rexbot-input::placeholder { color:#7d6f63; }
  .rexbot-input:focus { border-color:var(--rb-orange); box-shadow:0 0 0 1px var(--rb-orange), 0 0 20px rgba(255,122,24,.3); }
  .rexbot-send { flex:0 0 auto; width:44px; height:44px; border-radius:10px; cursor:pointer; border:1px solid var(--rb-orange);
    background: radial-gradient(circle at 40% 35%, var(--rb-hot), var(--rb-deep)); color:#1a0a02; font-size:17px; line-height:1;
    box-shadow:0 0 18px rgba(255,122,24,.5); transition: all .18s; }
  .rexbot-send:hover { box-shadow:0 0 26px rgba(255,122,24,.85); transform:translateY(-1px); }
  .rexbot-send:disabled { opacity:.4; cursor:default; box-shadow:none; transform:none; }
  .rexbot-tag { margin-top:8px; text-align:center; font-size:8px; letter-spacing:2px; color:#6b5d50; }

  @keyframes rb-spin { to { transform: rotate(360deg); } }
  @keyframes rb-pulse { 0%,100%{ transform:scale(1); opacity:1; } 50%{ transform:scale(.9); opacity:.82; } }
  @keyframes rb-speak { 0%,100%{ transform:scale(1); } 50%{ transform:scale(.74); } }
  @keyframes rb-float { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-7px); } }
  @keyframes rb-sweep { 0%{ transform:translateY(-100%); } 100%{ transform:translateY(280%); } }
  @keyframes rb-bounce { 0%,100%{ transform:translateY(0); opacity:.6; } 50%{ transform:translateY(-5px); opacity:1; } }
  @keyframes rb-flicker { 0%,100%{opacity:1;} 92%{opacity:1;} 93%{opacity:.55;} 94%{opacity:1;} 97%{opacity:.7;} 98%{opacity:1;} }

  @media (max-width:520px) {
    /* shorter floating sheet, not fullscreen — you see the world through it */
    .rexbot-panel { right:10px; left:10px; bottom:84px; width:auto; height:66dvh; max-height:66dvh; border-radius:16px; }
    .rexbot-orb { right:16px; bottom:16px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .rexbot-orb, .rexbot-orb .rb-core, .rexbot-orb .rb-ring, .rexbot-scan, .rexbot-title, .rexbot-sigil * { animation:none !important; }
  }`;

  /* ---------- helpers ------------------------------------------------------ */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function injectStyle() {
    if (document.getElementById("rexbot-style")) return;
    var s = el("style"); s.id = "rexbot-style"; s.textContent = CSS;
    document.head.appendChild(s);
  }
  var TAG_RE = /\[\[GO:(\w+)\]\]/g;
  function stripTags(t) { return (t || "").replace(TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim(); }
  function liveText(t) { return (t || "").split("[[")[0].replace(/\s+$/, ""); } // hide tags + trailing partial while streaming
  function extractTags(t) {
    var out = [], m, seen = {};
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(t)) && out.length < 2) {
      var k = m[1].toLowerCase();
      if (ACTIONS[k] && !seen[k]) { seen[k] = 1; out.push(k); }
    }
    return out;
  }

  /* ---------- build -------------------------------------------------------- */
  function build() {
    injectStyle();
    var root = el("div", "rexbot");
    document.body.appendChild(root);

    // orb
    var orb = el("button", "rexbot-orb");
    orb.type = "button";
    orb.setAttribute("aria-label", "Open REX, the Rex Trueform oracle");
    orb.innerHTML =
      '<span class="rb-ring"></span><span class="rb-ring b"></span>' +
      '<span class="rb-core"></span><span class="rb-eye">REX</span>';
    root.appendChild(orb);

    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var hasTTS = ("speechSynthesis" in window);

    // panel
    var panel = el("div", "rexbot-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "REX oracle chat");
    panel.innerHTML =
      '<div class="rexbot-scan"></div>' +
      '<div class="rexbot-head">' +
        '<div class="rexbot-sigil"><span class="rb-ring"></span><span class="rb-core"></span></div>' +
        '<div class="rexbot-titles">' +
          '<div class="rexbot-title">' + CFG.title + '</div>' +
          '<div class="rexbot-status"><span class="rb-dot"></span>' + CFG.status + '</div>' +
        '</div>' +
        (hasTTS ? '<button class="rexbot-hbtn rexbot-voice" type="button" aria-label="Toggle REX voice" title="REX speaks">🔊</button>' : '') +
        '<button class="rexbot-hbtn rexbot-x" type="button" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="rexbot-log" id="rexbotLog" aria-live="polite"></div>' +
      '<div class="rexbot-foot">' +
        '<div class="rexbot-inputwrap">' +
          (hasSR ? '<button class="rexbot-mic" type="button" aria-label="Speak to REX" title="Speak to REX">🎙</button>' : '') +
          '<textarea class="rexbot-input" rows="1" placeholder="' + CFG.placeholder + '"></textarea>' +
          '<button class="rexbot-send" type="button" aria-label="Send">➤</button>' +
        '</div>' +
        '<div class="rexbot-tag">REX · THE REX TRUEFORM ORACLE</div>' +
      '</div>';
    root.appendChild(panel);

    var logEl   = panel.querySelector(".rexbot-log");
    var input   = panel.querySelector(".rexbot-input");
    var sendBtn = panel.querySelector(".rexbot-send");
    var closeBtn= panel.querySelector(".rexbot-x");
    var sigil   = panel.querySelector(".rexbot-sigil");
    var voiceBtn= panel.querySelector(".rexbot-voice");
    var micBtn  = panel.querySelector(".rexbot-mic");

    // nav launcher (optional, portable)
    var navBtn = null;
    var mount = CFG.navMount && document.querySelector(CFG.navMount);
    if (mount) {
      navBtn = el("button", "rexbot-navbtn");
      navBtn.type = "button";
      navBtn.setAttribute("aria-label", "Open REX, the Rex Trueform oracle");
      navBtn.innerHTML = '<span class="rb-dot"></span>REX';
      mount.appendChild(navBtn);
    }

    /* ---------- state ---------- */
    var history = [];
    var busy = false, greeted = false;
    var voiceOn = false;
    try { voiceOn = localStorage.getItem("rexbot_voice") === "1"; } catch (e) {}
    if (voiceBtn && voiceOn) voiceBtn.classList.add("rb-on");
    var audioCtx = null;

    /* ---------- voice: REX speaks ---------- */
    var chosenVoice = null;
    function pickVoice() {
      if (chosenVoice) return chosenVoice;
      var vs = (hasTTS && speechSynthesis.getVoices()) || [];
      if (!vs.length) return null;
      var prefer = ["Daniel", "Arthur", "Oliver", "Aaron", "Fred", "Rocko", "Reed", "Eddy", "Google UK English Male"];
      for (var i = 0; i < prefer.length; i++) {
        var v = vs.find(function (x) { return x.name.indexOf(prefer[i]) !== -1; });
        if (v) { chosenVoice = v; return v; }
      }
      // else: any English male-ish, else first
      chosenVoice = vs.find(function (x) { return /en[-_]/i.test(x.lang) && !/female|samantha|victoria|karen|moira|tessa/i.test(x.name); }) || vs[0];
      return chosenVoice;
    }
    function speak(text) {
      if (!voiceOn || !hasTTS || !text) return;
      try { speechSynthesis.cancel(); } catch (e) {}
      var parts = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
      parts.forEach(function (p, i) {
        p = p.trim(); if (!p) return;
        var u = new SpeechSynthesisUtterance(p);
        var v = pickVoice(); if (v) u.voice = v;
        u.rate = 0.86; u.pitch = 0.6; u.volume = 1;     // deep, slow, gravelled
        if (i === 0) u.onstart = function () { sigil.classList.add("rb-speaking"); };
        u.onend = function () { if (!speechSynthesis.speaking) sigil.classList.remove("rb-speaking"); };
        try { speechSynthesis.speak(u); } catch (e) {}
      });
    }
    if (hasTTS) {
      // voices populate async on some browsers
      speechSynthesis.onvoiceschanged = function () { chosenVoice = null; pickVoice(); };
    }
    if (voiceBtn) voiceBtn.addEventListener("click", function () {
      voiceOn = !voiceOn;
      voiceBtn.classList.toggle("rb-on", voiceOn);
      try { localStorage.setItem("rexbot_voice", voiceOn ? "1" : "0"); } catch (e) {}
      if (!voiceOn) { try { speechSynthesis.cancel(); } catch (e) {} sigil.classList.remove("rb-speaking"); }
    });

    /* ---------- voice: REX listens ---------- */
    function toggleMic() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR || busy) return;
      var rec = new SR();
      rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
      micBtn.classList.add("rb-listening");
      rec.onresult = function (e) {
        var t = "";
        for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        input.value = t; autosize();
      };
      rec.onerror = function () {};
      rec.onend = function () {
        micBtn.classList.remove("rb-listening");
        if (input.value.trim()) send();
      };
      try { rec.start(); } catch (e) { micBtn.classList.remove("rb-listening"); }
    }
    if (micBtn) micBtn.addEventListener("click", toggleMic);

    /* ---------- boot beeps ---------- */
    function beep(freq, t0, dur) {
      if (!audioCtx) return;
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t0 + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + t0); o.stop(audioCtx.currentTime + t0 + dur + 0.02);
    }

    /* ---------- rendering ---------- */
    function scroll() { logEl.scrollTop = logEl.scrollHeight; }
    function addMsg(who, text) {
      var m = el("div", "rb-msg " + who);
      m.textContent = text || "";
      logEl.appendChild(m); scroll();
      return m;
    }
    function typeInto(node, text) {
      var i = 0, step = Math.max(1, Math.round(text.length / 90));
      (function tick() {
        i = Math.min(text.length, i + step);
        node.textContent = text.slice(0, i); scroll();
        if (i < text.length) setTimeout(tick, 16);
      })();
    }
    function showThinking() {
      var t = el("div", "rb-think", "<i></i><i></i><i></i>");
      logEl.appendChild(t); scroll(); return t;
    }
    function renderActions(full) {
      var tags = extractTags(full);
      if (!tags.length) return;
      var row = el("div", "rb-actions");
      tags.forEach(function (k) {
        var b = el("button", "rb-action"); b.type = "button";
        b.textContent = ACTIONS[k].label;
        b.addEventListener("click", function () { close(); setTimeout(ACTIONS[k].run, 280); });
        row.appendChild(b);
      });
      logEl.appendChild(row); scroll();
    }
    function showChips() {
      if (!CFG.suggestions || !CFG.suggestions.length) return;
      var row = el("div", "rb-chips");
      CFG.suggestions.forEach(function (q) {
        var c = el("button", "rb-chip"); c.type = "button"; c.textContent = q;
        c.addEventListener("click", function () { row.remove(); input.value = q; send(); });
        row.appendChild(c);
      });
      logEl.appendChild(row); scroll();
    }
    function hideChips() { var c = logEl.querySelector(".rb-chips"); if (c) c.remove(); }

    /* ---------- streaming send ---------- */
    async function streamInto(makeNode) {
      var res = await fetch(CFG.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stream: true })
      });
      if (!res.ok || !res.body) throw new Error("no stream");
      var reader = res.body.getReader(), dec = new TextDecoder();
      var buf = "", full = "", node = null;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          var evt = buf.slice(0, idx); buf = buf.slice(idx + 2);
          var lines = evt.split("\n"), data = null;
          for (var i = 0; i < lines.length; i++) if (lines[i].indexOf("data:") === 0) data = lines[i].slice(5).trim();
          if (data == null) continue;
          var p; try { p = JSON.parse(data); } catch (e) { continue; }
          if (p.delta) {
            if (!node) node = makeNode();
            full += p.delta; node.textContent = liveText(full); scroll();
          }
        }
      }
      if (!full.trim()) throw new Error("empty");
      return { full: full, node: node };
    }

    async function nonStream() {
      var res = await fetch(CFG.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });
      var d = await res.json();
      return (d && d.reply) || "The archive is silent.";
    }

    async function send() {
      var text = input.value.trim();
      if (!text || busy) return;
      busy = true; sendBtn.disabled = true; hideChips();
      input.value = ""; autosize();
      addMsg("user", text);
      history.push({ role: "user", content: text });

      var think = showThinking();
      var node = null, full = "";
      try {
        var out = await streamInto(function () { if (think.parentNode) think.remove(); return addMsg("rex", ""); });
        node = out.node; full = out.full;
      } catch (e) {
        try {
          full = await nonStream();
          if (think.parentNode) think.remove();
          node = addMsg("rex", "");
        } catch (e2) {
          if (think.parentNode) think.remove();
          node = addMsg("rex", ""); full = "My signal to the deep archive was lost. Try once more.";
        }
      }
      if (think.parentNode) think.remove();
      var clean = stripTags(full);
      if (node) node.textContent = clean;
      history.push({ role: "assistant", content: clean });
      renderActions(full);
      speak(clean);
      busy = false; sendBtn.disabled = false; input.focus();
    }

    function autosize() {
      input.style.height = "auto";
      input.style.height = Math.min(90, input.scrollHeight) + "px";
    }

    /* ---------- boot / awaken sequence ---------- */
    function runBoot(done) {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var ov = el("div", "rexbot-boot");
      ov.innerHTML =
        '<div class="rb-boot-line" data-i="0">▸ ESTABLISHING LINK…</div>' +
        '<div class="rb-boot-line" data-i="1">▸ DECRYPTING ARCHIVE…</div>' +
        '<div class="rb-boot-line cy" data-i="2">◉ ORACLE ONLINE</div>' +
        '<div class="rb-boot-bar"></div>';
      panel.appendChild(ov);
      var lines = ov.querySelectorAll(".rb-boot-line");
      var bar = ov.querySelector(".rb-boot-bar");
      if (reduce) { ov.remove(); done(); return; }
      try { beep(420, 0, 0.12); beep(620, 0.18, 0.12); beep(880, 0.95, 0.22); } catch (e) {}
      setTimeout(function () { lines[0].classList.add("on"); bar.style.width = "40%"; }, 60);
      setTimeout(function () { lines[1].classList.add("on"); bar.style.width = "75%"; }, 420);
      setTimeout(function () { lines[2].classList.add("on"); bar.style.width = "100%"; }, 880);
      setTimeout(function () { ov.classList.add("rb-gone"); }, 1320);
      setTimeout(function () { ov.remove(); done(); }, 1820);
    }

    /* ---------- open / close ---------- */
    function open() {
      panel.classList.add("rb-open");
      orb.classList.add("rb-hidden");
      try { sessionStorage.setItem("rexbot_open", "1"); } catch (e) {}
      if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
      if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
      if (!greeted) {
        greeted = true;
        runBoot(function () {
          var g = addMsg("rex", ""); typeInto(g, CFG.greeting);
          speak(CFG.greeting);
          showChips();
          setTimeout(function () { input.focus(); }, 200);
        });
      } else {
        setTimeout(function () { input.focus(); }, 300);
      }
    }
    function close() {
      panel.classList.remove("rb-open");
      orb.classList.remove("rb-hidden");
      try { speechSynthesis.cancel(); } catch (e) {}
      sigil.classList.remove("rb-speaking");
      try { sessionStorage.setItem("rexbot_open", "0"); } catch (e) {}
    }

    /* ---------- events ---------- */
    orb.addEventListener("click", open);
    if (navBtn) navBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    sendBtn.addEventListener("click", send);
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("rb-open")) close();
    });

    try { if (sessionStorage.getItem("rexbot_open") === "1") open(); } catch (e) {}
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", build);
  else build();
})();

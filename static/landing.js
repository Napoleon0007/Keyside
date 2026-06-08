/* ============================================================
   Keyside — rolling 3D disc engine.
   Two mounts:
     • #hero        — orbit hero: logo centred, panels revolve (camera orbit)
     • #section-disc — navigator under Rex's World
   Self-contained, no modules. Additive: never touches world.js.
   ============================================================ */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Panels (mirror the filter bar) ------------------------------- */
  var PANELS = [
    { label: "Rex's World", kicker: "ENTER THE COSMOS", img: "/static/galaxies/andromeda.jpg", action: { type: "scroll", sel: "#section-world" } },
    { label: "Video",       kicker: "MOTION",            img: "/static/video-thumbs/clouds.jpg",   action: { type: "filter", val: "video" } },
    { label: "Short Docs",  kicker: "ARCHIVE",           img: "/static/video-thumbs/boer-war.jpg", action: { type: "filter", val: "edit" } },
    { label: "Images",      kicker: "STILLS",            img: "/static/galaxies/sombrero.jpg",     action: { type: "filter", val: "image" } },
    { label: "Music",       kicker: "SOUND",             music: true,                              action: { type: "filter", val: "music" } },
    { label: "Products",    kicker: "REX TRUEFORM",      img: "/static/products/rex-casino.webp",  action: { type: "scroll", sel: "#products" } }
  ];

  /* ---- Disc factory -------------------------------------------------- */
  function createDisc(cfg) {
    var section = document.querySelector(cfg.section);
    var ring    = document.querySelector(cfg.ring);
    var sky     = cfg.sky ? document.querySelector(cfg.sky) : null;
    if (!section || !ring) return;

    var N = PANELS.length, STEP = 360 / N, cards = [];
    var drift = cfg.autoRevolve ? -0.10 : -0.04;   // camera-orbit speed when idle

    function buildRing() {
      PANELS.forEach(function (p, i) {
        var card = document.createElement("div");
        card.className = "disc-card" + (p.music ? " is-music" : "");
        if (p.img) card.style.backgroundImage = "url('" + p.img + "')";
        card.innerHTML =
          '<span class="card-enter">Enter ▸</span>' +
          '<div class="card-label"><span class="card-kicker">' + p.kicker + "</span>" + p.label + "</div>";
        card.addEventListener("click", function () { onCardClick(i); });
        ring.appendChild(card);
        cards.push(card);
      });
      layout();
    }

    function layout() {
      var small = window.innerWidth < 760;
      var w = small ? Math.min(window.innerWidth * 0.58, 210) : (cfg.cardW || 250);
      var h = w * 1.42;
      var radius = Math.round((w / 2) / Math.tan(Math.PI / N) * (cfg.spread || 1.55));
      ring.style.setProperty("--card-w", w + "px");
      ring.style.setProperty("--card-h", h + "px");
      cards.forEach(function (card, i) {
        card.style.transform = "rotateY(" + (i * STEP) + "deg) translateZ(" + radius + "px)";
      });
    }

    var spin = 8, vel = 0, dragging = false, lastX = 0;
    var idleActive = !!cfg.autoRevolve, idleTimer = null, raf = null;

    function render() {
      ring.style.setProperty("--spin", spin.toFixed(2) + "deg");
      var front = ((Math.round(-spin / STEP) % N) + N) % N;
      cards.forEach(function (c, i) { c.classList.toggle("active", i === front); });
    }

    function tick() {
      if (!dragging) {
        spin += vel;
        vel *= 0.93;
        if (Math.abs(vel) < 0.02) {
          vel = 0;
          if (cfg.autoRevolve && idleActive) {
            spin += drift;                       // free continuous orbit
          } else {
            var target = Math.round(spin / STEP) * STEP;   // snap to a panel
            spin += (target - spin) * 0.12;
            if (Math.abs(target - spin) < 0.05) spin = target;
            if (idleActive) spin += drift;
          }
        }
      }
      render();
      raf = requestAnimationFrame(tick);
    }

    function wake() {
      idleActive = false;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { idleActive = true; }, cfg.autoRevolve ? 2200 : 3500);
    }

    function onDown(e) {
      dragging = true; vel = 0;
      lastX = (e.touches ? e.touches[0].clientX : e.clientX);
      if (ring.setPointerCapture && e.pointerId != null) { try { ring.setPointerCapture(e.pointerId); } catch (_) {} }
      wake();
    }
    function onMove(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var d = (x - lastX) * 0.35;
      lastX = x; spin += d; vel = d;
    }
    function onUp() { dragging = false; wake(); }
    function onWheel(e) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {   // horizontal gesture spins; vertical scrolls page
        e.preventDefault();
        vel += (e.deltaX > 0 ? 1 : -1) * 1.4;
        wake();
      }
    }

    function onCardClick(i) {
      var front = ((Math.round(-spin / STEP) % N) + N) % N;
      if (i !== front) {
        var diff = i - front;
        if (diff > N / 2) diff -= N;
        if (diff < -N / 2) diff += N;
        vel = 0; spin = -((front + diff) * STEP); wake();
        return;
      }
      var action = PANELS[i].action;
      if (action.type === "filter") {
        var btn = document.querySelector('.filter-btn[data-type="' + action.val + '"]');
        if (btn) btn.click();
        var content = document.getElementById("content");
        if (content) content.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (action.type === "scroll") {
        var el = document.querySelector(action.sel);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    /* ---- Deep-space backdrop --------------------------------------- */
    var skyRaf = null, skyOn = false, skyDraw = null;
    function startSky() {
      if (!sky || window.innerWidth < 760) return;   // skip the canvas on phones (perf)
      var ctx = sky.getContext("2d");
      var w, h, stars, t = 0;
      function size() {
        w = sky.width = section.clientWidth;
        h = sky.height = section.clientHeight;
        var count = Math.round((w * h) / 5200);
        stars = [];
        for (var i = 0; i < count; i++) {
          stars.push({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.8 + 0.2, tw: Math.random() * Math.PI * 2 });
        }
      }
      size();
      window.addEventListener("resize", size);
      skyDraw = function draw() {
        if (!skyOn) { skyRaf = null; return; }
        t += 0.01;
        ctx.clearRect(0, 0, w, h);
        var g1 = ctx.createRadialGradient(w * 0.32, h * 0.4, 0, w * 0.32, h * 0.4, w * 0.5);
        g1.addColorStop(0, "rgba(255,85,0,0.10)"); g1.addColorStop(1, "rgba(255,85,0,0)");
        ctx.fillStyle = g1; ctx.fillRect(0, 0, w, h);
        var g2 = ctx.createRadialGradient(w * 0.72, h * 0.65, 0, w * 0.72, h * 0.65, w * 0.45);
        g2.addColorStop(0, "rgba(255,120,20,0.11)"); g2.addColorStop(1, "rgba(255,120,20,0)");
        ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          s.x -= s.z * 0.18; if (s.x < 0) s.x = w;
          var a = 0.4 + 0.6 * Math.abs(Math.sin(s.tw + t * (0.4 + s.z)));
          ctx.globalAlpha = a * s.z; ctx.fillStyle = "#fff";
          ctx.fillRect(s.x, s.y, s.z * 1.6, s.z * 1.6);
        }
        ctx.globalAlpha = 1;
        skyRaf = requestAnimationFrame(draw);
      };
    }

    function setRunning(on) {
      if (on) {
        if (!raf) tick();
        if (sky && !skyOn) { skyOn = true; if (skyDraw) skyDraw(); }
      } else {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        skyOn = false;
      }
    }

    /* ---- Bind + boot ----------------------------------------------- */
    ring.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    section.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", layout);

    buildRing();
    startSky();
    wake();

    if ("IntersectionObserver" in window && !reduced) {
      new IntersectionObserver(function (entries) {
        setRunning(entries[0].isIntersecting);
      }, { threshold: 0.02 }).observe(section);
    } else {
      setRunning(true);
    }
  }

  /* ---- Mounts ------------------------------------------------------- */
  createDisc({ section: "#hero", ring: "#heroRing", sky: "#heroSky", autoRevolve: true, cardW: 230, spread: 1.7 });
})();

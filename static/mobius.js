// mobius.js — the hero navigator as a true Möbius strip.
// A continuous, single-sided neon ribbon twists and loops through itself in
// front of the Zuma backdrop, the six category thumbnails flowing along its
// surface. Drag to spin, idle auto-revolve; hovering a stretch of the band
// pops that category's label in 3D (no baked-on upside-down text) and clicking
// enters it. Self-contained + additive: if WebGL is missing it does nothing and
// the CSS card ring stays. Remove by deleting this file, its <canvas>/<script>
// tags in index.html and the .hero-mobius / .mobius-labels rules in landing.css.

import * as THREE from 'three';

// The six navigator panels — mirrors the hero card ring (label, kicker, art, action).
const PANELS = [
  { label: "Rex's World", kicker: 'ENTER THE COSMOS', img: '/static/galaxies/andromeda.jpg', tint: '#ff7a2d', action: { type: 'scroll', sel: '#section-world' } },
  { label: 'Video',       kicker: 'MOTION',           img: '/static/video-thumbs/clouds.jpg',  tint: '#ff8a3d', action: { type: 'filter', val: 'video' } },
  { label: 'Short Docs',  kicker: 'ARCHIVE',          img: '/static/video-thumbs/boer-war.jpg',tint: '#3da5ff', action: { type: 'filter', val: 'edit' } },
  { label: 'Images',      kicker: 'STILLS',           img: '/static/galaxies/sombrero.jpg',    tint: '#8a6cff', action: { type: 'filter', val: 'image' } },
  { label: 'Music',       kicker: 'SOUND',            img: null, music: true,                  tint: '#2ad1ff', action: { type: 'filter', val: 'music' } },
  { label: 'Products',    kicker: 'REX TRUEFORM',     img: '/static/products/rex-casino.webp', tint: '#ff5500', action: { type: 'scroll', sel: '#products' } },
];

(function () {
  const canvas  = document.getElementById('mobiusCanvas');
  const labels  = document.getElementById('mobiusLabels');
  const ring    = document.getElementById('heroRing');
  const hero    = document.getElementById('hero');
  if (!canvas || !hero) return;

  // WebGL gate — bail silently and leave the CSS card ring in place.
  try {
    const probe = document.createElement('canvas').getContext('webgl');
    if (!probe) return;
  } catch (e) { return; }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Geometry constants.
  const N = PANELS.length;
  const R = 116;           // loop radius
  const WIDTH = 40;        // half-width of the ribbon
  const SEG_U = 240;       // segments around the loop (smoothness)
  const SEG_V = 18;        // segments across the ribbon

  let renderer, scene, camera, root, spinner, band, edge, raycaster, ndc;
  let inited = false, running = false, raf = 0;

  function init() {
    inited = true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);
    camera.position.set(0, 0, 330);

    root = new THREE.Group();
    root.rotation.x = -0.92;        // tilt so the twist reads in 3D
    root.position.y = 32;           // ride high — top of the band just under the hero top
    scene.add(root);
    spinner = new THREE.Group();     // revolves around the loop axis
    root.add(spinner);

    // lights — warm Rex orange key, cool rim, soft fill.
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffb070, 1.15); key.position.set(120, 160, 220); scene.add(key);
    const rim = new THREE.DirectionalLight(0x4aa0ff, 0.8);  rim.position.set(-160, -80, -120); scene.add(rim);

    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();

    buildBand();
    buildEdge();

    bindControls();
    resize();
    window.addEventListener('resize', resize);

    if (ring) ring.style.display = 'none';   // retire the CSS card ring
    start();
  }

  // ── Möbius surface ──────────────────────────────────────────────────────────
  // x = (R + w·v·cos(u/2))·cos(u),  y = (…)·sin(u),  z = w·v·sin(u/2)
  // One half-twist over u: 0→2π means the band closes onto its own back.
  function buildBand() {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEG_U; i++) {
      const u = (i / SEG_U) * Math.PI * 2;
      const t = u / 2;                       // half-twist
      const cu = Math.cos(u), su = Math.sin(u), ct = Math.cos(t), st = Math.sin(t);
      for (let j = 0; j <= SEG_V; j++) {
        const v = (j / SEG_V - 0.5) * 2;     // -1 … 1 across the ribbon
        const rad = R + WIDTH * v * ct;
        pos.push(rad * cu, rad * su, WIDTH * v * st);
        uv.push(i / SEG_U, j / SEG_V);       // U around the loop, V across
      }
    }
    for (let i = 0; i < SEG_U; i++) {
      for (let j = 0; j < SEG_V; j++) {
        const a = i * (SEG_V + 1) + j, b = a + SEG_V + 1, c = a + 1, d = b + 1;
        idx.push(a, b, c, c, b, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const tex = buildTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55,
      side: THREE.DoubleSide, metalness: 0.15, roughness: 0.62,
    });
    band = new THREE.Mesh(geo, mat);
    spinner.add(band);
  }

  // The single Möbius edge traced as one closed neon tube (it loops twice
  // around before closing — the signature read of a Möbius strip).
  function buildEdge() {
    const pts = [];
    const STEPS = SEG_U * 2;
    for (let i = 0; i < STEPS; i++) {
      const u = (i / SEG_U) * Math.PI * 2;   // 0 … 4π
      const t = u / 2;
      const rad = R + WIDTH * Math.cos(t);   // outer edge (v = +1)
      pts.push(new THREE.Vector3(rad * Math.cos(u), rad * Math.sin(u), WIDTH * Math.sin(t)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, STEPS, 1.6, 8, true);
    edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff5500 }));
    spinner.add(edge);
  }

  // A long strip texture: six category cells tiled along U, each a cover-fit
  // thumbnail under a neon tint + divider. Labels live on hover, not baked in.
  function buildTexture() {
    const CELL = 320, H = 320, W = CELL * N;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 8;

    const paintCell = (i, img) => {
      const x0 = i * CELL, p = PANELS[i];
      g.save();
      g.beginPath(); g.rect(x0, 0, CELL, H); g.clip();
      if (img) {
        // full-colour thumbnail, cover-fit, no tint or vignette — let it pop.
        g.fillStyle = '#08040a'; g.fillRect(x0, 0, CELL, H);
        const s = Math.max(CELL / img.width, H / img.height);
        const w = img.width * s, h = img.height * s;
        g.drawImage(img, x0 + (CELL - w) / 2, (H - h) / 2, w, h);
      } else if (p.music) {
        // Music has no thumbnail — keep a branded gradient + note glyph.
        const grad = g.createLinearGradient(x0, 0, x0 + CELL, H);
        grad.addColorStop(0, '#1a0a02'); grad.addColorStop(.55, '#3a1402'); grad.addColorStop(1, '#ff5500');
        g.fillStyle = grad; g.fillRect(x0, 0, CELL, H);
        g.fillStyle = '#fff'; g.font = '150px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('♫', x0 + CELL / 2, H / 2);
      } else {
        g.fillStyle = '#08040a'; g.fillRect(x0, 0, CELL, H);
      }
      // thin neon divider between cells
      g.fillStyle = 'rgba(255,85,0,.55)'; g.fillRect(x0, 0, 2, H);
      g.restore();
      tex.needsUpdate = true;
    };

    PANELS.forEach((p, i) => {
      paintCell(i, null);
      if (p.img) {
        const im = new Image();
        im.onload = () => paintCell(i, im);
        im.onerror = () => {};
        im.src = p.img;
      }
    });
    return tex;
  }

  // ── Controls: drag-spin + inertia + idle revolve, hover/click via raycast ────
  let dragging = false, lastX = 0, downX = 0, downY = 0, moved = false, vel = 0;
  let idleTimer = null, idleActive = true;

  function bindControls() {
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; vel = 0;
      lastX = downX = e.clientX; downY = e.clientY;
      canvas.classList.add('is-grabbing');
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      wake();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lastX; lastX = e.clientX;
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
        vel = dx * 0.006;
        spinner.rotation.z += vel;
      } else {
        hoverAt(e);
      }
    });
    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('is-grabbing');
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) clickAt(e);
      wake();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { dragging = false; clearHover(); });
  }

  function wake() {
    idleActive = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleActive = true; }, 2600);
  }

  function setNDC(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  function pick(e) {
    setNDC(e);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(band, false)[0];
  }
  function cellOf(hit) {
    // uv.x runs 0..1 around the loop → six cells.
    let f = hit.uv.x % 1; if (f < 0) f += 1;
    return Math.min(N - 1, Math.floor(f * N));
  }

  let hoverCell = -1;
  function hoverAt(e) {
    const hit = pick(e);
    if (!hit) { clearHover(); return; }
    const i = cellOf(hit);
    canvas.style.cursor = 'pointer';
    if (i !== hoverCell) { hoverCell = i; showLabel(i); }
    moveLabel(e);
  }
  function clearHover() {
    hoverCell = -1; canvas.style.cursor = 'grab';
    const el = labels.firstChild; if (el) el.classList.remove('show');
  }
  function showLabel(i) {
    const p = PANELS[i];
    labels.innerHTML =
      '<div class="mobius-label show">' +
      '<span class="kicker">' + esc(p.kicker) + '</span>' +
      esc(p.label) + '<span class="enter">Enter ▸</span></div>';
  }
  function moveLabel(e) {
    const el = labels.firstChild; if (!el) return;
    const r = canvas.getBoundingClientRect();
    el.style.left = (e.clientX - r.left) + 'px';
    el.style.top  = (e.clientY - r.top) + 'px';
  }

  function clickAt(e) {
    const hit = pick(e); if (!hit) return;
    runAction(PANELS[cellOf(hit)].action);
  }
  function runAction(action) {
    if (action.type === 'filter') {
      const btn = document.querySelector('.filter-btn[data-type="' + action.val + '"]');
      if (btn) btn.click();
      const content = document.getElementById('content');
      if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action.type === 'scroll') {
      const el = document.querySelector(action.sel);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────────
  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop()  { running = false; cancelAnimationFrame(raf); }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!dragging) {
      if (Math.abs(vel) > 0.0002) { spinner.rotation.z += vel; vel *= 0.94; }
      else if (idleActive && !reduced) { spinner.rotation.z += 0.0016; }
    }
    if (band && !reduced) {
      // thumbnails stream around the loop like a film reel feeding the twist
      const m = band.material.map;
      m.offset.x = (m.offset.x + 0.0007) % 1;
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = hero.clientWidth || window.innerWidth;
    const h = hero.clientHeight || Math.round(window.innerHeight * 0.9);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Boot once visible; pause when the hero scrolls away.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const vis = entries[0].isIntersecting;
      if (vis) { if (!inited) init(); else start(); }
      else if (inited) stop();
    }, { threshold: 0.05 }).observe(hero);
  } else {
    init();
  }
})();

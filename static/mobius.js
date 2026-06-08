// mobius.js — the hero navigator as a true Möbius strip.
// A continuous, single-sided neon ribbon twists and loops through itself in
// front of the Zuma backdrop, the six category thumbnails flowing along its
// surface. Drag to spin, idle auto-revolve; hovering a stretch of the band
// pops that category's label in 3D (no baked-on upside-down text) and clicking
// enters it. Self-contained + additive: if WebGL is missing it does nothing and
// the CSS card ring stays. Remove by deleting this file, its <canvas>/<script>
// tags in index.html and the .hero-mobius / .mobius-labels rules in landing.css.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The six navigator panels — mirrors the hero card ring (label, kicker, art, action).
const PANELS = [
  { label: "Rex's World", kicker: 'ENTER THE COSMOS', img: '/static/galaxies/andromeda.jpg', tint: '#ff7a2d', action: { type: 'scroll', sel: '#section-world' } },
  { label: 'Video',       kicker: 'MOTION',           img: '/static/video-thumbs/clouds.jpg',  tint: '#ff8a3d', action: { type: 'filter', val: 'video' } },
  { label: 'Short Docs',  kicker: 'ARCHIVE',          img: '/static/video-thumbs/boer-commando.jpg', tint: '#3da5ff', action: { type: 'filter', val: 'edit' } },
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
  const R = 158;           // loop radius — big, frames the title in its gap
  const WIDTH = 34;        // half-width of the ribbon — thick, so the images read clearly (it's a feature)
  const SEG_U = 260;       // segments around the loop (smoothness)
  const SEG_V = 16;        // segments across the ribbon

  let renderer, scene, camera, root, spinner, band, edge, raycaster, ndc, edgeCurve, bead;
  let inited = false, running = false, raf = 0;
  let lastHoverU = -1, hoverActive = false, edgeS = 0;

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
    camera.position.set(0, 0, 385);

    root = new THREE.Group();
    root.rotation.x = -0.78;        // less edge-on → you see more of the band's broad face
    root.position.y = 58;           // lifted up; the title sits in the loop's gap
    scene.add(root);
    spinner = new THREE.Group();     // revolves around the loop axis
    root.add(spinner);

    // lights — warm Rex orange key, cool rim, soft fill.
    // neutral white light so the thumbnails stay true-colour (no tint filtering them)
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(120, 160, 220); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(-160, -80, -120); scene.add(rim);

    // environment — gives the glossy/metal surface something to reflect.
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch (e) { /* gloss still works off the direct lights */ }

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
    const mat = new THREE.MeshPhysicalMaterial({
      // matte + self-lit so the thumbnails read clear and true — no gloss, no
      // iridescence, no reflections filtering the images.
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.65,
      side: THREE.DoubleSide, metalness: 0.0, roughness: 0.85,
      clearcoat: 0.0, iridescence: 0.0, envMapIntensity: 0.0,
    });
    // tactile hover — bulge the touched spot outward along its normal and make
    // it glow. Injected into the physical shader so it's GPU-cheap.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHoverU = { value: -1 };
      shader.uniforms.uHoverAmt = { value: 0 };
      shader.uniforms.uLift = { value: 16 };
      shader.vertexShader = 'uniform float uHoverU, uHoverAmt, uLift;\nvarying float vHover;\nvarying float vViewZ;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float du = uv.x - uHoverU; du = du - floor(du + 0.5);   // wrap around the loop
         float g = exp(-du * du / 0.0022) * uHoverAmt;
         vHover = g;
         transformed += normalize(objectNormal) * g * uLift;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n         vViewZ = -mvPosition.z;'
      );
      shader.fragmentShader = 'varying float vHover;\nvarying float vViewZ;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += vec3(1.0, 0.55, 0.18) * vHover * 1.8;`
      );
      // depth fade — the far side of the loop recedes so the front reads clear
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float df = smoothstep(470.0, 210.0, vViewZ);
         gl_FragColor.rgb *= mix(0.32, 1.0, df);`
      );
      mat.userData.shader = shader;
    };
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
    edgeCurve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(edgeCurve, STEPS, 1.4, 8, true);
    edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff5500 }));
    spinner.add(edge);

    // a bright sparkle that rides the single Möbius edge round and round
    bead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: beadSprite(), color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    bead.scale.set(11, 11, 1);
    spinner.add(bead);
  }

  function beadSprite() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.3, 'rgba(255,210,150,0.9)');
    rg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
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
    // the texture scrolls (flowing imagery), so the visible thumbnail at this
    // spot is the geometry uv plus the current scroll offset.
    const off = band ? band.material.map.offset.x : 0;
    let f = (hit.uv.x + off) % 1; if (f < 0) f += 1;
    return Math.min(N - 1, Math.floor(f * N));
  }

  let hoverCell = -1;
  function hoverAt(e) {
    const hit = pick(e);
    if (!hit) { clearHover(); return; }
    const i = cellOf(hit);
    canvas.style.cursor = 'pointer';
    lastHoverU = hit.uv.x;        // bulge follows the exact spot you touch
    hoverActive = true;
    if (i !== hoverCell) { hoverCell = i; showLabel(i); }
    moveLabel(e);
  }
  function clearHover() {
    hoverCell = -1; hoverActive = false; canvas.style.cursor = 'grab';
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
    // tactile hover: ease the bulge/glow toward the touched spot
    const sh = band && band.material.userData.shader;
    if (sh) {
      const tgt = hoverActive ? 1 : 0;
      sh.uniforms.uHoverAmt.value += (tgt - sh.uniforms.uHoverAmt.value) * 0.15;
      if (hoverActive) sh.uniforms.uHoverU.value = lastHoverU;
    }
    // sparkle riding the single Möbius edge
    if (bead && edgeCurve) {
      edgeS = (edgeS + (reduced ? 0 : 0.0011)) % 1;
      bead.position.copy(edgeCurve.getPointAt(edgeS));
      const tw = 0.8 + 0.35 * Math.sin(edgeS * 44.0);
      bead.scale.set(11 * tw, 11 * tw, 1);
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = hero.clientWidth || window.innerWidth;
    const h = hero.clientHeight || Math.round(window.innerHeight * 0.9);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    const tanHalf = Math.tan((camera.fov * Math.PI / 180) / 2);
    const outerR = R + WIDTH;
    if (aspect < 1.05) {
      // phone / portrait: make it BIG — fill the width (a little side-spill is fine)
      // and lift it so REX TRUEFORM sits in the loop's gap (~a third down the screen).
      camera.position.z = outerR / (1.2 * aspect * tanHalf);
      root.position.y = 0.40 * tanHalf * camera.position.z;
    } else {
      camera.position.z = 385;     // desktop unchanged
      root.position.y = 58;
    }
    camera.updateProjectionMatrix();
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

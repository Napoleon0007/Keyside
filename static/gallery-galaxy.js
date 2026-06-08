// gallery-galaxy.js — "Media Galaxy" view-mode for the gallery.
// Every media item (video / image / short doc / music) floats as a neon panel in
// 3D space. Drag to orbit, scroll to zoom, hover for the title, click to fly the
// camera to it and open it. A toggle in the filter bar flips between the normal
// coverflow ("Flow") and this Galaxy. Self-contained + lazy: nothing spins up
// until you switch it on. Remove by deleting this file, gallery-galaxy.css and
// their tags in index.html.

import * as THREE from 'three';

const TYPE_COLOR = { video: '#ff8a3d', edit: '#3da5ff', image: '#8a6cff', music: '#2ad1ff' };

(function () {
  const filterBar = document.getElementById('filterBar');
  const content   = document.getElementById('content');
  if (!filterBar || !content) return;

  // WebGL support gate — if it fails, never show the toggle (Flow stays default).
  try {
    const t = document.createElement('canvas').getContext('webgl');
    if (!t) return;
  } catch (e) { return; }

  // ── Toggle button (lives in the filter bar) ─────────────────────────────────
  const toggle = document.createElement('button');
  toggle.className = 'galaxy-toggle';
  toggle.type = 'button';
  toggle.textContent = '✦ Galaxy';
  toggle.setAttribute('aria-pressed', 'false');
  filterBar.appendChild(toggle);

  // ── Galaxy stage (inserted right after the gallery content) ──────────────────
  const section = document.createElement('section');
  section.id = 'section-galaxy';
  section.style.display = 'none';
  section.innerHTML =
    '<canvas id="galaxyCanvas"></canvas>' +
    '<div id="galaxyLabels"></div>' +
    '<div class="galaxy-hint">drag to orbit · pinch / scroll to pull the galaxy into a planet · tap a panel to open</div>' +
    '<div class="galaxy-loading">summoning the galaxy…</div>';
  content.parentNode.insertBefore(section, content.nextSibling);

  const canvas  = section.querySelector('#galaxyCanvas');
  const labels  = section.querySelector('#galaxyLabels');
  const loading = section.querySelector('.galaxy-loading');

  let active = false, inited = false, raf = 0, running = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_MOBILE = window.matchMedia('(max-width: 768px)').matches;

  // Zoom drives a morph between two layouts: a tight image-planet (spread→0, camera close)
  // and a wide dispersed galaxy (spread→1, camera far). You control how far they fly out.
  const PLANET_R = 120;          // radius of the clustered image-planet
  const PLANET_Z = 235;          // camera distance fully zoomed in (planet fills the view)
  const GALAXY_Z = 1020;         // camera distance fully zoomed out (whole galaxy in view)
  let spread = 0.82, spreadTarget = 0.82;   // start mostly-galaxy

  toggle.addEventListener('click', () => setActive(!active));

  function setActive(on) {
    active = on;
    section.style.display = on ? 'block' : 'none';
    content.style.display = on ? 'none' : '';
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? '▦ Flow' : '✦ Galaxy';
    if (on) {
      if (!inited) init();
      else { resize(); start(); }
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      stop();
    }
  }

  // ── Three.js scene ──────────────────────────────────────────────────────────
  let renderer, scene, camera, root, sprites = [], raycaster, ndc;

  async function init() {
    inited = true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { fail(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.set(0, 0, PLANET_Z + (GALAXY_Z - PLANET_Z) * spread);
    root = new THREE.Group();
    scene.add(root);

    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();

    // starfield backdrop
    scene.add(makeStars());

    let items = [];
    try {
      const data = await fetch('/api/videos').then(r => r.json());
      items = (Array.isArray(data) ? data : (data.videos || data.items || []))
        .filter(it => TYPE_COLOR[it.type]);
    } catch (e) { /* empty galaxy still renders */ }

    buildNodes(items);
    loading.style.display = 'none';

    bindControls();
    resize();
    window.addEventListener('resize', resize);
    start();
  }

  function fail() {
    loading.textContent = '3D unavailable on this device';
  }

  function buildNodes(items) {
    const N = Math.max(items.length, 1);
    const golden = Math.PI * (3 - Math.sqrt(5));
    items.forEach((item, i) => {
      // even direction on a sphere (fibonacci) — shared by both layouts
      const yy = 1 - (i / Math.max(N - 1, 1)) * 2;            // -1 … 1
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = golden * i;
      const dir = new THREE.Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr);

      // PLANET: tight uniform sphere — zoomed in, all the images form one ball
      const planetPos = dir.clone().multiplyScalar(PLANET_R);

      // GALAXY: thrown out to its own slot — varied radius + jitter, flattened into a disc
      const rad = 360 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 560;   // 360 … 920, each its own distance
      const jit = (n) => Math.sin(i * 97.13 + n) * 64;
      const galaxyPos = new THREE.Vector3(
        dir.x * rad + jit(1),
        dir.y * rad * 0.5 + jit(2),                          // squash Y → galaxy-disc feel
        dir.z * rad + jit(3),
      );

      const color = TYPE_COLOR[item.type] || '#5eeaff';
      const thumb = item.thumb || (item.type === 'image' ? item.src : '');
      const glyph = item.type === 'music' ? '♫' : '';
      const mat = new THREE.SpriteMaterial({
        map: panelTexture(thumb, color, glyph), transparent: true, depthTest: true, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const S = 52;
      sp.position.copy(galaxyPos);                            // start spread out as a galaxy
      sp.userData = { item, base: S, color, planetPos, galaxyPos, hover: 0, targetOpacity: 1 };
      root.add(sp);
      sprites.push(sp);
    });
  }

  // ── Controls: drag-orbit + inertia + idle spin + scroll/pinch zoom-morph ─────
  let dragging = false, lastX = 0, lastY = 0, velX = 0, velY = 0, downX = 0, downY = 0, moved = false;
  let focusing = null, opened = false, restore = false;
  const pointers = new Map();           // active touches, for pinch
  let pinchPrev = 0;

  function bindControls() {
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) { dragging = false; pinchPrev = pointerSpread(); return; }
      dragging = true; moved = false;
      lastX = downX = e.clientX; lastY = downY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {                       // pinch → morph planet↔galaxy
        const d = pointerSpread();
        if (pinchPrev) spreadTarget = clamp(spreadTarget - (d - pinchPrev) * 0.004, 0, 1);  // fingers apart → zoom in → planet
        pinchPrev = d;
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
        velY = dx * 0.005; velX = dy * 0.005;
        root.rotation.y += velY;
        root.rotation.x = clamp(root.rotation.x + velX, -1.2, 1.2);
      } else {
        hoverAt(e);
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchPrev = 0;
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) clickAt(e);     // a tap, not a drag → select
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', (e) => { pointers.delete(e.pointerId); dragging = false; clearHover(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      spreadTarget = clamp(spreadTarget + e.deltaY * 0.0011, 0, 1);   // scroll out → galaxy, in → planet
    }, { passive: false });
  }

  function pointerSpread() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function setNDC(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  function pick(e) {
    setNDC(e);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(sprites, false)[0];
  }

  let hovered = null;
  function hoverAt(e) {
    const hit = pick(e);
    const sp = hit ? hit.object : null;
    if (sp === hovered) { if (sp) moveLabel(sp, e); return; }
    hovered = sp;
    canvas.style.cursor = sp ? 'pointer' : 'grab';
    if (sp) showLabel(sp, e); else clearHover();
  }
  function clearHover() { hovered = null; labels.innerHTML = ''; }

  function showLabel(sp, e) {
    labels.innerHTML = '<div class="galaxy-label" style="border-color:' + sp.userData.color + '">' +
      escapeHtml(sp.userData.item.title || '') + '</div>';
    moveLabel(sp, e);
  }
  function moveLabel(sp, e) {
    const el = labels.firstChild; if (!el) return;
    const r = canvas.getBoundingClientRect();
    el.style.left = (e.clientX - r.left) + 'px';
    el.style.top  = (e.clientY - r.top) + 'px';
  }

  function clickAt(e) {
    const hit = pick(e); if (!hit) return;
    focusOn(hit.object);
  }

  function focusOn(sp) {
    const wp = new THREE.Vector3(); sp.getWorldPosition(wp);
    const from = wp.clone().normalize();
    const to = new THREE.Vector3(0, 0, 1);                  // toward the camera
    const qDelta = new THREE.Quaternion().setFromUnitVectors(from, to);
    focusing = { sp, quat: qDelta.multiply(root.quaternion.clone()) };
    opened = false; restore = false;
    sprites.forEach(s => s.userData.targetOpacity = (s === sp ? 1 : 0.12));
  }

  function resetFocus() {
    focusing = null; restore = true;
    sprites.forEach(s => s.userData.targetOpacity = 1);
  }

  // ── Loop ────────────────────────────────────────────────────────────────────
  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop()  { running = false; cancelAnimationFrame(raf); }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);

    if (focusing) {
      root.quaternion.slerp(focusing.quat, 0.12);
      if (!opened && root.quaternion.angleTo(focusing.quat) < 0.05) {
        opened = true;
        const item = focusing.sp.userData.item;
        if (window.openModal) window.openModal(item);
        setTimeout(resetFocus, 120);                  // snap back behind the modal
      }
    } else if (!dragging && !restore && !reduced) {
      root.rotation.y += 0.0011;                       // idle drift
      velY *= 0.94; velX *= 0.94;
      root.rotation.y += velY; root.rotation.x = clamp(root.rotation.x + velX, -1.2, 1.2);
    }
    restore = false;

    // zoom morph: spread 0 = clustered planet (camera close), 1 = dispersed galaxy (far)
    spread += (spreadTarget - spread) * 0.09;
    camera.position.z = PLANET_Z + (GALAXY_Z - PLANET_Z) * spread;
    const planetK = 0.55, galaxyK = 1.0;                 // panels are smaller when packed into the ball

    // morph each panel between its planet slot and its galaxy slot; fold in hover pop
    sprites.forEach(s => {
      const u = s.userData;
      _morph.copy(u.planetPos).lerp(u.galaxyPos, spread);
      s.position.copy(_morph);
      u.hover += (((s === hovered) ? 1 : 0) - u.hover) * 0.2;
      const k = (planetK + (galaxyK - planetK) * spread) * (1 + u.hover * 0.28);
      s.scale.set(u.base * 1.78 * k, u.base * k, 1);
      s.material.opacity += (u.targetOpacity - s.material.opacity) * 0.12;
    });

    renderer.render(scene, camera);
  }
  const _morph = new THREE.Vector3();

  function resize() {
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || Math.round(window.innerHeight * 0.88);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function makeStars() {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 1400 + Math.random() * 1600;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7da8ff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.55 }));
  }

  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // A 16:9 neon panel: thumbnail (cover) inside a glowing rounded border + corner ticks.
  function panelTexture(url, color, glyph) {
    const W = IS_MOBILE ? 320 : 512, H = IS_MOBILE ? 180 : 288, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const paint = (img) => {
      g.clearRect(0, 0, W, H);
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#0a0f1a'); grad.addColorStop(1, '#05070d');
      roundRectPath(g, 6, 6, W - 12, H - 12, 16); g.fillStyle = grad; g.fill();
      if (img) {
        g.save(); roundRectPath(g, 10, 10, W - 20, H - 20, 13); g.clip();
        const s = Math.max((W - 20) / img.width, (H - 20) / img.height);
        const w = img.width * s, h = img.height * s;
        g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        g.restore();
      } else if (glyph) {
        g.fillStyle = color; g.font = '120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(glyph, W / 2, H / 2 + 6);
      }
      g.lineWidth = 4; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 18;
      roundRectPath(g, 10, 10, W - 20, H - 20, 13); g.stroke();
      g.shadowBlur = 0;
      // corner ticks
      g.strokeStyle = color; g.lineWidth = 3;
      const t = 22, m = 18;
      const corner = (cx, cy, sx, sy) => { g.beginPath(); g.moveTo(cx, cy + sy * t); g.lineTo(cx, cy); g.lineTo(cx + sx * t, cy); g.stroke(); };
      corner(m, m, 1, 1); corner(W - m, m, -1, 1); corner(m, H - m, 1, -1); corner(W - m, H - m, -1, -1);
      tex.needsUpdate = true;
    };
    if (url) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => paint(img); img.onerror = () => paint(null); img.src = url;
    } else paint(null);
    return tex;
  }
})();

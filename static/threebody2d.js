// threebody2d.js — no-WebGL fallback for the Three-Body Problem.
// Plain Canvas2D: same physics, presets, controls and feel as the 3D version, so
// it works in any browser even when WebGL is unavailable. Top-down 2D view (the
// classic periodic solutions are planar, so they look perfect here). Loaded by
// three_body.html only when WebGL can't start.

(() => {
  'use strict';
  const canvas = document.getElementById('sim');
  const ctx = canvas && canvas.getContext('2d');
  if (!ctx) { const f = document.getElementById('glfail'); if (f) f.removeAttribute('hidden'); return; }
  const f = document.getElementById('glfail'); if (f) f.setAttribute('hidden', '');

  const COLORS = ['#ff5500', '#33b6ff', '#b06bff'];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  window.addEventListener('resize', resize);

  const cam = { cx: 0, cy: 0, scale: 150, follow: true };
  const toS = (x, y) => [(x - cam.cx) * cam.scale + W / 2, (y - cam.cy) * cam.scale + H / 2];
  const toW = (sx, sy) => [(sx - W / 2) / cam.scale + cam.cx, (sy - H / 2) / cam.scale + cam.cy];

  let G = 1, softening = 0.03, speed = 0.4, showTrails = true, showGrid = true;
  let mode = 'setup', manualEdited = false, currentPreset = 'figure-8';
  let bodies = [];
  const TRAIL_MAX = 1200, STAR_MASS = 5.5;
  const visR = (m) => Math.max(0.16, Math.cbrt(m) * 0.18);

  function body(x, y, vx, vy, m, i) { return { x, y, vx, vy, m, color: COLORS[i], trail: [] }; }

  // ── presets (the symmetric infinite family + free-form) ─────────────────────
  function symmetric(p1, p2) { G = 1; softening = 0; bodies = [body(-1, 0, p1, p2, 1, 0), body(1, 0, p1, p2, 1, 1), body(0, 0, -2 * p1, -2 * p2, 1, 2)]; cam.scale = 170; }
  const SYM = {
    'figure-8': [0.3471128135672417, 0.532726851767674], 'butterfly': [0.30689, 0.12551], 'butterfly-2': [0.39295, 0.09758],
    'bumblebee': [0.18428, 0.58719], 'moth': [0.46444, 0.39606], 'moth-2': [0.43917, 0.45297], 'goggles': [0.08330, 0.12789],
    'dragonfly': [0.08058, 0.58884], 'yin-yang': [0.51394, 0.30474], 'yarn': [0.55906, 0.34919],
  };
  const PRESETS = {
    'orbit': () => { G = 1; softening = 0.02; bodies = [body(0, 0, 0, 0, 12, 0), body(1.1, 0, 0, 3.3, 1, 1), body(-1.7, 0, 0, -2.6, 1, 2)]; cam.scale = 120; },
    'chaos': () => { G = 1; softening = 0.03; bodies = [body(-1, 0.3, 0.2, 0.25, 4, 0), body(1, 0, -0.1, -0.35, 4, 1), body(0.1, -1, 0.05, 0.15, 4, 2)]; cam.scale = 120; },
    'random': () => { G = 1; softening = 0.03; const r = () => Math.random() * 2 - 1; bodies = [0, 1, 2].map(i => body(r() * 1.2, r() * 1.2, r() * 0.6, r() * 0.6, 2 + Math.random() * 6, i)); cam.scale = 120; },
  };
  function loadPreset(name) {
    if (name === 'explore') symmetric(+$('vx').value, +$('vy').value);
    else if (SYM[name]) { symmetric(SYM[name][0], SYM[name][1]); if ($('vx')) { $('vx').value = SYM[name][0]; $('vy').value = SYM[name][1]; readout(); } }
    else PRESETS[name]();
    mode = 'setup'; cam.cx = 0; cam.cy = 0; cam.follow = true; if ($('follow')) $('follow').checked = true;
    bodies.forEach(b => b.trail.length = 0); updateRun();
  }

  // ── physics ──────────────────────────────────────────────────────────────────
  const ax = [0, 0, 0], ay = [0, 0, 0];
  function accel() {
    for (let i = 0; i < 3; i++) { ax[i] = 0; ay[i] = 0; }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === j) continue; const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + softening * softening, inv = G * bodies[j].m / (r2 * Math.sqrt(r2));
      ax[i] += inv * dx; ay[i] += inv * dy;
    }
  }
  function integrate(dt) {
    accel(); for (let i = 0; i < 3; i++) { const b = bodies[i]; b.vx += 0.5 * dt * ax[i]; b.vy += 0.5 * dt * ay[i]; b.x += dt * b.vx; b.y += dt * b.vy; }
    accel(); for (let i = 0; i < 3; i++) { bodies[i].vx += 0.5 * dt * ax[i]; bodies[i].vy += 0.5 * dt * ay[i]; }
  }
  function autoOrbit() {
    let cx = 0, cy = 0, M = 0; bodies.forEach(b => { cx += b.x * b.m; cy += b.y * b.m; M += b.m; }); cx /= M; cy /= M;
    bodies.forEach(b => {
      const rx = b.x - cx, ry = b.y - cy, d = Math.max(Math.hypot(rx, ry), 0.25);
      const s = Math.sqrt(G * M / d) * 0.55; b.vx = -ry / d * s; b.vy = rx / d * s;
    });
    let px = 0, py = 0; bodies.forEach(b => { px += b.vx * b.m; py += b.vy * b.m; }); px /= M; py /= M;
    bodies.forEach(b => { b.vx -= px; b.vy -= py; });
  }

  function autoFit() {
    if (!cam.follow) return;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    bodies.forEach(b => { minx = Math.min(minx, b.x); maxx = Math.max(maxx, b.x); miny = Math.min(miny, b.y); maxy = Math.max(maxy, b.y); });
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, sx = Math.max(maxx - minx, 0.6), sy = Math.max(maxy - miny, 0.6);
    const ts = Math.max(20, Math.min(420, Math.min(W / (sx * 1.7), H / (sy * 1.7))));
    cam.cx += (cx - cam.cx) * 0.05; cam.cy += (cy - cam.cy) * 0.05; cam.scale += (ts - cam.scale) * 0.05;
  }

  // ── stars ──────────────────────────────────────────────────────────────────────
  const stars = []; for (let i = 0; i < 220; i++) stars.push([Math.random(), Math.random(), Math.random() * 0.6 + 0.2, Math.random() * 6.28]);

  function withA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

  // ── render ───────────────────────────────────────────────────────────────────
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    // starfield
    for (const s of stars) { const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + s[3]); ctx.globalAlpha = s[2] * (0.45 + tw * 0.4); ctx.fillStyle = '#cfe3ff'; ctx.fillRect(s[0] * W, s[1] * H, 1.6, 1.6); }
    ctx.globalAlpha = 1;

    if (showGrid) drawGrid();

    ctx.globalCompositeOperation = 'lighter';
    if (showTrails) for (const b of bodies) {
      const tr = b.trail; if (tr.length < 2) continue; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let k = 1; k < tr.length; k++) { const a = (k / tr.length) * 0.8; const p0 = toS(tr[k - 1][0], tr[k - 1][1]), p1 = toS(tr[k][0], tr[k][1]); ctx.strokeStyle = withA(b.color, a); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
    }
    for (const b of bodies) {
      const [sx, sy] = toS(b.x, b.y), r = Math.max(5, visR(b.m) * cam.scale), star = b.m >= STAR_MASS;
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * (star ? 5 : 3.2));
      gr.addColorStop(0, withA(star ? '#ffd28a' : b.color, star ? 0.8 : 0.55)); gr.addColorStop(1, withA(star ? '#ffb060' : b.color, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, r * (star ? 5 : 3.2), 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of bodies) {
      const [sx, sy] = toS(b.x, b.y), r = Math.max(5, visR(b.m) * cam.scale), star = b.m >= STAR_MASS;
      ctx.fillStyle = star ? '#ffcf8a' : b.color; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.34, 0, 6.283); ctx.fill();
    }
  }

  // 2D "gravity well" grid: vertices pulled toward each mass → bending curvature.
  function drawGrid() {
    const half = 11, seg = 26, step = (half * 2) / seg;
    const P = (gx, gy) => {                       // world grid point, displaced toward masses
      let dx = 0, dy = 0;
      for (const b of bodies) { const rx = b.x - gx, ry = b.y - gy, d2 = rx * rx + ry * ry + 0.25; const w = Math.min(0.5 * b.m / d2, 1.4); dx += rx * w; dy += ry * w; }
      return toS(gx + dx, gy + dy);
    };
    ctx.strokeStyle = withA('#2f6bff', 0.4); ctx.lineWidth = 1;
    for (let i = 0; i <= seg; i++) {
      ctx.beginPath(); for (let j = 0; j <= seg; j++) { const p = P(-half + i * step, -half + j * step); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.stroke();
      ctx.beginPath(); for (let j = 0; j <= seg; j++) { const p = P(-half + j * step, -half + i * step); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.stroke();
    }
  }

  // ── loop ──────────────────────────────────────────────────────────────────────
  let t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    if (mode === 'running') {
      const dt = 0.001, sub = Math.max(1, Math.round(speed * 12));
      for (let s = 0; s < sub; s++) { integrate(dt); for (const b of bodies) { b.trail.push([b.x, b.y]); if (b.trail.length > TRAIL_MAX) b.trail.shift(); } }
    }
    autoFit(); draw(reduced ? 0 : t);
  }

  // ── interaction ──────────────────────────────────────────────────────────────
  let drag = null, panning = false, lx = 0, ly = 0;
  function hit(sx, sy) { for (const b of bodies) { const [bx, by] = toS(b.x, b.y); if (Math.hypot(sx - bx, sy - by) < Math.max(5, visR(b.m) * cam.scale) + 10) return b; } return null; }
  function pt(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  canvas.addEventListener('pointerdown', (e) => {
    const [sx, sy] = pt(e), b = hit(sx, sy);
    if (b) { if (mode === 'running') { mode = 'paused'; updateRun(); } drag = b; manualEdited = true; }
    else { panning = true; lx = sx; ly = sy; }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = pt(e);
    if (drag) { const [wx, wy] = toW(sx, sy); drag.x = wx; drag.y = wy; drag.vx = drag.vy = 0; }
    else if (panning) { cam.cx -= (sx - lx) / cam.scale; cam.cy -= (sy - ly) / cam.scale; lx = sx; ly = sy; cam.follow = false; if ($('follow')) $('follow').checked = false; }
    else canvas.style.cursor = hit(sx, sy) ? 'grab' : 'default';
  });
  const up = (e) => { drag = null; panning = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); const [sx, sy] = pt(e), b = hit(sx, sy);
    if (b) { b.m = Math.max(0.2, Math.min(40, b.m * (e.deltaY < 0 ? 1.12 : 0.89))); manualEdited = true; }
    else { cam.scale = Math.max(20, Math.min(800, cam.scale * (e.deltaY < 0 ? 1.1 : 0.9))); cam.follow = false; if ($('follow')) $('follow').checked = false; }
  }, { passive: false });

  // ── UI (shares the same controls as the 3D version) ─────────────────────────
  const $ = (id) => document.getElementById(id);
  function updateRun() { const r = $('run'); if (!r) return; r.textContent = (mode === 'running') ? '❚❚ Pause' : '▶ Run'; r.classList.toggle('is-running', mode === 'running'); }
  function readout() { const el = $('exploreReadout'); if (el && $('vx')) el.textContent = `v = (${(+$('vx').value).toFixed(3)}, ${(+$('vy').value).toFixed(3)})`; }
  $('run').addEventListener('click', () => { if (mode === 'running') mode = 'paused'; else { if (manualEdited) { autoOrbit(); manualEdited = false; } mode = 'running'; } updateRun(); });
  $('reset').addEventListener('click', () => loadPreset(currentPreset));
  $('newOrbit') && $('newOrbit').addEventListener('click', () => { document.querySelectorAll('.preset').forEach(b => b.classList.remove('active')); currentPreset = 'random'; PRESETS['random'](); autoOrbit(); cam.follow = true; bodies.forEach(b => b.trail.length = 0); manualEdited = false; mode = 'running'; updateRun(); });
  $('clear') && $('clear').addEventListener('click', () => bodies.forEach(b => b.trail.length = 0));
  $('speed').addEventListener('input', (e) => { speed = +e.target.value; $('speedVal').textContent = speed.toFixed(1) + '×'; });
  $('grav') && $('grav').addEventListener('input', (e) => { G = +e.target.value; $('gravVal').textContent = G.toFixed(2); });
  $('trails') && $('trails').addEventListener('change', (e) => { showTrails = e.target.checked; });
  $('grid') && $('grid').addEventListener('change', (e) => { showGrid = e.target.checked; });
  $('follow') && $('follow').addEventListener('change', (e) => { cam.follow = e.target.checked; });
  document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.preset').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentPreset = btn.dataset.preset; loadPreset(currentPreset); }));
  function explore() { document.querySelectorAll('.preset').forEach(b => b.classList.remove('active')); currentPreset = 'explore'; readout(); loadPreset('explore'); }
  ['vx', 'vy'].forEach(id => $(id) && $(id).addEventListener('input', explore));
  $('surprise') && $('surprise').addEventListener('click', () => { $('vx').value = (Math.random() * 0.62 + 0.02).toFixed(3); $('vy').value = (Math.random() * 0.62 + 0.02).toFixed(3); explore(); });

  // ── boot ──────────────────────────────────────────────────────────────────────
  resize();
  $('grav') && ($('grav').value = G, $('gravVal').textContent = G.toFixed(2));
  $('speed').value = speed; $('speedVal').textContent = speed.toFixed(1) + '×';
  loadPreset('figure-8'); mode = 'running'; updateRun();
  requestAnimationFrame(frame);
})();

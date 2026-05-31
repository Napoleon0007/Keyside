// sun.js — a realistic, living sun rendered on a canvas (no external image needed).
// A churning, mottled photosphere with limb darkening and a hot glowing corona,
// slowly rotating on its axis. Around the rim, prominence loops arch outward and
// get pulled back in — matter expelled and re-absorbed. Vanilla, dependency-free.
// Honors reduced-motion (renders one still frame); pauses when scrolled out of view.

(() => {
  const wrap   = document.querySelector('.hero-sun');
  const canvas = document.querySelector('.hero-sun-canvas');
  if (!wrap || !canvas) return;

  const ctx     = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Value-noise → baked photosphere texture ─────────────────────────────────
  // A small fractal-noise field, coloured along a hot ramp, baked once into an
  // offscreen canvas. We rotate/blend it at draw time to fake the churning surface.
  function makeNoise(seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const perm = new Uint8Array(512);
    const vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const fade = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      const xf = x - Math.floor(x),   yf = y - Math.floor(y);
      const aa = vals[perm[perm[xi]     + yi]],     ba = vals[perm[perm[xi + 1] + yi]];
      const ab = vals[perm[perm[xi]     + yi + 1]], bb = vals[perm[perm[xi + 1] + yi + 1]];
      const u = fade(xf), v = fade(yf);
      const top = aa + u * (ba - aa), bot = ab + u * (bb - ab);
      return top + v * (bot - top);
    };
  }

  // hot colour ramp (deep red → molten orange → white-hot)
  const STOPS = [
    [0.00, [ 60,  8,  0]], [0.32, [150, 28,  0]], [0.55, [214, 66,  2]],
    [0.74, [255, 138, 22]], [0.89, [255, 190, 78]], [1.00, [255, 236, 160]],
  ];
  function ramp(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }

  function bakeSurface(size, seed) {
    const tex = document.createElement('canvas');
    tex.width = tex.height = size;
    const tctx = tex.getContext('2d');
    const img  = tctx.createImageData(size, size);
    const n = makeNoise(seed);
    const fbm = (x, y) => {
      let f = 0, amp = 0.5, frq = 1;
      for (let o = 0; o < 5; o++) { f += amp * n(x * frq, y * frq); amp *= 0.5; frq *= 2.05; }
      return f;
    };
    const scale = 6.5 / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // granular cells: warp the field so it reads as convection, not smooth cloud
        const v  = fbm(x * scale, y * scale);
        const gv = fbm(x * scale * 3.1 + 11, y * scale * 3.1 - 7) * 0.35;
        const c  = ramp(v * 0.85 + gv + 0.08);
        const i  = (y * size + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    return tex;
  }

  const surfA = bakeSurface(512, 1337);
  const surfB = bakeSurface(512, 90210);

  // ── Prominences: arches that grow off the limb and retract ──────────────────
  const RND = (a, b) => a + Math.random() * (b - a);
  const proms = Array.from({ length: 6 }, () => ({
    angle:  RND(0, Math.PI * 2),
    spread: RND(0.10, 0.20),   // angular foot separation (radians)
    height: RND(0.16, 0.40),   // peak arch height as fraction of radius
    period: RND(7, 14),        // seconds for a full expel→retract cycle
    phase:  Math.random(),
    hue:    RND(8, 28),        // red→orange
  }));

  // small flickering spicules all around the rim for a "hot fuzz" limb
  const spicules = Array.from({ length: 90 }, (_, i) => ({
    angle: (i / 90) * Math.PI * 2 + RND(-0.02, 0.02),
    len:   RND(0.015, 0.05),
    spd:   RND(2, 5),
    phase: Math.random() * Math.PI * 2,
  }));

  // ── Sizing ──────────────────────────────────────────────────────────────────
  let W = 0, H = 0, dpr = 1;
  function resize() {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  else window.addEventListener('resize', resize);

  // ── Frame ─────────────────────────────────────────────────────────────────
  function draw(t) {
    if (!W) { resize(); if (!W) return; }
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.34;   // leave room for corona + prominences

    ctx.clearRect(0, 0, W, H);

    // Corona — soft hot halo bleeding off the surface (additive), gently breathing
    const breathe = 0.85 + 0.15 * Math.sin(t * 0.7);
    ctx.globalCompositeOperation = 'lighter';
    const cor = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2.1);
    cor.addColorStop(0,   `rgba(255,150,40,${0.38 * breathe})`);
    cor.addColorStop(0.4, `rgba(255,90,10,${0.18 * breathe})`);
    cor.addColorStop(1,   'rgba(255,60,0,0)');
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(cx, cy, R * 2.1, 0, Math.PI * 2); ctx.fill();

    // Prominence loops (behind the disc so feet tuck under the limb)
    ctx.lineCap = 'round';
    for (const p of proms) {
      const cyc  = ((t / p.period) + p.phase) % 1;
      const life = Math.sin(cyc * Math.PI);          // 0 → 1 → 0 : expel then retract
      if (life <= 0.03) continue;
      const a1 = p.angle - p.spread, a2 = p.angle + p.spread;
      const f1x = cx + Math.cos(a1) * R * 0.98, f1y = cy + Math.sin(a1) * R * 0.98;
      const f2x = cx + Math.cos(a2) * R * 0.98, f2y = cy + Math.sin(a2) * R * 0.98;
      const out = R * p.height * life;               // how far the arch reaches out
      const c1x = f1x + Math.cos(a1) * out * 2.0, c1y = f1y + Math.sin(a1) * out * 2.0;
      const c2x = f2x + Math.cos(a2) * out * 2.0, c2y = f2y + Math.sin(a2) * out * 2.0;
      ctx.shadowColor = `rgba(255,${90 + p.hue * 3 | 0},20,0.9)`;
      ctx.shadowBlur  = 22;
      // wide faint body
      ctx.strokeStyle = `rgba(255,${110 + p.hue * 2 | 0},30,${0.18 * life})`;
      ctx.lineWidth = R * 0.05 * (0.5 + life);
      ctx.beginPath(); ctx.moveTo(f1x, f1y); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, f2x, f2y); ctx.stroke();
      // bright filament core
      ctx.strokeStyle = `rgba(255,${170 + p.hue | 0},90,${0.5 * life})`;
      ctx.lineWidth = R * 0.018 * (0.6 + life);
      ctx.beginPath(); ctx.moveTo(f1x, f1y); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, f2x, f2y); ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Flickering spicules just outside the rim
    ctx.globalCompositeOperation = 'lighter';
    for (const sp of spicules) {
      const fl = 0.5 + 0.5 * Math.sin(t * sp.spd + sp.phase);
      const a  = sp.angle + t * 0.01;               // ride along with the rotation
      const r0 = R * 0.985, r1 = R * (1 + sp.len * fl);
      ctx.strokeStyle = `rgba(255,150,40,${0.25 * fl})`;
      ctx.lineWidth = R * 0.012;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }

    // ── The disc ────────────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.globalCompositeOperation = 'source-over';

    const D = R * 2.4; // draw texture larger than disc so rotation never shows a corner
    // primary surface — slow axial spin
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.012);
    ctx.drawImage(surfA, -D / 2, -D / 2, D, D);
    ctx.restore();
    // churning layer — counter-drifting + breathing opacity = boiling convection
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.02 + 0.6);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.45 + 0.15 * Math.sin(t * 1.3);
    const D2 = D * 1.18;
    ctx.drawImage(surfB, -D2 / 2, -D2 / 2, D2, D2);
    ctx.restore();

    // active regions — a few brighter hotspots that pulse, riding with the spin
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const a  = t * 0.012 + i * 1.7;
      const rr = R * (0.25 + 0.18 * i);
      const hx = cx + Math.cos(a) * rr, hy = cy + Math.sin(a) * rr;
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.1 + i * 0.3) + i);
      const hs = R * (0.10 + 0.05 * i);
      const g  = ctx.createRadialGradient(hx, hy, 0, hx, hy, hs);
      g.addColorStop(0, `rgba(255,235,150,${0.5 * pulse})`);
      g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy, hs, 0, Math.PI * 2); ctx.fill();
    }

    // central highlight — makes it read as a sphere, not a flat disc
    ctx.globalCompositeOperation = 'lighter';
    const hl = ctx.createRadialGradient(cx - R * 0.12, cy - R * 0.12, 0, cx, cy, R * 1.05);
    hl.addColorStop(0,   'rgba(255,240,200,0.45)');
    hl.addColorStop(0.5, 'rgba(255,170,60,0.10)');
    hl.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    // limb darkening — the edge of a star falls off into shadow
    ctx.globalCompositeOperation = 'source-over';
    const ld = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    ld.addColorStop(0,    'rgba(0,0,0,0)');
    ld.addColorStop(0.82, 'rgba(40,2,0,0.12)');
    ld.addColorStop(1,    'rgba(20,0,0,0.78)');
    ctx.fillStyle = ld;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ── Loop / lifecycle ─────────────────────────────────────────────────────
  const t0 = performance.now();
  let running = true, frameId = null;
  function frame(now) {
    if (!running) return;
    frameId = requestAnimationFrame(frame);
    draw((now - t0) / 1000);
  }

  if (reduced) { draw(2.5); return; }   // single still frame, no animation

  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; frame(performance.now()); }
    else if (!visible && running) { running = false; cancelAnimationFrame(frameId); }
  }, { threshold: 0 });
  io.observe(wrap);

  frame(performance.now());
})();

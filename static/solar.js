// solar.js — a long, photoreal scroll-through of the solar system.
// You travel inward from Neptune, drifting through the stars, and arrive at the Sun.
// Real NASA-style texture maps, lit by the Sun. Vanilla Three.js (ESM), no build step.
// Respects prefers-reduced-motion, pauses off-screen, degrades gracefully without WebGL.

import * as THREE from 'three';

const stage = document.getElementById('solarStage');
if (stage) boot(stage);

function boot(stage) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TEX = (name) => `/static/textures/${name}.jpg`;

  // ── Bodies, in travel order: deep space → inward → Sun (the finale). ─────────
  // radius = compressed visual size (real ratios kept among planets; Sun capped to fit).
  // spin   = self-rotation speed. fact = one-liner shown in the HUD.
  const BODIES = [
    { key: 'neptune', name: 'Neptune', tex: 'neptunemap',  radius: 1.95, spin: 0.10, tilt: 0.49,
      fact: 'The windiest world — supersonic storms tear across its deep blue methane sky.' },
    { key: 'uranus',  name: 'Uranus',  tex: 'uranusmap',   radius: 2.00, spin: 0.09, tilt: 1.71,
      fact: 'Tipped on its side, it rolls around the Sun like a marble.' },
    { key: 'saturn',  name: 'Saturn',  tex: 'saturnmap',   radius: 3.60, spin: 0.22, tilt: 0.47, ring: true,
      fact: 'Its rings are billions of ice chunks, yet only metres thick.' },
    { key: 'jupiter', name: 'Jupiter', tex: 'jupitermap',  radius: 4.30, spin: 0.26, tilt: 0.05,
      fact: 'The giant — a storm twice the size of Earth has raged for centuries.' },
    { key: 'mars',    name: 'Mars',    tex: 'marsmap1k',   radius: 0.66, spin: 0.20, tilt: 0.44,
      fact: 'The red planet — rusted iron dust and the tallest volcano in the system.' },
    { key: 'earth',   name: 'Earth',   tex: 'earthmap1k',  radius: 1.00, spin: 0.20, tilt: 0.41, moon: true,
      fact: 'Home — the only place we know where the lights are on.' },
    { key: 'venus',   name: 'Venus',   tex: 'venusmap',    radius: 0.95, spin: 0.12, tilt: 0.05,
      fact: 'A runaway greenhouse — hot enough to melt lead, wrapped in acid cloud.' },
    { key: 'mercury', name: 'Mercury', tex: 'mercurymap',  radius: 0.48, spin: 0.14, tilt: 0.03,
      fact: 'Closest to the fire — scorched by day, frozen by night.' },
    { key: 'sun',     name: 'The Sun', tex: 'sunmap',      radius: 9.00, spin: 0.04, tilt: 0.0, sun: true,
      fact: 'The star at the centre of it all — 99.8% of everything here.' },
  ];

  // ── WebGL guard — if unavailable, leave the static fallback in the DOM. ──────
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    stage.closest('.solar')?.classList.add('solar-unsupported');
    return;
  }

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  stage.querySelector('.solar-fallback')?.remove(); // WebGL is live; drop the fallback

  const loader = new THREE.TextureLoader();
  const tex = (name) => {
    const t = loader.load(TEX(name));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };

  // ── Lighting ─────────────────────────────────────────────────────────────────
  // A soft directional key gives every planet consistent, photoreal modelling no
  // matter how far it sits from the Sun; the Sun's own point light + glow carry the
  // finale. Ambient is a faint cold starlight fill.
  const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
  key.position.set(0.4, 0.5, 1);
  scene.add(key);
  const sunLight = new THREE.PointLight(0xffcaa0, 2.5, 120, 1.4);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x2a3650, 0.35)); // faint starlight fill

  // ── Lay the bodies out along the world X axis. ──────────────────────────────
  const GAP = 7;            // breathing room between surfaces
  const SUN_GAP = 10;       // extra space before the finale
  const group = new THREE.Group();
  scene.add(group);

  let x = 0;
  const meshes = [];
  BODIES.forEach((b, i) => {
    if (i > 0) {
      const prev = BODIES[i - 1];
      x += prev.radius + (b.sun ? SUN_GAP : GAP) + b.radius;
    }
    b.x = x;

    const geo = new THREE.SphereGeometry(b.radius, 64, 64);
    let mat;
    if (b.sun) {
      mat = new THREE.MeshBasicMaterial({ map: tex(b.tex) }); // self-lit
    } else {
      mat = new THREE.MeshStandardMaterial({ map: tex(b.tex), roughness: 1, metalness: 0 });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, 0);
    mesh.rotation.z = b.tilt;
    group.add(mesh);
    b.mesh = mesh;
    meshes.push(mesh);

    if (b.sun) {
      sunLight.position.set(x, 0, 0);
      // Corona glow — a soft additive halo behind the Sun.
      const glowMat = new THREE.SpriteMaterial({
        map: radialGlowTexture(),
        color: 0xffb24d,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(b.radius * 6, b.radius * 6, 1);
      glow.position.set(x, 0, -0.2);
      scene.add(glow);
    }

    if (b.ring) {
      const ring = makeRing(b.radius * 1.35, b.radius * 2.3);
      ring.rotation.x = Math.PI / 2 - 0.42;
      ring.position.set(x, 0, 0);
      group.add(ring);
      b.ringMesh = ring;
    }

    if (b.moon) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(b.radius * 0.27, 32, 32),
        new THREE.MeshStandardMaterial({ map: tex('moonmap1k'), roughness: 1 })
      );
      m.position.set(x + b.radius * 2.1, b.radius * 0.4, 1.5);
      group.add(m);
      b.moonMesh = m;
    }
  });

  // ── Starfield — a deep dome of points around the whole scene. ────────────────
  scene.add(makeStarfield(2600, 600));

  // ── Travel state: progress 0 (Neptune) → 1 (Sun). ───────────────────────────
  const N = BODIES.length;
  let progress = 0;     // current eased value
  let target   = 0;     // where we're heading
  const last   = N - 1;

  function bodyAt(p) {
    // Map 0..1 across the body list; interpolate x + radius between neighbours.
    const f = Math.max(0, Math.min(1, p)) * last;
    const i = Math.min(Math.floor(f), last - 1);
    const t = f - i;
    const a = BODIES[i], b = BODIES[Math.min(i + 1, last)];
    return {
      x: a.x + (b.x - a.x) * t,
      radius: a.radius + (b.radius - a.radius) * t,
      index: Math.round(f),
    };
  }

  function frameCamera(p) {
    const at = bodyAt(p);
    const dist = at.radius * 3.0 + 7;       // dolly so each body is well framed
    camera.position.set(at.x + at.radius * 0.35, at.radius * 0.18, dist);
    camera.lookAt(at.x, 0, 0);
    return at.index;
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  const nameEl = document.getElementById('solarName');
  const factEl = document.getElementById('solarFact');
  const scrub  = document.getElementById('solarScrub');
  let shownIndex = -1;

  function setHUD(index) {
    if (index === shownIndex) return;
    shownIndex = index;
    const b = BODIES[index];
    if (nameEl) nameEl.textContent = b.name;
    if (factEl) factEl.textContent = b.fact;
    scrub?.querySelectorAll('.solar-dot').forEach((d, i) =>
      d.classList.toggle('active', i === index));
  }

  // Scrubber: a clickable tick per body.
  if (scrub) {
    BODIES.forEach((b, i) => {
      const dot = document.createElement('button');
      dot.className = 'solar-dot';
      dot.type = 'button';
      dot.title = b.name;
      dot.setAttribute('aria-label', b.name);
      dot.addEventListener('click', () => { target = i / last; });
      scrub.appendChild(dot);
    });
  }

  // ── Interaction: drag + horizontal wheel + arrow keys scrub the journey. ─────
  let dragging = false, lastX = 0;
  const STEP = 1 / last;

  function onDown(e) {
    dragging = true;
    lastX = (e.touches ? e.touches[0].clientX : e.clientX);
    stage.classList.add('grabbing');
  }
  function onMove(e) {
    if (!dragging) return;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    const dx = cx - lastX;
    lastX = cx;
    target = clamp01(target - dx / (stage.clientWidth * 0.9));
    if (e.cancelable) e.preventDefault();
  }
  function onUp() { dragging = false; stage.classList.remove('grabbing'); }

  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);

  // Trackpad horizontal swipe scrubs; vertical wheel is left for page scroll.
  stage.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      target = clamp01(target + e.deltaX / 1400);
      e.preventDefault();
    }
  }, { passive: false });

  stage.tabIndex = 0;
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { target = clamp01(target + STEP); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { target = clamp01(target - STEP); e.preventDefault(); }
  });

  // ── Resize ────────────────────────────────────────────────────────────────────
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Render loop (paused when the section is off-screen). ─────────────────────
  let raf = null, visible = false;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(loop);
  }, { threshold: 0.01 });
  io.observe(stage.closest('.solar') || stage);

  let t = 0;
  function loop() {
    t += 0.016;
    progress += (target - progress) * 0.08;      // eased travel
    const idx = frameCamera(progress);
    setHUD(idx);

    if (!reduced) {
      for (const b of BODIES) {
        if (b.mesh) b.mesh.rotation.y += b.spin * 0.01;
      }
      // Earth's moon drifts a little.
      const earth = BODIES.find(b => b.moon);
      if (earth?.moonMesh) {
        earth.moonMesh.position.x = earth.x + Math.cos(t * 0.25) * earth.radius * 2.1;
        earth.moonMesh.position.z = 1.5 + Math.sin(t * 0.25) * earth.radius * 2.1;
      }
    }

    renderer.render(scene, camera);
    raf = visible ? requestAnimationFrame(loop) : null;
  }
  raf = requestAnimationFrame(loop);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function makeRing(inner, outer) {
    const geo = new THREE.RingGeometry(inner, outer, 96);
    // Remap UVs so the texture runs radially across the ring.
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r = (v.length() - inner) / (outer - inner);
      uv.setXY(i, r, 0.5);
    }
    const ringTex = tex('saturnringcolor');
    const mat = new THREE.MeshBasicMaterial({
      map: ringTex, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    });
    return new THREE.Mesh(geo, mat);
  }

  function makeStarfield(count, radius) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random point on a sphere shell.
      const u = Math.random(), w = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * w - 1);
      const r = radius * (0.6 + Math.random() * 0.4);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.1, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  function radialGlowTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0,   'rgba(255,240,210,1)');
    g.addColorStop(0.2, 'rgba(255,180,80,0.7)');
    g.addColorStop(0.5, 'rgba(255,120,40,0.25)');
    g.addColorStop(1,   'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

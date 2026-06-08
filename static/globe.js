// globe.js — neon dot-globe hero accent (inspired by borealishpc.com).
// A dark earth peppered with glowing cyan dots over continent-like clusters,
// wrapped by an orange orbiting ring. Self-contained vanilla Three.js (ESM via
// the importmap already in index.html). Pauses off-screen, honors reduced-motion,
// degrades silently if WebGL is unavailable.

import * as THREE from 'three';

const canvas = document.getElementById('globeCanvas');
if (canvas) boot(canvas).catch(() => { canvas.style.display = 'none'; });

async function boot(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    canvas.style.display = 'none';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 3.7);

  // group we tilt for life + pointer parallax
  const root = new THREE.Group();
  root.rotation.z = -0.18;               // slight axial tilt
  scene.add(root);

  // ── deterministic noise (continent mask) ──────────────────────────────────
  let seed = 1337;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const dirs = [];
  for (let i = 0; i < 6; i++) {
    // random unit directions + frequency/phase → smooth blobby field
    let x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    dirs.push({ x, y, z, f: 1.4 + rand() * 2.6, p: rand() * Math.PI * 2 });
  }
  const field = (x, y, z) => {
    let s = 0;
    for (const d of dirs) s += Math.sin((x * d.x + y * d.y + z * d.z) * d.f + d.p);
    return s / dirs.length;           // ~[-1, 1]
  };

  // ── occluder sphere: hides far-side dots so it reads as a solid globe ──────
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.985, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x040910 })
  );
  root.add(core);

  // ── dotted surface: fibonacci sphere, kept on continent-like patches ──────
  const N = 26000;
  const positions = [], colors = [];
  const cA = new THREE.Color(0x6ee9ff);  // electric neon cyan-blue (brighter)
  const cB = new THREE.Color(0x2f86ff);  // vivid electric blue
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const yy = 1 - (i / (N - 1)) * 2;            // 1 → -1
    const r  = Math.sqrt(1 - yy * yy);
    const th = golden * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r, y = yy;
    const m = field(x * 1.3, y * 1.3, z * 1.3);  // continent mask
    if (m < 0.04) continue;                       // oceans = gaps
    positions.push(x, y, z);
    const t = Math.min(1, (m - 0.04) * 1.6);
    const c = cB.clone().lerp(cA, t * t);
    const b = 1.05 + t * 0.85;
    colors.push(c.r * b, c.g * b, c.b * b);
  }
  // every bead gets its own blink phase so the whole globe shimmers continuously
  const dotPhase = new Float32Array(positions.length / 3);
  for (let i = 0; i < dotPhase.length; i++) dotPhase[i] = Math.random() * Math.PI * 2;

  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  dotGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  dotGeo.setAttribute('phase', new THREE.Float32BufferAttribute(dotPhase, 1));
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uMap: { value: dotSprite() }, uSize: { value: 0.072 } },
    vertexShader: `
      attribute vec3 aColor; attribute float phase;
      varying vec3 vCol; varying float vTw;
      uniform float uT, uSize;
      void main(){
        vCol = aColor;
        float b = 0.5 + 0.5 * sin(uT + phase);
        vTw = 0.30 + 0.70 * pow(b, 1.7);                 // every bead blinks, never fully dark
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.5 + vTw) * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying vec3 vCol; varying float vTw;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vCol * (0.7 + 1.35 * vTw), t.a * (0.45 + 0.6 * vTw));
      }`,
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  root.add(dots);

  // ── atmosphere: fresnel rim glow ──────────────────────────────────────────
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 48, 48),
    new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0x2f9dff) } },
      vertexShader: `varying vec3 vN; varying vec3 vP;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uColor;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), 2.6);
          gl_FragColor = vec4(uColor, f * 0.9); }`,
    })
  );
  atmo.scale.setScalar(1.2);
  atmo.material.uniforms.uColor.value.setHex(0x4ab0ff);
  root.add(atmo);

  // ── twinkling sparkle glints — each twinkles on the GPU; touch ignites them ──
  const SPK = 3800, spkPos = [], spkPhase = [];
  for (let i = 0; i < SPK; i++) {
    const u = (Math.sin(i * 12.9898) * 43758.5453) % 1, v = (Math.sin(i * 78.233) * 12543.123) % 1;
    const th = Math.abs(u) * Math.PI * 2, ph = Math.acos(2 * Math.abs(v) - 1), r = 1.012 + (Math.abs(u) * 0.01);
    spkPos.push(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r);
    spkPhase.push(Math.abs((Math.sin(i * 3.17) * 6.2831)) % 6.2831);
  }
  const spkGeo = new THREE.BufferGeometry();
  spkGeo.setAttribute('position', new THREE.Float32BufferAttribute(spkPos, 3));
  spkGeo.setAttribute('phase', new THREE.Float32BufferAttribute(spkPhase, 1));
  const sparkleMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uT: { value: 0 }, uMap: { value: dotSprite() }, uColor: { value: new THREE.Color(0xcdeeff) },
      uSize: { value: 0.155 }, uHit: { value: new THREE.Vector3(0, 0, 0) }, uHitStr: { value: 0 },
    },
    vertexShader: `attribute float phase; varying float vTw; varying float vLive;
      uniform float uT, uSize, uHitStr; uniform vec3 uHit;
      void main(){
        float base = pow(0.5 + 0.5 * sin(uT + phase), 2.4);
        float d = distance(position, uHit);
        float near = exp(-d * d / 0.05);            // glitter halo around the touch
        vLive = near * uHitStr;
        vTw = base * (0.95 + 0.45 * uHitStr) + vLive * 2.6;   // always twinkling; ignites where you touch
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.28 + vTw) * (320.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vTw; varying float vLive; uniform sampler2D uMap; uniform vec3 uColor;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord);
        vec3 col = mix(uColor, vec3(1.0), clamp(vLive, 0.0, 1.0));   // ignites toward white
        gl_FragColor = vec4(col, t.a * vTw); }`,
  });
  const sparkles = new THREE.Points(spkGeo, sparkleMat);
  root.add(sparkles);

  // ── orange orbiting ring(s) ───────────────────────────────────────────────
  const ringGroup = new THREE.Group();
  ringGroup.rotation.set(1.32, 0, 0.25);   // tilt
  scene.add(ringGroup);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff5500, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.008, 12, 220), ringMat);
  ringGroup.add(ring);
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.62, 0.004, 10, 220),
    new THREE.MeshBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ringGroup.add(ring2);

  // little orange traveller bead riding the ring
  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, blending: THREE.AdditiveBlending })
  );
  ringGroup.add(bead);

  // ── sizing ────────────────────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth || 280, h = canvas.clientHeight || 280;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  // ── pointer parallax (subtle) ─────────────────────────────────────────────
  let tx = 0, ty = 0, px = 0, py = 0;
  if (!reduced) window.addEventListener('pointermove', (e) => {
    tx = (e.clientX / window.innerWidth - 0.5);
    ty = (e.clientY / window.innerHeight - 0.5);
  }, { passive: true });

  // ── touch-to-sparkle: the globe stays intact; glitter ignites where you touch ─
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitLocal = new THREE.Vector3();
  let hovering = false;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    hovering = true;
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { hovering = false; }, { passive: true });

  function touchSparkle() {
    let onGlobe = false;
    if (hovering) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(core, false)[0];
      if (hit) {
        // raycast hits the front face; sparkles share the globe's spin, so the
        // touch point converts straight into their local frame.
        sparkles.worldToLocal(hitLocal.copy(hit.point));
        sparkleMat.uniforms.uHit.value.copy(hitLocal);
        onGlobe = true;
      }
    }
    const target = onGlobe ? 1 : 0;       // ramp the glitter up on touch, fade on leave
    const u = sparkleMat.uniforms.uHitStr;
    u.value += (target - u.value) * (onGlobe ? 0.2 : 0.06);
  }

  // ── run / pause off-screen ────────────────────────────────────────────────
  let running = true, raf = 0, t = 0;
  const tick = () => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    t += 1;
    const spin = reduced ? 0 : 0.0016;
    dots.rotation.y += spin; core.rotation.y += spin; atmo.rotation.y += spin;
    sparkles.rotation.y += spin;
    sparkleMat.uniforms.uT.value = t * (reduced ? 0 : 0.08);
    dotMat.uniforms.uT.value = t * (reduced ? 0 : 0.055);   // continuous neon blink across every bead
    if (!reduced) {
      ringGroup.rotation.z += 0.0026;
      const a = t * 0.012;
      bead.position.set(Math.cos(a) * 1.46, Math.sin(a) * 1.46, 0);
      px += (tx - px) * 0.05; py += (ty - py) * 0.05;
      root.rotation.x = -0.05 + py * 0.35;
      root.rotation.y += 0;             // base spin handled per-mesh
      ringGroup.rotation.y = px * 0.4;
    }
    touchSparkle();
    renderer.render(scene, camera);
  };
  const io = new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !running) { running = true; tick(); }
    else if (!en.isIntersecting) { running = false; cancelAnimationFrame(raf); }
  }, { threshold: 0.01 });
  io.observe(canvas);
  tick();
}

// soft round dot texture (so points glow rather than render as squares)
function dotSprite() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

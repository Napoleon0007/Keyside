// world.js — "The Rex Trueform World": a 3D interactive neural-map / solar system.
// A central Rex Trueform core (the logo) with category hubs rendered as REAL planets,
// pulled live from the site's APIs so the map grows itself as content/links are added.
//   Network = Earth · Images = Moon · Edits = Pluto · Music = Jupiter (rings) · Products = Mars
// Each planet's data points orbit it like moons (screenshot/letter circles). Free trackball:
// drag any direction (under/around), scroll/pinch to zoom; click a node to focus + Open.
// Vanilla Three.js (ESM via importmap). Pauses off-screen, degrades without WebGL.

import * as THREE from 'three';

const stage = document.getElementById('worldStage');
if (stage) boot(stage).catch(() => revealFallback());

function revealFallback() {
  const fb = document.getElementById('worldFallback');
  if (fb) fb.hidden = false;
}

async function boot(stage) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── WebGL guard ─────────────────────────────────────────────────────────────
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    revealFallback();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);
  stage.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 6000);
  camera.position.set(0, 0, 600);

  const pivot = new THREE.Group();   // subtle mouse-parallax lean
  scene.add(pivot);
  const root = new THREE.Group();    // the graph; free-orbit (trackball) rotation
  pivot.add(root);

  const labelLayer = document.getElementById('worldLabels');

  const ambient = new THREE.AmbientLight(0xffffff, 0.42);
  scene.add(ambient);
  const coreLight = new THREE.PointLight(0xffd0a0, 2.0, 0, 1.1);   // warm "sun" glow from the core
  scene.add(coreLight);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);      // white key so planets read true
  keyLight.position.set(0.7, 0.5, 1);
  scene.add(keyLight);
  const loader = new THREE.TextureLoader();

  const stars = makeStars();
  scene.add(stars);

  // Deep background: distant living galaxies (each drifting on its own slow orbit
  // and spinning) plus sporadic shooting stars.
  const galaxies = makeGalaxies();
  scene.add(galaxies.group);
  const meteors = makeMeteors();
  scene.add(meteors.group);

  // ── Living sky (Phase 3) — shift the cosmos by the visitor's real local time ──
  const worldEl = document.querySelector('.world');
  function applySky(hour) {
    const p = skyPalette(hour);
    coreLight.color.copy(p.core); coreLight.intensity = p.coreI;
    keyLight.color.copy(p.key);   keyLight.intensity = p.keyI;
    ambient.color.copy(p.amb);    ambient.intensity = p.ambI;
    stars.material.color.copy(p.star);
    if (worldEl) worldEl.style.setProperty('--sky-veil', p.veil.join(', '));
  }
  const _clock = () => { const n = new Date(); return n.getHours() + n.getMinutes() / 60; };
  applySky(_clock());
  setInterval(() => applySky(_clock()), 4 * 60 * 1000);

  // Real galaxies (NASA/Hubble photos) living in the deep background. Drop more
  // images into static/galaxies/ and they appear automatically on reload.
  const backdrop = new THREE.Group();
  scene.add(backdrop);   // fixed in the scene → galaxies stay put at the back, no drift
  fetch('/api/galaxies').then(r => r.json()).then(d => {
    const files = Array.isArray(d.galaxies) ? d.galaxies : [];
    if (!files.length) return;
    const spots = [
      { r: 2200, size: 1300, theta: 0.6, phi:  0.5 },
      { r: 2600, size: 1280, theta: 2.4, phi: -0.4 },   // left side — middle (was 1550, then 1000)
      { r: 2000, size: 905,  theta: 3.8, phi:  0.8 },   // left side — middle (was 1050, then 760)
      { r: 2800, size: 1750, theta: 5.2, phi: -0.2 },
      { r: 2400, size: 1150, theta: 1.5, phi: -0.9 },
      { r: 2300, size: 1200, theta: 4.4, phi:  0.3 },   // left side — middle (was 1450, then 950)
    ];
    spots.forEach((s, i) => {
      // Feathered, luminance-keyed texture → no rectangle, melts into space.
      const tex = featherGalaxyTexture(files[i % files.length]);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.95,
        depthTest: true, depthWrite: false,   // far planets/foreground occlude them → stays a backdrop
      }));
      const ct = Math.cos(s.phi);
      sp.position.set(s.r * ct * Math.cos(s.theta), s.r * Math.sin(s.phi), s.r * ct * Math.sin(s.theta));
      sp.scale.setScalar(s.size);
      sp.material.rotation = i * 1.1;
      backdrop.add(sp);
    });
  }).catch(() => {});

  // ── Fetch the live content; build the graph from it ─────────────────────────
  const [vRes, pRes, lRes] = await Promise.all([
    fetch('/api/videos').then(r => r.json()).catch(() => ({})),
    fetch('/api/products').then(r => r.json()).catch(() => ({})),
    fetch('/api/links').then(r => r.json()).catch(() => ({})),
  ]);
  const videos   = Array.isArray(vRes.videos)   ? vRes.videos   : [];
  const products = Array.isArray(pRes.products) ? pRes.products : [];
  const links    = Array.isArray(lRes.links)    ? lRes.links    : [];

  const mediaVideo = videos.filter(v => v.type === 'video');
  const mediaEdit  = videos.filter(v => v.type === 'edit');
  const mediaImage = videos.filter(v => v.type === 'image');
  const mediaMusic = videos.filter(v => v.type === 'music');

  const HUBS = [
    { key: 'products', label: 'Products', color: 0xff5500,
      leaves: products.map(p => ({ name: p.name, kind: 'app',   color: 0xff7a3d, payload: p, thumb: p.thumb })) },
    { key: 'video',    label: 'Video',    color: 0xff8a3d,
      leaves: mediaVideo.map(v => ({ name: v.title, kind: 'modal', color: 0xffae63, payload: v, mtype: 'video', thumb: v.thumb })) },
    { key: 'edits',    label: 'Edits',    color: 0x3da5ff,
      leaves: mediaEdit.map(v => ({ name: v.title, kind: 'modal', color: 0x7dc4ff, payload: v, mtype: 'edit', thumb: v.thumb })) },
    { key: 'images',   label: 'Images',   color: 0x8a6cff,
      leaves: mediaImage.map(v => ({ name: v.title, kind: 'modal', color: 0xa98cff, payload: v, mtype: 'image', thumb: v.src })) },
    { key: 'music',    label: 'Music',    color: 0x2ad1ff,
      leaves: mediaMusic.map(v => ({ name: v.title, kind: 'modal', color: 0x6fe0ff, payload: v, mtype: 'music', thumb: v.thumb })) },
    { key: 'network',  label: 'Network',  color: 0x4dff9e,
      leaves: links.map(l => ({ name: l.name, kind: 'link', color: hexToInt(l.color, 0x4dff9e), payload: l, url: l.url })) },

    // Outer neurons — the ever-growing edge of Rex's World. Empty for now: each is a
    // dormant node waiting for a future realm of work to bloom on it. They orbit
    // further out than the live hubs, are grabbable, and ride the tour like the rest.
    { key: 'titan',  label: 'Titan',  color: 0xffd27f, neuron: true, leaves: [],
      desc: 'A great ringed neuron on the far edge — a whole realm waiting to bloom.' },
    { key: 'helios', label: 'Helios', color: 0xffae3d, neuron: true, leaves: [],
      desc: 'The distant sun-neuron — light for work not yet made.' },
    { key: 'aether', label: 'Aether', color: 0x6fe0ff, neuron: true, leaves: [],
      desc: 'An outer neuron, cool and quiet — a new realm incoming.' },
    { key: 'vesper', label: 'Vesper', color: 0xffb38a, neuron: true, leaves: [],
      desc: 'A warm evening neuron on the rim — its content is still forming.' },
    { key: 'cinder', label: 'Cinder', color: 0xc2c8d2, neuron: true, leaves: [],
      desc: 'A small scorched neuron at the frontier — dormant, but ours.' },
  ];

  // Each category hub IS a real planet (NASA-style maps, same source as solar.js).
  const PLANETS = {
    products: { tex: 'marsmap1k',  r: 18, dist: 220, tilt: 0.45, spin: 0.010, orbitTilt:  0.30, orbitSpeed: 0.0011, moonTilt: 0.50, moonSpeed: 0.0016 },
    video:    { tex: 'plutomap',   r: 13, dist: 310, tilt: 0.30, spin: 0.008, orbitTilt: -0.28, orbitSpeed: 0.0008, moonTilt: 0.70, moonSpeed: 0.0013 },
    edits:    { tex: 'neptunemap', r: 15, dist: 400, tilt: 0.22, spin: 0.009, orbitTilt:  0.18, orbitSpeed: 0.0009, moonTilt: 0.50, moonSpeed: 0.0014 },
    images:   { tex: 'moonmap1k',  r: 12, dist: 175, tilt: 0.10, spin: 0.006, orbitTilt:  0.55, orbitSpeed: 0.0015, moonTilt: 0.30, moonSpeed: 0.0019 },
    music:    { tex: 'jupitermap', r: 27, dist: 355, tilt: 0.05, spin: 0.014, orbitTilt:  0.12, orbitSpeed: 0.0006, ring: true, moonTilt: 0.40, moonSpeed: 0.0011 },
    network:  { tex: 'earthmap1k', r: 19, dist: 265, tilt: 0.41, spin: 0.011, orbitTilt:  0.40, orbitSpeed: 0.0010, moonTilt: 0.45, moonSpeed: 0.0015 },

    // Outer neurons — a clear shell beyond the inner hubs (which now reach edits@400),
    // so nothing bunches. Widely spaced, slow drift. Titan is the giant (ringed);
    // Helios sits furthest out.
    cinder:   { tex: 'mercurymap', r: 12, dist: 470, tilt: 0.12, spin: 0.012, orbitTilt:  0.28, orbitSpeed: 0.00072, moonTilt: 0.50, moonSpeed: 0.0013 },
    aether:   { tex: 'uranusmap',  r: 16, dist: 545, tilt: 0.34, spin: 0.009, orbitTilt:  0.50, orbitSpeed: 0.00060, moonTilt: 0.55, moonSpeed: 0.0012 },
    vesper:   { tex: 'venusmap',   r: 17, dist: 620, tilt: 0.20, spin: 0.008, orbitTilt: -0.36, orbitSpeed: 0.00052, moonTilt: 0.35, moonSpeed: 0.0011 },
    titan:    { tex: 'saturnmap',  r: 34, dist: 700, tilt: 0.46, spin: 0.007, orbitTilt:  0.16, orbitSpeed: 0.00044, ring: true, moonTilt: 0.40, moonSpeed: 0.0010 },
    helios:   { tex: 'sunmap',     r: 22, dist: 785, tilt: 0.08, spin: 0.013, orbitTilt: -0.20, orbitSpeed: 0.00038, moonTilt: 0.30, moonSpeed: 0.0009 },
  };

  // ── Gravity (Phase 1) ─────────────────────────────────────────────────────────
  // Each planet is a real physics body: it springs toward its analytic orbital
  // "home", feels softened mutual gravity from the others (mass ∝ radius, so Music/
  // Jupiter pulls hardest), and can be grabbed, dragged and flung. Dial the feel here.
  const GRAV = {
    spring:    0.018,   // pull back toward the orbital home (higher = snappier)
    damp:      0.84,    // velocity retained per frame (lower = gooier/slower)
    G:         320,     // mutual-gravity strength
    soft:      55,      // softening length (px) so close planets don't explode
    massScale: 1.0,     // mass = radius ** massScale
    maxForce:  3.0,     // per-pair force clamp
    throwGain: 0.65,    // fling velocity scale on release → slingshot
    idleSway:  reduced ? 0 : 1,   // 0 under reduced-motion: planets sit still (drag still works)
    maxOffset: 280,     // furthest a planet may stray from home before a hard pull-back
  };

  // ── Shared assets ───────────────────────────────────────────────────────────
  const glowTex  = makeGlowTexture();
  const sphereLo = new THREE.SphereGeometry(1, 20, 20);

  const nodes        = [];   // label/dim targets (core, hubs, leaves)
  const hits         = [];   // clickable leaf hit meshes (tap → open)
  const hoverHits    = [];   // hoverable hit meshes (leaves + planets + core → info card)
  const labels       = [];   // persistent HTML labels (hub planets)
  const planetMeshes = [];   // { mesh, ring, spin } self-rotating planets
  const orbiters     = [];   // { group, speed } revolving groups (moon systems only now)
  const bodies       = [];   // planet physics records (Phase 1 gravity)
  const planetHits   = [];   // invisible planet spheres → grabbable on pointerdown
  const orbitRings   = [];   // LineLoop materials — the visible orbit paths (dimmed on focus)
  const edgePairs    = [];   // [Object3D, Object3D] — endpoints read from world each frame
  const ORBIT_RING_OPACITY = 0.2;

  // Core — the Rex Trueform logo lives IN the 3D scene (a video sprite) so planets
  // orbiting to the near side pass in FRONT of it and far ones go behind — true depth.
  const core = makeNode({ name: 'Rex Trueform', kind: 'core', color: 0xff5500, radius: 22, emissive: 1.5 });
  root.add(core.group);
  nodes.push(core);
  core.mesh.visible = false;   // no obsidian sphere / orange dot behind the logo —
  core.glow.visible = false;   // the logo video is the only thing at the centre

  // Invisible sphere so the Rex core is hoverable (shows its info card) without
  // being a click target.
  const coreHit = new THREE.Mesh(sphereLo, new THREE.MeshBasicMaterial({ visible: false }));
  coreHit.scale.setScalar(core.radius * 1.4);
  coreHit.userData.node = core;
  core.group.add(coreHit);
  hoverHits.push(coreHit);

  const logoVid = document.createElement('video');
  Object.assign(logoVid, { src: '/static/rex-logo.mp4', muted: true, loop: true, autoplay: true, playsInline: true, crossOrigin: 'anonymous' });
  logoVid.play().catch(() => {});
  const logoTex = new THREE.VideoTexture(logoVid);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  const logoSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: logoTex, alphaMap: makeDiscMask(), transparent: true, depthTest: true, depthWrite: false,
  }));
  logoSprite.scale.setScalar(92);                 // the central "sun" — biggest body, depth-sorted
  core.group.add(logoSprite);
  const htmlLogo = document.getElementById('worldLogo');
  if (htmlLogo) htmlLogo.style.display = 'none';  // replaced by the 3D logo above

  HUBS.forEach((hub, hi) => {
    const cfg = PLANETS[hub.key];

    const orbit = new THREE.Group();           // orbital plane (math frame): defines the tilted ring
    orbit.rotation.set(cfg.orbitTilt, hi * (Math.PI * 2 / HUBS.length), 0);
    root.add(orbit);
    orbit.updateMatrix();                       // stable — orbit no longer spins; the planet glides via physics

    // The visible orbit path: a faint full ring at the planet's radius, sitting in
    // its tilted orbital plane so you can see the track each planet travels.
    const orbitRing = makeOrbitRing(cfg.dist);
    orbit.add(orbitRing);
    orbitRings.push(orbitRing.material);

    // The planet is a free physics body in `root` space (Phase 1 — gravity). Its
    // analytic "home" is the point on the tilted ring; springs + mutual gravity let
    // it be dragged, flung and tugged. Everything attached (moons, edges, labels,
    // hit sphere) rides along because it all reads holder.matrixWorld each frame.
    const holder = new THREE.Group();
    root.add(holder);
    const home0 = new THREE.Vector3(cfg.dist, 0, 0).applyMatrix4(orbit.matrix);
    holder.position.copy(home0);

    const body = {
      key: hub.key, holder, orbit,
      dist: cfg.dist, orbitSpeed: cfg.orbitSpeed, theta: 0,
      mass: Math.pow(cfg.r, GRAV.massScale),
      home: home0.clone(), pos: home0.clone(), vel: new THREE.Vector3(),
      acc: new THREE.Vector3(), grabbed: false,
    };
    bodies.push(body);

    const planet = makePlanet(cfg);
    holder.add(planet.mesh);
    if (planet.ring) holder.add(planet.ring);
    planetMeshes.push({ mesh: planet.mesh, ring: planet.ring, spin: cfg.spin });

    const hubNode = { group: holder, kind: 'hub', name: hub.label, color: hub.color, count: hub.leaves.length, neuron: !!hub.neuron, desc: hub.desc };
    nodes.push(hubNode);
    labels.push(makeLabel(hubNode, 'hub'));
    edgePairs.push([core.group, holder]);      // core → planet

    // The planet is hoverable ("{Hub} · N items") and grabbable (drag), but not a leaf click target.
    const hubHit = new THREE.Mesh(sphereLo, new THREE.MeshBasicMaterial({ visible: false }));
    hubHit.scale.setScalar(cfg.r * 1.3);
    hubHit.userData.node = hubNode;
    hubHit.userData.body = body;
    holder.add(hubHit);
    hoverHits.push(hubHit);
    planetHits.push(hubHit);

    const moons = new THREE.Group();           // the hub's data points orbit it like moons
    moons.rotation.x = cfg.moonTilt;
    holder.add(moons);
    orbiters.push({ group: moons, speed: cfg.moonSpeed });

    const dirs = fibonacciSphere(hub.leaves.length, hi * 7.13 + 1);
    hub.leaves.forEach((leaf, li) => {
      const jitter = 0.6 + 0.8 * frac(Math.sin((hi + 1) * 12.9898 + (li + 1) * 78.233) * 43758.5453);
      const lr = cfg.r + 10 + 12 * jitter;        // hug the planet — moons sit close to the surface
      const dead = leaf.kind === 'link' && !leaf.url;   // social not linked yet
      const node = makeNode({
        name: leaf.name, kind: leaf.kind, color: leaf.color, radius: 7,
        emissive: dead ? 0.22 : 0.95, dim: dead,
        payload: leaf.payload, mtype: leaf.mtype, thumb: leaf.thumb, url: leaf.url,
      });
      node.group.position.copy(dirs[li].clone().multiplyScalar(lr));
      node.hub = hub.key;
      node.style = leaf.payload && leaf.payload.style;
      moons.add(node.group);
      nodes.push(node);
      hits.push(node.hit);
      hoverHits.push(node.hit);
      edgePairs.push([holder, node.group]);    // planet → moon
    });
  });

  // Cross-links: chain leaves sharing an art `style` (the "neural" web). Capped.
  const byStyle = {};
  nodes.filter(n => n.kind === 'modal' && n.style).forEach(n => {
    (byStyle[n.style] = byStyle[n.style] || []).push(n);
  });
  let cross = 0;
  Object.values(byStyle).forEach(group => {
    for (let i = 1; i < group.length && cross < 120; i++, cross++) {
      edgePairs.push([group[i - 1].group, group[i].group]);
    }
  });

  // ── Comets (Phase 5) — the newest artworks streak in on first view this session ──
  const comets = makeComets();
  scene.add(comets.group);
  const cometQueue = [];
  if (!reduced) {
    const art   = nodes.filter(n => (n.kind === 'modal' || n.kind === 'app') && n.thumb && n.group && n.hit);
    const keyOf = n => (n.payload && (n.payload.file || n.payload.name)) || n.name || '';
    let seen = {};
    try { seen = JSON.parse(sessionStorage.getItem('rexComets') || '{}'); } catch (_) {}
    // Prefer items explicitly flagged new; otherwise the most-recently-added (highest order).
    let fresh = art.filter(n => n.payload && n.payload.new);
    if (!fresh.length) {
      fresh = art.slice().sort((a, b) => ((b.payload && b.payload.order) || 0) - ((a.payload && a.payload.order) || 0));
    }
    fresh = fresh.filter(n => !seen[keyOf(n)]).slice(0, 3);   // ≤3, once per session — never a storm
    fresh.forEach((n, i) => {
      n.group.visible = false;                                // hidden until its comet lands
      if (n.hit) n.hit.visible = false;
      seen[keyOf(n)] = 1;
      cometQueue.push({ node: n, body: bodies.find(x => x.key === n.hub), at: 0.8 + i * 0.95 });
    });
    try { sessionStorage.setItem('rexComets', JSON.stringify(seen)); } catch (_) {}
  }

  // ── Black-hole portal (Phase 6) — "bring your own universe" (future multi-user) ──
  // A dark event horizon ringed by a swirling accretion disc and an orange halo,
  // sitting out beyond the planets. Hoverable ("coming soon"), not yet clickable.
  const portal = new THREE.Group();
  portal.position.set(380, -168, -336);
  root.add(portal);
  const portalNode = { group: portal, kind: 'portal', name: 'Bring Your Own Universe', color: 0xff7a1a };

  const horizon = new THREE.Mesh(sphereLo, new THREE.MeshBasicMaterial({ color: 0x05030a }));
  horizon.scale.setScalar(20); horizon.renderOrder = 2;
  portal.add(horizon);

  const portalTilt = new THREE.Group();
  portalTilt.rotation.set(Math.PI / 2 - 0.55, 0.25, 0);   // lay the disc to read edge-on-ish
  portal.add(portalTilt);
  const portalDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 170),
    new THREE.MeshBasicMaterial({ map: accretionTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  portalTilt.add(portalDisc);

  const portalHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(0xff7a1a), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  portalHalo.scale.setScalar(150);
  portal.add(portalHalo);

  const portalHit = new THREE.Mesh(sphereLo, new THREE.MeshBasicMaterial({ visible: false }));
  portalHit.scale.setScalar(80);
  portalHit.userData.node = portalNode;
  portal.add(portalHit);
  hoverHits.push(portalHit);
  labels.push(makeLabel(portalNode, 'portal'));

  // ── Dynamic edges — endpoints move with the orbits, rebuilt each frame ───────
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePairs.length * 6), 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  root.add(new THREE.LineSegments(edgeGeo, edgeMat));
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  function updateEdges() {
    const arr = edgeGeo.attributes.position.array;
    let i = 0;
    for (const [a, b] of edgePairs) {
      _e1.setFromMatrixPosition(a.matrixWorld); root.worldToLocal(_e1);
      _e2.setFromMatrixPosition(b.matrixWorld); root.worldToLocal(_e2);
      arr[i++] = _e1.x; arr[i++] = _e1.y; arr[i++] = _e1.z;
      arr[i++] = _e2.x; arr[i++] = _e2.y; arr[i++] = _e2.z;
    }
    edgeGeo.attributes.position.needsUpdate = true;
  }

  // ── Planet physics (Phase 1) — spring-to-home + softened mutual gravity ──────
  const _phHome = new THREE.Vector3(), _phD = new THREE.Vector3(), _phDir = new THREE.Vector3();
  function stepPhysics() {
    // Recompute each planet's orbital home and seed its accel with the spring force.
    for (const b of bodies) {
      b.theta += b.orbitSpeed * GRAV.idleSway;
      _phHome.set(Math.cos(b.theta) * b.dist, 0, Math.sin(b.theta) * b.dist).applyMatrix4(b.orbit.matrix);
      b.home.copy(_phHome);
      b.acc.copy(_phHome).sub(b.pos).multiplyScalar(GRAV.spring);
    }
    // Mutual gravity — only 6 bodies (15 pairs), so a full double loop is free.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j];
        _phD.copy(c.pos).sub(a.pos);
        const dist2 = _phD.lengthSq();
        let f = GRAV.G * a.mass * c.mass / (dist2 + GRAV.soft * GRAV.soft);
        if (f > GRAV.maxForce) f = GRAV.maxForce;
        _phDir.copy(_phD).multiplyScalar(1 / Math.sqrt(dist2 || 1));
        a.acc.addScaledVector(_phDir,  f / a.mass);
        c.acc.addScaledVector(_phDir, -f / c.mass);
      }
    }
    // Integrate (grabbed planets keep their dragged position but still pull on others).
    for (const b of bodies) {
      if (!b.grabbed) {
        b.vel.add(b.acc).multiplyScalar(GRAV.damp);
        b.pos.add(b.vel);
        _phD.copy(b.pos).sub(b.home);
        const off = _phD.length();
        if (off > GRAV.maxOffset) {
          b.pos.copy(b.home).addScaledVector(_phD.multiplyScalar(1 / off), GRAV.maxOffset);
          b.vel.multiplyScalar(0.4);
        }
      }
      b.holder.position.copy(b.pos);
    }
  }

  // ── Node + planet + texture factories ───────────────────────────────────────
  function makeNode({ name, kind, color, radius, emissive, dim, payload, mtype, thumb, url }) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0b0b0e, metalness: 0.35, roughness: 0.32,
      emissive: new THREE.Color(color), emissiveIntensity: emissive,
    });
    const mesh = new THREE.Mesh(sphereLo, mat);
    mesh.scale.setScalar(radius);
    group.add(mesh);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color), transparent: true,
      opacity: dim ? 0.22 : 0.52, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(radius * 4.0);
    group.add(glow);

    const node = { group, mesh, glow, kind, color, name, payload, mtype, thumb, url,
                   baseEmissive: emissive, baseGlow: glow.material.opacity, radius, dim };

    // Leaf data points become a CIRCLE showing their screenshot/image (or a letter disc).
    if (kind === 'app' || kind === 'modal' || kind === 'link') {
      const ring = '#' + new THREE.Color(color).getHexString();
      const tex = thumb
        ? circleImageTexture(thumb, ring)
        : letterDiscTexture((name || '?').trim().charAt(0).toUpperCase(), color, ring);
      const billboard = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: dim ? 0.5 : 1,
      }));
      billboard.scale.setScalar(radius * 3.1);
      group.add(billboard);
      mesh.visible = false;
      node.billboard = billboard;

      const hit = new THREE.Mesh(sphereLo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.scale.setScalar(radius * 3.4);
      hit.userData.node = node;
      group.add(hit);
      node.hit = hit;
    }
    return node;
  }

  function loadTex(name) {
    const t = loader.load(`/static/textures/${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function makePlanet(cfg) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.r, 48, 48),
      new THREE.MeshStandardMaterial({ map: loadTex(cfg.tex), roughness: 1, metalness: 0, transparent: true }),
    );
    mesh.rotation.z = cfg.tilt || 0;
    let ring = null;
    if (cfg.ring) {
      ring = makeRing(cfg.r * 1.5, cfg.r * 2.5);
      ring.rotation.set(Math.PI / 2 - 0.32, 0.15, 0);
    }
    return { mesh, ring };
  }
  // A thin circular line marking a planet's orbit path (XZ plane, centred on the core).
  function makeOrbitRing(radius) {
    const seg = 160;
    const pos = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos[i * 3]     = Math.cos(a) * radius;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: ORBIT_RING_OPACITY, depthWrite: false,
    }));
  }
  function makeRing(inner, outer) {
    const geo = new THREE.RingGeometry(inner, outer, 96);
    const pos = geo.attributes.position, uv = geo.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {       // remap UVs so the ring texture runs radially
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - inner) / (outer - inner), 1);
    }
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: loadTex('saturnringcolor'), side: THREE.DoubleSide, transparent: true, opacity: 0.85,
    }));
  }

  // Turn a rectangular galaxy photo into an edgeless texture: the image's own
  // brightness becomes its transparency (dark sky → see-through) and a radial
  // feather dissolves the corners. No straight edges, melts into space.
  function featherGalaxyTexture(url) {
    const S = 512;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const s = Math.max(S / img.width, S / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      const data = g.getImageData(0, 0, S, S), px = data.data;
      const c = S / 2, rmax = S / 2;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          const L = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
          let a = Math.min(1, Math.max(0, (L - 0.06) * 1.7));     // dark sky → transparent
          const d = Math.hypot(x - c, y - c) / rmax;              // 0 centre … 1.41 corner
          a *= Math.max(0, 1 - Math.pow(d, 2.2));                 // radial feather kills the box
          px[i + 3] = (a * 255) | 0;
        }
      }
      g.putImageData(data, 0, 0);
      tex.needsUpdate = true;
    };
    img.onerror = () => {};
    img.src = url;
    return tex;
  }

  // Soft circular alpha mask so the (square) logo video reads as a glowing disc.
  function makeDiscMask() {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.82, '#fff');
    grad.addColorStop(0.96, '#666'); grad.addColorStop(1, '#000');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  function circleImageTexture(url, ring) {
    const size = 256, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2); g.clip();
      const s = Math.max(size / img.width, size / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      g.restore();
      g.lineWidth = 7; g.strokeStyle = ring;
      g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2); g.stroke();
      tex.needsUpdate = true;
    };
    img.onerror = () => {};
    img.src = url;
    return tex;
  }
  function letterDiscTexture(letter, colorInt, ring) {
    const size = 160, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const col = new THREE.Color(colorInt);
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
    g.fillStyle = `rgb(${Math.round(col.r * 70 + 10)},${Math.round(col.g * 70 + 10)},${Math.round(col.b * 70 + 10)})`;
    g.fill();
    g.lineWidth = 7; g.strokeStyle = ring; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 80px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, size / 2, size / 2 + 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── Comets (Phase 5) — a fresh artwork streaks in, then pops into its cluster ──
  function makeComets() {
    const group = new THREE.Group();
    const tailTex = meteorTexture();   // shared bright-head/fading-tail streak
    const live = [];                    // comets in flight
    const popping = [];                 // leaves easing in after arrival
    function launch(node, target, startT) {
      const ring = '#' + new THREE.Color(node.color || 0xffffff).getHexString();
      const head = new THREE.Sprite(new THREE.SpriteMaterial({
        map: circleImageTexture(node.thumb, ring), transparent: true, opacity: 0,
        depthTest: false, depthWrite: false,
      }));
      head.scale.setScalar((node.radius || 7) * 4.2);
      const tail = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tailTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthTest: false, depthWrite: false,
      }));
      tail.scale.set(170, 30, 1);
      group.add(tail); group.add(head);
      const p0 = new THREE.Vector3((Math.random() * 2 - 1) * 1500, 500 + Math.random() * 600, 250 + Math.random() * 600);
      live.push({ head, tail, p0, p1: target.clone(), t0: startT, dur: 1.1 + Math.random() * 0.4, node });
    }
    function update(tt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const c = live[i];
        const k = (tt - c.t0) / c.dur;
        if (k < 0) continue;
        if (k >= 1) {                                   // arrived → reveal the leaf with a pop
          group.remove(c.head); group.remove(c.tail);
          c.head.material.map?.dispose?.(); c.head.material.dispose(); c.tail.material.dispose();
          if (c.node) {
            c.node.group.visible = true;
            if (c.node.hit) c.node.hit.visible = true;
            c.node.group.scale.setScalar(0.01);
            popping.push({ node: c.node, t0: tt });
          }
          live.splice(i, 1);
          continue;
        }
        const x = c.p0.x + (c.p1.x - c.p0.x) * k;
        const y = c.p0.y + (c.p1.y - c.p0.y) * k;
        const z = c.p0.z + (c.p1.z - c.p0.z) * k;
        c.head.position.set(x, y, z);
        c.tail.position.set(x, y, z);
        c.tail.material.rotation = Math.atan2(c.p1.y - c.p0.y, c.p1.x - c.p0.x);
        const o = Math.sin(k * Math.PI);
        c.head.material.opacity = Math.min(1, o * 1.6);
        c.tail.material.opacity = o * 0.8;
      }
      for (let i = popping.length - 1; i >= 0; i--) {
        const p = popping[i];
        const k = (tt - p.t0) / 0.4;
        if (k >= 1) { p.node.group.scale.setScalar(1); popping.splice(i, 1); continue; }
        p.node.group.scale.setScalar(0.01 + (1 - Math.pow(1 - k, 3)) * 0.99);   // easeOutCubic pop
      }
    }
    return { group, update, launch };
  }

  // ── Zoom + small-screen fit ───────────────────────────────────────────────────
  // Phones (especially portrait) can't fit the whole system at the desktop distance,
  // so start further back and re-frame on rotate. Declared before resize() so it
  // can use them; desktop is left at the original distance.
  const phone = window.innerWidth < 760;
  const DEFAULT_CAMZ = 600;                          // pulled back to frame the outer neuron shell without bunching
  function fitZoom() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    const vHalf = (52 * Math.PI / 180) / 2;
    const R = 430;                                   // frame radius (planets + neuron shell) — wider so neurons fit
    return Math.max(500, Math.min(1300, (R / Math.tan(vHalf)) * Math.max(1, h / w)));
  }
  let camZ = DEFAULT_CAMZ, tCamZ = DEFAULT_CAMZ, userZoomed = false;
  if (phone) { camZ = tCamZ = fitZoom(); }

  // ── Resize ──────────────────────────────────────────────────────────────────
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (phone && !userZoomed) tCamZ = fitZoom();     // re-frame on orientation change
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ── Interaction: free trackball orbit / zoom / pick ──────────────────────────
  let dragging = false, moved = false, lastX = 0, lastY = 0;
  let autoRot = !reduced;
  let velYaw = 0, velPitch = 0;
  let parTX = 0, parTY = 0, parX = 0, parY = 0;
  const pointers = new Map();
  let pinchDist = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Gesture arbiter (Phase 1): 'idle' | 'orbit' (camera trackball) | 'planetDrag'.
  let inputMode = 'idle', dragBody = null;
  const dragPlane = new THREE.Plane(), _PLANE_N = new THREE.Vector3(0, 0, 1), _dragHit = new THREE.Vector3();

  // Premultiplying WORLD-axis rotations makes a drag feel screen-relative — you can
  // spin under, over and around with no gimbal lock, whichever way the mouse goes.
  const ROT_SPEED = 0.006;
  const _qa = new THREE.Quaternion(), _ax = new THREE.Vector3();
  function rotateBy(dx, dy) {
    _qa.setFromAxisAngle(_ax.set(0, 1, 0), dx * ROT_SPEED); root.quaternion.premultiply(_qa);
    _qa.setFromAxisAngle(_ax.set(1, 0, 0), dy * ROT_SPEED); root.quaternion.premultiply(_qa);
  }

  const el = renderer.domElement;
  el.style.touchAction = 'none';

  el.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (tour.active) { stopTour(); return; }           // first touch exits the tour
    if (focus) cancelFocus();                          // any user input hands control back
    if (pointers.size >= 2) {                         // second finger → pinch; abandon any planet grab
      if (dragBody) dragBody.grabbed = false;
      dragBody = null; dragging = false; inputMode = 'orbit';
      pinchDist = pointerSpread();
      return;
    }
    const body = bodyAt(e);                            // grab a planet, else fall back to camera orbit
    if (body) {
      inputMode = 'planetDrag'; dragBody = body; body.grabbed = true;
      moved = false; lastX = e.clientX; lastY = e.clientY;
      body.holder.getWorldPosition(_dragHit);
      dragPlane.setFromNormalAndCoplanarPoint(_PLANE_N, _dragHit);
    } else {
      inputMode = 'orbit'; dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY; velYaw = velPitch = 0;
    }
  });
  el.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { handlePinch(); return; }
    if (inputMode === 'planetDrag' && dragBody) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      lastX = e.clientX; lastY = e.clientY;
      dragPlaneMove(e);
      return;
    }
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      rotateBy(dx, dy);
      velYaw = dx; velPitch = dy;
      lastX = e.clientX; lastY = e.clientY;
    } else {
      updateParallaxTarget(e);
      hover(e);
    }
  });
  el.addEventListener('pointerleave', () => { parTX = parTY = 0; });
  function updateParallaxTarget(e) {
    const r = el.getBoundingClientRect();
    parTY = (((e.clientX - r.left) / r.width) * 2 - 1) * 0.20;
    parTX = (((e.clientY - r.top) / r.height) * 2 - 1) * 0.16;
  }

  function endPointer(e) {
    if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
    if (inputMode === 'planetDrag' && pointers.size === 0) {
      const b = dragBody;
      if (b) {
        b.grabbed = false;
        if (moved) b.vel.multiplyScalar(GRAV.throwGain);   // fling → slingshot
      }
      dragBody = null; inputMode = 'idle';
      if (b && !moved) focusOn(b, { frameRadius: 170 });   // a tap (no drag) → fly to the planet
    } else if (dragging && pointers.size === 0) {
      dragging = false; inputMode = 'idle';
      if (!moved) pick(e);   // a tap, not a drag → select
    }
    if (pointers.size < 2) pinchDist = 0;
  }
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);

  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (tour.active) stopTour();
    if (focus) cancelFocus();
    // macOS trackpad pinch arrives as a ctrlKey wheel — treat it as a stronger zoom,
    // so pinch-to-zoom and two-finger scroll both work natively.
    const factor = e.ctrlKey ? 7 : 0.5;
    userZoomed = true;
    tCamZ = clamp(tCamZ + e.deltaY * factor, 180, 1500);
  }, { passive: false });

  function pointerSpread() {
    const p = [...pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  function handlePinch() {
    const d = pointerSpread();
    if (pinchDist) { userZoomed = true; tCamZ = clamp(tCamZ + (pinchDist - d) * 1.5, 230, 1300); }
    pinchDist = d;
  }

  // ── Raycasting ───────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hoverCard = labelLayer ? makeHoverCard() : null;
  const hcThumb = hoverCard && hoverCard.querySelector('.whc-thumb');
  const hcTitle = hoverCard && hoverCard.querySelector('.whc-title');
  const hcDesc  = hoverCard && hoverCard.querySelector('.whc-desc');
  const hcTag   = hoverCard && hoverCard.querySelector('.whc-tag');
  const hcGo    = hoverCard && hoverCard.querySelector('.whc-go');
  let hovered = null;
  let peeked  = null;   // touch: the node shown on first tap (second tap opens it)

  function rayAt(e, list) {
    const r = el.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(list, false)[0];
    return hit ? hit.object.userData.node : null;
  }

  // Which planet (if any) is under the pointer — for grabbing on pointerdown.
  function bodyAt(e) {
    const r = el.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(planetHits, false)[0];
    return hit ? hit.object.userData.body : null;
  }

  // Drag the grabbed planet: project the pointer onto a screen-parallel plane through
  // the planet, in root-local space. The per-move delta becomes the throw velocity.
  function dragPlaneMove(e) {
    const r = el.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(dragPlane, _dragHit)) return;
    root.worldToLocal(_dragHit);
    dragBody.vel.copy(_dragHit).sub(dragBody.pos);
    dragBody.pos.copy(_dragHit);
  }

  // ── Cinematic focus / fly-to (Phase 2) — reused by clicks, filters and the tour ──
  const FOCUS_MS = reduced ? 0 : 800;
  const _AXIS_Z = new THREE.Vector3(0, 0, 1);
  let focus = null;   // { qFrom, qTo, zFrom, zTo, t0, dur, then, track, target, frameRadius }

  // Resolve a focus target (body / node / Object3D / Vector3) to a root-local point.
  function resolveLocal(target) {
    if (!target) return null;
    if (target.isVector3) return target.clone();
    const obj = target.holder || target.group || (target.isObject3D ? target : null);
    if (!obj) return null;
    const p = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    return root.worldToLocal(p);
  }
  // Camera Z that frames a body of radius r sitting at root-local point P.
  function frameDistance(P, r) {
    const vHalf = (52 * Math.PI / 180) / 2;
    const camToTarget = Math.max(150, r / Math.tan(vHalf));
    return clamp(P.length() + camToTarget, 200, 1400);
  }
  // Swing `root` so the target lands centre-screen, easing the zoom to frame it.
  function focusOn(target, opts = {}) {
    const P = resolveLocal(target);
    if (!P || P.lengthSq() < 1e-6) return;
    const frameRadius = opts.frameRadius != null ? opts.frameRadius : 90;
    focus = {
      qFrom: root.quaternion.clone(),
      qTo: new THREE.Quaternion().setFromUnitVectors(P.clone().normalize(), _AXIS_Z),
      zFrom: tCamZ, zTo: frameDistance(P, frameRadius),
      t0: t, dur: (opts.ms != null ? opts.ms : FOCUS_MS) / 1000,
      then: opts.then || null, track: !!opts.track, target, frameRadius,
    };
    inputMode = 'focusing'; autoRot = false;
  }
  function cancelFocus() {
    focus = null;
    if (inputMode === 'focusing') inputMode = 'idle';
    autoRot = !reduced;
  }
  // Let the page's category filter swoop the world to a hub (main.js calls this).
  window.worldFocusHub = (key) => {
    const b = bodies.find(x => x.key === key);
    if (b) focusOn(b, { frameRadius: 175 });
  };

  // ── Planetarium tour (Phase 4) — autopilot through the cosmos ────────────────
  const tourBtn = document.getElementById('worldTour');
  const tour = { active: false, idx: -1, holdUntil: 0, seq: [] };
  function advanceTour() {
    tour.idx++;
    if (tour.idx >= tour.seq.length) { finishTour(); return; }   // one full pass → reset itself
    const node = tour.seq[tour.idx];
    focusOn(node, {
      frameRadius: node.kind === 'core' ? 120 : 175,
      ms: reduced ? 0 : 900, track: true,                         // quicker fly between bodies
      then: () => { tour.holdUntil = t + 1.6; },                  // quicker dwell on each body
    });
    showPeek(node);                                 // caption follows the framed body
  }
  function startTour() {
    tour.seq = [core, ...nodes.filter(n => n.kind === 'hub')];
    if (!tour.seq.length) return;
    tour.active = true; tour.idx = -1; tour.holdUntil = 0;
    if (tourBtn) { tourBtn.classList.add('touring'); tourBtn.textContent = '■'; }
    advanceTour();
  }
  function stopTour() {
    tour.active = false;
    if (tourBtn) { tourBtn.classList.remove('touring'); tourBtn.textContent = '▶'; }
    cancelFocus();
    clearHover();
  }
  // Played through every body → stop and ease back out to the default framing.
  function finishTour() {
    tour.active = false;
    if (tourBtn) { tourBtn.classList.remove('touring'); tourBtn.textContent = '▶'; }
    clearHover();
    tCamZ = phone ? fitZoom() : DEFAULT_CAMZ;
    autoRot = !reduced;
  }
  if (tourBtn) tourBtn.addEventListener('click', () => (tour.active ? stopTour() : startTour()));

  // Desktop hover → show the rich info card for whatever node is under the cursor.
  function hover(e) {
    const node = rayAt(e, hoverHits);
    if (node === hovered) return;
    setHoverPop(hovered, false);
    hovered = node;
    el.style.cursor = node ? (isClickable(node) ? 'pointer' : 'grab') : 'grab';
    if (!node) { if (hoverCard) hoverCard.style.display = 'none'; return; }
    setHoverPop(node, true);
    fillHoverCard(node);
    if (hoverCard) hoverCard.style.display = '';
  }

  // A tap that wasn't a drag. Desktop: open the node directly. Touch (no hover):
  // first tap peeks the info card, second tap on the same node opens it.
  function pick(e) {
    const touch = e.pointerType === 'touch';
    const node = rayAt(e, hits);
    if (!node) { peeked = null; if (touch) clearHover(); return; }
    if (touch && peeked !== node) { peeked = node; showPeek(node); return; }
    peeked = null;
    if (isClickable(node)) focusOn(node, { frameRadius: 60, then: () => openTarget(node) });
  }

  function showPeek(node) {
    setHoverPop(hovered, false);
    hovered = node;
    setHoverPop(node, true);
    fillHoverCard(node);
    if (hoverCard) hoverCard.style.display = '';
  }
  function clearHover() {
    setHoverPop(hovered, false);
    hovered = null;
    if (hoverCard) hoverCard.style.display = 'none';
  }

  // ── Node info + navigation ───────────────────────────────────────────────────
  const TAGS = { app: 'Product', link: 'Network', video: 'Video', edit: 'Edit', image: 'Image', music: 'Music' };

  const cap = s => { s = (s == null ? '' : String(s)); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

  // The "what it does" line, generated from each node's own data — products carry a
  // real blurb; everything else is described from its style / type / category.
  function autoDesc(node) {
    const p = node.payload || {};
    if (node.kind === 'core')   return "The centre of Rex's World";
    if (node.kind === 'portal') return 'A shared cosmos — bring your own universe. Coming soon.';
    if (node.kind === 'hub') {
      if (node.neuron) return node.desc || 'A dormant neuron of the ever-growing Hub — content incoming';
      return `${node.count} ${node.count === 1 ? 'item' : 'items'} orbiting here`;
    }
    if (node.kind === 'app')  return p.blurb || 'A Rex Trueform product';
    if (node.kind === 'link') {
      const cat = cap(p.category || 'network');
      return p.url ? cat : `${cat} · coming soon`;
    }
    const style = cap(node.style || p.style || '');
    if (node.mtype === 'image') return style ? `${style} · still image` : 'Still image';
    if (node.mtype === 'music') {
      if ((p.style || '') === 'song') return 'Original song';
      if (p.subtype === 'ai')        return 'AI-generated track';
      return style ? `${style} · track` : 'Music track';
    }
    if (node.mtype === 'edit') {
      const s = (p.style || '');
      return (s && s !== 'edit') ? `${cap(s)} · edit` : 'A personal edit — music video / short doc';
    }
    return style ? `${style} · animated piece` : 'Animated piece';
  }

  function iconFor(node) {
    if (node.kind === 'core')   return '✦';
    if (node.kind === 'portal') return '◍';
    if (node.kind === 'hub')    return '◉';
    if (node.kind === 'link')   return (node.name || '?').trim().charAt(0).toUpperCase();
    if (node.mtype === 'music') return '♫';
    if (node.mtype === 'video' || node.mtype === 'edit') return '▶';
    return '◉';
  }

  function isClickable(node) {
    return node.kind === 'app' || node.kind === 'modal' || (node.kind === 'link' && !!node.url);
  }

  // One click → straight to it, reusing main.js's navigation.
  function openTarget(node) {
    if (node.kind === 'app'   && window.openAppModal) window.openAppModal(node.payload);
    else if (node.kind === 'modal' && window.openModal) window.openModal(node.payload);
    else if (node.kind === 'link' && node.url) window.open(node.url, '_blank', 'noopener');
  }

  // Subtle pop + glow on the hovered/peeked leaf so it reads as touchable.
  function setHoverPop(node, on) {
    if (!node || !node.billboard) return;            // only leaves pop (not planets/core)
    node.group.scale.setScalar(on ? 1.28 : 1);
    if (node.glow) node.glow.material.opacity = on ? Math.min(1, node.baseGlow + 0.3) : node.baseGlow;
  }

  function fillHoverCard(node) {
    if (!hoverCard) return;
    hcTitle.textContent = node.name || '';
    hcDesc.textContent  = autoDesc(node);
    hcTag.textContent   = node.kind === 'hub' ? (node.neuron ? 'Neuron' : 'Hub')
                        : node.kind === 'core' ? 'Core'
                        : node.kind === 'portal' ? 'Portal'
                        : (TAGS[node.kind === 'modal' ? node.mtype : node.kind] || '');

    hcThumb.innerHTML = '';
    hcThumb.style.background = '';
    hcThumb.classList.remove('icon');
    if (node.thumb) {
      const img = document.createElement('img');
      img.src = node.thumb; img.alt = node.name || ''; img.loading = 'lazy';
      hcThumb.appendChild(img);
    } else {
      hcThumb.classList.add('icon');
      hcThumb.textContent = iconFor(node);
      hcThumb.style.background = '#' + new THREE.Color(node.color || 0xff5500).getHexString();
    }

    if (node.kind === 'link' && !node.url) { hcGo.textContent = 'coming soon'; hcGo.classList.add('soon'); }
    else if (node.kind === 'portal')       { hcGo.textContent = 'coming soon'; hcGo.classList.add('soon'); }
    else if (isClickable(node))            { hcGo.textContent = 'click to open →'; hcGo.classList.remove('soon'); }
    else                                   { hcGo.textContent = ''; hcGo.classList.remove('soon'); }
  }

  // ── Expand → fullscreen ──────────────────────────────────────────────────────
  const expandBtn = document.getElementById('worldExpand');
  const section = document.getElementById('section-world');
  if (expandBtn && section) {
    expandBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else section.requestFullscreen?.();
    });
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(resize));
  }

  // ── HTML labels (planets, projected each frame) ──────────────────────────────
  function makeLabel(node, cls) {
    if (!labelLayer) return null;
    const d = document.createElement('div');
    d.className = 'world-label ' + cls;
    d.textContent = node.name;
    labelLayer.appendChild(d);
    return { el: d, node };
  }
  function makeHoverCard() {
    const d = document.createElement('div');
    d.className = 'world-hovercard';
    d.style.display = 'none';
    d.innerHTML =
      '<div class="whc-thumb"></div>' +
      '<div class="whc-body">' +
        '<div class="whc-title"></div>' +
        '<div class="whc-desc"></div>' +
        '<div class="whc-foot"><span class="whc-tag"></span><span class="whc-go"></span></div>' +
      '</div>';
    labelLayer.appendChild(d);
    return d;
  }
  const _v = new THREE.Vector3();
  function place(el2, obj) {
    const r = el.getBoundingClientRect();
    _v.setFromMatrixPosition(obj.matrixWorld).project(camera);
    if (_v.z >= 1) { el2.style.display = 'none'; return; }
    el2.style.display = '';
    el2.style.left = ((_v.x * 0.5 + 0.5) * r.width) + 'px';
    el2.style.top  = ((-_v.y * 0.5 + 0.5) * r.height) + 'px';
  }
  function updateLabels() {
    labels.forEach(l => { if (l) place(l.el, l.node.group); });
    if (hoverCard && hovered) place(hoverCard, hovered.group);
  }

  // ── Render loop (paused off-screen) ──────────────────────────────────────────
  let raf = null, visible = false, t = 0;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(loop);
  }, { threshold: 0.02 });
  io.observe(section || stage);

  function loop() {
    t += 0.016;

    if (focus) {                                   // cinematic fly-to (Phase 2)
      let k = focus.dur > 0 ? (t - focus.t0) / focus.dur : 1;
      if (k > 1) k = 1;
      const ke = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
      if (focus.track) {                           // re-aim at a moving target (tour)
        const P = resolveLocal(focus.target);
        if (P && P.lengthSq() > 1e-6) {
          focus.qTo.setFromUnitVectors(P.clone().normalize(), _AXIS_Z);
          focus.zTo = frameDistance(P, focus.frameRadius);
        }
      }
      root.quaternion.slerpQuaternions(focus.qFrom, focus.qTo, ke);
      tCamZ = focus.zFrom + (focus.zTo - focus.zFrom) * ke;
      if (k >= 1) {
        const then = focus.then, wasTrack = focus.track;
        focus = null;
        if (inputMode === 'focusing') inputMode = 'idle';
        autoRot = !reduced && !wasTrack;
        if (then) then();
      }
    }

    if (tour.active && !focus && t >= tour.holdUntil) advanceTour();   // autopilot dwell → next body

    if (!dragging && inputMode === 'idle' && !tour.active) {
      rotateBy(velYaw, velPitch);
      velYaw *= 0.92; velPitch *= 0.92;
      if (autoRot && Math.abs(velYaw) < 0.04 && Math.abs(velPitch) < 0.04) rotateBy(0.16, 0);
    }
    for (const o of orbiters) o.group.rotation.y += o.speed;
    for (const p of planetMeshes) p.mesh.rotation.y += p.spin;
    stepPhysics();
    galaxies.update(0.016);
    meteors.update(t);
    comets.update(t);
    for (let i = cometQueue.length - 1; i >= 0; i--) {        // launch queued comets when due
      if (t >= cometQueue[i].at) {
        const q = cometQueue.splice(i, 1)[0];
        const target = new THREE.Vector3();
        (q.body ? q.body.holder : q.node.group).getWorldPosition(target);
        comets.launch(q.node, target, t);
      }
    }

    parX += (parTX - parX) * 0.06; parY += (parTY - parY) * 0.06;
    pivot.rotation.set(parX, parY, 0);
    camZ += (tCamZ - camZ) * 0.08; camera.position.z = camZ;

    pivot.updateMatrixWorld(true);   // sync all world matrices for edges + labels
    const pulse = 1 + Math.sin(t * 1.6) * 0.06;
    core.glow.scale.setScalar(core.radius * 4.0 * pulse);
    core.mesh.material.emissiveIntensity = 1.3 + Math.sin(t * 1.6) * 0.25;
    stars.rotation.y += 0.0002;
    portalDisc.rotation.z += reduced ? 0 : 0.0035;                 // accretion swirl
    portalHalo.material.opacity = 0.4 + Math.sin(t * 1.1) * 0.12;  // breathing halo

    updateEdges();
    updateLabels();
    renderer.render(scene, camera);
    raf = visible ? requestAnimationFrame(loop) : null;
  }
  raf = requestAnimationFrame(loop);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeStars() {
  const N = 1400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u), R = 1600 + Math.random() * 1400;
    pos[i * 3]     = R * rr * Math.cos(th);
    pos[i * 3 + 1] = R * u;
    pos[i * 3 + 2] = R * rr * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8 }));
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fibonacciSphere(n, offset = 0) {
  const out = [];
  if (n <= 0) return out;
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i + offset;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}

function frac(x) { return x - Math.floor(x); }

function hexToInt(hex, fallback) {
  if (typeof hex !== 'string') return fallback;
  const v = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(v) ? fallback : v;
}

// Living-sky palette (Phase 3): the world's mood by hour of day, lerped between
// keyframes — night violet → dawn warm → midday bright-cool → dusk orange-pink.
function skyPalette(h) {
  const K = [
    { h: 0,  core: 0x6a4bff, key: 0x8a7cff, amb: 0x241a40, ambI: 0.30, coreI: 1.4, keyI: 0.9, star: 0xb9c4ff, veil: [10, 4, 22] },
    { h: 6,  core: 0xffb070, key: 0xfff0d8, amb: 0x3a2a30, ambI: 0.42, coreI: 2.0, keyI: 1.3, star: 0xffe0c0, veil: [24, 10, 14] },
    { h: 12, core: 0xfff4e0, key: 0xffffff, amb: 0x3a3a44, ambI: 0.55, coreI: 1.8, keyI: 1.6, star: 0xffffff, veil: [10, 10, 18] },
    { h: 18, core: 0xff6a2a, key: 0xffb38a, amb: 0x402028, ambI: 0.46, coreI: 2.2, keyI: 1.2, star: 0xffcab0, veil: [30, 8, 12] },
    { h: 24, core: 0x6a4bff, key: 0x8a7cff, amb: 0x241a40, ambI: 0.30, coreI: 1.4, keyI: 0.9, star: 0xb9c4ff, veil: [10, 4, 22] },
  ];
  h = ((h % 24) + 24) % 24;
  let a = K[0], b = K[1];
  for (let i = 0; i < K.length - 1; i++) {
    if (h >= K[i].h && h <= K[i + 1].h) { a = K[i]; b = K[i + 1]; break; }
  }
  const f = (h - a.h) / ((b.h - a.h) || 1);
  const col = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), f);
  const num = (x, y) => x + (y - x) * f;
  return {
    core: col(a.core, b.core), key: col(a.key, b.key), amb: col(a.amb, b.amb), star: col(a.star, b.star),
    coreI: num(a.coreI, b.coreI), keyI: num(a.keyI, b.keyI), ambI: num(a.ambI, b.ambI),
    veil: [Math.round(num(a.veil[0], b.veil[0])), Math.round(num(a.veil[1], b.veil[1])), Math.round(num(a.veil[2], b.veil[2]))],
  };
}

// ── Deep-space background: galaxies + shooting stars ─────────────────────────

// '#rrggbb' + alpha → rgba() string
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// A face-on spiral galaxy drawn from thousands of little stars along log arms.
function galaxyTexSpiral(pal) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.translate(S / 2, S / 2);
  let haze = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.5);
  haze.addColorStop(0, hexA(pal[0], 0.45)); haze.addColorStop(0.4, hexA(pal[2], 0.12)); haze.addColorStop(1, hexA(pal[2], 0));
  g.fillStyle = haze; g.beginPath(); g.arc(0, 0, S * 0.5, 0, 7); g.fill();
  const arms = Math.random() < 0.5 ? 2 : 3, wind = 2.2 + Math.random() * 1.4;
  for (let a = 0; a < arms; a++) {
    const base = a * (Math.PI * 2 / arms) + Math.random() * 0.3;
    for (let s = 0; s < 300; s++) {
      const tt = s / 300, r = tt * S * 0.46, ang = base + tt * wind * Math.PI * 2, sc = (1 - tt) * 5 + 1.5;
      const x = Math.cos(ang) * r + (Math.random() * 2 - 1) * sc;
      const y = Math.sin(ang) * r + (Math.random() * 2 - 1) * sc;
      g.globalAlpha = (1 - tt) * 0.55 + 0.06;
      g.fillStyle = tt < 0.35 ? pal[0] : (tt < 0.7 ? pal[1] : pal[2]);
      g.beginPath(); g.arc(x, y, Math.max(0.5, (1 - tt) * 1.7 + 0.4), 0, 7); g.fill();
    }
  }
  g.globalAlpha = 1;
  let core = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.16);
  core.addColorStop(0, '#ffffff'); core.addColorStop(0.4, hexA(pal[0], 0.9)); core.addColorStop(1, hexA(pal[1], 0));
  g.fillStyle = core; g.beginPath(); g.arc(0, 0, S * 0.16, 0, 7); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// A softer elliptical galaxy — a tilted glowing ovoid with speckle stars.
function galaxyTexElliptical(pal) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.translate(S / 2, S / 2); g.rotate(Math.random() * Math.PI); g.scale(1, 0.6);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.5);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, hexA(pal[0], 0.85)); gr.addColorStop(0.5, hexA(pal[1], 0.28)); gr.addColorStop(1, hexA(pal[2], 0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, S * 0.5, 0, 7); g.fill();
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * 7, r = Math.random() * S * 0.45;
    g.globalAlpha = Math.random() * 0.5; g.fillStyle = '#fff';
    g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 0.6, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// A field of distant galaxies, each drifting on its own slow orbit + spinning.
function makeGalaxies() {
  const group = new THREE.Group();
  const palettes = [
    ['#fff4e0', '#ffb36b', '#8a5cff'], ['#eaf2ff', '#7fb0ff', '#3b5bff'],
    ['#fff0f6', '#ff7eb6', '#a05bff'], ['#eafff4', '#7ce0b0', '#3fa9ff'],
  ];
  const items = [];
  for (let i = 0; i < 6; i++) {
    const pal = palettes[i % palettes.length];
    const tex = Math.random() < 0.7 ? galaxyTexSpiral(pal) : galaxyTexElliptical(pal);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    const size = 460 + Math.random() * 680; sp.scale.set(size, size, 1);
    const axis = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const up = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const e1 = new THREE.Vector3().crossVectors(axis, up).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
    items.push({
      sp, mat, e1, e2,
      radius: 2700 + Math.random() * 1700,
      phase: Math.random() * Math.PI * 2,
      speed: (0.004 + Math.random() * 0.008) * (Math.random() < 0.5 ? -1 : 1),
      spin: (0.0008 + Math.random() * 0.0018) * (Math.random() < 0.5 ? -1 : 1),
    });
    group.add(sp);
  }
  let acc = 0;
  return {
    group,
    update(dt) {
      acc += dt;
      for (const it of items) {
        const a = it.phase + acc * it.speed;
        it.sp.position.set(
          (Math.cos(a) * it.e1.x + Math.sin(a) * it.e2.x) * it.radius,
          (Math.cos(a) * it.e1.y + Math.sin(a) * it.e2.y) * it.radius,
          (Math.cos(a) * it.e1.z + Math.sin(a) * it.e2.z) * it.radius,
        );
        it.mat.rotation += it.spin;
      }
    },
  };
}

// Bright head with a fading tail.
function meteorTexture() {
  const w = 160, h = 24, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(160,200,255,0)');
  grad.addColorStop(0.6, 'rgba(200,220,255,0.12)');
  grad.addColorStop(0.92, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad; g.fillRect(0, h / 2 - 1.5, w, 3);
  const hg = g.createRadialGradient(w - 8, h / 2, 0, w - 8, h / 2, 9);
  hg.addColorStop(0, 'rgba(255,255,255,1)'); hg.addColorStop(0.5, 'rgba(200,225,255,0.8)'); hg.addColorStop(1, 'rgba(160,200,255,0)');
  g.fillStyle = hg; g.beginPath(); g.arc(w - 8, h / 2, 9, 0, 7); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// Accretion disc for the black-hole portal (Phase 6): a glowing orange annulus with
// faint spiral streaks, transparent in the centre (the void shows through) and edges.
function accretionTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.translate(S / 2, S / 2);
  const grad = g.createRadialGradient(0, 0, S * 0.18, 0, 0, S * 0.5);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.12, 'rgba(255,240,210,0.95)');   // white-hot inner edge
  grad.addColorStop(0.30, 'rgba(255,150,40,0.80)');
  grad.addColorStop(0.62, 'rgba(255,85,0,0.40)');
  grad.addColorStop(1.00, 'rgba(120,20,0,0)');          // fades into space
  g.fillStyle = grad; g.beginPath(); g.arc(0, 0, S * 0.5, 0, 7); g.fill();
  g.globalCompositeOperation = 'destination-out';        // punch a clean void in the centre
  const hole = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.2);
  hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(0.7, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hole; g.beginPath(); g.arc(0, 0, S * 0.2, 0, 7); g.fill();
  g.globalCompositeOperation = 'lighter';
  for (let a = 0; a < 28; a++) {                          // faint spiral streaks → structure/swirl
    const ang = a * 0.61, r0 = S * 0.2 + (a % 5) * S * 0.012;
    g.strokeStyle = `rgba(255,225,190,${0.04 + (a % 7) * 0.012})`;
    g.lineWidth = 0.8 + (a % 3) * 0.5;
    g.beginPath();
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const rr = r0 + s * S * 0.28, aa = ang + s * 1.6;
      const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
      s === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// One shooting star at a time, streaking from a fresh random spot every ~10s.
function makeMeteors() {
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: meteorTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const sp = new THREE.Sprite(mat); sp.scale.set(190, 30, 1); group.add(sp);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  let active = false, t0 = 0, dur = 1, nextAt = 4;
  function spawn(t) {
    const x0 = (Math.random() * 2 - 1) * 1500, y0 = 500 + Math.random() * 700, z0 = -200 + Math.random() * 700;
    p0.set(x0, y0, z0);
    const dx = (Math.random() < 0.5 ? -1 : 1) * (800 + Math.random() * 1100), dy = -(350 + Math.random() * 650);
    p1.set(x0 + dx, y0 + dy, z0 + (Math.random() * 2 - 1) * 200);
    mat.rotation = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    dur = 0.9 + Math.random() * 0.6; t0 = t; active = true;
  }
  return {
    group,
    update(t) {
      if (!active) { if (t >= nextAt) spawn(t); else { mat.opacity = 0; return; } }
      const k = (t - t0) / dur;
      if (k >= 1) { active = false; mat.opacity = 0; nextAt = t + 8 + Math.random() * 5; return; }
      sp.position.set(p0.x + (p1.x - p0.x) * k, p0.y + (p1.y - p0.y) * k, p0.z + (p1.z - p0.z) * k);
      mat.opacity = Math.sin(k * Math.PI) * 0.95;
    },
  };
}

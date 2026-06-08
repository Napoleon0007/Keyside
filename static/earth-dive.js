// earth-dive.js — tap Earth in Rex's World and fall into the REAL planet.
// Renders Google's Photorealistic 3D Tiles (actual buildings/houses/terrain) in a
// fullscreen overlay using the 3d-tiles-renderer library. Fully self-contained: it
// loads its OWN three.js from a CDN (separate instance from the hero's three.js, so
// it can never disturb world.js / mobius.js). Activates only when window.openEarthDive
// is called, so if anything here fails it cannot affect the rest of the site.
//
// Requires window.GOOGLE_TILES_KEY (a Map Tiles API key, referrer-locked to this site),
// injected by the Flask template from the GOOGLE_TILES_KEY env var.
//
// Remove by deleting this file + its <script> tag in index.html and the Earth hook in
// world.js (search "openEarthDive").

const THREE_VER = '0.170.0';
const TILES_VER = '0.4.7';

// Default dive target — Cape Town (recognisable houses for Luke).
const DEFAULT_LAT = -33.9249, DEFAULT_LON = 18.4241;

let loading = false, openInstance = null;

window.openEarthDive = async function (lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  if (openInstance || loading) return;
  // Google's photoreal 3D Tiles stream hundreds of MB of mesh+texture — that crashes a
  // phone ("Can't open this page"). Keep the dive to desktops where there's memory for it.
  if (window.matchMedia('(max-width: 768px)').matches) {
    toast('🌍 Earth dive is a desktop feature — it streams heavy 3D tiles. Open Keyside on a computer to fly in.');
    return;
  }
  const key = window.GOOGLE_TILES_KEY;
  if (!key) { toast('Earth dive isn’t configured yet (missing tiles key).'); return; }

  loading = true;
  const overlay = buildOverlay();
  try {
    const [THREE, tilesMod, pluginsMod, orbitMod, gltfMod, dracoMod] = await Promise.all([
      import(`https://esm.sh/three@${THREE_VER}`),
      import(`https://esm.sh/3d-tiles-renderer@${TILES_VER}?deps=three@${THREE_VER}`),
      import(`https://esm.sh/3d-tiles-renderer@${TILES_VER}/plugins?deps=three@${THREE_VER}`),
      import(`https://esm.sh/three@${THREE_VER}/examples/jsm/controls/OrbitControls.js`),
      import(`https://esm.sh/three@${THREE_VER}/examples/jsm/loaders/GLTFLoader.js`),
      import(`https://esm.sh/three@${THREE_VER}/examples/jsm/loaders/DRACOLoader.js`),
    ]);
    openInstance = await startDive({
      THREE, overlay, key, lat, lon,
      TilesRenderer: tilesMod.TilesRenderer,
      GoogleCloudAuthPlugin: pluginsMod.GoogleCloudAuthPlugin,
      GLTFExtensionsPlugin: pluginsMod.GLTFExtensionsPlugin,
      TileCompressionPlugin: pluginsMod.TileCompressionPlugin,
      TilesFadePlugin: pluginsMod.TilesFadePlugin,
      ReorientationPlugin: pluginsMod.ReorientationPlugin,
      OrbitControls: orbitMod.OrbitControls,
      GLTFLoader: gltfMod.GLTFLoader,
      DRACOLoader: dracoMod.DRACOLoader,
    });
  } catch (err) {
    console.error('[earth-dive] failed:', err);
    showError(overlay, err);
  } finally {
    loading = false;
  }
};

async function startDive(ctx) {
  const { THREE, overlay, key, lat, lon, TilesRenderer, GoogleCloudAuthPlugin,
          GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin,
          ReorientationPlugin, OrbitControls, GLTFLoader, DRACOLoader } = ctx;

  const canvas = overlay.querySelector('.ed-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(1, 2, 1); scene.add(sun);

  const DEG = Math.PI / 180;
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
  const gltf = new GLTFLoader(); gltf.setDRACOLoader(draco);
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  // put the chosen lat/lon at the world origin, ground level, up = +Y
  tiles.registerPlugin(new ReorientationPlugin({ lat: lat * DEG, lon: lon * DEG, height: 0 }));
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.setCamera(camera);
  scene.add(tiles.group);

  tiles.addEventListener('load-tile-set', () => {
    const note = overlay.querySelector('.ed-loading'); if (note) note.classList.add('gone');
  });

  // controls orbit around the landing point
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 60;
  controls.maxDistance = 6000;

  // the dive: start high, ease down toward the rooftops
  camera.position.set(0, 4200, 4200);
  controls.target.set(0, 0, 0);
  let diveT = 0;
  const startPos = camera.position.clone();
  const endPos = new THREE.Vector3(0, 520, 760);

  let running = true;
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    if (diveT < 1) {
      diveT = Math.min(1, diveT + 0.006);
      const e = 1 - Math.pow(1 - diveT, 3);              // ease-out
      camera.position.lerpVectors(startPos, endPos, e);
    }
    controls.update();
    camera.updateMatrixWorld();
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.setCamera(camera);
    tiles.update();
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  function close() {
    running = false;
    window.removeEventListener('resize', onResize);
    try { tiles.dispose(); } catch (_) {}
    try { renderer.dispose(); } catch (_) {}
    overlay.classList.add('ed-out');
    setTimeout(() => overlay.remove(), 400);
    openInstance = null;
  }
  overlay.querySelector('.ed-close').addEventListener('click', close);
  overlay._close = close;
  return { close };
}

// ── overlay DOM (styles inline so the module is self-contained) ────────────────
function buildOverlay() {
  const o = document.createElement('div');
  o.className = 'ed-overlay';
  o.innerHTML =
    '<canvas class="ed-canvas"></canvas>' +
    '<div class="ed-loading"><span class="ed-spin"></span>Falling to Earth…</div>' +
    '<button class="ed-close" aria-label="Back to Rex’s World">✕ Back to the cosmos</button>';
  injectStyles();
  document.body.appendChild(o);
  requestAnimationFrame(() => o.classList.add('ed-in'));
  return o;
}

function showError(overlay, err) {
  const note = overlay.querySelector('.ed-loading');
  if (note) {
    note.classList.remove('gone');
    note.innerHTML = '<div style="max-width:520px;text-align:center;line-height:1.5">' +
      'Couldn’t load the 3D Earth.<br><span style="opacity:.7;font-size:.8em">' +
      String(err && err.message || err).replace(/[<>]/g, '') + '</span></div>';
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:99999;' +
    'background:rgba(8,4,2,.92);color:#fff;border:1px solid #ff5500;border-radius:999px;' +
    'padding:12px 22px;font-family:sans-serif;font-size:14px;box-shadow:0 0 30px rgba(255,85,0,.4)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return; stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .ed-overlay{position:fixed;inset:0;z-index:99998;background:#02040a;opacity:0;
      transition:opacity .4s ease}
    .ed-overlay.ed-in{opacity:1}
    .ed-overlay.ed-out{opacity:0}
    .ed-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
    .ed-loading{position:absolute;inset:0;display:flex;gap:14px;align-items:center;justify-content:center;
      color:#fff;font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.06em;
      background:radial-gradient(circle at 50% 50%,rgba(6,12,26,.4),#02040a);transition:opacity .6s ease}
    .ed-loading.gone{opacity:0;pointer-events:none}
    .ed-spin{width:22px;height:22px;border:3px solid rgba(255,85,0,.3);border-top-color:#ff5500;
      border-radius:50%;animation:edspin .8s linear infinite}
    @keyframes edspin{to{transform:rotate(360deg)}}
    .ed-close{position:absolute;top:20px;right:20px;z-index:5;cursor:pointer;
      background:rgba(8,4,2,.7);color:#fff;border:1px solid #ff5500;border-radius:999px;
      padding:10px 18px;font-family:'Space Mono',monospace;font-size:.75rem;letter-spacing:.12em;
      text-transform:uppercase;backdrop-filter:blur(4px);box-shadow:0 0 24px rgba(255,85,0,.35)}
    .ed-close:hover{background:#ff5500;color:#000}`;
  document.head.appendChild(s);
}

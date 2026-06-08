// threebody.js — interactive 3D three-body gravity sandbox (Three.js).
// Drag a planet to place it, flick to throw it (sets its launch velocity), scroll
// on it to change its mass. Drag empty space to orbit the camera, scroll to zoom,
// double-click a planet to ride along. Press Run and watch full 3D Newtonian
// mutual gravity play out with glowing trails. Symplectic velocity-Verlet (dt 0.001).

import * as THREE from 'three';

const COLORS = [0xff5500, 0x33b6ff, 0xb06bff];
const NAMES  = ['Body I', 'Body II', 'Body III'];

// Create the renderer robustly: try a few option sets, each on a FRESH canvas
// (a canvas caches a failed context, so retrying needs a new one). The
// 'high-performance' GPU request fails on some Macs even when plain WebGL works.
const slot = document.getElementById('sim');
let renderer = null, canvas = slot;
for (const o of [
  { antialias: true, powerPreference: 'high-performance' },
  { antialias: true, powerPreference: 'default' },
  { antialias: true },
  { antialias: false },
  {},
]) {
  try { renderer = new THREE.WebGLRenderer(o); break; } catch (e) { renderer = null; }
}
if (!renderer) {
  document.getElementById('glfail')?.removeAttribute('hidden');
} else {
  canvas = renderer.domElement;          // use the renderer's own working canvas
  canvas.id = 'sim';
  if (slot && slot.parentNode) slot.parentNode.replaceChild(canvas, slot);
  boot();
}

function boot() {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x03040a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;                 // #1: real cast shadows → planet-on-planet eclipses
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // soft penumbra, not hard edges

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03040a, 0.0009);   // light touch: depth haze without fogging out the starfield
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 4000);

  // Lighting rig (#1): a warm key gives every sphere a real lit side + terminator
  // (so it reads 3D even with no star present); a cool fill keeps dark sides from
  // crushing to black and adds rim shape; ambient is low so form survives.
  scene.add(new THREE.AmbientLight(0x35507a, 0.22));
  const keyLight = new THREE.DirectionalLight(0xfff1dd, 1.15);
  keyLight.position.set(24, 20, 16);                 // pulled out so the shadow frustum brackets the whole field
  keyLight.castShadow = true;                         // #1: the single shadow caster (cheap, consistent eclipses)
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 90;
  keyLight.shadow.camera.left = -20; keyLight.shadow.camera.right = 20;
  keyLight.shadow.camera.top = 20; keyLight.shadow.camera.bottom = -20;
  keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x4d74c8, 0.4);
  fillLight.position.set(-5, -2, -4); scene.add(fillLight);
  const starTex = starSprite();                        // shared point-sprite for the star layers (init before first use)
  const ambient = new THREE.Group();
  ambient.add(makeStars(9000, 1.4, 0.95, 300, 2200));  // far, very dense field
  ambient.add(makeStars(2600, 2.2, 1.0, 120, 900));    // mid layer
  const starNear = makeStars(700, 3.6, 1.0, 80, 480);  // near, bright headline stars
  ambient.add(starNear);                               // #5: drifts a touch faster → parallax shear vs the far field
  ambient.add(makeNebula());
  ambient.add(makeGalaxies());
  const shootingStars = makeShootingStars();           // sporadic streaks across the deep background
  scene.add(shootingStars.group);
  scene.add(ambient);

  // Real bloom for that sharp neon-in-space glow (loaded lazily; falls back if it fails).
  let composer = null, bokeh = null;
  (async () => {
    try {
      const base = 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/';
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { BokehPass }] = await Promise.all([
        import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'), import(base + 'UnrealBloomPass.js'), import(base + 'BokehPass.js'),
      ]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bokeh = new BokehPass(scene, camera, { focus: 5.0, aperture: 0.00026, maxblur: 0.009 });  // #5: cinematic depth of field (readable rack)
      composer.addPass(bokeh);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.85, 0.65, 0.8));
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(canvas.clientWidth, canvas.clientHeight);
    } catch (e) { composer = null; }
  })();

  // #5: anamorphic lens flare + sunburst rays from the star (lazy; harmless if it fails)
  let lensflare = null;
  (async () => {
    try {
      const { Lensflare, LensflareElement } = await import('https://unpkg.com/three@0.160.0/examples/jsm/objects/Lensflare.js');
      const burst = (() => {
        const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); g.translate(s / 2, s / 2);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, s / 2); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.22, 'rgba(255,228,186,0.55)'); rg.addColorStop(1, 'rgba(255,196,130,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, s / 2, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(255,240,210,0.75)'; g.lineWidth = 2;
        for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * s / 2, Math.sin(a) * s / 2); g.stroke(); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const streak = (() => {
        const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
        const lg = g.createLinearGradient(0, 0, s, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,244,224,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg; g.fillRect(0, s / 2 - 2, s, 4); g.globalAlpha = 0.32; g.fillRect(0, s / 2 - 9, s, 18); g.globalAlpha = 1;
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const lf = new Lensflare();
      lf.addElement(new LensflareElement(burst, 300, 0, new THREE.Color(0xffe6c0)));
      lf.addElement(new LensflareElement(streak, 700, 0, new THREE.Color(0xfff0d8)));
      lf.addElement(new LensflareElement(glowTex, 50, 0.35, new THREE.Color(0xff8a3d)));
      lf.addElement(new LensflareElement(glowTex, 90, 0.55, new THREE.Color(0x6fa8ff)));
      lf.addElement(new LensflareElement(glowTex, 60, 0.72, new THREE.Color(0xb06bff)));
      lf.addElement(new LensflareElement(glowTex, 130, 1.0, new THREE.Color(0xffd28a)));
      lf.visible = false; scene.add(lf); lensflare = lf;
    } catch (e) { lensflare = null; }
  })();

  // ── simulation state ────────────────────────────────────────────────────────
  let G = 1.0, softening = 0.03, speed = 0.4, showTrails = true, solarMode = false, systemMode = false;
  let solarRings = [], SOLAR_TEX = null;
  let mode = 'setup';                     // 'setup' | 'running' | 'paused'
  let bodies = [];
  let manualEdited = false;               // user moved/resized a planet → auto-orbit on Run
  const TRAIL_MAX = 700;
  const glowTex = makeGlowTexture();
  const texLoader = new THREE.TextureLoader();
  const loadTex = (n) => { const t = texLoader.load(`/static/textures/${n}.jpg`); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const PLANET_TEX = [loadTex('marsmap1k'), loadTex('earthmap1k'), loadTex('jupitermap')];
  const EARTH_NIGHT = texLoader.load('/static/textures/earthlights1k.jpg');   // NASA Black Marble city lights (sampled raw → leave linear)
  const STAR_MASS = 5.5;                 // a body this heavy (or heavier) ignites into a star

  // #5: a cheap procedural cosmic cube-map so planets reflect the nebula/starfield
  const envCube = (() => {
    const tints = ['#1a2c52', '#2a1a4a', '#10314f', '#3a1530', '#24407a', '#2e1840'], faces = [];
    for (let f = 0; f < 6; f++) {
      const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
      const rg = g.createRadialGradient(s * 0.5, s * 0.42, 0, s * 0.5, s * 0.5, s * 0.72);
      rg.addColorStop(0, tints[f]); rg.addColorStop(1, '#04060e'); g.fillStyle = rg; g.fillRect(0, 0, s, s);
      g.fillStyle = '#cfe3ff'; for (let i = 0; i < 45; i++) { g.globalAlpha = Math.random() * 0.6 + 0.2; g.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4); } g.globalAlpha = 1;
      faces.push(c);
    }
    const t = new THREE.CubeTexture(faces); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // ── star shaders: a boiling-plasma surface + a flickering corona of flames (#3) ──
  const NOISE_GLSL = `
    float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z); }
    float fbm(vec3 p){ float v=0.0,a=0.5; for(int k=0;k<5;k++){ v+=a*vnoise(p); p*=2.0; a*=0.5; } return v; }`;
  const starUniforms = { uTime: { value: 0 } };
  const starSurfaceMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: NOISE_GLSL + `
      varying vec3 vPos; uniform float uTime;
      void main(){
        vec3 p=normalize(vPos);
        float g = fbm(p*4.0 + vec3(0.0,0.0,uTime*0.15))*0.7 + fbm(p*9.0 - vec3(uTime*0.22))*0.4;
        vec3 cool=vec3(0.85,0.20,0.02), hot=vec3(1.0,0.86,0.46);
        vec3 col=mix(cool,hot, smoothstep(0.32,0.95,g));
        col += pow(max(g-0.72,0.0),2.0)*vec3(1.3,0.95,0.55)*4.0;   // white-hot granule flecks
        gl_FragColor=vec4(col*1.5, 1.0);
      }`,
  });
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: starUniforms, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vPos; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=mv.xyz; vPos=position; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: NOISE_GLSL + `
      varying vec3 vN; varying vec3 vP; varying vec3 vPos; uniform float uTime;
      void main(){
        float fres=pow(1.0-abs(dot(normalize(vN),normalize(-vP))),1.8);
        vec3 p=normalize(vPos);
        float flame=fbm(p*5.0 + vec3(0.0,uTime*0.6,0.0));   // flames lick upward over time
        float a=fres*(0.35+0.85*flame);
        vec3 col=mix(vec3(1.0,0.35,0.04), vec3(1.0,0.72,0.30), flame);
        gl_FragColor=vec4(col, a*0.95);
      }`,
  });

  // ── world detail (#2): a ringed gas giant + a drifting cloud layer ──────────────
  const ringTex = loadTex('saturnringcolor');
  function ringSystem() {                            // flat annulus, texture mapped inner→outer
    const g = new THREE.RingGeometry(1.4, 2.35, 96, 1);
    const pos = g.attributes.position, uv = g.attributes.uv, v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v3.fromBufferAttribute(pos, i); uv.setXY(i, (v3.length() - 1.4) / 0.95, 0.5); }
    const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ringTex, alphaMap: ringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.92 }));
    ring.rotation.x = Math.PI / 2 - 0.32; ring.rotation.y = 0.18;
    return ring;
  }
  function cloudShell() {                             // wispy procedural clouds drifting over the surface
    return new THREE.Mesh(new THREE.SphereGeometry(1.014, 40, 40), new THREE.ShaderMaterial({
      uniforms: starUniforms, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: NOISE_GLSL + `varying vec3 vPos; uniform float uTime;
        void main(){ vec3 p=normalize(vPos); float c=fbm(p*3.2 + vec3(uTime*0.02,0.0,0.0)); float a=smoothstep(0.55,0.82,c); gl_FragColor=vec4(vec3(1.0), a*0.6); }`,
    }));
  }

  function visRadius(m) { return Math.max(0.18, Math.cbrt(m) * 0.2); }

  // Atmospheric-scattering shell: a Fresnel limb that glows blue on the lit side,
  // reddens to a sunset where it meets the day/night terminator, and fades to
  // nothing on the night limb. uSun is the light direction in VIEW space (matches
  // the shell's view-space normal, so the effect is invariant to camera orbit).
  function atmosphere(colorInt) {
    return new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(colorInt) }, uSun: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=mv.xyz; gl_Position=projectionMatrix*mv; }',
      fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uColor; uniform vec3 uSun;
        void main(){
          vec3 N = normalize(vN), V = normalize(-vP);
          float fres = pow(1.0 - abs(dot(N, V)), 2.6);
          float ndl = dot(N, normalize(uSun));
          float day = smoothstep(-0.25, 0.35, ndl);
          float sunset = smoothstep(0.55, 0.0, abs(ndl)) * smoothstep(-0.45, 0.05, ndl);
          vec3 col = mix(uColor, vec3(1.0, 0.45, 0.18), sunset * 0.85);
          gl_FragColor = vec4(col, fres * (0.12 + 0.95 * day) * 0.95);
        }`,
    }));
  }

  // A neutron star: a tiny, blindingly blue-white core (no orange plasma).
  const neutronMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ff });
  // Twin pulsar beams — two opposed cones on a tilted magnetic axis; the whole rig
  // spins so the beams sweep the sky like a lighthouse.
  function makeBeams() {
    const grp = new THREE.Group(), axis = new THREE.Group();
    axis.rotation.z = 0.42;                                   // magnetic axis tilted off the spin axis → it sweeps
    const geo = new THREE.ConeGeometry(0.5, 5, 28, 1, true); geo.translate(0, -2.5, 0);   // apex at the star
    const mat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; void main(){ vY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float vY; void main(){ float a=clamp((vY+5.0)/5.0,0.0,1.0); gl_FragColor=vec4(0.55,0.82,1.0, a*0.42); }',
    });
    const c1 = new THREE.Mesh(geo, mat), c2 = new THREE.Mesh(geo, mat); c2.rotation.x = Math.PI;
    c1.frustumCulled = c2.frustumCulled = false;
    axis.add(c1, c2); grp.add(axis); grp.renderOrder = 2;
    return grp;
  }

  function makeBody(x, y, z, vx, vy, vz, m, i, opts) {
    opts = opts || {};                   // opts lets the Solar System place arbitrary planets; 3-body presets pass none
    const color = opts.color != null ? opts.color : COLORS[i];
    const tex = opts.tex !== undefined ? opts.tex : PLANET_TEX[i];
    const name = opts.name != null ? opts.name : NAMES[i];
    const photoreal = opts.photoreal != null ? opts.photoreal : (i === 1);       // Earth treatment
    const hasRing = opts.ring != null ? opts.ring : (i === 2);
    const hasCloud = opts.cloud != null ? opts.cloud : (i === 1);
    const noLight = !!opts.noLight;      // Solar planets skip their own point light (Sun lights them) → far cheaper on mobile
    const neutron = !!opts.neutron;      // a neutron star: blue-white core + sweeping pulsar beams
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.05, emissive: color, emissiveIntensity: 0.05,
      roughness: photoreal ? 0.48 : 0.62, metalness: photoreal ? 0.22 : 0.08,    // #2: lower roughness → a tight specular hotspot that travels as it spins
      envMap: envCube, envMapIntensity: photoreal ? 0.7 : 0.45 });               // #5: faint cosmic reflection
    if (photoreal) {                     // Earth → photoreal: night city lights, ocean-only specular, cloud shadows
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uNightMap = { value: EARTH_NIGHT };
        shader.uniforms.uSunView = { value: new THREE.Vector3(0, 0, 1) };
        shader.uniforms.uCloudT = starUniforms.uTime;       // share the boil clock so shadows drift
        shader.fragmentShader = NOISE_GLSL +
          '\nuniform sampler2D uNightMap; uniform vec3 uSunView; uniform float uCloudT;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>',                                       // oceans glint, land stays matte
            '#include <roughnessmap_fragment>\n{ vec3 _d=texture2D(map,vMapUv).rgb; float _o=smoothstep(0.02,0.16,_d.b-max(_d.r,_d.g)); roughnessFactor=mix(roughnessFactor,0.18,_o); }')
          .replace('#include <map_fragment>',                                                // soft drifting cloud shadows on the surface
            '#include <map_fragment>\n{ float _c=fbm(vec3(vMapUv*7.0+vec2(uCloudT*0.012,0.0),0.0)); diffuseColor.rgb*=(1.0-smoothstep(0.52,0.82,_c)*0.32); }')
          .replace('#include <emissivemap_fragment>',                                        // city lights, only on the night side
            '#include <emissivemap_fragment>\n{ float _n=smoothstep(0.18,-0.12,dot(normalize(vNormal),normalize(uSunView))); totalEmissiveRadiance+=texture2D(uNightMap,vMapUv).rgb*_n*vec3(1.25,1.05,0.7)*4.2; }');
        mat.userData.shader = shader;
      };
      mat.customProgramCacheKey = () => 'earth-photoreal';
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 40), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;   // #1: occlude + catch eclipses
    let cloud = null, ring = null;
    if (hasCloud) { cloud = cloudShell(); mesh.add(cloud); }                    // Earth → drifting clouds
    if (hasRing) { ring = ringSystem(); mesh.add(ring); }                       // ringed giant → ring system
    const corona = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), coronaMat);   // flames, shown only when this body is a star
    corona.visible = false; scene.add(corona);
    const atmo = atmosphere(color); scene.add(atmo);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const light = new THREE.PointLight(color, 1.2, 80, 2);
    if (!noLight) mesh.add(light);
    let beams = null;
    if (neutron) { beams = makeBeams(); beams.visible = false; scene.add(beams); }
    scene.add(mesh); scene.add(glow);

    const line = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(line);

    // generous invisible hit-sphere so the planet is easy to grab/drag
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(hit);

    return { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz), m, idx: i, color: new THREE.Color(color), name, photoreal, neutron, rVis: opts.rVis || 0, mesh, mat, cloud, ring, corona, atmo, glow, line, light, beams, hit, trail: [], star: null };
  }

  function clearBodies() {
    bodies.forEach(b => scene.remove(b.mesh, b.corona, b.atmo, b.glow, b.line, b.hit, b.beams));
    bodies = [];
    solarRings.forEach(r => { scene.remove(r); r.geometry.dispose(); }); solarRings = [];
    grid.wells.material.opacity = 1.0;     // restore full well-glow for the 3-body sandbox
    solarMode = systemMode = false;
  }

  const _sunWorld = new THREE.Vector3(), _sunView = new THREE.Vector3();
  function applyVisual(b) {
    const r = b.rVis || visRadius(b.m);    // Solar bodies carry an explicit visual size (decoupled from their light mass)
    const isStar = b.m >= STAR_MASS;
    if (isStar !== b.star) {               // swap planet⇄star look only when it flips
      b.star = isStar;
      b.mesh.material = b.neutron ? neutronMat : (isStar ? starSurfaceMat : b.mat);   // neutron core · plasma sun · textured planet
      b.atmo.visible = !isStar && !b.neutron;   // star/neutron use corona/beams instead of the soft atmosphere shell
      b.corona.visible = isStar && !b.neutron;  // neutron has no orange flame corona
      if (b.cloud) b.cloud.visible = !isStar;
      if (b.ring) b.ring.visible = !isStar;
      b.glow.material.color.set(b.neutron ? 0xcfe6ff : (isStar ? 0xffc070 : b.color.getHex()));
    }
    b.light.intensity = b.neutron ? 5.0 : (isStar ? (solarMode ? 3.0 : 6.5) : 0.45);   // softer Sun in solar mode; neutron is a hot blue key
    b.light.distance = (isStar || b.neutron) ? 160 : 70;
    b.mesh.position.copy(b.pos); b.mesh.scale.setScalar(r);
    b.corona.position.copy(b.pos); b.corona.scale.setScalar(r * 1.42);
    b.atmo.position.copy(b.pos); b.atmo.scale.setScalar(r * (b.photoreal ? 1.34 : 1.26));
    // light direction toward the dominant source (a star if present, else the key light), in view space
    _sunWorld.set(24, 20, 16);
    const star = bodies.find(s => s.star && s !== b);
    if (star) _sunWorld.subVectors(star.pos, b.pos);
    _sunView.copy(_sunWorld).transformDirection(camera.matrixWorldInverse);
    b.atmo.material.uniforms.uSun.value.copy(_sunView);
    if (b.photoreal) {                                        // Earth → blue sky + feed the surface shader
      b.atmo.material.uniforms.uColor.value.set(0x6fb3ff);
      if (b.mat.userData.shader) b.mat.userData.shader.uniforms.uSunView.value.copy(_sunView);
    } else {
      b.atmo.material.uniforms.uColor.value.set(b.color.getHex());
    }
    b.glow.position.copy(b.pos); b.glow.scale.setScalar(r * (b.neutron ? 9 : (isStar ? (solarMode ? 2.8 : 4.6) : 6.5)));   // small star halo; neutron is a tight intense point
    b.glow.material.opacity = b.neutron ? 0.5 : (isStar ? (solarMode ? 0.26 : 0.4) : 0.6);
    if (b.beams) { b.beams.position.copy(b.pos); b.beams.visible = true; }
    b.hit.position.copy(b.pos); b.hit.scale.setScalar(Math.max(r * 2.8, 0.55));
  }

  // ── spacetime curvature surface (#1): a living 3D rubber-sheet — a translucent
  //    dark body for presence, glowing gravity wells in each mass's colour, and the
  //    neon wireframe on top. All three share one bending displacement. ──────────
  let showGrid = true;
  const grid = makeGrid(15, 88, -2.8);
  grid.surface.renderOrder = 0; grid.wells.renderOrder = 1; grid.lines.renderOrder = 2;
  scene.add(grid.surface); scene.add(grid.wells); scene.add(grid.lines);
  function makeGrid(half, seg, y0) {
    const N = seg + 1, base = new Float32Array(N * N * 3), lcol = new Float32Array(N * N * 3);
    const c = new THREE.Color(0x2f6bff);
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const v = j * N + k, x = (k / (N - 1) * 2 - 1) * half, z = (j / (N - 1) * 2 - 1) * half;
      base[v * 3] = x; base[v * 3 + 1] = 0; base[v * 3 + 2] = z;
      const edge = Math.pow(1 - Math.min(1, Math.hypot(x, z) / half), 1.4);  // fade to dark at the rim
      lcol[v * 3] = c.r * edge; lcol[v * 3 + 1] = c.g * edge; lcol[v * 3 + 2] = c.b * edge;
    }
    // wireframe (line segments)
    const lidx = [];
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) { const a = j * N + k; if (k < N - 1) lidx.push(a, a + 1); if (j < N - 1) lidx.push(a, a + N); }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(base.slice(), 3));
    lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
    lgeo.setIndex(lidx);
    const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    // filled sheet (triangles) — shared by the dark body and the glowing wells
    const tidx = [];
    for (let j = 0; j < N - 1; j++) for (let k = 0; k < N - 1; k++) { const a = j * N + k; tidx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1); }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(base.slice(), 3));
    tgeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * N * 3), 3));
    tgeo.setIndex(tidx);
    const surfMat = new THREE.MeshBasicMaterial({ color: 0x0c213f, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false });
    const surface = new THREE.Mesh(tgeo, surfMat);   // unlit transparent blue sheet → never catches the star's warm light
    const wells = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    const larr = lgeo.attributes.position.array, tarr = tgeo.attributes.position.array, carr = tgeo.attributes.color.array;
    const WELL = new THREE.Color(0x4f9bff);                     // uniform sky-blue well-glow (never the star's orange)
    function update(bs) {
      for (let v = 0; v < N * N; v++) {
        const x = base[v * 3], z = base[v * 3 + 2];
        let d = 0, wsum = 0;
        for (const b of bs) {
          const dx = x - b.pos.x, dz = z - b.pos.z, inv = b.m / (dx * dx + dz * dz + 0.35);
          d += 1.4 * inv;
          wsum += Math.min(0.55 * inv, 1.7);                   // glow weight by depth (colour is always blue)
        }
        const cr = WELL.r * wsum, cg = WELL.g * wsum, cb = WELL.b * wsum;
        const y = y0 - Math.min(d, 6);
        larr[v * 3 + 1] = y; tarr[v * 3 + 1] = y;
        carr[v * 3] = cr; carr[v * 3 + 1] = cg; carr[v * 3 + 2] = cb;
      }
      lgeo.attributes.position.needsUpdate = true;
      tgeo.attributes.position.needsUpdate = true;
      tgeo.attributes.color.needsUpdate = true;
    }
    return { lines, surface, wells, update };
  }

  // ── presets: the infinite symmetric family + free-form ──────────────────────
  function symmetric(p1, p2) {
    G = 1; softening = 0.0;
    clearBodies();
    bodies = [
      makeBody(-1, 0, 0, p1, p2, 0, 1, 0),
      makeBody( 1, 0, 0, p1, p2, 0, 1, 1),
      makeBody( 0, 0, 0, -2 * p1, -2 * p2, 0, 1, 2),
    ];
    camOrbit.radius = 4.6;
  }
  const SYM = {
    'figure-8':    [0.3471128135672417, 0.532726851767674],
    'butterfly':   [0.30689, 0.12551],
    'butterfly-2': [0.39295, 0.09758],
    'bumblebee':   [0.18428, 0.58719],
    'moth':        [0.46444, 0.39606],
    'moth-2':      [0.43917, 0.45297],
    'goggles':     [0.08330, 0.12789],
    'dragonfly':   [0.08058, 0.58884],
    'yin-yang':    [0.51394, 0.30474],
    'yarn':        [0.55906, 0.34919],
  };
  const PRESETS = {
    'orbit': () => { G = 1; softening = 0.02; clearBodies(); bodies = [
      makeBody(0, 0, 0, 0, 0, 0, 12, 0),
      makeBody(1.1, 0, 0, 0, 3.3, 0, 1, 1),
      makeBody(-1.7, 0, 0, 0, -2.6, 0.3, 1, 2),
    ]; camOrbit.radius = 6; },
    'chaos': () => { G = 1; softening = 0.03; clearBodies(); bodies = [
      makeBody(-1.0, 0.3, 0.2, 0.2, 0.25, -0.1, 4, 0),
      makeBody( 1.0, 0.0, -0.3, -0.1, -0.35, 0.15, 4, 1),
      makeBody( 0.1, -1.0, 0.1, 0.05, 0.15, 0.05, 4, 2),
    ]; camOrbit.radius = 6; },
    'random': () => { G = 1; softening = 0.03; clearBodies(); const r = () => (Math.random() * 2 - 1);
      bodies = [0, 1, 2].map(i => makeBody(r() * 1.2, r() * 1.2, r() * 1.2, r() * 0.6, r() * 0.6, r() * 0.6, 2 + Math.random() * 6, i));
      camOrbit.radius = 6; },
  };

  // ── our Solar System (realistic, Sun-dominated) ──────────────────────────────────
  //    The Sun + 8 planets on circular orbits (v=√(GM/r)). Distances/sizes are
  //    visually compressed (true scale is unwatchable), but the PHYSICS is honest:
  //    the Sun outweighs the planets ~25–1000×, so dragging one out of line wrecks
  //    ITS orbit while the rest keep sailing — exactly as the real system behaves.
  function solarTextures() {
    if (SOLAR_TEX) return SOLAR_TEX;
    SOLAR_TEX = {                       // earth/mars/jupiter already loaded in PLANET_TEX — reuse
      mercury: loadTex('mercurymap'), venus: loadTex('venusmap'), earth: PLANET_TEX[1],
      mars: PLANET_TEX[0], jupiter: PLANET_TEX[2], saturn: loadTex('saturnmap'),
      uranus: loadTex('uranusmap'), neptune: loadTex('neptunemap'),
    };
    return SOLAR_TEX;
  }
  function addOrbitRing(radius) {
    const seg = 160, pts = [];
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)); }
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x6f8fbf, transparent: true, opacity: 0.16, depthWrite: false }));
    scene.add(ring); solarRings.push(ring);
  }
  function solarSystem() {
    G = 1; softening = 0.02; clearBodies(); solarMode = true; systemMode = true;
    grid.wells.material.opacity = 0.5;        // dim the warm well-glow so the Sun's funnel doesn't flood the scene
    const T = solarTextures(), MSUN = 42;      // dominant (≥17× any planet) → planets stay calm, but a shallower/narrower well
    // name, texture, colour, orbit radius, mass (≪ Sun), visual radius, ring?, photoreal?
    const defs = [
      ['Mercury', T.mercury, 0x9c8b7a, 1.30, 0.05, 0.12, false, false],
      ['Venus',   T.venus,   0xd9b78a, 1.95, 0.30, 0.20, false, false],
      ['Earth',   T.earth,   0x6fb3ff, 2.65, 0.32, 0.21, false, true ],
      ['Mars',    T.mars,    0xd0683a, 3.45, 0.12, 0.16, false, false],
      ['Jupiter', T.jupiter, 0xcaa37a, 5.30, 2.40, 0.50, false, false],
      ['Saturn',  T.saturn,  0xd8c08a, 7.20, 1.80, 0.44, true,  false],
      ['Uranus',  T.uranus,  0x9fe0e6, 9.10, 0.90, 0.32, false, false],
      ['Neptune', T.neptune, 0x4f6cff, 11.0, 0.95, 0.31, false, false],
    ];
    const sun = makeBody(0, 0, 0, 0, 0, 0, MSUN, 0, { name: 'Sun', color: 0xffc070, tex: null, rVis: 1.1 });
    bodies = [sun];
    let px = 0, pz = 0;
    defs.forEach((d, k) => {
      const [name, tex, color, dist, mass, rVis, ring, photoreal] = d;
      const ang = k * 0.9 + 0.4;        // fan them around so they don't start in a line
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      const v = Math.sqrt(G * MSUN / dist);     // circular-orbit speed, tangential in the XZ plane
      const vx = -Math.sin(ang) * v, vz = Math.cos(ang) * v;
      bodies.push(makeBody(x, 0, z, vx, 0, vz, mass, k + 1, { name, tex, color, rVis, ring, photoreal, cloud: photoreal, noLight: true }));
      px += mass * vx; pz += mass * vz;
      addOrbitRing(dist);
    });
    sun.vel.set(-px / MSUN, 0, -pz / MSUN);       // cancel net momentum → Sun (and the frame) stays put
    const portrait = canvas.clientHeight > canvas.clientWidth;
    camOrbit.radius = portrait ? 48 : 32;          // pull back on a phone so the whole disc fits the narrow width
    camOrbit.phi = 0.82; camOrbit.theta = 0.6;     // flatter, higher view reads the orbital disc
    speed = 6;                                      // planets crawl at slow-mo speeds — run the system briskly
    if ($('speed')) { $('speed').value = speed; $('speedVal').textContent = speed.toFixed(1) + '×'; }
  }

  // ── a neutron star + tight, fast-whipping companions ─────────────────────────────
  //    A tiny ultra-dense core (huge mass, sweeping pulsar beams) the worlds race
  //    around — extreme gravity made visible. Same honest physics: drag one out and
  //    only its orbit is wrecked.
  function neutronStar() {
    G = 1; softening = 0.02; clearBodies(); systemMode = true;
    grid.wells.material.opacity = 0.5;
    const T = solarTextures(), MNS = 70;     // tiny radius, enormous mass → blistering close orbits
    const ns = makeBody(0, 0, 0, 0, 0, 0, MNS, 0, { name: 'Neutron Star', color: 0xbcd8ff, tex: null, rVis: 0.24, neutron: true });
    bodies = [ns];
    const defs = [
      ['Inner',  T.mars,    0xd0683a, 1.5, 0.25, 0.16, false],
      ['Middle', T.earth,   0x6fb3ff, 2.4, 0.30, 0.20, true ],
      ['Outer',  T.jupiter, 0xcaa37a, 3.6, 0.60, 0.32, false],
    ];
    let px = 0, pz = 0;
    defs.forEach((d, k) => {
      const [name, tex, color, dist, mass, rVis, photoreal] = d;
      const ang = k * 2.1 + 0.5;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      const v = Math.sqrt(G * MNS / dist);
      bodies.push(makeBody(x, 0, z, -Math.sin(ang) * v, 0, Math.cos(ang) * v, mass, k + 1, { name, tex, color, rVis, photoreal, cloud: photoreal, noLight: true }));
      px += mass * (-Math.sin(ang) * v); pz += mass * (Math.cos(ang) * v);
      addOrbitRing(dist);
    });
    ns.vel.set(-px / MNS, 0, -pz / MNS);
    const portrait = canvas.clientHeight > canvas.clientWidth;
    camOrbit.radius = portrait ? 20 : 13; camOrbit.phi = 0.92; camOrbit.theta = 0.6;
    speed = 2.5; if ($('speed')) { $('speed').value = speed; $('speedVal').textContent = speed.toFixed(1) + '×'; }
  }

  let currentPreset = 'figure-8';
  function loadPreset(name) {
    if (name === 'explore') symmetric(+$('vx').value, +$('vy').value);
    else if (name === 'solar') solarSystem();
    else if (name === 'neutron') neutronStar();
    else if (SYM[name]) { symmetric(SYM[name][0], SYM[name][1]); if ($('vx')) { $('vx').value = SYM[name][0]; $('vy').value = SYM[name][1]; readout(); } }
    else PRESETS[name]();
    mode = 'setup';
    camOrbit.follow = -1; camTarget.set(0, 0, 0);
    cinemaHomeR = camOrbit.radius; cinemaHomePhi = camOrbit.phi; idleFrames = 0;   // re-home the auto-cinema to this world's framing
    bodies.forEach(b => { b.trail.length = 0; applyVisual(b); });
    updateRun();
  }

  // ── physics ──────────────────────────────────────────────────────────────────
  const _a = [];                                   // grows to match the body count (3 sandbox · 9 solar)
  function accel() {
    const n = bodies.length;
    while (_a.length < n) _a.push(new THREE.Vector3());
    for (let i = 0; i < n; i++) _a[i].set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      if (bodies[i] === dragBody) continue;          // held body is steered by the finger, not gravity
      for (let j = 0; j < n; j++) {
        if (i === j || bodies[j] === dragBody) continue;   // a held body exerts no pull → its gravity is "taken away"
        const dx = bodies[j].pos.x - bodies[i].pos.x, dy = bodies[j].pos.y - bodies[i].pos.y, dz = bodies[j].pos.z - bodies[i].pos.z;
        // soften by at least the pair's combined radius so an overlapping pass gives a
        // strong-but-finite slingshot, never an infinite-force explosion
        const soft = Math.max(softening, visRadius(bodies[i].m) + visRadius(bodies[j].m));
        const r2 = dx * dx + dy * dy + dz * dz + soft * soft;
        const inv = G * bodies[j].m / (r2 * Math.sqrt(r2));
        _a[i].x += inv * dx; _a[i].y += inv * dy; _a[i].z += inv * dz;
      }
    }
  }
  function integrate(dt) {
    const n = bodies.length;
    accel();
    for (let i = 0; i < n; i++) { if (bodies[i] === dragBody) continue; bodies[i].vel.addScaledVector(_a[i], 0.5 * dt); bodies[i].pos.addScaledVector(bodies[i].vel, dt); }
    accel();
    for (let i = 0; i < n; i++) { if (bodies[i] === dragBody) continue; bodies[i].vel.addScaledVector(_a[i], 0.5 * dt); }
  }

  // Auto-orbit: from any placement, hand each body a balanced tangential velocity
  // so the system swirls into a pleasing bound orbit — no physics knowledge needed.
  function autoOrbit() {
    const C = new THREE.Vector3(); let M = 0;
    bodies.forEach(b => { C.addScaledVector(b.pos, b.m); M += b.m; });
    C.multiplyScalar(1 / M);
    // spin axis = normal of the plane through the bodies (fallback: up) — survives a merge to 2
    let axis = new THREE.Vector3(0, 1, 0);
    if (bodies.length >= 3) axis.subVectors(bodies[1].pos, bodies[0].pos).cross(new THREE.Vector3().subVectors(bodies[2].pos, bodies[0].pos));
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0); else axis.normalize();
    bodies.forEach(b => {
      const r = new THREE.Vector3().subVectors(b.pos, C);
      const dist = Math.max(r.length(), 0.25);
      const tang = new THREE.Vector3().crossVectors(axis, r);
      if (tang.lengthSq() < 1e-6) tang.set(1, 0, 0);
      tang.normalize();
      b.vel.copy(tang).multiplyScalar(Math.sqrt(G * M / dist) * 0.55);  // sub-circular → bound ellipses
    });
    // zero the net momentum so the whole system stays centred on screen
    const P = new THREE.Vector3(); bodies.forEach(b => P.addScaledVector(b.vel, b.m));
    P.multiplyScalar(1 / M); bodies.forEach(b => b.vel.sub(P));
  }

  // ── camera (custom orbit) ─────────────────────────────────────────────────────
  const camOrbit = { theta: 0.6, phi: 1.15, radius: 5, follow: -1 };
  const camTarget = new THREE.Vector3();
  let velTheta = 0, velPhi = 0;          // #4: fling inertia carried after you let go of a drag
  // auto-cinema: when idle, the camera pans 360°, tilts, and dollies on its own.
  let cinema = true, idleFrames = 0, _ct = 0, cinemaHomeR = 5, cinemaHomePhi = 1.0;
  function wake() { idleFrames = 0; }    // any user input takes the wheel back
  function updateCamera() {
    // target eases to followed body, else to the system's centre of mass
    const t = new THREE.Vector3();
    if (camOrbit.follow >= 0 && bodies[camOrbit.follow]) t.copy(bodies[camOrbit.follow].pos);
    else { let M = 0; bodies.forEach(b => { t.addScaledVector(b.pos, b.m); M += b.m; }); if (M) t.multiplyScalar(1 / M); }
    camTarget.lerp(t, 0.06);
    if (!orbiting && !dragBody && !pinching) {   // glide on after a fling, then either auto-cinema or a gentle idle drift
      camOrbit.theta += velTheta;
      camOrbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, camOrbit.phi + velPhi));
      velTheta *= 0.93; velPhi *= 0.93;
      idleFrames++;
      if (cinema && idleFrames > 140) {          // engaged after ~2.3s of no input
        _ct += 0.016;
        camOrbit.theta += 0.0018;                                                   // slow continuous 360° pan
        const tp = Math.max(0.18, Math.min(1.3, cinemaHomePhi + 0.3 * Math.sin(_ct * 0.25)));  // gentle tilt up/down
        const tr = cinemaHomeR * (1 + 0.25 * Math.sin(_ct * 0.16));                  // dolly in close, then pull back
        camOrbit.phi += (tp - camOrbit.phi) * 0.02;                                  // ease → smooth engage/disengage
        camOrbit.radius += (tr - camOrbit.radius) * 0.02;
      } else {
        camOrbit.theta += 0.0006;                 // the original whisper-drift (cinema off or just settling)
      }
    } else { idleFrames = 0; }
    const sp = camOrbit.phi, st = camOrbit.theta, r = camOrbit.radius * eclipseZoom;
    camera.position.set(
      camTarget.x + r * Math.sin(sp) * Math.sin(st),
      camTarget.y + r * Math.cos(sp),
      camTarget.z + r * Math.sin(sp) * Math.cos(st),
    );
    camera.lookAt(camTarget);
  }

  // ── trails: a thin glowing polyline tracing each body's path ─────────────────────
  function updateTrail(b) {
    const t = b.trail, n = t.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = t[k].x; pos[k * 3 + 1] = t[k].y; pos[k * 3 + 2] = t[k].z;
      const f = k / n, a = f * f * 1.5;         // sharp falloff + bright head
      const w = Math.max(0, f - 0.85) * 4;      // white-hot tip near the planet
      col[k * 3] = b.color.r * a + w; col[k * 3 + 1] = b.color.g * a + w; col[k * 3 + 2] = b.color.b * a + w;
    }
    b.line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    b.line.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.line.geometry.setDrawRange(0, n);
    b.line.visible = showTrails && n > 1;
  }

  // ── cinematic eclipse moments ───────────────────────────────────────────────────
  // When one body slips in front of another (or the star) from the camera's view,
  // ease into slow-mo + a gentle push-in + a HUD cue so the alignment is witnessed,
  // not missed. Pure overlays — never alters the user's speed or camera permanently.
  let cinematic = true, timeScale = 1, eclipseZoom = 1, eclipseStrength = 0, _eclipseHot = false;
  const eclipseHud = document.getElementById('eclipseHud');
  const _ev1 = new THREE.Vector3(), _ev2 = new THREE.Vector3();
  function updateEclipse() {
    let raw = 0;
    if (mode === 'running' && cinematic && !orbiting && !dragBody) {
      const cam = camera.position;
      for (let i = 0; i < bodies.length; i++) for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        const di = _ev1.subVectors(bodies[i].pos, cam), li = di.length();
        const dj = _ev2.subVectors(bodies[j].pos, cam), lj = dj.length();
        if (li >= lj) continue;                              // i must be the nearer (occluding) body
        const ang = di.angleTo(dj);
        const ai = Math.asin(Math.min(1, visRadius(bodies[i].m) / Math.max(li, 1e-3)));
        const aj = Math.asin(Math.min(1, visRadius(bodies[j].m) / Math.max(lj, 1e-3)));
        const s = 1 - ang / (ai + aj);                       // 1 = dead-centre overlap, <0 = no overlap
        if (s > raw) raw = s;
      }
      raw = Math.pow(Math.max(0, Math.min(1, raw)), 1.2);    // punchy: only real overlaps register
    }
    eclipseStrength += (raw - eclipseStrength) * 0.12;
    if (!_eclipseHot && eclipseStrength > 0.55) { _eclipseHot = true; FX.chime(); }   // ring the bell once per alignment
    else if (_eclipseHot && eclipseStrength < 0.25) _eclipseHot = false;
    timeScale += ((1 - 0.82 * eclipseStrength) - timeScale) * 0.08;   // slow-mo at the peak
    eclipseZoom += ((1 - 0.16 * eclipseStrength) - eclipseZoom) * 0.06; // subtle push-in
    if (eclipseHud) eclipseHud.style.opacity = (eclipseStrength * 0.92).toFixed(3);
  }

  // ── no collisions: bodies pass through each other and slingshot under pure
  //    gravity — they never bounce, never merge. A close pass is softened (see
  //    accel's per-pair floor) so it whips the body away instead of blowing up. ──

  // ── render loop ────────────────────────────────────────────────────────────────
  function frame() {
    updateEclipse();
    if (mode === 'running') {
      const dt = 0.001, sub = Math.max(1, Math.round(speed * 12));
      for (let s = 0; s < sub; s++) integrate(dt * timeScale);
      for (const b of bodies) { b.trail.push(b.pos.clone()); if (b.trail.length > TRAIL_MAX) b.trail.shift(); }
      if (!systemMode) checkSlingshots();   // placed-orbit scenarios aren't slingshots — skip the whoosh

    }
    if (lensflare) { const s = bodies.find(b => b.star); if (s) { lensflare.position.copy(s.pos); lensflare.visible = true; } else lensflare.visible = false; }
    starUniforms.uTime.value += 0.016;      // boil the plasma + flicker the corona
    bodies.forEach(b => { applyVisual(b); updateTrail(b); b.mesh.rotation.y += 0.0025; if (b.beams) b.beams.rotation.y += 0.05; });
    grid.lines.visible = grid.surface.visible = grid.wells.visible = showGrid;
    if (showGrid) grid.update(bodies);
    updateCamera();
    if (bokeh) {                            // #5: smooth rack-focus — pulls onto whatever you grab, else the system
      const fp = dragBody ? dragBody.pos : camTarget;
      const want = camera.position.distanceTo(fp);
      bokeh.uniforms['focus'].value += (want - bokeh.uniforms['focus'].value) * 0.1;
    }
    ambient.rotation.y += 0.00018;          // whole cosmos drifts → floaty parallax
    starNear.rotation.y += 0.00012;         // #5: near layer shears against the far field for real depth
    shootingStars.update(0.016);
    if (composer) composer.render(); else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ── interaction ────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  let dragBody = null, orbiting = false, lastX = 0, lastY = 0;

  function setNDC(e) { const r = canvas.getBoundingClientRect(); ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1; ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1; }
  function pickBody(e) { setNDC(e); raycaster.setFromCamera(ndc, camera); const hit = raycaster.intersectObjects(bodies.map(b => b.hit), false)[0]; return hit ? bodies.find(b => b.hit === hit.object) : null; }

  // #3: tactile throwing — flick a planet to launch it. An arrow + dashed ghost path
  // preview the shot while you hold; release with a real flick and it takes off.
  const THROW_GAIN = 3.2, THROW_MAX = 2.6, THROW_MIN = 0.14;
  const flickVel = new THREE.Vector3();
  const aimArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffd27a, 0.34, 0.22);
  aimArrow.visible = false; scene.add(aimArrow);
  const previewLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55, depthWrite: false }));
  previewLine.visible = false; scene.add(previewLine);
  function updateAim(b) {
    const v = flickVel.clone().multiplyScalar(THROW_GAIN); v.clampLength(0, THROW_MAX);
    const speed = v.length();
    if (speed <= THROW_MIN) { aimArrow.visible = false; previewLine.visible = false; return; }
    aimArrow.visible = true; aimArrow.position.copy(b.pos);
    aimArrow.setDirection(v.clone().normalize()); aimArrow.setLength(0.5 + speed * 1.8, 0.34, 0.22);
    const pts = [], p = b.pos.clone(), vv = v.clone(), a = new THREE.Vector3();   // ghost path under the others' gravity
    for (let s = 0; s < 150; s++) {
      a.set(0, 0, 0);
      for (const o of bodies) { if (o === b) continue; const d = o.pos.clone().sub(p), r2 = d.lengthSq() + 0.05; a.addScaledVector(d, G * o.m / (r2 * Math.sqrt(r2))); }
      vv.addScaledVector(a, 0.012); p.addScaledVector(vv, 0.012); pts.push(p.clone());
    }
    previewLine.geometry.setFromPoints(pts); previewLine.visible = true;
  }

  // Multi-touch aware: 1 finger orbits / drags a planet, 2 fingers pinch-to-zoom.
  const pointers = new Map();
  let pinching = false, pinchStartDist = 0, pinchStartRadius = 0;
  const pinchDist = () => { const p = [...pointers.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };

  canvas.addEventListener('pointerdown', (e) => {
    FX.init(); FX.resume();                        // first gesture unlocks audio (autoplay policy)
    wake();                                         // hands on → pause the auto-cinema
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {                     // second finger → pinch-zoom; drop any orbit/drag
      pinching = true; pinchStartDist = Math.max(1, pinchDist()); pinchStartRadius = camOrbit.radius;
      dragBody = null; orbiting = false; aimArrow.visible = false; previewLine.visible = false; flickVel.set(0, 0, 0);
    } else if (pointers.size === 1) {
      const b = pickBody(e);                       // grab a planet anytime — the sim keeps running
      if (b) {
        dragBody = b; manualEdited = true; flickVel.set(0, 0, 0);   // held body is lifted out of physics; the rest keep orbiting
        const n = camera.getWorldDirection(new THREE.Vector3()).negate();
        dragPlane.setFromNormalAndCoplanarPoint(n, b.pos);
      } else { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) { const p = pointers.get(e.pointerId); p.x = e.clientX; p.y = e.clientY; }
    if (pinching && pointers.size >= 2) {          // gentle pinch-zoom (exponent < 1 = less sensitive)
      const dist = Math.max(1, pinchDist());
      camOrbit.radius = Math.max(1.2, Math.min(120, pinchStartRadius * Math.pow(pinchStartDist / dist, 0.7)));
      cinemaHomeR = camOrbit.radius;               // auto-cinema dollies around the user's chosen zoom
      return;
    }
    if (dragBody) {
      setNDC(e); raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hit)) {
        flickVel.lerp(hit.clone().sub(dragBody.pos), 0.4);   // smoothed flick = recent drag motion
        dragBody.pos.copy(hit); dragBody.vel.set(0, 0, 0);
        updateAim(dragBody);
      }
    } else if (orbiting) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      const dTheta = -dx * 0.005, dPhi = -dy * 0.005;
      camOrbit.theta += dTheta;
      camOrbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, camOrbit.phi + dPhi));
      velTheta = dTheta; velPhi = dPhi;   // remember the last motion → fling inertia on release
    } else {
      canvas.style.cursor = pickBody(e) ? 'grab' : 'default';
    }
  });
  function endPointer(e) {
    const wasPinching = pinching;
    pointers.delete(e.pointerId);
    if (wasPinching) {
      if (pointers.size < 2) {
        pinching = false;
        if (pointers.size === 1) {                 // one finger left → resume orbit from it, no jump
          const rem = [...pointers.values()][0]; orbiting = true; lastX = rem.x; lastY = rem.y; velTheta = velPhi = 0;
        }
      }
    } else if (dragBody) {
      const launch = flickVel.clone().multiplyScalar(THROW_GAIN); launch.clampLength(0, THROW_MAX);
      if (launch.length() > THROW_MIN) {           // a real flick → throw it and let it fly
        dragBody.vel.copy(launch); manualEdited = false;
        FX.pluck(launch.length() / THROW_MAX);     // tactile launch: pluck + buzz scaled by strength
        if (mode !== 'running') { mode = 'running'; updateRun(); }
      } else { dragBody.vel.set(0, 0, 0); }        // gentle drop → just placed
    }
    if (pointers.size === 0) { dragBody = null; orbiting = false; }
    aimArrow.visible = false; previewLine.visible = false; flickVel.set(0, 0, 0);
    canvas.style.cursor = 'default';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wake();
    const b = pickBody(e);
    if (b) { b.m = Math.max(0.2, Math.min(40, b.m * (e.deltaY < 0 ? 1.12 : 0.89))); manualEdited = true; applyVisual(b); }
    else { camOrbit.radius = Math.max(1.2, Math.min(120, camOrbit.radius * (e.deltaY < 0 ? 0.9 : 1.1))); cinemaHomeR = camOrbit.radius; }
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const b = pickBody(e);
    camOrbit.follow = b ? bodies.indexOf(b) : -1;
  });

  // ── resize ───────────────────────────────────────────────────────────────────
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (composer) composer.setSize(w, h); }
  window.addEventListener('resize', resize);

  // ── UI ──────────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  function updateRun() { const r = $('run'); if (!r) return; r.textContent = (mode === 'running') ? '❚❚ Pause' : '▶ Run'; r.classList.toggle('is-running', mode === 'running'); }
  function readout() { const el = $('exploreReadout'); if (el && $('vx')) el.textContent = `v = (${(+$('vx').value).toFixed(3)}, ${(+$('vy').value).toFixed(3)})`; }

  $('run').addEventListener('click', () => {
    FX.init(); FX.resume();
    if (mode === 'running') { mode = 'paused'; }
    else { if (manualEdited && !systemMode) { autoOrbit(); manualEdited = false; } mode = 'running'; }   // placed scenarios: keep the real orbits, don't auto-swirl
    updateRun();
  });
  $('reset').addEventListener('click', () => loadPreset(currentPreset));
  // "New orbit" → scatter three planets and auto-orbit them into a fresh dance.
  $('newOrbit') && $('newOrbit').addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    currentPreset = 'random'; PRESETS['random']();
    autoOrbit();
    camOrbit.follow = -1; camTarget.set(0, 0, 0);
    bodies.forEach(b => { b.trail.length = 0; applyVisual(b); });
    manualEdited = false; mode = 'running'; updateRun();
  });
  $('clear').addEventListener('click', () => bodies.forEach(b => b.trail.length = 0));
  $('speed').addEventListener('input', (e) => { speed = +e.target.value; $('speedVal').textContent = speed.toFixed(1) + '×'; });
  $('grav').addEventListener('input', (e) => { G = +e.target.value; $('gravVal').textContent = G.toFixed(2); });
  $('trails').addEventListener('change', (e) => { showTrails = e.target.checked; });
  $('grid') && $('grid').addEventListener('change', (e) => { showGrid = e.target.checked; });
  $('sound') && $('sound').addEventListener('click', () => { FX.init(); FX.resume(); const m = FX.toggleMute(); $('sound').innerHTML = m ? '&#128263;' : '&#128266;'; $('sound').classList.toggle('is-muted', m); });
  $('cinematic') && $('cinematic').addEventListener('change', (e) => { cinematic = e.target.checked; });
  $('autocam') && $('autocam').addEventListener('change', (e) => { cinema = e.target.checked; wake(); });

  function clearWorldActive() {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    $('solarBtn') && $('solarBtn').classList.remove('active');
    $('neutronBtn') && $('neutronBtn').classList.remove('active');
  }
  document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => {
    clearWorldActive();
    btn.classList.add('active'); currentPreset = btn.dataset.preset; loadPreset(currentPreset);
  }));
  // Selectable "worlds" that load a whole system and run straight away
  function loadWorld(id, btnId) {
    FX.init(); FX.resume();
    clearWorldActive();
    $(btnId) && $(btnId).classList.add('active');
    currentPreset = id; loadPreset(id);
    mode = 'running'; updateRun();
    $('solutions').setAttribute('hidden', '');
  }
  $('solarBtn') && $('solarBtn').addEventListener('click', () => loadWorld('solar', 'solarBtn'));
  $('neutronBtn') && $('neutronBtn').addEventListener('click', () => loadWorld('neutron', 'neutronBtn'));
  function explore() {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    currentPreset = 'explore'; readout(); loadPreset('explore');
  }
  ['vx', 'vy'].forEach(id => $(id) && $(id).addEventListener('input', explore));
  $('surprise') && $('surprise').addEventListener('click', () => {
    $('vx').value = (Math.random() * 0.62 + 0.02).toFixed(3);
    $('vy').value = (Math.random() * 0.62 + 0.02).toFixed(3);
    explore();
  });

  // ── FX: ambient audio bed + event sounds + haptics ─────────────────────────────
  //    A low space hum (starts on the first gesture, per autoplay rules), a bell on
  //    eclipse alignment, a soft pluck on launch, a whoosh on a close slingshot.
  //    Haptics buzz on Android via the Vibration API; iOS gets a best-effort tap.
  const FX = (() => {
    let ctx = null, master = null, muted = false;
    const iosSink = $('iosHaptic');
    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (_) { ctx = null; return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
      // ambient pad: two low sines + a sub, through a slowly-swept lowpass
      const pad = ctx.createGain(); pad.gain.value = 0.0; pad.connect(master);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7; lp.connect(pad);
      [55, 82.41, 41].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = i * 5; const g = ctx.createGain(); g.gain.value = i === 2 ? 0.5 : 0.35; o.connect(g).connect(lp); o.start(); });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = ctx.createGain(); lg.gain.value = 150; lfo.connect(lg).connect(lp.frequency); lfo.start();
      pad.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 3.5);   // fade the bed in
    }
    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
    function tone(freqs, peak, dur, type) {
      if (!ctx) return; const t = ctx.currentTime, g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(master);
      freqs.forEach((f, i) => { const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f; o.detune.value = i * 4; o.connect(g); o.start(t); o.stop(t + dur + 0.05); });
    }
    function noise(peak, dur, f0, f1) {
      if (!ctx) return; const t = ctx.currentTime, n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + dur + 0.02);
    }
    function buzz(ms) {
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
      try { if (iosSink) iosSink.click(); } catch (_) {}   // best-effort iOS haptic (switch trick)
    }
    return {
      init, resume,
      chime() { tone([880, 1318.5], 0.12, 1.2); buzz(22); },          // eclipse bell (a fifth)
      pluck(s) { tone([300 + s * 120], Math.min(0.09, 0.04 + s * 0.04), 0.18, 'triangle'); buzz(10 + Math.round(s * 10)); },
      whoosh() { noise(0.07, 0.32, 320, 1400); buzz(14); },
      toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 1; return muted; },
    };
  })();

  // Slingshot detector: fire a whoosh+buzz the moment a pair enters a close pass
  // (debounced per pair so it triggers once on entry, not every frame).
  const _pairNear = [false, false, false];
  function checkSlingshots() {
    let pk = 0;
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const d = bodies[i].pos.distanceTo(bodies[j].pos), rs = visRadius(bodies[i].m) + visRadius(bodies[j].m);
      const near = d < rs * 1.9;
      if (near && !_pairNear[pk]) FX.whoosh();
      _pairNear[pk] = near; pk++;
    }
  }

  // ── boot ──────────────────────────────────────────────────────────────────────
  resize();
  $('grav').value = G; $('gravVal').textContent = G.toFixed(2);
  $('speed').value = speed; $('speedVal').textContent = speed.toFixed(1) + '×';
  loadPreset('figure-8');
  mode = 'running'; updateRun();             // greet the user with motion, not a still frame
  requestAnimationFrame(frame);

  // ── scene assets ───────────────────────────────────────────────────────────────
  function makeStars(count, size, opacity, rMin, rMax) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const tint = [new THREE.Color(0xbfd4ff), new THREE.Color(0xffffff), new THREE.Color(0xffe6c0), new THREE.Color(0x9fc4ff)];
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); pos[i * 3 + 2] = r * Math.cos(ph);
      const c = tint[(Math.random() * tint.length) | 0], b = 0.6 + Math.random() * 0.4;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: starTex, transparent: true, opacity, depthWrite: false }));
  }
  function makeNebula() {
    const grp = new THREE.Group();
    const cols = [0x4a2a7a, 0x1a4f7f, 0x5a2040, 0x24407a, 0x44206a, 0x2a5a6a, 0x6a3050];
    for (let i = 0; i < cols.length; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexFor(cols[i]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
      const r = 80 + Math.random() * 150, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph) - 60);
      s.scale.setScalar(160 + Math.random() * 150); grp.add(s);
    }
    return grp;
  }
  // Sporadic shooting stars / comets streaking through the deep background.
  function makeShootingStars() {
    const grp = new THREE.Group(); const streaks = [];
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xdfeeff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      grp.add(line); streaks.push({ line, active: false, t: 0, dur: 1, idle: Math.random() * 6, p: new THREE.Vector3(), v: new THREE.Vector3() });
    }
    function spawn(s) {
      const r = 350 + Math.random() * 250, th = Math.random() * Math.PI * 2;
      s.p.set(Math.cos(th) * r, 120 + Math.random() * 220, Math.sin(th) * r);
      s.v.set((Math.random() - 0.5) * 2, -0.5 - Math.random() * 0.6, (Math.random() - 0.5) * 2).normalize().multiplyScalar(420 + Math.random() * 380);
      s.t = 0; s.dur = 0.7 + Math.random() * 0.6; s.active = true;
    }
    function update(dt) {
      for (const s of streaks) {
        if (!s.active) { s.idle -= dt; if (s.idle <= 0) { spawn(s); } else continue; }
        s.t += dt; if (s.t >= s.dur) { s.active = false; s.idle = 3 + Math.random() * 7; s.line.material.opacity = 0; continue; }
        s.p.addScaledVector(s.v, dt);
        const a = s.line.geometry.attributes.position.array;
        a[0] = s.p.x - s.v.x * 0.04; a[1] = s.p.y - s.v.y * 0.04; a[2] = s.p.z - s.v.z * 0.04;
        a[3] = s.p.x; a[4] = s.p.y; a[5] = s.p.z; s.line.geometry.attributes.position.needsUpdate = true;
        s.line.material.opacity = Math.sin((s.t / s.dur) * Math.PI) * 0.9;
      }
    }
    return { group: grp, update };
  }
  // Real NASA/Hubble galaxy photos from static/galaxies/ (same set as Rex's World),
  // scattered through the deep background. Feathered so the square photo edges melt
  // into space; normal blending keeps their true colours. Procedural fallback if the
  // API is unreachable so the back is never empty.
  function makeGalaxies() {
    const grp = new THREE.Group();
    fetch('/api/galaxies').then(r => r.json()).then(d => {
      const files = Array.isArray(d.galaxies) ? d.galaxies : [];
      if (!files.length) { fillProcedural(grp); return; }
      const COUNT = 13;
      for (let i = 0; i < COUNT; i++) {
        const tex = featherGalaxyTexture(files[i % files.length]);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.72 + Math.random() * 0.28 }));
        const r = 650 + Math.random() * 850, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.8, r * Math.cos(ph));
        s.material.rotation = Math.random() * Math.PI * 2; s.scale.setScalar(280 + Math.random() * 380); grp.add(s);
      }
    }).catch(() => fillProcedural(grp));
    return grp;
  }
  function fillProcedural(grp) {                     // fallback only — no real photos available
    const cols = [0x6fa8ff, 0xff9ad1, 0xffd28a, 0x9d7bff, 0x7fe0c0];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: galaxyTex(cols[i % cols.length]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
      const r = 650 + Math.random() * 750, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph));
      s.material.rotation = Math.random() * Math.PI * 2; s.scale.setScalar(130 + Math.random() * 180); grp.add(s);
    }
  }
  // Turn a rectangular galaxy photo into an edgeless texture: its own brightness
  // becomes its alpha (dark sky → transparent) and a radial feather kills the corners.
  function featherGalaxyTexture(url) {
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sc = Math.max(S / img.width, S / img.height), w = img.width * sc, h = img.height * sc;
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      const data = g.getImageData(0, 0, S, S), px = data.data, c = S / 2, rmax = S / 2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const L = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
        let a = Math.min(1, Math.max(0, (L - 0.06) * 1.7));
        a *= Math.max(0, 1 - Math.pow(Math.hypot(x - c, y - c) / rmax, 2.2));
        px[i + 3] = (a * 255) | 0;
      }
      g.putImageData(data, 0, 0); tex.needsUpdate = true;
    };
    img.onerror = () => {};
    img.src = url;
    return tex;
  }
  function starSprite() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.28, 'rgba(255,255,255,0.75)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function galaxyTex(colorInt) {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const col = new THREE.Color(colorInt), R = col.r * 255 | 0, G2 = col.g * 255 | 0, B = col.b * 255 | 0;
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.18, `rgba(${R},${G2},${B},0.6)`); rg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(${R},${G2},${B},0.5)`; g.lineWidth = 2;
    for (let a = 0; a < 3; a++) { g.beginPath(); for (let t = 0; t < 6; t += 0.1) { const rad = t * 8, ang = t + a * 2.09; g.lineTo(s / 2 + Math.cos(ang) * rad, s / 2 + Math.sin(ang) * rad * 0.6); } g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function makeGlowTexture() { return glowTexFor(0xffffff); }
  function glowTexFor(colorInt) {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const col = new THREE.Color(colorInt), R = Math.round(col.r * 255), G2 = Math.round(col.g * 255), B = Math.round(col.b * 255);
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, `rgba(${R},${G2},${B},1)`); rg.addColorStop(0.4, `rgba(${R},${G2},${B},0.45)`); rg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
}

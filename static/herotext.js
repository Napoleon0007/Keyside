// herotext.js — captivating 3D motion for the MESIDE title.
// Letters fly in from off-screen, settle, idle-float in 3D, tilt toward the cursor,
// and periodically the "SIDE" word lifts off, orbits the hero, and returns home.
// Vanilla, dependency-free. Honors reduced-motion; pauses when the hero is off-screen.

(() => {
  const title = document.querySelector('.site-title');
  if (!title) return;

  const letters = [...title.querySelectorAll('.hero-letter')];
  if (!letters.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return; // static title — letters stay in place

  const hero = document.querySelector('.hero') || title;

  // Per-letter motion params: a random fly-in start + unique idle rhythm.
  const rand = (a, b) => a + Math.random() * (b - a);
  letters.forEach((el, i) => {
    const side = el.classList.contains('side');
    el._p = {
      side,
      sx: rand(-1, 1) * rand(280, 720),   // fly-in start offset X
      sy: rand(-1, 1) * rand(220, 460),   // fly-in start offset Y
      sz: rand(-500, 500),                // fly-in start depth
      srx: rand(-220, 220),               // fly-in start rotateX
      sry: rand(-220, 220),               // fly-in start rotateY
      srz: rand(-120, 120),               // fly-in start rotateZ
      fy: rand(0.5, 0.9),                 // idle bob speed
      fz: rand(0.35, 0.7),                // idle depth speed
      ph: rand(0, Math.PI * 2),           // idle phase
      jo: i * 0.16,                       // journey stagger
    };
  });

  const easeOutBack = (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  const INTRO_DUR    = 1.5;   // s — fly-in
  const JOURNEY_EVERY = 11;   // s — how often SIDE goes travelling
  const JOURNEY_DUR  = 3.4;   // s — length of the trip
  const JOURNEY_START = 4.5;  // s — first trip after intro settles

  // Smoothed mouse tilt for the whole title.
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  if (!window.matchMedia('(hover: none)').matches) {
    window.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tmx = ((e.clientX - r.left) / r.width) * 2 - 1;
      tmy = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    window.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; });
  }

  const t0 = performance.now();
  let running = true;
  let frameId = null;

  function frame(now) {
    if (!running) return;
    frameId = requestAnimationFrame(frame);

    const t = (now - t0) / 1000;
    const intro = Math.min(t / INTRO_DUR, 1);
    const e = easeOutBack(intro);          // 1 at home, <1 (overshoot) during fly-in
    const settle = Math.min(intro, 1);     // 0..1 idle fade-in

    // Whole-title parallax tilt toward the cursor.
    mx += (tmx - mx) * 0.06;
    my += (tmy - my) * 0.06;
    title.style.transform = `rotateX(${-my * 9}deg) rotateY(${mx * 12}deg)`;

    // Journey progress (0 when resting; a 0->1 sweep while travelling).
    let journey = -1;
    if (t > JOURNEY_START) {
      const phase = (t - JOURNEY_START) % JOURNEY_EVERY;
      if (phase < JOURNEY_DUR) journey = phase / JOURNEY_DUR;
    }

    for (const el of letters) {
      const p = el._p;

      // Fly-in residual (full at t=0, zero once settled).
      const k = 1 - e;
      let tx = k * p.sx, ty = k * p.sy, tz = k * p.sz;
      let rx = k * p.srx, ry = k * p.sry, rz = k * p.srz;

      // Idle 3D float (fades in after the intro).
      ty += Math.sin(t * p.fy + p.ph) * 7 * settle;
      tz += Math.sin(t * p.fz + p.ph) * 38 * settle;
      rx += Math.sin(t * p.fy + p.ph) * 5 * settle;
      ry += Math.cos(t * p.fz + p.ph) * 7 * settle;

      // Journey: SIDE letters lift off, sweep an ellipse around the hero, return.
      if (journey >= 0 && p.side) {
        const jp = Math.max(0, Math.min(1, journey + p.jo - 0.24));
        const bell = Math.sin(Math.PI * jp);          // 0 -> 1 -> 0 (leaves & returns)
        const ang  = jp * Math.PI * 2;                 // full loop -> ends where it started
        tx += Math.cos(ang) * 260 * bell;
        ty += Math.sin(ang) * 150 * bell;
        tz += Math.sin(ang * 2) * 320 * bell;
        rz += jp * 360 * bell;                          // spins, unwinds back to 0
        ry += Math.sin(ang) * 60 * bell;
      }

      el.style.opacity = String(0.15 + 0.85 * Math.min(intro * 1.3, 1));
      el.style.transform =
        `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) ` +
        `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    }
  }

  // Pause when the hero scrolls out of view.
  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; frame(performance.now()); }
    else if (!visible && running) { running = false; cancelAnimationFrame(frameId); }
  }, { threshold: 0 });
  io.observe(hero);

  frame(performance.now());
})();

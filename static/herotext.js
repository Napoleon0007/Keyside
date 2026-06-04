// herotext.js — the MEDICI title floats gently in place, like it's resting on water.
// A soft wave rolls across the letters (each one phase-offset), with a little rocking
// and depth. No flying off-screen. Vanilla, dependency-free. Honors reduced-motion;
// pauses when the hero scrolls out of view.

// Hero background video — make sure it actually plays. Muted+playsinline autoplay is
// allowed everywhere, but iOS Low-Power-Mode (and the odd mobile browser) can still
// stall it on a poster frame. Kick it on load and again on the first user gesture.
(() => {
  const v = document.getElementById('heroBgVideo');
  if (!v) return;
  const kick = () => v.play().catch(() => {});
  kick();
  v.addEventListener('canplay', kick, { once: true });
  ['pointerdown', 'touchstart', 'keydown'].forEach(evt =>
    window.addEventListener(evt, kick, { once: true, passive: true })
  );
})();

(() => {
  const title = document.querySelector('.site-title');
  if (!title) return;

  const letters = [...title.querySelectorAll('.hero-letter')];
  if (!letters.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return; // static title — letters stay put

  const hero = document.querySelector('.hero') || title;

  // Each letter gets a wave phase based on its position (so the wave travels across
  // the word) plus a touch of randomness so it never looks mechanical.
  const rand = (a, b) => a + Math.random() * (b - a);
  letters.forEach((el, i) => {
    el._p = {
      phase: i * 0.55 + rand(-0.15, 0.15), // travelling-wave offset per letter
      bob:   rand(7, 10),                   // vertical bob amplitude (px)
      depth: rand(10, 16),                  // subtle forward/back drift (px)
      rock:  rand(1.8, 3.0),                // gentle rotation (deg)
    };
  });

  // Accent words (True / ART / BAN) — each hovers on its own clock, never in sync.
  const floaties = [...document.querySelectorAll('.floaty')];
  floaties.forEach((el) => {
    el._f = {
      phase: rand(0, Math.PI * 2),  // random start → all at different times
      speed: rand(0.55, 1.05),      // different rhythms
      bob:   rand(5, 9),            // gentle vertical hover (px)
      drift: rand(0.35, 0.8),       // slow secondary swell
      rock:  rand(1.2, 2.6),        // slight rotation (deg)
    };
  });

  // Very soft tilt of the whole word toward the cursor — adds to the "natural" feel
  // without moving it anywhere. Skipped on touch.
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
    const intro = Math.min(t / 0.9, 1); // quick, soft fade/rise in

    mx += (tmx - mx) * 0.05;
    my += (tmy - my) * 0.05;
    title.style.transform = `rotateX(${-my * 4}deg) rotateY(${mx * 5}deg)`;

    for (const el of letters) {
      const p = el._p;

      // Two overlapping sine waves = an organic, water-like bob (not a perfect loop).
      const ty = (Math.sin(t * 1.1 + p.phase) * p.bob
               + Math.sin(t * 0.47 + p.phase * 0.6) * (p.bob * 0.4))
               + (1 - intro) * 22;                 // gentle rise as it fades in
      const tz = Math.sin(t * 0.7 + p.phase) * p.depth;
      const rz = Math.sin(t * 0.9 + p.phase) * p.rock;
      const rx = Math.sin(t * 0.6 + p.phase) * (p.rock * 0.7);

      el.style.opacity = String(intro);
      el.style.transform =
        `translate3d(0px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) ` +
        `rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    }

    // Accent words hover independently (no shared phase → never together).
    for (const el of floaties) {
      const f = el._f;
      const ty = Math.sin(t * f.speed + f.phase) * f.bob
               + Math.sin(t * f.drift + f.phase * 1.7) * (f.bob * 0.35);
      const rz = Math.sin(t * f.speed * 0.8 + f.phase) * f.rock;
      el.style.transform = `translateY(${ty.toFixed(2)}px) rotate(${rz.toFixed(2)}deg)`;
    }
  }

  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; frame(performance.now()); }
    else if (!visible && running) { running = false; cancelAnimationFrame(frameId); }
  }, { threshold: 0 });
  io.observe(hero);

  frame(performance.now());
})();

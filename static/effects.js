// Atmosphere FX: hero parallax, cursor spotlight, film grain, vignette.
// Vanilla, dependency-free. Respects reduced-motion and touch devices.

(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;

  // ── Cursor spotlight + film grain + vignette ──────────────────────────────
  const vignette = document.createElement('div');
  vignette.className = 'fx-vignette';

  const grain = document.createElement('div');
  grain.className = 'fx-grain';

  const spotlight = document.createElement('div');
  spotlight.className = 'fx-spotlight';

  document.body.append(vignette, grain, spotlight);

  if (!noHover) {
    let sx = 0, sy = 0, queued = false;
    window.addEventListener('mousemove', (e) => {
      sx = e.clientX;
      sy = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        spotlight.style.setProperty('--mx', `${sx}px`);
        spotlight.style.setProperty('--my', `${sy}px`);
        spotlight.classList.add('on');
        queued = false;
      });
    });
    window.addEventListener('mouseleave', () => spotlight.classList.remove('on'));
  }

  // ── Hero parallax ─────────────────────────────────────────────────────────
  if (reduced) return;

  const heroVideo   = document.querySelector('.hero-bg-video');
  const heroContent = document.querySelector('.hero-content');
  const hero        = document.querySelector('.hero');
  if (!hero) return;

  // Target mouse offset (-0.5..0.5 across the viewport) + smoothed current value.
  let tmx = 0, tmy = 0;   // target
  let cmx = 0, cmy = 0;   // current (eased toward target)
  let scrollY = 0;
  let visible = true;
  let raf = null;

  if (!noHover) {
    window.addEventListener('mousemove', (e) => {
      tmx = e.clientX / window.innerWidth  - 0.5;
      tmy = e.clientY / window.innerHeight - 0.5;
    });
  }
  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

  // Pause the loop whenever the hero scrolls fully out of view.
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(hero);

  function frame() {
    // Ease the mouse offset for a fluid, weighty drift.
    cmx += (tmx - cmx) * 0.06;
    cmy += (tmy - cmy) * 0.06;

    const t    = performance.now();
    const max  = hero.offsetHeight || 1;
    const prog = Math.min(scrollY / max, 1); // 0..1 through the hero

    // Continuous "levitation" — slow, offset sine drift on each axis.
    const floatX = Math.sin(t / 3400) * 9;
    const floatY = Math.cos(t / 2700) * 7;

    // Background: drifts WITH the cursor + breathes + parallax-scrolls down.
    const bgX = cmx * 26 + floatX;
    const bgY = cmy * 26 + floatY + scrollY * 0.35;
    if (heroVideo) {
      heroVideo.style.transform =
        `translate3d(${bgX.toFixed(2)}px, ${bgY.toFixed(2)}px, 0) scale(1.16)`;
    }

    // Foreground title: drifts AGAINST the cursor → parallax depth, fades on scroll.
    if (heroContent) {
      const fgX = cmx * -16;
      const fgY = cmy * -12 + scrollY * 0.18;
      heroContent.style.transform = `translate3d(${fgX.toFixed(2)}px, ${fgY.toFixed(2)}px, 0)`;
      heroContent.style.opacity   = `${1 - prog * 0.9}`;
    }

    raf = visible ? requestAnimationFrame(frame) : null;
  }

  raf = requestAnimationFrame(frame);
})();

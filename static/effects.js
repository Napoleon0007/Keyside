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

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y    = window.scrollY;
      const max  = hero.offsetHeight || 1;
      const prog = Math.min(y / max, 1); // 0..1 through the hero

      if (heroVideo) {
        heroVideo.style.transform = `translateY(${y * 0.35}px) scale(1.12)`;
      }
      if (heroContent) {
        heroContent.style.transform = `translateY(${y * 0.18}px)`;
        heroContent.style.opacity   = `${1 - prog * 0.9}`;
      }
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

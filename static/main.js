// Small looping bg clips: GitHub-raw CDN in prod (window.LOOP_BASE set by the page),
// local /static in dev. CDN TTFB ~0.4s vs Railway static ~1.1s, so the bg plays fast.
const loopUrl = (rel) => {
  rel = String(rel).replace(/^\/?static\//, '');
  return window.LOOP_BASE
    ? window.LOOP_BASE + '/' + rel.split('/').map(encodeURIComponent).join('/')
    : '/static/' + rel;
};

// Phones have a tiny simultaneous-video-decoder budget — too many at once and iOS
// kills ("reloads") the tab. On small screens we run lighter: section background
// clips don't play (poster only) and the fixed page background pauses off the hero.
const LIGHT_MEDIA = window.matchMedia('(max-width: 768px)').matches;

const content     = document.getElementById('content');
const galleryLoad = document.getElementById('galleryLoading');
const modal       = document.getElementById('modal');
const modalVideo  = document.getElementById('modalVideo');
const modalImage  = document.getElementById('modalImage');
const modalAudio  = document.getElementById('modalAudio');
const modalAudioWrap = document.getElementById('modalAudioWrap');
const modalTitle  = document.getElementById('modalTitle');
const modalTag    = document.getElementById('modalStyleTag');
const modalClose  = document.getElementById('modalClose');
const modalBg     = document.getElementById('modalBg');
const countNum    = document.getElementById('countNum');

let currentType = 'all';

// #1 Search + style filter state
let allEditItems  = [];
let styleFilter   = '';
let searchQuery   = '';

let scrollY        = 0;
let currentFile    = null;

// ── Build gallery from API ──────────────────────────────────────────────────

async function init() {
  let videos, aiIntro = null;

  try {
    const res = await fetch('/api/videos');
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    videos  = data.videos;
    aiIntro = data.ai_music_intro || null;
  } catch (err) {
    const loading = document.getElementById('galleryLoading');
    if (loading) loading.innerHTML = '<span style="color:#ff5500;font-size:11px;letter-spacing:.15em">Could not load works</span>';
    return;
  }

  // Group by media type; music splits into "My Music" vs "AI Music".
  const groups = { video: [], edit: [], image: [], musicMine: [], musicAi: [] };
  videos.forEach(v => {
    if (v.type === 'music') (v.subtype === 'ai' ? groups.musicAi : groups.musicMine).push(v);
    else (groups[v.type] || groups.video).push(v);
  });

  // Store full list for search/filter rebuilds; mark the latest item
  allEditItems = groups.edit;
  if (allEditItems.length) allEditItems[allEditItems.length - 1]._latest = true;

  content.innerHTML = '';
  renderStylePills();
  rebuildEditSection();
  applyTypeFilter(currentType);
}

// ── #1 Search + style filter ─────────────────────────────────────────────────

function rebuildEditSection() {
  const q = searchQuery.trim().toLowerCase();
  const filtered = allEditItems.filter(item => {
    const okStyle  = !styleFilter || item.style === styleFilter;
    const okSearch = !q || item.title.toLowerCase().includes(q) || (item.style || '').toLowerCase().includes(q);
    return okStyle && okSearch;
  });

  const existing = document.getElementById('section-edit');
  if (existing) {
    if (existing._teardown) existing._teardown();   // release window listeners + observers
    existing.remove();
  }

  buildSection('edit', 'Short Docs', filtered,
    { src: loopUrl('pattern-hero.mp4'), poster: '/static/video-thumbs/pattern-acid.jpg' });

  countNum.textContent = filtered.length;
}

// Style pills are generated from the styles actually present in the gallery,
// so a pill can never point at a style with zero matches.
function renderStylePills() {
  const wrap = document.getElementById('stylePills');
  if (!wrap) return;
  const styles = [...new Set(allEditItems.map(i => i.style).filter(Boolean))].sort();
  wrap.innerHTML = '';
  wrap.style.display = styles.length > 1 ? '' : 'none';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.className = 'style-pill' + (styleFilter === val ? ' active' : '');
    b.type = 'button';
    b.dataset.style = val;
    b.textContent = label;
    b.addEventListener('click', () => {
      styleFilter = val;
      wrap.querySelectorAll('.style-pill').forEach(p => p.classList.toggle('active', p === b));
      rebuildEditSection();
      applyTypeFilter(currentType);
    });
    wrap.appendChild(b);
  };
  mk('All', '');
  styles.forEach(s => mk(s.replace(/\b\w/g, c => c.toUpperCase()), s));
}

// Wire up search input
(function initSearch() {
  const input = document.getElementById('gallerySearch');
  const row   = document.getElementById('gallerySearchRow');
  if (!input || !row) return;

  // Debounced: rebuilding the rail per keystroke would churn DOM + listeners.
  let searchTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = input.value;
      rebuildEditSection();
      applyTypeFilter(currentType);
    }, 150);
  });

  // Show search row only when Short Docs tab is active or all
  function syncSearchVis() {
    const show = currentType === 'all' || currentType === 'edit';
    row.style.display = show ? '' : 'none';
  }
  syncSearchVis();
})();

// ── #3 Brand footer — render social links from /api/links ────────────────────

async function initFooter() {
  const nav = document.getElementById('footerLinks');
  if (!nav) return;
  try {
    const res  = await fetch('/api/links');
    if (!res.ok) return;
    const { links } = await res.json();
    links.forEach(link => {
      if (!link.url) return;  // skip placeholders
      const a = document.createElement('a');
      a.className = 'footer-link';
      a.href      = link.url;
      a.target    = '_blank';
      a.rel       = 'noopener noreferrer';
      a.textContent = link.name;
      a.style.setProperty('--link-color', link.color || '#fff');
      nav.appendChild(a);
    });
  } catch (e) { /* network; footer just stays empty */ }
}

// Mount a muted, looping background video into a section. It does NOT fetch until the
// section nears the viewport (preload='none' + .play() only when live) — otherwise every
// section's bg + card videos hammer the server at once and the bg clips get starved and
// never play. The section's viewport observer (see liveLoadSection) flips it on/off.
function attachSectionBg(section, src, poster) {
  section.classList.add('has-bg-video');
  const v = document.createElement('video');
  v.className = 'section-bg-video';
  v.muted = true; v.defaultMuted = true; v.loop = true;
  v.playsInline = true; v.preload = LIGHT_MEDIA ? 'none' : 'auto';   // desktop pre-buffers; phones don't load it at all
  // attributes too (some engines only honor the attribute form for muted/playsinline)
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  if (poster) v.poster = poster;
  v.innerHTML = `<source src="${src}" type="video/mp4">`;
  const veil = document.createElement('div');
  veil.className = 'section-bg-veil';
  section.append(v, veil);
  section._bgVideo = v;          // liveLoadSection drives play/pause from the viewport
  return v;
}

// Play (and thus load) a section's background video. Safe to call repeatedly.
function kickBg(v) {
  if (!v) return;
  if (v.preload !== 'auto') v.preload = 'auto';
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
}

// Watch a section: when it nears the viewport, light up its background video AND its
// coverflow rails (load + play their videos); when it leaves, pause everything so the
// page isn't loading a dozen clips at once. This is what makes the on-screen bg actually
// play immediately instead of starving behind off-screen card videos.
function liveLoadSection(section, signal /* optional AbortSignal: releases window listeners + IO */) {
  // Start the section's secondary clips (coverflow cards + music cover tiles). These are
  // big art clips, so we hold them back until the BACKGROUND is actually playing — the bg
  // is the priority and must not be starved by them.
  const startRest = () => {
    (section._cfs || []).forEach(cf => {
      if (!cf || cf.el._inView) return;
      cf.el._inView = true;
      cf.layout();                                   // now pulls/plays the active card video
    });
    section.querySelectorAll('video.card-audio-video').forEach(c => {
      c.preload = 'auto'; c.play().catch(() => {});
    });
  };
  const pauseRest = () => {
    (section._cfs || []).forEach(cf => {
      if (!cf || !cf.el._inView) return;
      cf.el._inView = false;
      cf.layout();
    });
    section.querySelectorAll('video.card-audio-video').forEach(c => c.pause());
  };
  let restTimer = null;
  const enter = () => {
    const bg = section._bgVideo;
    // On phones, never spin up the section's background clip — just show its poster
    // and bring the cards in. Keeps the simultaneous-decoder count low enough not to
    // crash the tab when you scroll through the rails.
    if (!bg || LIGHT_MEDIA) { startRest(); return; }
    kickBg(bg);
    if (bg.readyState >= 3 || (!bg.paused && bg.currentTime > 0)) { startRest(); return; }
    bg.addEventListener('playing', startRest, { once: true });
    clearTimeout(restTimer);
    restTimer = setTimeout(startRest, 1800);         // fallback: don't strand the cards
  };
  const leave = () => {
    if (section._bgVideo) section._bgVideo.pause();
    clearTimeout(restTimer);
    pauseRest();
  };
  if (!('IntersectionObserver' in window)) { enter(); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? enter() : leave();
  }, { rootMargin: '60px 0px', threshold: 0.01 });
  io.observe(section);
  if (signal) signal.addEventListener('abort', () => io.disconnect());
  // first user gesture also kicks the bg, in case autoplay is blocked outright
  // (never on phones — enter() deliberately skips bg clips there to save decoders)
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, () => {
      if (LIGHT_MEDIA) return;
      const r = section.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) kickBg(section._bgVideo);
    }, { passive: true, signal }));
}

function buildSection(type, label, items, bg /* optional {src, poster} bg video */) {
  const section = document.createElement('section');
  section.className = 'media-section';
  section.dataset.type = type;
  section.id = `section-${type}`;
  // Search rebuilds replace this section — the controller releases its window
  // listeners + observers so rebuilds don't accumulate orphans (rebuildEditSection).
  const ac = new AbortController();
  section._teardown = () => ac.abort();

  if (bg) attachSectionBg(section, bg.src, bg.poster);

  const head = document.createElement('div');
  head.className = 'section-head';
  const h2 = document.createElement('h2');
  h2.className = 'section-title';
  h2.textContent = label;
  const count = document.createElement('span');
  count.className = 'section-count';
  count.textContent = items.length;
  head.append(h2, count);
  section.appendChild(head);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'section-empty';
    empty.textContent = `Nothing here yet`;
    section.appendChild(empty);
    content.appendChild(section);
    liveLoadSection(section, ac.signal);            // still drive the bg video, if any
    return;
  }

  // #5 Latest drop — pin the last (most recently added) item as a featured card
  const latestItem = allEditItems.length ? allEditItems[allEditItems.length - 1] : null;
  if (type === 'edit' && latestItem && latestItem._latest && items.includes(latestItem)) {
    const feat = document.createElement('div');
    feat.className = 'latest-drop';
    feat.addEventListener('click', () => openModal(latestItem));

    const thumb = document.createElement('div');
    thumb.className = 'latest-drop-thumb';
    if (latestItem.thumb) {
      const img = document.createElement('img');
      img.src = latestItem.thumb; img.alt = latestItem.title; img.loading = 'lazy';
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'latest-drop-info';

    const badge = document.createElement('span');
    badge.className = 'latest-badge';
    badge.textContent = 'Latest Drop';

    const title = document.createElement('h3');
    title.className = 'latest-drop-title';
    title.textContent = latestItem.title;

    const tag = document.createElement('span');
    tag.className = 'latest-drop-tag';
    tag.textContent = latestItem.style || 'edit';

    const cta = document.createElement('span');
    cta.className = 'latest-drop-cta';
    cta.textContent = 'Watch →';

    info.append(badge, title, tag, cta);
    feat.append(thumb, info);
    section.appendChild(feat);
  }

  const cf = makeCoverflow(items, ac.signal);
  section.appendChild(cf.el);
  section._cfs = [cf];                            // rails to relayout on filter/resize
  content.appendChild(section);
  requestAnimationFrame(() => cf.layout());       // lay out once it has width in the DOM
  liveLoadSection(section, ac.signal);              // load/play videos only when on screen
}

// ── 3D Coverflow rail ─────────────────────────────────────────────────────────
// A horizontal carousel: the centre card faces you, neighbours angle back into Z.
// Drag, trackpad-swipe, arrow keys, arrow buttons, or click a side card to glide.
function makeCoverflow(items, signal /* optional AbortSignal for the window drag listeners */) {
  const el = document.createElement('div');
  el.className = 'coverflow';
  el.tabIndex = 0;
  el._inView = false;   // set true by the section's viewport observer; gates video loading
                        // so off-screen rails don't starve the page's bandwidth

  const viewport = document.createElement('div');
  viewport.className = 'cf-viewport';
  el.appendChild(viewport);

  let active = 0;
  let moved  = false;            // true after a real drag — suppresses the click-open

  const cards = items.map((item, i) => {
    const card = buildCard(item, { coverflow: true });
    card.dataset.idx = i;
    card.addEventListener('click', () => {
      if (moved) { moved = false; return; }      // drag, not a click
      if (i === active) openModal(item);          // centre → open
      else go(i);                                 // side → bring to centre
    });
    viewport.appendChild(card);
    return card;
  });

  const prev = arrowBtn('prev', '‹', () => go(active - 1));
  const next = arrowBtn('next', '›', () => go(active + 1));
  const counter = document.createElement('div');
  counter.className = 'cf-counter';
  el.append(prev, next, counter);

  const VISIBLE = 4;             // cards rendered either side of centre

  function layout() {
    const w = el.clientWidth || window.innerWidth;
    const spread = Math.min(w * 0.32, 320);
    cards.forEach((card, i) => {
      const o = i - active;
      const ao = Math.abs(o);
      const sign = o < 0 ? -1 : 1;

      if (ao > VISIBLE) {
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
        card.style.zIndex = '0';
        setActiveMedia(card, false);
        card.classList.remove('cf-active');
        return;
      }

      const x  = o === 0 ? 0 : sign * (spread + (ao - 1) * spread * 0.52);
      const ry = o === 0 ? 0 : -sign * 46;
      const z  = o === 0 ? 60 : -ao * 200;
      const sc = o === 0 ? 1 : Math.max(0.6, 0.84 - (ao - 1) * 0.08);
      const op = o === 0 ? 1 : Math.max(0.18, 0.82 - (ao - 1) * 0.24);

      card.style.transform =
        `translate(-50%, -50%) translateX(${x.toFixed(1)}px) translateZ(${z}px) ` +
        `rotateY(${ry}deg) scale(${sc.toFixed(3)})`;
      card.style.opacity = op.toFixed(2);
      card.style.zIndex = String(100 - ao);
      card.style.pointerEvents = ao <= 2 ? 'auto' : 'none';

      if (el._inView) ensureLoaded(card);          // only pull video sources when on screen
      const isActive = o === 0;
      card.classList.toggle('cf-active', isActive);
      setActiveMedia(card, isActive && el._inView);
    });

    counter.textContent = `${active + 1} / ${items.length}`;
    prev.disabled = active === 0;
    next.disabled = active === items.length - 1;
  }

  function go(i) {
    active = Math.max(0, Math.min(items.length - 1, i));
    layout();
  }

  function setActiveMedia(card, on) {
    if (!card._videoSrc) return;                 // image cards + clip-less tiles: nothing to mount
    if (on) mountCardVideo(card, el._inView);    // active + on-screen → bring the clip to life
    else    unmountCardVideo(card);              // anything else → still thumbnail, no live <video>
  }

  // Pull a deferred video source in once the card is near the centre.
  function ensureLoaded(card) {
    const m = card._media;
    if (m && m.tagName === 'VIDEO' && !m.src && m.dataset.src) m.src = m.dataset.src;
  }

  // ── Drag ───────────────────────────────────────────────────────────────────
  let down = false, startX = 0, startActive = 0;
  viewport.addEventListener('pointerdown', (e) => {
    down = true; moved = false; startX = e.clientX; startActive = active;
    el.classList.add('grabbing');
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 6) moved = true;
    const steps = Math.round(-dx / (el.clientWidth * 0.16));
    const ni = Math.max(0, Math.min(items.length - 1, startActive + steps));
    if (ni !== active) go(ni);
  }, { signal });
  window.addEventListener('pointerup', () => { down = false; el.classList.remove('grabbing'); }, { signal });

  // ── Trackpad horizontal swipe (vertical wheel left for page scroll) ──────────
  let wheelAcc = 0, wheelLock = false;
  el.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (!d) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelAcc += d;
    if (Math.abs(wheelAcc) > 36) {
      go(active + (wheelAcc > 0 ? 1 : -1));
      wheelAcc = 0; wheelLock = true;
      setTimeout(() => { wheelLock = false; }, 200);
    }
  }, { passive: false });

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { go(active + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { go(active - 1); e.preventDefault(); }
    if (e.key === 'Enter')      { openModal(items[active]); }
  });

  return { el, layout };
}

function arrowBtn(cls, glyph, onClick) {
  const b = document.createElement('button');
  b.className = `cf-arrow ${cls}`;
  b.type = 'button';
  b.innerHTML = glyph;
  b.setAttribute('aria-label', cls === 'prev' ? 'Previous' : 'Next');
  b.addEventListener('click', onClick);
  return b;
}

// ── Lazy card video ───────────────────────────────────────────────────────────
// Cards render a still thumbnail by default; a real <video> is mounted ONLY for the
// active, on-screen card and torn down the moment it leaves. iOS Safari crashes a
// page that holds dozens of <video> elements at once ("Can't open this page"), so we
// keep live <video>s to a handful — active cards + the few section backgrounds.
let CURRENT_CARD_VIDEO = null;   // at most ONE card clip alive at a time across the whole page
function mountCardVideo(card, play) {
  if (!card || !card._videoSrc) return null;
  // Hard cap: only one card video may be live at once. When several rail sections are
  // partially in view at the same time (mid-scroll) this stops 3-4 decoders spinning up
  // together and crashing the phone.
  if (CURRENT_CARD_VIDEO && CURRENT_CARD_VIDEO !== card) unmountCardVideo(CURRENT_CARD_VIDEO);
  CURRENT_CARD_VIDEO = card;
  let v = card._cardVideo;
  if (!v) {
    v = document.createElement('video');
    v.className = card._videoClass || 'card-video';
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.preload = 'metadata';
    if (card._thumb) v.poster = card._thumb;
    v.src = card._videoSrc;
    const host = card._videoHost || card;
    const ref  = (card._posterEl && card._posterEl.parentNode === host) ? card._posterEl : host.firstChild;
    host.insertBefore(v, ref || null);
    if (card._posterEl) card._posterEl.style.visibility = 'hidden';
    v.addEventListener('loadeddata', () => v.play().catch(() => {}));
    card._cardVideo = v;
  }
  if (play) v.play().catch(() => {});
  return v;
}
function unmountCardVideo(card) {
  const v = card && card._cardVideo;
  if (!v) return;
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}   // release the decoder + buffer
  if (v.parentNode) v.parentNode.removeChild(v);
  card._cardVideo = null;
  if (CURRENT_CARD_VIDEO === card) CURRENT_CARD_VIDEO = null;
  if (card._posterEl) card._posterEl.style.visibility = '';
}

function buildCard(item, opts = {}) {
  const { title, style, src, type } = item;
  const cf = !!opts.coverflow;
  const card = document.createElement('div');
  card.className = cf ? 'card' : 'card reveal';
  card.dataset.style = style;
  card.dataset.type  = type;
  card._type = type;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  let media;
  if (type === 'image') {
    media = document.createElement('img');
    media.className = 'card-image';
    media.src = src;
    media.alt = title;
    media.loading = 'lazy';
  } else if (type === 'music') {
    media = document.createElement('div');
    media.className = 'card-audio';
    if (item.thumb) {
      media.classList.add('has-thumb');
      media.style.backgroundImage = `url("${item.thumb}")`;
    }
    if (item.cover) {                                 // animated cover → mounted only when active
      card._videoSrc   = item.cover;
      card._thumb      = item.thumb || '';
      card._videoClass = 'card-audio-video';
      card._videoHost  = media;                        // the clip loops behind the scrim + ♫
      card._posterEl   = null;                          // the thumb is a CSS background; nothing to hide
    }
    media.insertAdjacentHTML('beforeend', '<span class="card-audio-note">&#9835;</span>');
  } else {
    // Still thumbnail by default; the clip is mounted only when this card is the
    // active, on-screen one (mountCardVideo). This is what keeps the gallery from
    // holding ~60 live <video> elements and crashing the tab on phones.
    media = document.createElement('img');
    media.className = 'card-video';
    media.alt = title;
    media.loading = 'lazy';
    if (item.thumb) media.src = item.thumb;
    card._videoSrc   = src;
    card._thumb      = item.thumb || '';
    card._videoClass = 'card-video';
    card._videoHost  = inner;
    card._posterEl   = media;
    if (!cf) {
      card.addEventListener('mouseenter', () => mountCardVideo(card, true));
      card.addEventListener('mouseleave', () => unmountCardVideo(card));
    }
  }
  card._media = media;

  const badge = document.createElement('div');
  badge.className = 'card-badge';
  badge.textContent = (type === 'video') ? style : type;

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const titleEl = document.createElement('div');
  titleEl.className   = 'card-title';
  titleEl.textContent = title;
  overlay.appendChild(titleEl);

  const sheen = document.createElement('div');
  sheen.className = 'card-sheen';

  inner.append(media, badge, overlay, sheen);
  card.appendChild(inner);

  if (!cf) {
    card.addEventListener('click', () => openModal(item));
    revealObserver.observe(card);
  }
  attachTilt(card, inner, sheen);

  return card;
}

// ── 3D tilt + scroll reveal ───────────────────────────────────────────────

const REDUCED  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NO_HOVER = window.matchMedia('(hover: none)').matches;

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (!entry.isIntersecting) return;
    const card = entry.target;
    card.style.transitionDelay = `${Math.min(i * 60, 260)}ms`;
    card.classList.add('in');
    setTimeout(() => { card.style.transitionDelay = ''; }, 760);
    revealObserver.unobserve(card);
  });
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

function attachTilt(card, inner, sheen) {
  if (REDUCED || NO_HOVER) return;
  const MAX = 9; // max tilt, degrees
  let raf = null;

  card.addEventListener('mouseenter', () => card.classList.add('tilting'));
  card.addEventListener('mousemove', (e) => {
    const r  = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top)  / r.height;  // 0..1
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const rx = (0.5 - py) * MAX * 2;
      const ry = (px - 0.5) * MAX * 2;
      inner.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      sheen.style.setProperty('--sx', `${(px * 100).toFixed(1)}%`);
      sheen.style.setProperty('--sy', `${(py * 100).toFixed(1)}%`);
    });
  });
  card.addEventListener('mouseleave', () => {
    card.classList.remove('tilting');
    if (raf) cancelAnimationFrame(raf);
    inner.style.transform = '';
  });
}

// ── Modal ───────────────────────────────────────────────────────────────────

function openModal(item, opts = {}) {
  const { src, title, style, file, type } = item;
  currentFile = file;
  scrollY = window.scrollY;
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('modal-open');

  // Reset all media holders.
  modalVideo.pause(); modalVideo.removeAttribute('src'); modalVideo.style.display = 'none';
  modalImage.removeAttribute('src'); modalImage.style.display = 'none';
  modalAudio.pause(); modalAudio.removeAttribute('src'); modalAudioWrap.style.display = 'none';

  if (type === 'image') {
    modalImage.src = src;
    modalImage.style.display = 'block';
  } else if (type === 'music') {
    modalAudio.src = src;
    modalAudioWrap.style.display = 'flex';
    modalAudio.play().catch(() => {});
  } else {
    modalVideo.src = src;
    modalVideo.muted = !(opts.sound || type === 'edit');   // art clips muted; edits + AI-music intro play with sound
    modalVideo.style.display = 'block';
    modalVideo.play().catch(() => {});
  }

  modalTitle.textContent = title;
  modalTag.textContent   = (type === 'video') ? style : (type === 'edit' ? 'short doc' : type);
  modalFs.style.display  = (type === 'image' || type === 'music') ? 'none' : 'flex';
  modal.classList.remove('controls-hidden');   // visible on open; auto-hide kicks in once a clip plays
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  if (!modal.classList.contains('open')) return;   // Escape with no modal open must not scroll-jump
  modal.classList.remove('open');
  modal.classList.remove('controls-hidden');
  clearTimeout(modalCtrlsTimer);
  modal.setAttribute('aria-hidden', 'true');
  modalVideo.pause(); modalVideo.removeAttribute('src');
  modalAudio.pause(); modalAudio.removeAttribute('src');
  modalImage.removeAttribute('src');
  currentFile = null;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, scrollY);
}

modalClose.addEventListener('click', closeModal);
modalBg.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Modal: fullscreen + auto-hiding controls while a clip plays ────────────────
const modalFs  = document.getElementById('modalFs');
const modalBox = modal.querySelector('.modal-box');
let modalCtrlsTimer = null;

function showModalControls() {
  modal.classList.remove('controls-hidden');
  clearTimeout(modalCtrlsTimer);
  // only fade them away again while a video is actually playing
  if (modalVideo.style.display !== 'none' && !modalVideo.paused && !modalVideo.ended) {
    modalCtrlsTimer = setTimeout(() => modal.classList.add('controls-hidden'), 2200);
  }
}
function keepModalControls() { clearTimeout(modalCtrlsTimer); modal.classList.remove('controls-hidden'); }

modalVideo.addEventListener('play',  showModalControls);
modalVideo.addEventListener('pause', keepModalControls);
modalVideo.addEventListener('ended', keepModalControls);
['pointermove', 'pointerdown', 'touchstart'].forEach(evt =>
  modal.addEventListener(evt, showModalControls, { passive: true })
);

function toggleModalFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const t = (modalVideo.style.display !== 'none') ? modalVideo : modalBox;
    const req = t.requestFullscreen || t.webkitRequestFullscreen || t.webkitEnterFullscreen;
    if (req) req.call(t);
  }
}
if (modalFs) modalFs.addEventListener('click', toggleModalFullscreen);

// ── App (in-site product) modal ───────────────────────────────────────────────

const appModal       = document.getElementById('appModal');
const appModalFrame  = document.getElementById('appModalFrame');
const appModalTitle  = document.getElementById('appModalTitle');
const appModalNew    = document.getElementById('appModalNew');
const appModalClose  = document.getElementById('appModalClose');
const appModalLoader = document.getElementById('appModalLoader');

function openAppModal(p) {
  if (!p || !p.url) return;
  scrollY = window.scrollY;
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('modal-open');

  appModalTitle.textContent = p.name || '';
  appModalNew.href = p.url;
  appModalFrame.title = p.name || '';
  appModalLoader.style.display = 'flex';
  appModalFrame.addEventListener('load', () => { appModalLoader.style.display = 'none'; }, { once: true });
  appModalFrame.src = p.url;

  appModal.classList.add('open');
  appModal.setAttribute('aria-hidden', 'false');
}

function closeAppModal() {
  if (!appModal.classList.contains('open')) return;
  appModal.classList.remove('open');
  appModal.setAttribute('aria-hidden', 'true');
  appModalFrame.src = 'about:blank';   // actually unload the embedded app (removeAttribute doesn't)
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, scrollY);
}

appModalClose.addEventListener('click', closeAppModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAppModal(); });

// ── Filter ──────────────────────────────────────────────────────────────────

// Filter categories that map to a planet hub in Rex's World (for the swoop-to focus).
const HUB_OF = { video: 'video', edit: 'edits', image: 'images', music: 'music', products: 'products' };

function applyTypeFilter(type) {
  // Video/Images/Music rails were removed — if anything still asks for one of those,
  // show everything instead of blanking the page.
  const served = type === 'all' || type === 'world' || type === 'products'
    || (type in HUB_OF) || !!document.querySelector(`.media-section[data-type="${type}"]`);
  if (!served) type = 'all';
  currentType = type;
  document.querySelectorAll('.media-section').forEach(section => {
    const show = type === 'all' || section.dataset.type === type;
    section.style.display = show ? '' : 'none';
    if (show && section._cfs) requestAnimationFrame(() => section._cfs.forEach(cf => cf.layout()));
  });
  const products = document.getElementById('products');
  if (products) products.style.display = (type === 'all' || type === 'products') ? '' : 'none';
  const world = document.getElementById('section-world');
  // Keep the world visible (and let it swoop to the hub) for any category that maps to a planet.
  if (world) world.style.display = (type === 'all' || type === 'world' || (type in HUB_OF)) ? '' : 'none';
}

// Re-flow every rail on resize (card width / spread are viewport-relative).
let cfResizeRaf = null;
window.addEventListener('resize', () => {
  if (cfResizeRaf) cancelAnimationFrame(cfResizeRaf);
  cfResizeRaf = requestAnimationFrame(() => {
    document.querySelectorAll('.media-section').forEach(s => (s._cfs || []).forEach(cf => cf.layout()));
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.dataset.type;
    applyTypeFilter(type);
    // Sync search row visibility
    const row = document.getElementById('gallerySearchRow');
    if (row) row.style.display = (type === 'all' || type === 'edit') ? '' : 'none';
    const hub = HUB_OF[type];
    if (hub && window.worldFocusHub) window.worldFocusHub(hub);   // swoop the cosmos to that planet
    if (type !== 'all') {
      const sec = hub ? document.getElementById('section-world')
                      : (document.getElementById(`section-${type}`) || document.getElementById(type));
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});


// ── The Order of the Skull — secret manifesto (nav skull → old manuscript) ────
const skullBtn   = document.getElementById('skullBtn');
const skullModal = document.getElementById('skullModal');
const skullClose = document.getElementById('skullClose');
const skullBg    = document.getElementById('skullModalBg');

function openSkull() {
  if (!skullModal) return;
  scrollY = window.scrollY;
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('modal-open');
  skullModal.classList.add('open');
  skullModal.setAttribute('aria-hidden', 'false');
}
function closeSkull() {
  if (!skullModal || !skullModal.classList.contains('open')) return;
  skullModal.classList.remove('open');
  skullModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, scrollY);
}
if (skullBtn)   skullBtn.addEventListener('click', openSkull);
if (skullClose) skullClose.addEventListener('click', closeSkull);
if (skullBg)    skullBg.addEventListener('click', closeSkull);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSkull(); });

// Pause the fixed full-page background video once you've scrolled past the hero — it's
// hidden behind the content down there anyway, and freeing its decoder keeps the gallery
// from exhausting the phone's video budget and reloading the tab. Resume near the top.
(function manageHeroBg() {
  const bg = document.getElementById('heroBgVideo');
  if (!bg) return;
  let off = false;
  const sync = () => {
    const pastHero = window.scrollY > window.innerHeight * 0.85;
    if (pastHero && !off) { off = true; try { bg.pause(); } catch (e) {} }
    else if (!pastHero && off) { off = false; bg.play().catch(() => {}); }
  };
  window.addEventListener('scroll', sync, { passive: true });
  sync();
})();

// Play the Explore section's Boer-War background only while it's on screen — keeps the
// phone's video-decoder count low (one clip at a time) and saves bandwidth otherwise.
(function manageDiscBg() {
  const v = document.getElementById('discBgVideo');
  const sec = document.getElementById('section-disc');
  if (!v || !sec) return;
  let on = false;
  const sync = () => {
    const r = sec.getBoundingClientRect();
    const vis = r.top < window.innerHeight * 0.85 && r.bottom > window.innerHeight * 0.15;
    if (vis && !on) { on = true; v.preload = 'auto'; v.play().catch(() => {}); }
    else if (!vis && on) { on = false; try { v.pause(); } catch (e) {} }
  };
  window.addEventListener('scroll', sync, { passive: true });
  sync();
})();

// ── Boot ────────────────────────────────────────────────────────────────────

init();
initFooter();

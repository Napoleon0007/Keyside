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
const dlFormats   = document.getElementById('dlFormats');
const navRight    = document.getElementById('navRight');

// Media sections shown on the one page, in this order.
const SECTIONS = [
  { type: 'video', label: 'Video'  },
  { type: 'image', label: 'Images' },
  { type: 'music', label: 'Music'  },
];
const PREVIEW_COUNT = 6;
let currentType = 'all';

let currentFilter  = 'all';
let hideTimers     = [];
let scrollY        = 0;
let currentFile    = null;
let currentUser    = null;

// ── Auth state ──────────────────────────────────────────────────────────────

async function checkAuth() {
  const res  = await fetch('/api/me');
  const data = await res.json();
  currentUser = data.logged_in ? data : null;
  renderNav();
}

function renderNav() {
  navRight.innerHTML = '';

  if (currentUser) {
    if (currentUser.is_admin) {
      const a = navBtn('Admin Panel', () => window.location.href = '/admin');
      navRight.appendChild(a);
    } else {
      const emailEl = document.createElement('span');
      emailEl.className = 'nav-user-email';
      emailEl.textContent = currentUser.email;

      const uploadB = navBtn('↑ Upload', openUploadModal);
      navRight.append(emailEl, uploadB);
    }
    const logoutB = navBtn('Logout', doLogout);
    navRight.appendChild(logoutB);
  } else {
    const loginB  = navBtn('Login', () => openAuthModal('login'));
    const signupB = navBtn('Sign Up', () => openAuthModal('signup'));
    signupB.classList.add('nav-btn-orange');
    navRight.append(loginB, signupB);
  }
}

function navBtn(label, onClick) {
  const b = document.createElement('button');
  b.className   = 'nav-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  renderNav();
}

// ── Auth modal ───────────────────────────────────────────────────────────────

const authModal  = document.getElementById('authModal');
const authModalBg = document.getElementById('authModalBg');
const authClose  = document.getElementById('authClose');
const authTabs   = document.querySelectorAll('.auth-tab');
const authForm   = document.getElementById('authForm');
const authEmail  = document.getElementById('authEmail');
const authPass   = document.getElementById('authPassword');
const authError  = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');

let authMode = 'login';

function openAuthModal(mode) {
  authMode = mode;
  authError.textContent = '';
  authEmail.value = '';
  authPass.value  = '';
  authTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  authSubmit.textContent = mode === 'login' ? 'Login' : 'Create Account';
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => authEmail.focus(), 80);
}

function closeAuthModal() {
  authModal.classList.remove('open');
  authModal.setAttribute('aria-hidden', 'true');
}

authClose.addEventListener('click', closeAuthModal);
authModalBg.addEventListener('click', closeAuthModal);

authTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.tab;
    authTabs.forEach(t => t.classList.toggle('active', t === tab));
    authSubmit.textContent = authMode === 'login' ? 'Login' : 'Create Account';
    authError.textContent  = '';
  });
});

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled   = true;

  const endpoint = authMode === 'login' ? '/api/login' : '/api/signup';
  const res  = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: authEmail.value, password: authPass.value }),
  });
  const data = await res.json();

  authSubmit.disabled = false;

  if (data.ok) {
    if (authMode === 'signup') {
      // Auto-login after signup
      const loginRes  = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: authEmail.value, password: authPass.value }),
      });
      const loginData = await loginRes.json();
      if (!loginData.ok) { authError.textContent = 'Signed up — please login.'; return; }
    }
    closeAuthModal();
    await checkAuth();
  } else {
    authError.textContent = data.error || 'Something went wrong';
  }
});

// ── Upload modal ─────────────────────────────────────────────────────────────

const uploadModal  = document.getElementById('uploadModal');
const uploadModalBg = document.getElementById('uploadModalBg');
const uploadClose  = document.getElementById('uploadClose');
const uploadDrop   = document.getElementById('uploadDrop');
const uploadFile   = document.getElementById('uploadFile');
const uploadName   = document.getElementById('uploadName');
const uploadError  = document.getElementById('uploadError');
const uploadSubmit = document.getElementById('uploadSubmit');
const uploadProgress = document.getElementById('uploadProgress');
const uploadBar    = document.getElementById('uploadBar');

let pendingFile = null;

function openUploadModal() {
  pendingFile = null;
  uploadName.textContent = '';
  uploadError.textContent = '';
  uploadSubmit.disabled = true;
  uploadProgress.style.display = 'none';
  uploadBar.style.width = '0';
  uploadModal.classList.add('open');
  uploadModal.setAttribute('aria-hidden', 'false');
}

function closeUploadModal() {
  uploadModal.classList.remove('open');
  uploadModal.setAttribute('aria-hidden', 'true');
}

uploadClose.addEventListener('click', closeUploadModal);
uploadModalBg.addEventListener('click', closeUploadModal);

uploadFile.addEventListener('change', () => {
  const f = uploadFile.files[0];
  if (!f) return;
  pendingFile = f;
  uploadName.textContent = f.name;
  uploadSubmit.disabled  = false;
  uploadError.textContent = '';
});

['dragover', 'dragenter'].forEach(evt =>
  uploadDrop.addEventListener(evt, e => { e.preventDefault(); uploadDrop.classList.add('dragging'); })
);
['dragleave', 'dragend', 'drop'].forEach(evt =>
  uploadDrop.addEventListener(evt, e => { e.preventDefault(); uploadDrop.classList.remove('dragging'); })
);
uploadDrop.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  pendingFile = f;
  uploadName.textContent = f.name;
  uploadSubmit.disabled  = false;
  uploadError.textContent = '';
});

uploadSubmit.addEventListener('click', async () => {
  if (!pendingFile) return;
  uploadSubmit.disabled = true;
  uploadError.textContent = '';
  uploadProgress.style.display = 'block';

  const fd = new FormData();
  fd.append('file', pendingFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/videos/upload');

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) uploadBar.style.width = `${(e.loaded / e.total) * 100}%`;
  });

  xhr.addEventListener('load', async () => {
    const data = JSON.parse(xhr.responseText);
    if (data.ok) {
      closeUploadModal();
      // Reload sections to show the new upload
      content.innerHTML = '<div class="gallery-loading" id="galleryLoading"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>';
      await init();
    } else {
      uploadError.textContent = data.error || 'Upload failed';
      uploadSubmit.disabled   = false;
      uploadProgress.style.display = 'none';
    }
  });

  xhr.addEventListener('error', () => {
    uploadError.textContent = 'Upload failed — network error';
    uploadSubmit.disabled   = false;
    uploadProgress.style.display = 'none';
  });

  xhr.send(fd);
});

// ── Download ─────────────────────────────────────────────────────────────────

// Format options offered per media type (server converts on the fly).
const DL_FORMATS = {
  music: ['MP3', 'WAV'],
  image: ['PNG', 'JPG', 'WEBP'],
  video: ['MP4'],
};

function buildDownloadOptions(type) {
  if (!dlFormats) return;
  dlFormats.innerHTML = '';
  if (!currentUser || !currentFile) { dlFormats.style.display = 'none'; return; }   // members only; skip the file-less intro
  dlFormats.style.display = 'flex';

  const label = document.createElement('span');
  label.className = 'dl-label';
  label.textContent = '↓';
  dlFormats.appendChild(label);

  (DL_FORMATS[type] || ['MP4']).forEach(f => {
    const b = document.createElement('button');
    b.className = 'dl-chip';
    b.type = 'button';
    b.textContent = f;
    b.addEventListener('click', () => downloadCurrent(f.toLowerCase(), b));
    dlFormats.appendChild(b);
  });
}

function downloadCurrent(fmt, btn) {
  if (!currentFile || !currentUser) return;
  // Preserve sub-folder slashes (e.g. ai-music/track.wav) while escaping each part.
  const safePath = currentFile.split('/').map(encodeURIComponent).join('/');
  if (btn) { btn.classList.add('working'); setTimeout(() => btn.classList.remove('working'), 1400); }
  const a = document.createElement('a');
  a.href = `/api/videos/${safePath}/download?format=${encodeURIComponent(fmt)}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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

  content.innerHTML = '';
  buildMusicSection(groups.musicMine);   // music first, up top (AI Music removed)
  buildSection('edit', 'Short Docs', groups.edit,                 // short documentaries, just below music
    { src: '/static/pattern-hero.mp4', poster: '/static/video-thumbs/pattern-acid.jpg' });  // Pattern Acid bg
  buildSection('video', 'Video', groups.video);
  buildSection('image', 'Images', groups.image);

  countNum.textContent = videos.length;
  applyTypeFilter(currentType);
}

function buildSection(type, label, items, bg /* optional {src, poster} bg video */) {
  const section = document.createElement('section');
  section.className = 'media-section';
  section.dataset.type = type;
  section.id = `section-${type}`;

  if (bg) {
    section.classList.add('has-bg-video');
    const v = document.createElement('video');
    v.className = 'section-bg-video';
    v.autoplay = true; v.muted = true; v.loop = true;
    v.playsInline = true; v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    if (bg.poster) v.poster = bg.poster;
    v.innerHTML = `<source src="${bg.src}" type="video/mp4">`;
    const veil = document.createElement('div');
    veil.className = 'section-bg-veil';
    section.append(v, veil);
  }

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
    return;
  }

  const cf = makeCoverflow(items);
  section.appendChild(cf.el);
  section._cfs = [cf];                            // rails to relayout on filter/resize
  content.appendChild(section);
  requestAnimationFrame(() => cf.layout());       // lay out once it has width in the DOM
}

// Build a rail into `parent`, or an empty-state note if there's nothing. Returns the rail (or null).
function railOrEmpty(items, parent) {
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'section-empty';
    empty.textContent = 'Nothing here yet';
    parent.appendChild(empty);
    return null;
  }
  const cf = makeCoverflow(items);
  parent.appendChild(cf.el);
  requestAnimationFrame(() => cf.layout());
  return cf;
}

// A single Music rail of Rex's songs (the old "AI Music" sub-section was removed).
function buildMusicSection(mine /* ai, introSrc removed — AI Music section taken out */) {
  const section = document.createElement('section');
  section.className = 'media-section has-bg-video';
  section.dataset.type = 'music';
  section.id = 'section-music';
  section._cfs = [];

  // Zuma music-video loop, fast-loading, behind everything in the music section so it
  // reads as one dark cinematic space. Poster paints instantly; clip fades in muted.
  const bg = document.createElement('video');
  bg.className = 'section-bg-video';
  bg.autoplay = true; bg.muted = true; bg.loop = true;
  bg.playsInline = true; bg.preload = 'auto';
  bg.setAttribute('aria-hidden', 'true');
  bg.poster = '/static/video-thumbs/zuma.jpg';
  bg.innerHTML = '<source src="/static/zuma-hero.mp4" type="video/mp4">';
  const bgVeil = document.createElement('div');
  bgVeil.className = 'section-bg-veil';
  section.append(bg, bgVeil);

  const head = document.createElement('div');
  head.className = 'section-head';
  const h2 = document.createElement('h2');
  h2.className = 'section-title';
  h2.textContent = 'Music';
  const count = document.createElement('span');
  count.className = 'section-count';
  count.textContent = mine.length;
  head.append(h2, count);
  section.appendChild(head);

  const cf = railOrEmpty(mine, section);
  if (cf) section._cfs.push(cf);

  content.appendChild(section);
}

// ── 3D Coverflow rail ─────────────────────────────────────────────────────────
// A horizontal carousel: the centre card faces you, neighbours angle back into Z.
// Drag, trackpad-swipe, arrow keys, arrow buttons, or click a side card to glide.
function makeCoverflow(items) {
  const el = document.createElement('div');
  el.className = 'coverflow';
  el.tabIndex = 0;

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

      ensureLoaded(card);
      const isActive = o === 0;
      card.classList.toggle('cf-active', isActive);
      setActiveMedia(card, isActive);
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
    if ((card._type !== 'video' && card._type !== 'edit') || !card._media) return;
    if (on) { card._media.play().catch(() => {}); }
    else { try { card._media.pause(); card._media.currentTime = 0; } catch (e) {} }
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
  });
  window.addEventListener('pointerup', () => { down = false; el.classList.remove('grabbing'); });

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
    if (item.cover) {                                 // animated cover → loop the art clip behind the tile
      const bg = document.createElement('video');
      bg.className   = 'card-audio-video';
      bg.src         = item.cover;
      bg.muted       = true;
      bg.loop        = true;
      bg.autoplay    = true;
      bg.playsInline = true;
      bg.preload     = 'metadata';
      if (item.thumb) bg.poster = item.thumb;         // show the still until the clip is ready
      bg.addEventListener('loadeddata', () => bg.play().catch(() => {}));
      media.appendChild(bg);
    }
    media.insertAdjacentHTML('beforeend', '<span class="card-audio-note">&#9835;</span>');
  } else {
    media = document.createElement('video');
    media.className   = 'card-video';
    if (item.thumb) media.poster = item.thumb;   // show the thumbnail until the clip loads/plays
    if (cf) { media.dataset.src = src; }   // deferred — the rail loads it when near centre
    else    { media.src = src; }
    media.muted       = true;
    media.loop        = true;
    media.preload     = 'metadata';
    media.playsInline = true;
    if (!cf) {
      card.addEventListener('mouseenter', () => media.play().catch(() => {}));
      card.addEventListener('mouseleave', () => { media.pause(); media.currentTime = 0; });
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
  buildDownloadOptions(type);
}

function closeModal() {
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
  appModalFrame.removeAttribute('src');   // stop the embedded app (audio/video/network)
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
    const hub = HUB_OF[type];
    if (hub && window.worldFocusHub) window.worldFocusHub(hub);   // swoop the cosmos to that planet
    if (type !== 'all') {
      const sec = hub ? document.getElementById('section-world')
                      : (document.getElementById(`section-${type}`) || document.getElementById(type));
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Rex's Products ────────────────────────────────────────────────────────────

async function initProducts() {
  const grid = document.getElementById('productsGrid');
  const countEl = document.getElementById('productsCount');
  if (!grid) return;
  let products = [];
  try {
    const res = await fetch('/api/products');
    if (res.ok) ({ products } = await res.json());
  } catch (e) { /* leave empty */ }

  grid.innerHTML = '';
  if (countEl) countEl.textContent = products.length;
  if (!products.length) {
    const p = document.createElement('p');
    p.className = 'section-empty';
    p.textContent = 'Coming soon';
    grid.appendChild(p);
    return;
  }
  products.forEach(prod => grid.appendChild(buildProductCard(prod)));
}

function buildProductCard(p) {
  const card = document.createElement('div');
  card.className = 'product-card reveal';

  const thumb = document.createElement('div');
  thumb.className = 'product-thumb';
  if (p.thumb) {
    const img = document.createElement('img');
    img.src = p.thumb; img.alt = p.name || ''; img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    thumb.classList.add('placeholder');
    thumb.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
  }
  card.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'product-body';

  const h3 = document.createElement('h3');
  h3.className = 'product-name';
  h3.textContent = p.name || 'Untitled';

  const blurb = document.createElement('p');
  blurb.className = 'product-blurb';
  blurb.textContent = p.blurb || '';
  body.append(h3, blurb);

  if (Array.isArray(p.tags) && p.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'product-tags';
    p.tags.forEach(t => {
      const s = document.createElement('span');
      s.className = 'product-tag';
      s.textContent = t;
      tags.appendChild(s);
    });
    body.appendChild(tags);
  }

  const cta = document.createElement('a');
  cta.className = 'product-cta';
  const labels = { app: 'Open', link: 'Open', repo: 'View code', download: 'Download' };
  if (p.url) {
    cta.textContent = labels[p.kind] || 'Open';
    cta.href = p.url;
    if (p.kind === 'app') {
      // Opens inside the site in an iframe modal rather than leaving Keyside.
      card.classList.add('is-app');
      cta.addEventListener('click', e => { e.preventDefault(); openAppModal(p); });
      card.addEventListener('click', e => {
        if (e.target.closest('.product-cta')) return;  // CTA handles its own click
        openAppModal(p);
      });
    } else if (p.kind === 'download') { cta.setAttribute('download', ''); }
    else { cta.target = '_blank'; cta.rel = 'noopener'; }
  } else {
    cta.textContent = 'Coming soon';
    cta.classList.add('disabled');
    cta.setAttribute('aria-disabled', 'true');
  }
  body.appendChild(cta);

  card.appendChild(body);
  revealObserver.observe(card);
  return card;
}

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

// ── Boot ────────────────────────────────────────────────────────────────────

checkAuth();
init();
initProducts();

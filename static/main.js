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
const downloadBtn = document.getElementById('downloadBtn');
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
  if (downloadBtn) {
    downloadBtn.style.display = currentUser ? 'flex' : 'none';
  }
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
  if (downloadBtn) downloadBtn.style.display = 'none';
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

downloadBtn.addEventListener('click', () => {
  if (!currentFile || !currentUser) return;
  const a = document.createElement('a');
  a.href     = `/api/videos/${encodeURIComponent(currentFile)}/download`;
  a.download = currentFile;
  a.click();
});

// ── Build gallery from API ──────────────────────────────────────────────────

async function init() {
  let videos;

  try {
    const res = await fetch('/api/videos');
    if (!res.ok) throw new Error(res.statusText);
    ({ videos } = await res.json());
  } catch (err) {
    const loading = document.getElementById('galleryLoading');
    if (loading) loading.innerHTML = '<span style="color:#ff5500;font-size:11px;letter-spacing:.15em">Could not load works</span>';
    return;
  }

  // Group by media type.
  const groups = { video: [], image: [], music: [] };
  videos.forEach(v => { (groups[v.type] || groups.video).push(v); });

  content.innerHTML = '';
  SECTIONS.forEach(({ type, label }) => buildSection(type, label, groups[type]));

  countNum.textContent = videos.length;
  applyTypeFilter(currentType);
}

function buildSection(type, label, items) {
  const section = document.createElement('section');
  section.className = 'media-section';
  section.dataset.type = type;
  section.id = `section-${type}`;

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

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  items.forEach((item, i) => {
    const card = buildCard(item);
    if (i >= PREVIEW_COUNT) card.classList.add('beyond-preview');
    grid.appendChild(card);
  });
  section.appendChild(grid);

  if (items.length > PREVIEW_COUNT) {
    const viewAll = document.createElement('button');
    viewAll.className = 'view-all';
    viewAll.textContent = `View all ${items.length}`;
    viewAll.addEventListener('click', () => {
      grid.querySelectorAll('.beyond-preview').forEach(c => {
        c.classList.remove('beyond-preview');
        revealObserver.observe(c);
      });
      viewAll.remove();
    });
    section.appendChild(viewAll);
  }

  content.appendChild(section);
}

function buildCard(item) {
  const { title, style, src, type } = item;
  const card = document.createElement('div');
  card.className = 'card reveal';
  card.dataset.style = style;
  card.dataset.type  = type;

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
    media.innerHTML = '<span class="card-audio-note">&#9835;</span>';
  } else {
    media = document.createElement('video');
    media.className   = 'card-video';
    media.src         = src;
    media.muted       = true;
    media.loop        = true;
    media.preload     = 'metadata';
    media.playsInline = true;
    card.addEventListener('mouseenter', () => media.play().catch(() => {}));
    card.addEventListener('mouseleave', () => { media.pause(); media.currentTime = 0; });
  }

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

  card.addEventListener('click', () => openModal(item));

  attachTilt(card, inner, sheen);
  revealObserver.observe(card);

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

function openModal(item) {
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
    modalVideo.muted = true;
    modalVideo.style.display = 'block';
    modalVideo.play().catch(() => {});
  }

  modalTitle.textContent = title;
  modalTag.textContent   = (type === 'video') ? style : type;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (downloadBtn) downloadBtn.style.display = currentUser ? 'flex' : 'none';
}

function closeModal() {
  modal.classList.remove('open');
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

// ── Filter ──────────────────────────────────────────────────────────────────

function applyTypeFilter(type) {
  currentType = type;
  document.querySelectorAll('.media-section').forEach(section => {
    const show = type === 'all' || section.dataset.type === type;
    section.style.display = show ? '' : 'none';
  });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.dataset.type;
    applyTypeFilter(type);
    if (type !== 'all') {
      const sec = document.getElementById(`section-${type}`);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Boot ────────────────────────────────────────────────────────────────────

checkAuth();
init();

const gallery     = document.getElementById('gallery');
const galleryLoad = document.getElementById('galleryLoading');
const modal       = document.getElementById('modal');
const modalVideo  = document.getElementById('modalVideo');
const modalTitle  = document.getElementById('modalTitle');
const modalTag    = document.getElementById('modalStyleTag');
const modalClose  = document.getElementById('modalClose');
const modalBg     = document.getElementById('modalBg');
const countNum    = document.getElementById('countNum');
const downloadBtn = document.getElementById('downloadBtn');
const navRight    = document.getElementById('navRight');

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
      // Reload gallery to show new video
      gallery.innerHTML = '<div class="gallery-loading" id="galleryLoading"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>';
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
    if (loading) loading.innerHTML = '<span style="color:#ff5500;font-size:11px;letter-spacing:.15em">Could not load videos</span>';
    return;
  }

  const loading = document.getElementById('galleryLoading');
  if (loading) loading.remove();
  videos.forEach(buildCard);
  countNum.textContent = videos.length;
}

function buildCard({ file, title, style, src }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.style = style;

  const video = document.createElement('video');
  video.className  = 'card-video';
  video.src        = src;
  video.muted      = true;
  video.loop       = true;
  video.preload    = 'metadata';
  video.playsInline = true;

  const badge = document.createElement('div');
  badge.className = 'card-badge';
  badge.textContent = style;

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  const titleEl = document.createElement('div');
  titleEl.className   = 'card-title';
  titleEl.textContent = title;

  overlay.appendChild(titleEl);
  card.append(video, badge, overlay);

  card.addEventListener('mouseenter', () => video.play().catch(() => {}));
  card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
  card.addEventListener('click', () => openModal(src, title, style, file));

  gallery.appendChild(card);
}

// ── Modal ───────────────────────────────────────────────────────────────────

function openModal(src, title, style, file) {
  currentFile = file;
  scrollY = window.scrollY;
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('modal-open');
  modalVideo.src = src;
  modalVideo.muted = true;
  modalTitle.textContent = title;
  modalTag.textContent   = style;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modalVideo.play().catch(() => {});
  if (downloadBtn) downloadBtn.style.display = currentUser ? 'flex' : 'none';
}

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalVideo.pause();
  modalVideo.src = '';
  currentFile = null;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, scrollY);
}

modalClose.addEventListener('click', closeModal);
modalBg.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Filter ──────────────────────────────────────────────────────────────────

function applyFilter(style) {
  currentFilter = style;

  hideTimers.forEach(clearTimeout);
  hideTimers = [];

  const cards = [...gallery.querySelectorAll('.card')];
  cards.forEach(card => card.classList.remove('hidden'));

  requestAnimationFrame(() => requestAnimationFrame(() => {
    let visible = 0;

    cards.forEach(card => {
      const matches = style === 'all' || card.dataset.style === style;

      if (matches) {
        card.classList.remove('filtered-out');
        visible++;
      } else {
        card.classList.add('filtered-out');
        const t = setTimeout(() => {
          if (currentFilter === style) card.classList.add('hidden');
        }, 370);
        hideTimers.push(t);
      }
    });

    countNum.textContent = visible;
  }));
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(btn.dataset.style);
  });
});

// ── Boot ────────────────────────────────────────────────────────────────────

checkAuth();
init();

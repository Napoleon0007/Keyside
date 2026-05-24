const gallery     = document.getElementById('gallery');
const galleryLoad = document.getElementById('galleryLoading');
const modal       = document.getElementById('modal');
const modalVideo  = document.getElementById('modalVideo');
const modalTitle  = document.getElementById('modalTitle');
const modalTag    = document.getElementById('modalStyleTag');
const modalClose  = document.getElementById('modalClose');
const modalBg     = document.getElementById('modalBg');
const countNum    = document.getElementById('countNum');

let currentFilter = 'all';
let hideTimers    = [];

// ── Build gallery from API ──────────────────────────────────────────────────

async function init() {
  let videos;

  try {
    const res = await fetch('/api/videos');
    if (!res.ok) throw new Error(res.statusText);
    ({ videos } = await res.json());
  } catch (err) {
    galleryLoad.innerHTML = '<span style="color:#ff5500;font-size:11px;letter-spacing:.15em">Could not load videos</span>';
    return;
  }

  galleryLoad.remove();
  videos.forEach(buildCard);
  countNum.textContent = videos.length;
}

function buildCard({ file, title, style, src }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.style = style;

  const video = document.createElement('video');
  video.className = 'card-video';
  video.src = src;
  video.muted = true;
  video.loop = true;
  video.preload = 'metadata';
  video.playsInline = true;

  const badge = document.createElement('div');
  badge.className = 'card-badge';
  badge.textContent = style;

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = title;

  overlay.appendChild(titleEl);
  card.append(video, badge, overlay);

  card.addEventListener('mouseenter', () => video.play().catch(() => {}));
  card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
  card.addEventListener('click', () => openModal(src, title, style));

  gallery.appendChild(card);
}

// ── Modal ───────────────────────────────────────────────────────────────────

function openModal(src, title, style) {
  modalVideo.src = src;
  modalTitle.textContent = title;
  modalTag.textContent = style;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  modalVideo.play().catch(() => {});
}

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalVideo.pause();
  modalVideo.src = '';
  document.body.style.overflow = '';
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

  // Un-hide everything so we can animate it
  cards.forEach(card => card.classList.remove('hidden'));

  // Next paint: transition to final state
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

init();

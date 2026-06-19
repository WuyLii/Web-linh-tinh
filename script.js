// ====================================================

// CẤU HÌNH

// ====================================================

const CLOUDINARY_CLOUD_NAME    = 'dmq9orepw';

const CLOUDINARY_UPLOAD_PRESET = 'memory_gallery';

const SUPABASE_URL = 'https://nafjrifwubpujvqrbkaj.supabase.co';

const SUPABASE_KEY = 'sb_publishable_A7Rkd6AM1gUgJKcYzzht0g_bS5GMwkl';


// ====================================================

// CLOUDINARY ADAPTER

// ====================================================

const CloudinaryAdapter = {

  async upload(file) {

    const fd = new FormData();

    fd.append('file', file);

    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const type = file.type.startsWith('video/') ? 'video' : 'image';

    const url  = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${type}/upload`;

    const res  = await fetch(url, { method: 'POST', body: fd });

    if (!res.ok) {

      const err = await res.json().catch(() => ({}));

      throw new Error('Cloudinary: ' + (err.error?.message || `HTTP ${res.status}`));

    }

    const data = await res.json();

    return { secure_url: data.secure_url, resource_type: type, public_id: data.public_id };

  },

};


// ====================================================

// SUPABASE ADAPTER

// ====================================================

const SupabaseAdapter = {

  _h() {

    return {

      'Content-Type': 'application/json',

      'apikey': SUPABASE_KEY,

      'Authorization': `Bearer ${SUPABASE_KEY}`,

    };

  },


  // ── memories ──

  async getAllMemories() {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?select=*&order=date.asc,created_at.asc`, { headers: this._h() });

    if (!res.ok) throw new Error(`GET memories thất bại: ${res.status}`);

    return res.json();

  },

  async insertMemory(record) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(record),

    });

    if (!res.ok) {

      const e = await res.json().catch(() => ({}));

      throw new Error(e.message || `INSERT memory thất bại: ${res.status}`);

    }

    const rows = await res.json();

    return rows[0];

  },

  async updateMemory(id, updates) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?id=eq.${id}`, {

      method: 'PATCH',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(updates),

    });

    if (!res.ok) throw new Error(`UPDATE memory thất bại: ${res.status}`);

    const rows = await res.json();

    return rows[0];

  },

  async deleteMemory(id) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?id=eq.${id}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE memory thất bại: ${res.status}`);

  },


  // ── memory_media ──

  async getMedia(memoryId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memory_media?memory_id=eq.${memoryId}&order=position.asc`, { headers: this._h() });

    if (!res.ok) return [];

    return res.json();

  },

  async insertMedia(memoryId, items) {

    if (!items.length) return;

    const records = items.map((it, i) => ({ memory_id: memoryId, media_url: it.url, media_type: it.type, position: i, cloudinary_public_id: it.public_id || null, cloudinary_resource_type: it.resource_type || null }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memory_media`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=minimal' },

      body: JSON.stringify(records),

    });

    if (!res.ok) {

      const e = await res.json().catch(() => ({}));

      throw new Error(e.message || `INSERT media thất bại: ${res.status}`);

    }

  },

  async deleteMedia(memoryId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/memory_media?memory_id=eq.${memoryId}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE media thất bại: ${res.status}`);

  },


  // ── cloudinary delete ──

  async deleteCloudinaryAsset(public_id, resource_type) {
    if (!public_id) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/delete-cloudinary-asset`, {
        method: 'POST',
        headers: { ...this._h(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id, resource_type: resource_type || 'image' }),
      });
    } catch(e) {
      console.warn('Xóa Cloudinary không thành công (bỏ qua):', e);
    }
  },

  async deleteCloudinaryBatch(items) {
    if (!items || !items.length) return;
    const toDelete = items.filter(it => it.cloudinary_public_id);
    await Promise.allSettled(
      toDelete.map(it => this.deleteCloudinaryAsset(it.cloudinary_public_id, it.cloudinary_resource_type))
    );
  },


  // ── settings ──

  async getSetting(key) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, { headers: this._h() });

    if (!res.ok) return null;

    const rows = await res.json();

    return rows.length ? rows[0].value : null;

  },

  async setSetting(key, value) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'resolution=merge-duplicates,return=representation' },

      body: JSON.stringify({ key, value }),

    });

    if (!res.ok) throw new Error(`setSetting thất bại: ${res.status}`);

  },

};


// ====================================================

// APP STATE

// ====================================================

const AppState = {

  memories: [],

  // Multi-upload state

  pendingFiles: [],      // [{file, blobUrl, type}] — files mới chưa upload

  existingMedia: [],     // [{id, media_url, media_type, position}] — media đã lưu (khi edit)

  editingId: null,

  editingSupabaseId: null,

  // Lightbox

  lbItems: [],

  lbIndex: 0,

  counterInterval: null,

};


// ====================================================

// LOAD DỮ LIỆU TỪ SUPABASE

// ====================================================

async function loadMemoriesFromSupabase() {

  try {

    const rows = await SupabaseAdapter.getAllMemories();

    AppState.memories = rows.map(r => {

      // r.date from Supabase is always a plain "yyyy-mm-dd" string (no time, no timezone).

      // Never pass it through `new Date()` — that interprets it as UTC midnight and can

      // shift by a day when the browser is in a non-UTC timezone (including UTC+7 Vietnam).

      // Instead we handle it purely as a string.

      let dateIso = '';

      if (r.date) {

        // Supabase date column returns "yyyy-mm-dd" — keep as-is

        dateIso = String(r.date).substring(0, 10);

      } else if (r.created_at) {

        // Fallback: created_at is an ISO timestamp in UTC (e.g. "2025-07-01T17:00:00+00:00").

        // Convert to Vietnam time (UTC+7) before extracting the date string,

        // so a record created at 2025-07-01T18:30 UTC actually shows 02/07/2025 in VN.

        const utcMs = new Date(r.created_at).getTime();

        const vnDate = new Date(utcMs + 7 * 3600000); // shift to UTC+7

        const y = vnDate.getUTCFullYear();

        const mo = String(vnDate.getUTCMonth() + 1).padStart(2, '0');

        const d  = String(vnDate.getUTCDate()).padStart(2, '0');

        dateIso = `${y}-${mo}-${d}`;

      }

      return {

        id: String(r.id),

        supabaseId: r.id,

        title: r.title || '',

        date: dateIso,

        description: r.description || '',

        mediaType: r.media_type || 'image',

        mediaData: r.media_url || null,

        cloudinary_public_id: r.cloudinary_public_id || null,

        cloudinary_resource_type: r.cloudinary_resource_type || null,

        createdAt: r.created_at,

      };

    });

  } catch(e) {

    console.error('Lỗi tải kỷ niệm:', e);

    showToast('⚠️ Không thể tải dữ liệu!', 'error');

    AppState.memories = [];

  }

  renderTimeline();

  initYearFilter();

  renderAdminMemoryList();

}

// ====================================================

// MOBILE NAVIGATION - SWITCH TABS

// ====================================================

const mobileTabOrder = ['love-counter', 'timeline', 'photobooth', 'journey'];
let currentTabIndex = 0;

function switchMobileTab(tabName) {
  // Update active button
  document.querySelectorAll('.mbn-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Hide all sections and show the active one
  document.querySelectorAll('.love-counter-section, .timeline-section, .photobooth-section, .journey-section').forEach(section => {
    section.classList.remove('active');
  });
  document.getElementById(tabName).classList.add('active');

  // Update current tab index
  currentTabIndex = mobileTabOrder.indexOf(tabName);

  // Scroll to top
  window.scrollTo(0, 0);
}

// ---- Hàm xử lý nút "Xem Kỷ Niệm" trên mobile ----
window.revealMobileNav = function(defaultTab) {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    // Gỡ chốt an toàn inline-style trước khi cho CSS .active điều khiển hiển thị
    document.querySelectorAll('.love-counter-section, .timeline-section, .photobooth-section, .journey-section').forEach(section => {
      section.style.display = '';
    });
    document.body.classList.add('mobile-nav-revealed');
    switchMobileTab(defaultTab || 'love-counter');
    window.scrollTo(0, 0);
  } else {
    smoothScroll('#' + (defaultTab || 'timeline'));
  }
};

// Initialize on load and add swipe detection
window.addEventListener('DOMContentLoaded', () => {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) {
    switchMobileTab('love-counter');
  } else {
    // Trên mobile: chỉ chuẩn bị sẵn trạng thái tab đầu tiên,
    // KHÔNG hiện bottom nav / ẩn hero — chỉ làm vậy khi người dùng bấm "Xem Kỷ Niệm"
    currentTabIndex = 0;
    document.querySelectorAll('.mbn-tab').forEach(tab => tab.classList.remove('active'));
    const firstTab = document.querySelector(`[data-tab="${mobileTabOrder[0]}"]`);
    if (firstTab) firstTab.classList.add('active');
    document.querySelectorAll('.love-counter-section, .timeline-section, .photobooth-section, .journey-section').forEach(section => {
      section.classList.remove('active');
      // Chốt an toàn bằng inline style, không phụ thuộc hoàn toàn vào CSS/cache
      section.style.display = 'none';
    });
    const firstSection = document.getElementById(mobileTabOrder[0]);
    if (firstSection) firstSection.classList.add('active');
  }
  initSwipeDetection();
});

// Swipe detection for mobile
function initSwipeDetection() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let swipeAllowed = false;

  // Các overlay/modal/lightbox đang mở → tuyệt đối không đổi tab khi vuốt
  function isAnyOverlayOpen() {
    const ids = ['modalOverlay', 'lightbox', 'jnCatalog', 'pbCatalog', 'adminPanel', 'memoryModal', 'jnModal', 'pbModal'];
    return ids.some(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('active');
    });
  }

  document.addEventListener('touchstart', (e) => {
    // Chỉ cho phép vuốt đổi tab khi đã ở màn hình mobile-nav (đã bấm vào trong),
    // và không có modal/lightbox/catalog nào đang mở phía trên
    const isMobile = window.innerWidth <= 768;
    swipeAllowed = isMobile &&
      document.body.classList.contains('mobile-nav-revealed') &&
      !isAnyOverlayOpen();

    if (!swipeAllowed) return;

    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, false);

  document.addEventListener('touchend', (e) => {
    if (!swipeAllowed) return;
    // Phải kiểm tra lại lúc kết thúc vuốt, phòng trường hợp modal vừa mở ra trong lúc vuốt
    if (isAnyOverlayOpen()) return;

    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    detectSwipe();
  }, false);

  function detectSwipe() {
    const swipeThreshold = 60; // Khoảng cách tối thiểu để tính là vuốt
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;

    // Chỉ tính là vuốt ngang nếu khoảng cách ngang lớn hơn rõ rệt khoảng cách dọc
    // (tránh việc cuộn dọc trang bị nhận lầm thành vuốt đổi tab)
    if (Math.abs(diffX) <= swipeThreshold) return;
    if (Math.abs(diffX) < Math.abs(diffY) * 1.5) return;

    if (diffX > 0) {
      // Vuốt SANG TRÁI - chuyển tab kế tiếp
      if (currentTabIndex < mobileTabOrder.length - 1) {
        switchMobileTab(mobileTabOrder[currentTabIndex + 1]);
      }
    } else {
      // Vuốt SANG PHẢI - chuyển tab trước đó
      if (currentTabIndex > 0) {
        switchMobileTab(mobileTabOrder[currentTabIndex - 1]);
      }
    }
  }
}

// ====================================================

// VIDEO NỀN

// ====================================================

async function initBackgroundVideo() {

  const heroVideo = document.getElementById('heroVideo');

  if (!heroVideo) return;

  heroVideo.addEventListener('error', () => {

    document.getElementById('videoBg')?.classList.add('no-video');

  });

  const src = heroVideo.querySelector('source')?.src || '';

  if (!src || src.includes('nen(test).mp4') || src.includes('background.mp4')) {

    document.getElementById('videoBg')?.classList.add('no-video');

  }

  try {

    const saved = await SupabaseAdapter.getSetting('bg_video');

    if (saved) {

      heroVideo.src = saved;

      heroVideo.load();

      heroVideo.play().catch(() => {});

      document.getElementById('videoBg')?.classList.remove('no-video');

    }

  } catch(e) {}

}


async function changeBgVideo(input) {

  const file = input.files[0];

  if (!file || !file.type.startsWith('video/')) { showToast('⚠️ Chọn file video!', 'error'); return; }

  showToast('⏳ Đang tải video lên...', '');

  try {

    const heroVideo = document.getElementById('heroVideo');

    const blobUrl = URL.createObjectURL(file);

    if (heroVideo) { heroVideo.src = blobUrl; heroVideo.load(); heroVideo.play(); document.getElementById('videoBg')?.classList.remove('no-video'); }

    const up = await CloudinaryAdapter.upload(file);

    await SupabaseAdapter.setSetting('bg_video', up.secure_url);

    if (heroVideo) heroVideo.src = up.secure_url;

    showToast('✓ Đã cập nhật video nền!', 'success');

  } catch(e) { showToast('⚠️ Lỗi: ' + e.message, 'error'); }

}


// ====================================================

// ẢNH KHUNG TRÒN

// ====================================================

async function loadCounterPhoto() {

  try {

    const saved = await SupabaseAdapter.getSetting('counter_photo');

    if (saved) applyCounterPhoto(saved);

  } catch(e) {}

}


function applyCounterPhoto(url) {

  const img = document.getElementById('counterPhoto');

  const ph  = document.getElementById('counterPhotoPlaceholder');

  if (img && ph) { img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }

}


async function changeCounterPhoto(input) {

  const file = input.files[0];

  if (!file || !file.type.startsWith('image/')) { showToast('⚠️ Chọn file ảnh!', 'error'); return; }

  showToast('⏳ Đang tải ảnh lên...', '');

  try {

    applyCounterPhoto(URL.createObjectURL(file));

    const up = await CloudinaryAdapter.upload(file);

    await SupabaseAdapter.setSetting('counter_photo', up.secure_url);

    applyCounterPhoto(up.secure_url);

    showToast('✓ Đã cập nhật ảnh!', 'success');

  } catch(e) { showToast('⚠️ Lỗi: ' + e.message, 'error'); }

}


// ====================================================

// NAVBAR & SCROLL

// ====================================================

function smoothScroll(selector) {

  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

}


function initNavbar() {

  const navbar = document.getElementById('navbar');

  window.addEventListener('scroll', () => {

    navbar?.classList.toggle('scrolled', window.pageYOffset > 80);

  }, { passive: true });

}


// ====================================================

// ĐẾM NGÀY YÊU

// ====================================================


// Ngày bắt đầu yêu nhau — khai báo với offset +07:00 tường minh để

// JavaScript hiểu đúng là midnight ngày 11/07/2025 theo giờ Việt Nam.

const LOVE_START_DATE = new Date('2025-07-11T00:00:00+07:00');


/**

 * Trả về thời điểm hiện tại dưới dạng Date nhưng "dịch" sang UTC+7.

 * Cách làm: lấy timestamp hiện tại (UTC) rồi cộng thêm 7 tiếng,

 * sau đó dùng getUTC* để đọc các thành phần — không phụ thuộc vào

 * múi giờ của trình duyệt người dùng.

 */

function nowVN() {

  // getTimezoneOffset() trả số phút lệch (dương = sau UTC), nên:

  // utcMs = timestamp UTC thuần

  const now   = new Date();

  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;

  return new Date(utcMs + 7 * 3600000); // +7h → giờ Việt Nam

}


function updateLoveCounter() {

  const diff = nowVN() - LOVE_START_DATE;

  if (diff < 0) { ['days','hours','minutes','seconds'].forEach(id => setCounterValue(id, 0, id==='days'?3:2)); return; }

  const s = Math.floor(diff / 1000);

  setCounterValue('days',    Math.floor(s / 86400), 3);

  setCounterValue('hours',   Math.floor(s / 3600) % 24, 2);

  setCounterValue('minutes', Math.floor(s / 60) % 60, 2);

  setCounterValue('seconds', s % 60, 2);

}


function setCounterValue(id, value, pad = 2) {

  const el = document.getElementById(id);

  if (!el) return;

  const txt = String(value).padStart(pad, '0');

  if (el.textContent !== txt) {

    el.textContent = txt;

    el.style.transform = 'scale(1.05)';

    setTimeout(() => { el.style.transform = 'scale(1)'; }, 150);

  }

}


function initLoveCounter() {

  updateLoveCounter();

  AppState.counterInterval = setInterval(updateLoveCounter, 1000);

}


// ====================================================

// TIMELINE

// ====================================================

function renderTimeline() {

  const container  = document.getElementById('timelineContainer');

  const emptyState = document.getElementById('timelineEmpty');

  container.querySelectorAll('.timeline-item').forEach(el => el.remove());


  if (!AppState.memories.length) { emptyState.style.display = 'block'; return; }

  emptyState.style.display = 'none';


  AppState.memories.forEach((memory, i) => {

    const item = createTimelineItem(memory, i);

    container.appendChild(item);

    setTimeout(() => observeScrollReveal(item), 0);

    // Load số lượng media phụ để cập nhật badge

    loadMediaBadge(memory, item);

  });


  // Đo chiều cao 1 hàng + gap để vẽ đường kẻ ngang — tính lại sau khi ảnh load để tránh lỗi sọc
  function recalcRowCycle() {
    const firstItem = container.querySelector('.timeline-item');
    if (!firstItem) return;
    const rowHeight = firstItem.offsetHeight;
    const gap = parseFloat(getComputedStyle(container).rowGap) || 90;
    container.style.setProperty('--row-cycle', (rowHeight + gap) + 'px');
  }

  requestAnimationFrame(() => recalcRowCycle());

  const imgs = container.querySelectorAll('.timeline-media-wrapper img');
  if (imgs.length) {
    let loaded = 0;
    imgs.forEach(img => {
      if (img.complete) { loaded++; if (loaded === imgs.length) recalcRowCycle(); }
      else {
        img.addEventListener('load',  () => { loaded++; if (loaded === imgs.length) recalcRowCycle(); }, { once: true });
        img.addEventListener('error', () => { loaded++; if (loaded === imgs.length) recalcRowCycle(); }, { once: true });
      }
    });
  }
  setTimeout(() => recalcRowCycle(), 800);

}


// ====================================================

// TIMELINE YEAR FILTER

// ====================================================

function initYearFilter() {

  const select = document.getElementById('yearFilter');

  if (!select) return;

  

  const years = new Set();

  AppState.memories.forEach(m => {

    if (m.date) {

      const year = m.date.split('-')[0];

      years.add(year);

    }

  });

  

  const sortedYears = Array.from(years).sort().reverse();

  

  // Giữ lại option "Tất cả", xóa các option cũ

  while (select.options.length > 1) select.remove(1);

  

  sortedYears.forEach(year => {

    const opt = document.createElement('option');

    opt.value = year;

    opt.textContent = year;

    select.appendChild(opt);

  });

}


function filterTimelineByYear(year) {

  const container = document.getElementById('timelineContainer');

  if (!container) return;

  

  container.querySelectorAll('.timeline-item').forEach(item => {

    const itemYear = item.dataset.id ? 

      AppState.memories.find(m => m.id === item.dataset.id)?.date?.split('-')[0] : '';

    

    if (year === 'all' || itemYear === year) {

      item.style.display = '';

    } else {

      item.style.display = 'none';

    }

  });

}


function createTimelineItem(memory, index) {

  const item = document.createElement('div');

  item.className = 'timeline-item scroll-reveal';

  item.dataset.id = memory.id;


  const mediaHtml = createMediaHtml(memory);

  const dateFormatted = formatDate(memory.date);

  const badgeText = memory.mediaType === 'video' ? '🎬 Video' : '📷 Ảnh';


  item.innerHTML = `

    <div class="timeline-card" onclick="openLightbox('${memory.id}')">

      <div class="timeline-media-wrapper">

        ${mediaHtml}

        <div class="media-badge" id="badge-${memory.id}">${badgeText}</div>

      </div>

      <div class="timeline-card-body">

        <div class="timeline-card-date">${dateFormatted}</div>

        <h3 class="timeline-card-title">${escapeHtml(memory.title)}</h3>

        <p class="timeline-card-desc">${escapeHtml(memory.description || '')}</p>

      </div>

      <div class="timeline-card-actions" onclick="event.stopPropagation()">

        <button class="action-btn action-btn-edit" onclick="openEditMemoryModal('${memory.id}')">✏️ Sửa</button>

        <button class="action-btn action-btn-delete" onclick="confirmDeleteMemory('${memory.id}')">🗑 Xóa</button>

      </div>

    </div>

    <div class="timeline-dot"></div>

  `;

  return item;

}


async function loadMediaBadge(memory, item) {

  try {

    const rows = await SupabaseAdapter.getMedia(memory.supabaseId);

    if (!rows.length) return;

    const badge = item.querySelector(`#badge-${memory.id}`);

    if (badge) {

      const total = (memory.mediaData ? 1 : 0) + rows.length;

      const icon  = memory.mediaType === 'video' ? '🎬' : '📷';

      badge.textContent = total > 1 ? `${icon} ${total} ảnh/video` : badge.textContent;

    }

  } catch(e) {}

}


function createMediaHtml(memory) {

  if (!memory.mediaData) {

    return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:3rem;opacity:0.3;">${memory.mediaType==='video'?'🎬':'📷'}</div>`;

  }

  if (memory.mediaType === 'video') {

    return `<video src="${memory.mediaData}" controls preload="none" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" onclick="event.stopPropagation()"></video>`;

  }

  return `<img src="${memory.mediaData}" alt="${escapeHtml(memory.title)}" loading="lazy" />`;

}


// ====================================================

// LIGHTBOX — SLIDESHOW

// ====================================================

async function openLightbox(id) {

  const memory = AppState.memories.find(m => m.id === id);

  if (!memory) return;


  // Gộp ảnh chính + tất cả media phụ

  AppState.lbItems = [];

  if (memory.mediaData) AppState.lbItems.push({ url: memory.mediaData, type: memory.mediaType });


  try {

    const extras = await SupabaseAdapter.getMedia(memory.supabaseId);

    extras.forEach(e => AppState.lbItems.push({ url: e.media_url, type: e.media_type }));

  } catch(e) {}


  AppState.lbIndex = 0;


  // Thông tin text

  document.getElementById('lightboxTitle').textContent = memory.title;

  document.getElementById('lightboxDate').textContent  = formatDate(memory.date);

  document.getElementById('lightboxDesc').textContent  = memory.description || '';


  // Thêm nút điều hướng nếu chưa có

  ensureLightboxNav();

  renderLightboxSlide();

  updateLightboxNav();


  document.getElementById('lightbox').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function ensureLightboxNav() {

  if (document.getElementById('lbPrev')) return;

  // Nút nằm trong lightboxMedia để hiện đè lên ảnh

  const media = document.getElementById('lightboxMedia');

  if (!media) return;


  const prev = document.createElement('button');

  prev.id = 'lbPrev'; prev.className = 'lb-nav-btn lb-prev'; prev.innerHTML = '&#10094;';

  prev.onclick = e => { e.stopPropagation(); slideBy(-1); };


  const next = document.createElement('button');

  next.id = 'lbNext'; next.className = 'lb-nav-btn lb-next'; next.innerHTML = '&#10095;';

  next.onclick = e => { e.stopPropagation(); slideBy(1); };


  const counter = document.createElement('div');

  counter.id = 'lbCounter'; counter.className = 'lb-counter';


  media.appendChild(prev);

  media.appendChild(next);

  media.appendChild(counter);

}


function renderLightboxSlide() {

  const item = AppState.lbItems[AppState.lbIndex];

  const container = document.getElementById('lightboxMedia');

  if (!item) return;


  // Pause video cũ

  container.querySelector('video')?.pause();


  // Tạo element media mới mà không xóa nút nav

  const old = container.querySelector('img, video');

  if (old) old.remove();


  let el;

  if (item.type === 'video') {

    el = document.createElement('video');

    el.src = item.url;

    el.controls = true;

    el.autoplay = true;

    el.style.cssText = 'width:100%;max-height:60vh;object-fit:contain;display:block;';

  } else {

    el = document.createElement('img');

    el.src = item.url;

    el.style.cssText = 'width:100%;max-height:60vh;object-fit:contain;display:block;';

  }


  // Chèn ảnh/video vào đầu, trước các nút nav

  container.insertBefore(el, container.firstChild);

}


function slideBy(dir) {

  const total = AppState.lbItems.length;

  if (total <= 1) return;

  AppState.lbIndex = (AppState.lbIndex + dir + total) % total;

  renderLightboxSlide();

  updateLightboxNav();

}


function updateLightboxNav() {

  const total = AppState.lbItems.length;

  const show  = total > 1;

  document.getElementById('lbPrev')?.style.setProperty('display', show ? 'flex' : 'none');

  document.getElementById('lbNext')?.style.setProperty('display', show ? 'flex' : 'none');

  const counter = document.getElementById('lbCounter');

  if (counter) counter.textContent = show ? `${AppState.lbIndex + 1} / ${total}` : '';

}


function closeLightbox() {

  document.getElementById('lightbox').classList.remove('active');

  document.body.style.overflow = '';

  document.getElementById('lightboxMedia').querySelector('video')?.pause();

}


// ====================================================

// ADMIN PANEL

// ====================================================

function openAdminPanel() {

  document.getElementById('adminPanel').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

  renderAdminMemoryList();

}


function closeAdminPanel() {

  document.getElementById('adminPanel').classList.remove('active');

  document.getElementById('modalOverlay').classList.remove('active');

  document.body.style.overflow = '';

}


function renderAdminMemoryList() {

  const list = document.getElementById('adminMemoryList');

  if (!AppState.memories.length) {

    list.innerHTML = '<p style="font-size:0.82rem;color:rgba(255,255,255,0.3);text-align:center;padding:20px;">Chưa có kỷ niệm nào</p>';

    return;

  }

  list.innerHTML = AppState.memories.map(m => `

    <div class="admin-memory-item">

      ${m.mediaData && m.mediaType === 'image'

        ? `<img class="admin-memory-thumb" src="${m.mediaData}" alt="${escapeHtml(m.title)}" />`

        : `<div class="admin-memory-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${m.mediaType==='video'?'🎬':'📷'}</div>`}

      <div class="admin-memory-info">

        <div class="admin-memory-title">${escapeHtml(m.title)}</div>

        <div class="admin-memory-date">${formatDate(m.date)}</div>

      </div>

      <div class="admin-memory-btns">

        <button class="admin-mini-btn admin-mini-btn-edit" onclick="openEditMemoryModal('${m.id}')">Sửa</button>

        <button class="admin-mini-btn admin-mini-btn-delete" onclick="confirmDeleteMemory('${m.id}')">Xóa</button>

      </div>

    </div>

  `).join('');

}


// ====================================================

// MULTI-UPLOAD: CHỌN ẢNH/VIDEO

// ====================================================

function handleMediaSelect(input) {

  const files = Array.from(input.files);

  if (!files.length) return;


  files.forEach(file => {

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;

    AppState.pendingFiles.push({

      file,

      blobUrl: URL.createObjectURL(file),

      type: file.type.startsWith('video/') ? 'video' : 'image',

    });

  });


  renderMediaPreviewGrid();

  input.value = '';

  showToast(`✓ Đã chọn thêm ${files.length} file`, 'success');

}


function renderMediaPreviewGrid() {

  const grid = document.getElementById('mediaPreviewGrid');

  const ph   = document.getElementById('mediaPlaceholder');

  if (!grid) return;


  const existHtml = AppState.existingMedia.map((item, i) => `

    <div class="mpg-item">

      ${item.media_type === 'video'

        ? `<video src="${item.media_url}" class="mpg-thumb"></video>`

        : `<img src="${item.media_url}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge">${item.media_type === 'video' ? '🎬' : '📷'}</div>

      <button class="mpg-del" onclick="removeExisting(${i})">✕</button>

    </div>

  `).join('');


  const newHtml = AppState.pendingFiles.map((item, i) => `

    <div class="mpg-item">

      ${item.type === 'video'

        ? `<video src="${item.blobUrl}" class="mpg-thumb"></video>`

        : `<img src="${item.blobUrl}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge mpg-badge--new">${item.type === 'video' ? '🎬' : '📷'} mới</div>

      <button class="mpg-del" onclick="removePending(${i})">✕</button>

    </div>

  `).join('');


  const total = AppState.existingMedia.length + AppState.pendingFiles.length;

  grid.innerHTML = existHtml + newHtml;

  grid.style.display = total ? 'grid' : 'none';

  if (ph) ph.style.display = total ? 'none' : 'flex';

}


function removeExisting(i) {

  AppState.existingMedia.splice(i, 1);

  renderMediaPreviewGrid();

}


function removePending(i) {

  URL.revokeObjectURL(AppState.pendingFiles[i].blobUrl);

  AppState.pendingFiles.splice(i, 1);

  renderMediaPreviewGrid();

}


function resetMediaState() {

  AppState.pendingFiles.forEach(f => URL.revokeObjectURL(f.blobUrl));

  AppState.pendingFiles  = [];

  AppState.existingMedia = [];

  const grid = document.getElementById('mediaPreviewGrid');

  const ph   = document.getElementById('mediaPlaceholder');

  const inp  = document.getElementById('memoryMediaInput');

  if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }

  if (ph)   ph.style.display = 'flex';

  if (inp)  inp.value = '';

}


// ====================================================

// MODAL THÊM / SỬA KỶ NIỆM

// ====================================================

function openAddMemoryModal() {

  resetMediaState();

  AppState.editingId = null;

  AppState.editingSupabaseId = null;

  document.getElementById('memoryModalTitle').textContent = '✦ Thêm Kỷ Niệm Mới';

  document.getElementById('editMemoryId').value = '';

  document.getElementById('memoryTitle').value = '';

  document.getElementById('memoryDate').value = getTodayVN(); // dd/mm/yyyy

  document.getElementById('memoryDescription').value = '';

  document.getElementById('memoryModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


async function openEditMemoryModal(id) {

  const memory = AppState.memories.find(m => m.id === id);

  if (!memory) return;


  resetMediaState();

  AppState.editingId = id;

  AppState.editingSupabaseId = memory.supabaseId;


  document.getElementById('memoryModalTitle').textContent = '✦ Chỉnh Sửa Kỷ Niệm';

  document.getElementById('editMemoryId').value = id;

  document.getElementById('memoryTitle').value = memory.title;

  document.getElementById('memoryDate').value = isoToDisplay(memory.date); // dd/mm/yyyy

  document.getElementById('memoryDescription').value = memory.description || '';


  // Load media hiện có (ảnh chính + phụ)

  const allMedia = [];

  if (memory.mediaData) allMedia.push({ id: null, media_url: memory.mediaData, media_type: memory.mediaType, position: -1, isMain: true });

  try {

    const extras = await SupabaseAdapter.getMedia(memory.supabaseId);

    extras.forEach(e => allMedia.push({ ...e, isMain: false }));

  } catch(e) {}

  AppState.existingMedia = allMedia;

  renderMediaPreviewGrid();


  document.getElementById('adminPanel').classList.remove('active');

  document.getElementById('memoryModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function closeMemoryModal() {

  document.getElementById('memoryModal').classList.remove('active');

  if (!document.getElementById('adminPanel').classList.contains('active')) {

    document.getElementById('modalOverlay').classList.remove('active');

    document.body.style.overflow = '';

  }

  resetMediaState();

}


// ====================================================

// NÉN ẢNH — giảm kích thước xuống dưới giới hạn Cloudinary (10MB)

// ====================================================

async function compressImage(file, maxSizeMB = 9) {

  return new Promise(resolve => {

    if (file.size <= maxSizeMB * 1024 * 1024) { resolve(file); return; }

    const img = new Image();

    const blobUrl = URL.createObjectURL(file);

    img.onload = () => {

      URL.revokeObjectURL(blobUrl);

      const ratio  = Math.sqrt((maxSizeMB * 1024 * 1024) / file.size);

      const canvas = document.createElement('canvas');

      canvas.width  = Math.floor(img.width  * ratio);

      canvas.height = Math.floor(img.height * ratio);

      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(

        blob => resolve(blob

          ? new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() })

          : file),

        'image/jpeg', 0.92

      );

    };

    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };

    img.src = blobUrl;

  });

}


// ====================================================

// LƯU KỶ NIỆM

// ====================================================

async function saveMemory() {

  const title          = document.getElementById('memoryTitle').value.trim();

  const dateDisplay    = document.getElementById('memoryDate').value.trim();

  const description    = document.getElementById('memoryDescription').value.trim();


  if (!title) { showToast('⚠️ Vui lòng nhập tiêu đề!', 'error'); document.getElementById('memoryTitle').focus(); return; }

  if (!dateDisplay) { showToast('⚠️ Vui lòng nhập ngày (dd/mm/yyyy)!', 'error'); document.getElementById('memoryDate').focus(); return; }

  if (!isValidDisplayDate(dateDisplay)) { showToast('⚠️ Ngày không hợp lệ! Vui lòng nhập theo dạng dd/mm/yyyy (ví dụ: 02/07/2025)', 'error'); document.getElementById('memoryDate').focus(); return; }

  const date = displayToIso(dateDisplay);

  if (!AppState.pendingFiles.length && !AppState.existingMedia.length && !AppState.editingId) {

    showToast('⚠️ Vui lòng chọn ít nhất 1 ảnh hoặc video!', 'error'); return;

  }


  const saveBtn = document.querySelector('.memory-modal-footer .btn-primary');

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu...'; }


  try {

    // 1. Upload tất cả file mới lên Cloudinary (có nén ảnh nếu > 9MB)

    const uploadedNew = [];

    for (let i = 0; i < AppState.pendingFiles.length; i++) {

      const f = AppState.pendingFiles[i];

      showToast(`⏳ Đang tải file ${i + 1}/${AppState.pendingFiles.length}...`, '');


      // Video quá lớn (>100MB) → bỏ qua

      if (f.type === 'video' && f.file.size > 100 * 1024 * 1024) {

        showToast(`⚠️ Video "${f.file.name}" quá lớn (>100MB), đã bỏ qua.`, 'error');

        continue;

      }


      // Ảnh lớn hơn 9MB → nén trước khi upload

      let fileToUpload = f.file;

      if (f.type === 'image' && f.file.size > 9 * 1024 * 1024) {

        showToast(`⏳ Đang nén ảnh ${i + 1}...`, '');

        fileToUpload = await compressImage(f.file);

      }


      try {

        const up = await CloudinaryAdapter.upload(fileToUpload);

        uploadedNew.push({ url: up.secure_url, type: f.type, public_id: up.public_id, resource_type: up.resource_type });

      } catch(uploadErr) {

        showToast(`⚠️ Lỗi upload "${f.file.name}": ${uploadErr.message}`, 'error');

      }

    }


    // 2. Ảnh đầu tiên làm thumbnail (ảnh chính trong bảng memories)

    const allMediaUrls = [

      ...AppState.existingMedia.filter(e => e.isMain).map(e => ({ url: e.media_url, type: e.media_type, public_id: e.cloudinary_public_id, resource_type: e.cloudinary_resource_type })),

      ...uploadedNew,

    ];

    const firstMedia = allMediaUrls[0] || { url: '', type: 'image' };


    if (AppState.editingId && AppState.editingSupabaseId) {

      // ── UPDATE ──

      await SupabaseAdapter.updateMemory(AppState.editingSupabaseId, {

        title, date, description,

        media_url: firstMedia.url,

        media_type: firstMedia.type,

        cloudinary_public_id: firstMedia.public_id || null,

        cloudinary_resource_type: firstMedia.resource_type || null,

      });

      // Xóa toàn bộ media phụ cũ rồi insert lại

      await SupabaseAdapter.deleteMedia(AppState.editingSupabaseId);

      const mediaPhụ = allMediaUrls.slice(1);

      if (mediaPhụ.length) await SupabaseAdapter.insertMedia(AppState.editingSupabaseId, mediaPhụ);

      showToast('✓ Đã cập nhật kỷ niệm!', 'success');


    } else {

      // ── INSERT ──

      const row = await SupabaseAdapter.insertMemory({

        title, date, description,

        media_url: firstMedia.url,

        media_type: firstMedia.type,

        cloudinary_public_id: firstMedia.public_id || null,

        cloudinary_resource_type: firstMedia.resource_type || null,

      });

      const mediaPhụ = allMediaUrls.slice(1);

      if (mediaPhụ.length) await SupabaseAdapter.insertMedia(row.id, mediaPhụ);

      showToast('✓ Đã thêm kỷ niệm mới!', 'success');

    }


    await loadMemoriesFromSupabase();

    closeMemoryModal();


  } catch(e) {

    console.error('Lỗi lưu:', e);

    showToast(`⚠️ Lỗi: ${e.message}`, 'error');

  } finally {

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Lưu'; }

  }

}


// ====================================================

// XÓA KỶ NIỆM

// ====================================================

async function confirmDeleteMemory(id) {

  const memory = AppState.memories.find(m => m.id === id);

  if (!memory) return;

  if (!confirm(`Xóa kỷ niệm "${memory.title}"?\nHành động không thể hoàn tác.`)) return;

  try {

    const mediaRows = await SupabaseAdapter.getMedia(memory.supabaseId);

    const allToDelete = [
      { cloudinary_public_id: memory.cloudinary_public_id, cloudinary_resource_type: memory.cloudinary_resource_type },
      ...mediaRows,
    ];
    await SupabaseAdapter.deleteCloudinaryBatch(allToDelete);

    await SupabaseAdapter.deleteMedia(memory.supabaseId);

    await SupabaseAdapter.deleteMemory(memory.supabaseId);

    await loadMemoriesFromSupabase();

    showToast('✓ Đã xóa kỷ niệm', 'success');

  } catch(e) { showToast(`⚠️ Lỗi: ${e.message}`, 'error'); }

}


// ====================================================

// HELPER FUNCTIONS — NGÀY THÁNG

// ── NGUYÊN TẮC QUAN TRỌNG ──────────────────────────

// Tất cả ngày tháng đều được xử lý dưới dạng CHUỖI thuần túy (yyyy-mm-dd hoặc dd/mm/yyyy).

// KHÔNG BAO GIỜ dùng `new Date("yyyy-mm-dd")` để parse — JavaScript sẽ hiểu là

// UTC midnight và convert sang giờ local (UTC+7), làm lệch ngày 1 ngày.

// ====================================================


/**

 * yyyy-mm-dd → dd/mm/yyyy  (xử lý chuỗi, không qua Date)

 */

function formatDate(d) {

  if (!d) return '';

  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);

  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);

}


/**

 * yyyy-mm-dd → dd/mm/yyyy  (alias, dùng để set vào input text)

 */

function isoToDisplay(iso) {

  return formatDate(iso);

}


/**

 * Định dạng khoảng thời gian cho Journey Events
 * start_date: "2025-07-01", end_date: "2025-07-05" → "01/07/2025 - 05/07/2025"
 * Nếu chỉ có 1 ngày → "01/07/2025"
 */

function formatDateRange(startDate, endDate) {

  if (!startDate) return '';

  if (!endDate || startDate === endDate) return formatDate(startDate);

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;

}


/**

 * dd/mm/yyyy → yyyy-mm-dd  (để lưu vào Supabase)

 * Ví dụ: "02/07/2025" → "2025-07-02"

 */

function displayToIso(display) {

  if (!display) return '';

  const m = String(display).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!m) return display; // trả lại nguyên nếu không khớp

  return `${m[3]}-${m[2]}-${m[1]}`;

}


/**

 * Kiểm tra định dạng dd/mm/yyyy và tính hợp lệ của ngày tháng năm

 */

function isValidDisplayDate(val) {

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return false;

  const [dd, mm, yyyy] = val.split('/').map(Number);

  if (mm < 1 || mm > 12) return false;

  if (dd < 1 || dd > 31) return false;

  // Kiểm tra số ngày trong tháng (kể cả năm nhuận)

  const daysInMonth = new Date(yyyy, mm, 0).getDate(); // tháng mm, ngày 0 = ngày cuối tháng mm-1

  return dd <= daysInMonth;

}


/**

 * Trả về ngày hôm nay theo giờ Việt Nam (UTC+7) dưới dạng dd/mm/yyyy.

 * Dùng toLocaleDateString với en-CA (cho ra yyyy-mm-dd) rồi tách chuỗi — không qua Date constructor.

 */

function getTodayVN() {

  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  return formatDate(iso);

}


function escapeHtml(str) {

  if (!str) return '';

  const d = document.createElement('div');

  d.appendChild(document.createTextNode(str));

  return d.innerHTML;

}


function showToast(msg, type = '') {

  document.querySelector('.toast')?.remove();

  const t = document.createElement('div');

  t.className = `toast ${type}`;

  t.textContent = msg;

  document.body.appendChild(t);

  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));

  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);

}


function closeAllModals() {

  if (!document.getElementById('lightbox').classList.contains('active')) {

    closeMemoryModal();

    closeAdminPanel();

  }

}


// ====================================================

// SCROLL REVEAL

// ====================================================

let scrollObserver = null;


function initScrollReveal() {

  scrollObserver = new IntersectionObserver((entries) => {

    entries.forEach((entry, i) => {

      if (entry.isIntersecting) {

        setTimeout(() => entry.target.classList.add('visible'), i * 100);

        scrollObserver.unobserve(entry.target);

      }

    });

  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

}


function observeScrollReveal(el) {

  scrollObserver?.observe(el);

}


function observeStaticElements() {

  document.querySelectorAll('.section-header, .counter-card, .counter-quote, .counter-separator').forEach(el => {

    el.classList.add('scroll-reveal');

    observeScrollReveal(el);

  });

}


// ====================================================

// KEYBOARD NAVIGATION

// ====================================================

document.addEventListener('keydown', e => {

  if (document.getElementById('lightbox').classList.contains('active')) {

    if (e.key === 'ArrowLeft')  slideBy(-1);

    if (e.key === 'ArrowRight') slideBy(1);

    if (e.key === 'Escape')     closeLightbox();

  } else if (e.key === 'Escape') {

    closeMemoryModal();

    closeAdminPanel();

  }

});


// ====================================================

// AUTO-FORMAT INPUT NGÀY THÁNG (dd/mm/yyyy)

// ====================================================

function initDateInput() {

  const input = document.getElementById('memoryDate');

  if (!input) return;


  input.addEventListener('input', function (e) {

    let val = this.value.replace(/\D/g, ''); // chỉ giữ số

    if (val.length > 8) val = val.slice(0, 8);


    let formatted = '';

    if (val.length <= 2) {

      formatted = val;

    } else if (val.length <= 4) {

      formatted = val.slice(0, 2) + '/' + val.slice(2);

    } else {

      formatted = val.slice(0, 2) + '/' + val.slice(2, 4) + '/' + val.slice(4);

    }

    this.value = formatted;

  });


  // Cho phép xóa dấu / tự nhiên (backspace)

  input.addEventListener('keydown', function (e) {

    if (e.key === 'Backspace') {

      const val = this.value;

      if (val.endsWith('/')) {

        e.preventDefault();

        this.value = val.slice(0, -1);

      }

    }

  });

}


// ====================================================

// KHỞI TẠO

// ====================================================

async function init() {

  console.log('💕 Ký Ức Của Chúng Mình - Đang khởi động...');

  showToast('⏳ Đang tải...', '');

  await initBackgroundVideo();

  await loadCounterPhoto();

  initNavbar();

  initLoveCounter();

  initScrollReveal();

  await loadMemoriesFromSupabase();

  await loadPhotoboothFromSupabase();

  await loadJourneyFromSupabase();

  observeStaticElements();


  document.getElementById('openAdminBtn')?.addEventListener('click', openAdminPanel);

  document.getElementById('openAddMemoryBtn')?.addEventListener('click', openAddMemoryModal);

  document.getElementById('openAddPhotoboothBtn')?.addEventListener('click', openAddPhotoboothModal);

  document.getElementById('openAddJourneyBtn')?.addEventListener('click', openAddJourneyModal);

  initDateInput();

  initPbDateInput();

  initJnDateInput();


  console.log(`💕 Sẵn sàng! Đã tải ${AppState.memories.length} kỷ niệm.`);

}


document.readyState === 'loading'

  ? document.addEventListener('DOMContentLoaded', init)

  : init();

// ====================================================

// SUPABASE ADAPTER — PHOTOBOOTH & JOURNEY

// ====================================================

Object.assign(SupabaseAdapter, {


  // ── photobooth_events ──

  async getAllPhotobooth() {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_events?select=*&order=date.asc,created_at.asc`, { headers: this._h() });

    if (!res.ok) throw new Error(`GET photobooth thất bại: ${res.status}`);

    return res.json();

  },

  async insertPhotobooth(record) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_events`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(record),

    });

    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `INSERT photobooth thất bại: ${res.status}`); }

    return (await res.json())[0];

  },

  async updatePhotobooth(id, updates) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_events?id=eq.${id}`, {

      method: 'PATCH',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(updates),

    });

    if (!res.ok) throw new Error(`UPDATE photobooth thất bại: ${res.status}`);

    return (await res.json())[0];

  },

  async deletePhotobooth(id) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_events?id=eq.${id}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE photobooth thất bại: ${res.status}`);

  },

  async getPbMedia(eventId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_media?event_id=eq.${eventId}&order=position.asc`, { headers: this._h() });

    if (!res.ok) return [];

    return res.json();

  },

  async insertPbMedia(eventId, items) {

    if (!items.length) return;

    const records = items.map((it, i) => ({ event_id: eventId, media_url: it.url, media_type: it.type, position: i }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_media`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=minimal' },

      body: JSON.stringify(records),

    });

    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `INSERT pb_media thất bại: ${res.status}`); }

  },

  async deletePbMedia(eventId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/photobooth_media?event_id=eq.${eventId}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE pb_media thất bại: ${res.status}`);

  },


  // ── journey_events ──

  async getAllJourney() {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_events?select=*&order=date.asc,created_at.asc`, { headers: this._h() });

    if (!res.ok) throw new Error(`GET journey thất bại: ${res.status}`);

    return res.json();

  },

  async insertJourney(record) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_events`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(record),

    });

    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `INSERT journey thất bại: ${res.status}`); }

    return (await res.json())[0];

  },

  async updateJourney(id, updates) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_events?id=eq.${id}`, {

      method: 'PATCH',

      headers: { ...this._h(), 'Prefer': 'return=representation' },

      body: JSON.stringify(updates),

    });

    if (!res.ok) throw new Error(`UPDATE journey thất bại: ${res.status}`);

    return (await res.json())[0];

  },

  async deleteJourney(id) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_events?id=eq.${id}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE journey thất bại: ${res.status}`);

  },

  async getJnMedia(eventId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_media?event_id=eq.${eventId}&order=position.asc`, { headers: this._h() });

    if (!res.ok) return [];

    return res.json();

  },

  async insertJnMedia(eventId, items) {

    if (!items.length) return;

    const records = items.map((it, i) => ({ event_id: eventId, media_url: it.url, media_type: it.type, position: i }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_media`, {

      method: 'POST',

      headers: { ...this._h(), 'Prefer': 'return=minimal' },

      body: JSON.stringify(records),

    });

    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || `INSERT jn_media thất bại: ${res.status}`); }

  },

  async deleteJnMedia(eventId) {

    const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_media?event_id=eq.${eventId}`, { method: 'DELETE', headers: this._h() });

    if (!res.ok) throw new Error(`DELETE jn_media thất bại: ${res.status}`);

  },

});


// ====================================================

// APP STATE — PHOTOBOOTH & JOURNEY

// ====================================================

AppState.photobooth   = [];

AppState.journey      = [];

AppState.pbPending    = [];

AppState.pbExisting   = [];

AppState.pbEditingId  = null;

AppState.jnPending    = [];

AppState.jnExisting   = [];

AppState.jnEditingId  = null;

// Journey catalog slideshow

AppState.jnCatItems   = [];

AppState.jnCatIndex   = 0;

// Photobooth catalog slideshow

AppState.pbCatItems   = [];

AppState.pbCatIndex   = 0;


// ====================================================

// PHOTOBOOTH — LOAD & RENDER

// ====================================================

async function loadPhotoboothFromSupabase() {

  try {

    const rows = await SupabaseAdapter.getAllPhotobooth();

    AppState.photobooth = rows.map(r => ({

      id: String(r.id),

      supabaseId: r.id,

      title: r.title || '',

      date: r.date ? String(r.date).substring(0, 10) : '',

      description: r.description || '',

      mediaType: r.media_type || 'image',

      mediaData: r.media_url || null,

      createdAt: r.created_at,

    }));

  } catch(e) {

    console.error('Lỗi tải photobooth:', e);

    AppState.photobooth = [];

  }

  renderPhotoboothGrid();

}


function renderPhotoboothGrid() {

  const grid  = document.getElementById('pbGrid');

  const empty = document.getElementById('pbEmpty');

  if (!grid) return;

  grid.querySelectorAll('.pb-card').forEach(el => el.remove());


  if (!AppState.photobooth.length) { empty.style.display = 'block'; return; }

  empty.style.display = 'none';


  AppState.photobooth.forEach((ev, i) => {

    const card = createPbCard(ev, i);

    grid.appendChild(card);

    setTimeout(() => observeScrollReveal(card), 0);

  });

}


function createPbCard(ev, index) {

  const card = document.createElement('div');

  card.className = 'pb-card scroll-reveal';

  card.dataset.id = ev.id;


  let mediaHtml = '';

  if (ev.mediaData) {

    if (ev.mediaType === 'video') {

      mediaHtml = `<video src="${ev.mediaData}" preload="none" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"></video>`;

    } else {

      mediaHtml = `<img src="${ev.mediaData}" alt="${escapeHtml(ev.title)}" loading="lazy" />`;

    }

  } else {

    mediaHtml = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:3rem;opacity:0.25;">🎯</div>`;

  }


  card.innerHTML = `

    <div class="pb-card-index">${index + 1}</div>

    <div class="pb-card-media" onclick="openPbCatalog('${ev.id}')">${mediaHtml}

      <div class="pb-card-media-badge">${ev.mediaType === 'video' ? '🎬 Video' : '📷 Ảnh'}</div>

    </div>

    <div class="pb-card-body" onclick="openPbCatalog('${ev.id}')">

      <div class="pb-card-date">${formatDate(ev.date)}</div>

      <h3 class="pb-card-title">${escapeHtml(ev.title)}</h3>

      <p class="pb-card-desc">${escapeHtml(ev.description || '')}</p>

    </div>

    <div class="pb-card-actions" onclick="event.stopPropagation()">

      <button class="pb-action-edit" onclick="openEditPbModal('${ev.id}')">✏️ Sửa</button>

      <button class="pb-action-delete" onclick="confirmDeletePb('${ev.id}')">🗑 Xóa</button>

    </div>

  `;

  return card;

}


// ====================================================

// PHOTOBOOTH — MODAL & CRUD

// ====================================================

function openAddPhotoboothModal() {

  resetPbMediaState();

  AppState.pbEditingId = null;

  document.getElementById('pbModalTitle').textContent = '🎯 Thêm Cột Mốc Mới';

  document.getElementById('pbEditId').value = '';

  document.getElementById('pbTitle').value = '';

  document.getElementById('pbDate').value = getTodayVN();

  document.getElementById('pbDescription').value = '';

  document.getElementById('pbModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


async function openEditPbModal(id) {

  const ev = AppState.photobooth.find(e => e.id === id);

  if (!ev) return;

  resetPbMediaState();

  AppState.pbEditingId = id;

  document.getElementById('pbModalTitle').textContent = '🎯 Chỉnh Sửa Cột Mốc';

  document.getElementById('pbEditId').value = id;

  document.getElementById('pbTitle').value = ev.title;

  document.getElementById('pbDate').value = isoToDisplay(ev.date);

  document.getElementById('pbDescription').value = ev.description || '';


  const allMedia = [];

  if (ev.mediaData) allMedia.push({ id: null, media_url: ev.mediaData, media_type: ev.mediaType, position: -1, isMain: true });

  try {

    const extras = await SupabaseAdapter.getPbMedia(ev.supabaseId);

    extras.forEach(e => allMedia.push({ ...e, isMain: false }));

  } catch(e) {}

  AppState.pbExisting = allMedia;

  renderPbPreviewGrid();


  document.getElementById('pbModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function closePbModal() {

  document.getElementById('pbModal').classList.remove('active');

  document.getElementById('modalOverlay').classList.remove('active');

  document.body.style.overflow = '';

  resetPbMediaState();

}


function handlePbMediaSelect(input) {

  Array.from(input.files).forEach(file => {

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;

    AppState.pbPending.push({ file, blobUrl: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image' });

  });

  renderPbPreviewGrid();

  input.value = '';

}


function renderPbPreviewGrid() {

  const grid = document.getElementById('pbMediaPreviewGrid');

  const ph   = document.getElementById('pbMediaPlaceholder');

  if (!grid) return;

  const existHtml = AppState.pbExisting.map((item, i) => `

    <div class="mpg-item">

      ${item.media_type === 'video' ? `<video src="${item.media_url}" class="mpg-thumb"></video>` : `<img src="${item.media_url}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge">${item.media_type === 'video' ? '🎬' : '📷'}</div>

      <button class="mpg-del" onclick="removePbExisting(${i})">✕</button>

    </div>`).join('');

  const newHtml = AppState.pbPending.map((item, i) => `

    <div class="mpg-item">

      ${item.type === 'video' ? `<video src="${item.blobUrl}" class="mpg-thumb"></video>` : `<img src="${item.blobUrl}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge mpg-badge--new">${item.type === 'video' ? '🎬' : '📷'} mới</div>

      <button class="mpg-del" onclick="removePbPending(${i})">✕</button>

    </div>`).join('');

  const total = AppState.pbExisting.length + AppState.pbPending.length;

  grid.innerHTML = existHtml + newHtml;

  grid.style.display = total ? 'grid' : 'none';

  if (ph) ph.style.display = total ? 'none' : 'flex';

}

function removePbExisting(i) { AppState.pbExisting.splice(i, 1); renderPbPreviewGrid(); }

function removePbPending(i)  { URL.revokeObjectURL(AppState.pbPending[i].blobUrl); AppState.pbPending.splice(i, 1); renderPbPreviewGrid(); }

function resetPbMediaState() {

  AppState.pbPending.forEach(f => URL.revokeObjectURL(f.blobUrl));

  AppState.pbPending = []; AppState.pbExisting = [];

  const grid = document.getElementById('pbMediaPreviewGrid');

  const ph   = document.getElementById('pbMediaPlaceholder');

  const inp  = document.getElementById('pbMediaInput');

  if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }

  if (ph)   ph.style.display = 'flex';

  if (inp)  inp.value = '';

}


async function savePbMemory() {

  const title       = document.getElementById('pbTitle').value.trim();

  const dateDisplay = document.getElementById('pbDate').value.trim();

  const description = document.getElementById('pbDescription').value.trim();


  if (!title) { showToast('⚠️ Vui lòng nhập tên cột mốc!', 'error'); return; }

  if (!dateDisplay || !isValidDisplayDate(dateDisplay)) { showToast('⚠️ Ngày không hợp lệ! (dd/mm/yyyy)', 'error'); return; }

  const date = displayToIso(dateDisplay);


  const saveBtn = document.querySelector('.pb-modal-footer .btn-pb-primary');

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu...'; }


  try {

    const uploadedNew = [];

    for (let i = 0; i < AppState.pbPending.length; i++) {

      const f = AppState.pbPending[i];

      showToast(`⏳ Đang tải file ${i+1}/${AppState.pbPending.length}...`, '');

      if (f.type === 'video' && f.file.size > 100*1024*1024) { showToast(`⚠️ Video quá lớn (>100MB)`, 'error'); continue; }

      let fileToUpload = f.file;

      if (f.type === 'image' && f.file.size > 9*1024*1024) fileToUpload = await compressImage(f.file);

      try {

        const up = await CloudinaryAdapter.upload(fileToUpload);

        uploadedNew.push({ url: up.secure_url, type: f.type });

      } catch(e) { showToast(`⚠️ Lỗi upload: ${e.message}`, 'error'); }

    }


    const allMedia = [

      ...AppState.pbExisting.filter(e => e.isMain).map(e => ({ url: e.media_url, type: e.media_type })),

      ...uploadedNew,

    ];

    const first = allMedia[0] || { url: '', type: 'image' };


    if (AppState.pbEditingId) {

      const ev = AppState.photobooth.find(e => e.id === AppState.pbEditingId);

      await SupabaseAdapter.updatePhotobooth(ev.supabaseId, { title, date, description, media_url: first.url, media_type: first.type });

      await SupabaseAdapter.deletePbMedia(ev.supabaseId);

      if (allMedia.length > 1) await SupabaseAdapter.insertPbMedia(ev.supabaseId, allMedia.slice(1));

      showToast('✓ Đã cập nhật cột mốc!', 'success');

    } else {

      const row = await SupabaseAdapter.insertPhotobooth({ title, date, description, media_url: first.url, media_type: first.type });

      if (allMedia.length > 1) await SupabaseAdapter.insertPbMedia(row.id, allMedia.slice(1));

      showToast('✓ Đã thêm cột mốc mới!', 'success');

    }


    await loadPhotoboothFromSupabase();

    closePbModal();

  } catch(e) {

    console.error('Lỗi lưu photobooth:', e);

    showToast(`⚠️ Lỗi: ${e.message}`, 'error');

  } finally {

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Lưu'; }

  }

}


async function confirmDeletePb(id) {

  const ev = AppState.photobooth.find(e => e.id === id);

  if (!ev || !confirm(`Xóa cột mốc "${ev.title}"?\nHành động không thể hoàn tác.`)) return;

  try {

    await SupabaseAdapter.deletePbMedia(ev.supabaseId);

    await SupabaseAdapter.deletePhotobooth(ev.supabaseId);

    await loadPhotoboothFromSupabase();

    showToast('✓ Đã xóa cột mốc', 'success');

  } catch(e) { showToast(`⚠️ Lỗi: ${e.message}`, 'error'); }

}


// ====================================================

// JOURNEY — LOAD & RENDER

// ====================================================

async function loadJourneyFromSupabase() {

  try {

    const rows = await SupabaseAdapter.getAllJourney();

    AppState.journey = rows.map(r => ({

      id: String(r.id),

      supabaseId: r.id,

      title: r.title || '',

      location: r.location || '',

      date: r.date ? String(r.date).substring(0, 10) : '',

      start_date: r.start_date ? String(r.start_date).substring(0, 10) : '',

      end_date: r.end_date ? String(r.end_date).substring(0, 10) : '',

      description: r.description || '',

      mediaType: r.media_type || 'image',

      mediaData: r.media_url || null,

      createdAt: r.created_at,

    }));

  } catch(e) {

    console.error('Lỗi tải journey:', e);

    AppState.journey = [];

  }

  renderJourneyPath();

}


function renderJourneyPath() {

  const container = document.getElementById('jnPathContainer');

  const empty     = document.getElementById('jnEmpty');

  if (!container) return;

  container.querySelectorAll('.jn-stop').forEach(el => el.remove());


  if (!AppState.journey.length) { empty.style.display = 'block'; return; }

  empty.style.display = 'none';


  AppState.journey.forEach((ev, i) => {

    const stop = createJourneyStop(ev, i);

    container.appendChild(stop);

    setTimeout(() => observeScrollReveal(stop), 0);

  });

}


function createJourneyStop(ev, index) {

  const stop = document.createElement('div');

  stop.className = 'jn-stop scroll-reveal';

  stop.dataset.id = ev.id;


  let mediaHtml = '';

  if (ev.mediaData) {

    if (ev.mediaType === 'video') {

      mediaHtml = `<video src="${ev.mediaData}" preload="none" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"></video>`;

    } else {

      mediaHtml = `<img src="${ev.mediaData}" alt="${escapeHtml(ev.title)}" loading="lazy" />`;

    }

  } else {

    mediaHtml = `<div class="jn-card-no-media">📍</div>`;

  }


  const locationTag = ev.location

    ? `<span class="jn-card-location-tag">${escapeHtml(ev.location)}</span>`

    : '';


  stop.innerHTML = `

    <div class="jn-card" onclick="openJnCatalog('${ev.id}')">

      <div class="jn-card-media">${mediaHtml}</div>

      <div class="jn-card-body">

        <div class="jn-card-meta">

          <span class="jn-card-date">${formatDateRange(ev.start_date || ev.date, ev.end_date)}</span>

          ${locationTag}

        </div>

        <h3 class="jn-card-title">${escapeHtml(ev.title)}</h3>

        <p class="jn-card-desc">${escapeHtml(ev.description || '')}</p>

      </div>

      <div class="jn-card-actions" onclick="event.stopPropagation()">

        <button class="jn-action-edit" onclick="openEditJnModal('${ev.id}')">✏️ Sửa</button>

        <button class="jn-action-delete" onclick="confirmDeleteJn('${ev.id}')">🗑 Xóa</button>

      </div>

    </div>

    <div class="jn-stop-pin"><div class="jn-stop-pin-inner">📍</div></div>

    <div class="jn-stop-spacer"></div>

  `;

  return stop;

}


// ====================================================

// JOURNEY — CATALOG LIGHTBOX

// ====================================================

async function openJnCatalog(id) {

  const ev = AppState.journey.find(e => e.id === id);

  if (!ev) return;


  AppState.jnCatItems = [];

  if (ev.mediaData) AppState.jnCatItems.push({ url: ev.mediaData, type: ev.mediaType });

  try {

    const extras = await SupabaseAdapter.getJnMedia(ev.supabaseId);

    extras.forEach(e => AppState.jnCatItems.push({ url: e.media_url, type: e.media_type }));

  } catch(e) {}

  AppState.jnCatIndex = 0;


  document.getElementById('jnCatalogTitle').textContent    = ev.title;

  document.getElementById('jnCatalogDate').textContent     = formatDateRange(ev.start_date || ev.date, ev.end_date);

  document.getElementById('jnCatalogLocation').textContent = ev.location || '';

  document.getElementById('jnCatalogDesc').textContent     = ev.description || '';


  ensureJnCatalogNav();

  renderJnCatalogSlide();

  updateJnCatalogNav();


  document.getElementById('jnCatalog').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function ensureJnCatalogNav() {

  if (document.getElementById('jnCatPrev')) return;

  const media = document.getElementById('jnCatalogMedia');

  if (!media) return;


  const prev = document.createElement('button');

  prev.id = 'jnCatPrev'; prev.className = 'jn-cat-prev'; prev.innerHTML = '&#10094;';

  prev.onclick = e => { e.stopPropagation(); jnCatalogSlideBy(-1); };


  const next = document.createElement('button');

  next.id = 'jnCatNext'; next.className = 'jn-cat-next'; next.innerHTML = '&#10095;';

  next.onclick = e => { e.stopPropagation(); jnCatalogSlideBy(1); };


  const counter = document.createElement('div');

  counter.id = 'jnCatCounter'; counter.className = 'jn-cat-counter';


  media.appendChild(prev);

  media.appendChild(next);

  media.appendChild(counter);

}


function renderJnCatalogSlide() {

  const item = AppState.jnCatItems[AppState.jnCatIndex];

  const container = document.getElementById('jnCatalogMedia');

  if (!container) return;


  container.querySelector('video')?.pause();

  const old = container.querySelector('img, video');

  if (old) old.remove();


  if (!item) {

    const ph = document.createElement('div');

    ph.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;opacity:0.2;';

    ph.textContent = '📍';

    container.insertBefore(ph, container.firstChild);

    return;

  }


  let el;

  if (item.type === 'video') {

    el = document.createElement('video');

    el.src = item.url; el.controls = true; el.autoplay = true;

    el.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;';

  } else {

    el = document.createElement('img');

    el.src = item.url;

    el.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;';

  }

  container.insertBefore(el, container.firstChild);

}


function jnCatalogSlideBy(dir) {

  const total = AppState.jnCatItems.length;

  if (total <= 1) return;

  AppState.jnCatIndex = (AppState.jnCatIndex + dir + total) % total;

  renderJnCatalogSlide();

  updateJnCatalogNav();

}


function updateJnCatalogNav() {

  const total = AppState.jnCatItems.length;

  const show  = total > 1;

  const prev = document.getElementById('jnCatPrev');

  const next = document.getElementById('jnCatNext');

  const counter = document.getElementById('jnCatCounter');

  if (prev) prev.style.display = show ? 'flex' : 'none';

  if (next) next.style.display = show ? 'flex' : 'none';

  if (counter) counter.textContent = show ? `${AppState.jnCatIndex + 1} / ${total}` : '';

}


function closeJnCatalog() {

  document.getElementById('jnCatalog').classList.remove('active');

  document.body.style.overflow = '';

  document.getElementById('jnCatalogMedia').querySelector('video')?.pause();

}


// ====================================================

// JOURNEY — MODAL & CRUD

// ====================================================

function openAddJourneyModal() {

  resetJnMediaState();

  AppState.jnEditingId = null;

  document.getElementById('jnModalTitle').textContent = '🗺️ Thêm Địa Điểm Mới';

  document.getElementById('jnEditId').value = '';

  document.getElementById('jnTitle').value = '';

  document.getElementById('jnLocation').value = '';

  const todayVN = getTodayVN();

  document.getElementById('jnDateStart').value = todayVN;

  document.getElementById('jnDateEnd').value = '';

  document.getElementById('jnDescription').value = '';

  document.getElementById('jnModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


async function openEditJnModal(id) {

  const ev = AppState.journey.find(e => e.id === id);

  if (!ev) return;

  resetJnMediaState();

  AppState.jnEditingId = id;

  document.getElementById('jnModalTitle').textContent = '🗺️ Chỉnh Sửa Địa Điểm';

  document.getElementById('jnEditId').value = id;

  document.getElementById('jnTitle').value = ev.title;

  document.getElementById('jnLocation').value = ev.location || '';

  document.getElementById('jnDateStart').value = isoToDisplay(ev.start_date || ev.date || '');

  document.getElementById('jnDateEnd').value = isoToDisplay(ev.end_date || '');

  document.getElementById('jnDescription').value = ev.description || '';


  const allMedia = [];

  if (ev.mediaData) allMedia.push({ id: null, media_url: ev.mediaData, media_type: ev.mediaType, position: -1, isMain: true });

  try {

    const extras = await SupabaseAdapter.getJnMedia(ev.supabaseId);

    extras.forEach(e => allMedia.push({ ...e, isMain: false }));

  } catch(e) {}

  AppState.jnExisting = allMedia;

  renderJnPreviewGrid();


  document.getElementById('jnModal').classList.add('active');

  document.getElementById('modalOverlay').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function closeJnModal() {

  document.getElementById('jnModal').classList.remove('active');

  document.getElementById('modalOverlay').classList.remove('active');

  document.body.style.overflow = '';

  resetJnMediaState();

}


function handleJnMediaSelect(input) {

  Array.from(input.files).forEach(file => {

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;

    AppState.jnPending.push({ file, blobUrl: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image' });

  });

  renderJnPreviewGrid();

  input.value = '';

}


function renderJnPreviewGrid() {

  const grid = document.getElementById('jnMediaPreviewGrid');

  const ph   = document.getElementById('jnMediaPlaceholder');

  if (!grid) return;

  const existHtml = AppState.jnExisting.map((item, i) => `

    <div class="mpg-item">

      ${item.media_type === 'video' ? `<video src="${item.media_url}" class="mpg-thumb"></video>` : `<img src="${item.media_url}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge">${item.media_type === 'video' ? '🎬' : '📷'}</div>

      <button class="mpg-del" onclick="removeJnExisting(${i})">✕</button>

    </div>`).join('');

  const newHtml = AppState.jnPending.map((item, i) => `

    <div class="mpg-item">

      ${item.type === 'video' ? `<video src="${item.blobUrl}" class="mpg-thumb"></video>` : `<img src="${item.blobUrl}" class="mpg-thumb" loading="lazy" />`}

      <div class="mpg-badge mpg-badge--new">${item.type === 'video' ? '🎬' : '📷'} mới</div>

      <button class="mpg-del" onclick="removeJnPending(${i})">✕</button>

    </div>`).join('');

  const total = AppState.jnExisting.length + AppState.jnPending.length;

  grid.innerHTML = existHtml + newHtml;

  grid.style.display = total ? 'grid' : 'none';

  if (ph) ph.style.display = total ? 'none' : 'flex';

}

function removeJnExisting(i) { AppState.jnExisting.splice(i, 1); renderJnPreviewGrid(); }

function removeJnPending(i)  { URL.revokeObjectURL(AppState.jnPending[i].blobUrl); AppState.jnPending.splice(i, 1); renderJnPreviewGrid(); }

function resetJnMediaState() {

  AppState.jnPending.forEach(f => URL.revokeObjectURL(f.blobUrl));

  AppState.jnPending = []; AppState.jnExisting = [];

  const grid = document.getElementById('jnMediaPreviewGrid');

  const ph   = document.getElementById('jnMediaPlaceholder');

  const inp  = document.getElementById('jnMediaInput');

  if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }

  if (ph)   ph.style.display = 'flex';

  if (inp)  inp.value = '';

}


async function saveJnMemory() {

  const title         = document.getElementById('jnTitle').value.trim();

  const location      = document.getElementById('jnLocation').value.trim();

  const dateStartDisp = document.getElementById('jnDateStart').value.trim();

  const dateEndDisp   = document.getElementById('jnDateEnd').value.trim();

  const description   = document.getElementById('jnDescription').value.trim();


  if (!title) { showToast('⚠️ Vui lòng nhập tên địa điểm!', 'error'); return; }

  if (!dateStartDisp || !isValidDisplayDate(dateStartDisp)) { showToast('⚠️ Ngày bắt đầu không hợp lệ! (dd/mm/yyyy)', 'error'); return; }

  const start_date = displayToIso(dateStartDisp);

  const end_date = dateEndDisp ? displayToIso(dateEndDisp) : '';


  const saveBtn = document.querySelector('.jn-modal-footer .btn-jn-primary');

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu...'; }


  try {

    const uploadedNew = [];

    for (let i = 0; i < AppState.jnPending.length; i++) {

      const f = AppState.jnPending[i];

      showToast(`⏳ Đang tải file ${i+1}/${AppState.jnPending.length}...`, '');

      if (f.type === 'video' && f.file.size > 100*1024*1024) { showToast(`⚠️ Video quá lớn (>100MB)`, 'error'); continue; }

      let fileToUpload = f.file;

      if (f.type === 'image' && f.file.size > 9*1024*1024) fileToUpload = await compressImage(f.file);

      try {

        const up = await CloudinaryAdapter.upload(fileToUpload);

        uploadedNew.push({ url: up.secure_url, type: f.type });

      } catch(e) { showToast(`⚠️ Lỗi upload: ${e.message}`, 'error'); }

    }


    const allMedia = [

      ...AppState.jnExisting.filter(e => e.isMain).map(e => ({ url: e.media_url, type: e.media_type })),

      ...uploadedNew,

    ];

    const first = allMedia[0] || { url: '', type: 'image' };


    if (AppState.jnEditingId) {

      const ev = AppState.journey.find(e => e.id === AppState.jnEditingId);

      await SupabaseAdapter.updateJourney(ev.supabaseId, { title, location, start_date, end_date, description, media_url: first.url, media_type: first.type });

      await SupabaseAdapter.deleteJnMedia(ev.supabaseId);

      if (allMedia.length > 1) await SupabaseAdapter.insertJnMedia(ev.supabaseId, allMedia.slice(1));

      showToast('✓ Đã cập nhật địa điểm!', 'success');

    } else {

      const row = await SupabaseAdapter.insertJourney({ title, location, start_date, end_date, description, media_url: first.url, media_type: first.type });

      if (allMedia.length > 1) await SupabaseAdapter.insertJnMedia(row.id, allMedia.slice(1));

      showToast('✓ Đã thêm địa điểm mới!', 'success');

    }


    await loadJourneyFromSupabase();

    closeJnModal();

  } catch(e) {

    console.error('Lỗi lưu journey:', e);

    showToast(`⚠️ Lỗi: ${e.message}`, 'error');

  } finally {

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Lưu'; }

  }

}


async function confirmDeleteJn(id) {

  const ev = AppState.journey.find(e => e.id === id);

  if (!ev || !confirm(`Xóa địa điểm "${ev.title}"?\nHành động không thể hoàn tác.`)) return;

  try {

    await SupabaseAdapter.deleteJnMedia(ev.supabaseId);

    await SupabaseAdapter.deleteJourney(ev.supabaseId);

    await loadJourneyFromSupabase();

    showToast('✓ Đã xóa địa điểm', 'success');

  } catch(e) { showToast(`⚠️ Lỗi: ${e.message}`, 'error'); }

}


// ====================================================

// DATE INPUT AUTO-FORMAT — PHOTOBOOTH & JOURNEY

// ====================================================

function initPbDateInput() {

  const input = document.getElementById('pbDate');

  if (!input) return;

  input.addEventListener('input', function() {

    let val = this.value.replace(/\D/g, '');

    if (val.length > 8) val = val.slice(0, 8);

    if (val.length <= 2)      this.value = val;

    else if (val.length <= 4) this.value = val.slice(0,2)+'/'+val.slice(2);

    else                      this.value = val.slice(0,2)+'/'+val.slice(2,4)+'/'+val.slice(4);

  });

  input.addEventListener('keydown', function(e) {

    if (e.key === 'Backspace' && this.value.endsWith('/')) { e.preventDefault(); this.value = this.value.slice(0,-1); }

  });

}


function initJnDateInput() {

  const input = document.getElementById('jnDate');

  if (!input) return;

  input.addEventListener('input', function() {

    let val = this.value.replace(/\D/g, '');

    if (val.length > 8) val = val.slice(0, 8);

    if (val.length <= 2)      this.value = val;

    else if (val.length <= 4) this.value = val.slice(0,2)+'/'+val.slice(2);

    else                      this.value = val.slice(0,2)+'/'+val.slice(2,4)+'/'+val.slice(4);

  });

  input.addEventListener('keydown', function(e) {

    if (e.key === 'Backspace' && this.value.endsWith('/')) { e.preventDefault(); this.value = this.value.slice(0,-1); }

  });

}


// ====================================================

// KEYBOARD — Escape cho catalog xuyên việt & photobooth

// ====================================================

document.addEventListener('keydown', function(e) {

  if (e.key === 'Escape' && document.getElementById('jnCatalog')?.classList.contains('active')) {

    closeJnCatalog();

  }

  if (e.key === 'Escape' && document.getElementById('pbCatalog')?.classList.contains('active')) {

    closePbCatalog();

  }

  if (e.key === 'ArrowLeft' && document.getElementById('jnCatalog')?.classList.contains('active')) {

    jnCatalogSlideBy(-1);

  }

  if (e.key === 'ArrowRight' && document.getElementById('jnCatalog')?.classList.contains('active')) {

    jnCatalogSlideBy(1);

  }

  if (e.key === 'ArrowLeft' && document.getElementById('pbCatalog')?.classList.contains('active')) {

    pbCatalogSlideBy(-1);

  }

  if (e.key === 'ArrowRight' && document.getElementById('pbCatalog')?.classList.contains('active')) {

    pbCatalogSlideBy(1);

  }

});


// ====================================================

// PHOTOBOOTH CATALOG LIGHTBOX

// ====================================================

async function openPbCatalog(id) {

  const ev = AppState.photobooth.find(e => e.id === id);

  if (!ev) return;


  AppState.pbCatItems = [];

  if (ev.mediaData) AppState.pbCatItems.push({ url: ev.mediaData, type: ev.mediaType });

  try {

    const extras = await SupabaseAdapter.getPbMedia(ev.supabaseId);

    extras.forEach(e => AppState.pbCatItems.push({ url: e.media_url, type: e.media_type }));

  } catch(e) {}

  AppState.pbCatIndex = 0;


  document.getElementById('pbCatalogTitle').textContent = ev.title;

  document.getElementById('pbCatalogDate').textContent  = formatDate(ev.date);

  document.getElementById('pbCatalogDesc').textContent  = ev.description || '';


  ensurePbCatalogNav();

  renderPbCatalogSlide();

  updatePbCatalogNav();


  document.getElementById('pbCatalog').classList.add('active');

  document.body.style.overflow = 'hidden';

}


function ensurePbCatalogNav() {

  if (document.getElementById('pbCatPrev')) return;

  const media = document.getElementById('pbCatalogMedia');

  if (!media) return;


  const prev = document.createElement('button');

  prev.id = 'pbCatPrev'; prev.className = 'jn-cat-prev'; prev.innerHTML = '&#10094;';

  prev.onclick = e => { e.stopPropagation(); pbCatalogSlideBy(-1); };


  const next = document.createElement('button');

  next.id = 'pbCatNext'; next.className = 'jn-cat-next'; next.innerHTML = '&#10095;';

  next.onclick = e => { e.stopPropagation(); pbCatalogSlideBy(1); };


  const counter = document.createElement('div');

  counter.id = 'pbCatCounter'; counter.className = 'jn-cat-counter';


  media.appendChild(prev);

  media.appendChild(next);

  media.appendChild(counter);

}


function renderPbCatalogSlide() {

  const item = AppState.pbCatItems[AppState.pbCatIndex];

  const container = document.getElementById('pbCatalogMedia');

  if (!container) return;


  container.querySelector('video')?.pause();

  const old = container.querySelector('img, video');

  if (old) old.remove();


  if (!item) {

    const ph = document.createElement('div');

    ph.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;opacity:0.2;';

    ph.textContent = '🎯';

    container.insertBefore(ph, container.firstChild);

    return;

  }


  let el;

  if (item.type === 'video') {

    el = document.createElement('video');

    el.src = item.url; el.controls = true; el.autoplay = true;

    el.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;';

  } else {

    el = document.createElement('img');

    el.src = item.url;

    el.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;';

  }

  container.insertBefore(el, container.firstChild);

}


function pbCatalogSlideBy(dir) {

  const total = AppState.pbCatItems.length;

  if (total <= 1) return;

  AppState.pbCatIndex = (AppState.pbCatIndex + dir + total) % total;

  renderPbCatalogSlide();

  updatePbCatalogNav();

}


function updatePbCatalogNav() {

  const total = AppState.pbCatItems.length;

  const show  = total > 1;

  const prev = document.getElementById('pbCatPrev');

  const next = document.getElementById('pbCatNext');

  const counter = document.getElementById('pbCatCounter');

  if (prev) prev.style.display = show ? 'flex' : 'none';

  if (next) next.style.display = show ? 'flex' : 'none';

  if (counter) counter.textContent = show ? `${AppState.pbCatIndex + 1} / ${total}` : '';

}


function closePbCatalog() {

  document.getElementById('pbCatalog').classList.remove('active');

  document.body.style.overflow = '';

  document.getElementById('pbCatalogMedia').querySelector('video')?.pause();

}
/* ====================================================
   CÁNH CỔNG KÝ ỨC - GATE SCREEN LOGIC
   ==================================================== */

(function () {
  // ---- Mật mã (thay đổi tại đây) ----
  const GATE_PASSWORD = "11072025"; // Mật mã để mở khóa cổng ký ức
  const STORAGE_KEY   = "memoryGateUnlocked";

  // ---- Khởi động ----
  function initGate() {
    const alreadyUnlocked = sessionStorage.getItem(STORAGE_KEY) === "true";

    if (alreadyUnlocked) {
      // Đã mở khóa trong session này -> ẩn gate, hiện nội dung
      hideGateInstant();
    } else {
      // Hiển thị gate, ẩn nội dung chính
      document.body.classList.add("gate-active");
      spawnParticles();
      spawnPetals();
    }
  }

  // ---- Ẩn gate ngay lập tức (session đã unlock) ----
  function hideGateInstant() {
    const gate = document.getElementById("memoryGate");
    if (gate) gate.classList.add("gate-hidden");
    document.body.classList.remove("gate-active");
    document.body.classList.add("gate-unlocked");
  }

  // ---- Tạo hạt sáng lấp lánh ----
  function spawnParticles() {
    const container = document.getElementById("gateParticles");
    if (!container) return;
    const count = 35;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "gate-particle";
      const size = Math.random() * 4 + 2;
      const left = Math.random() * 100;
      const delay = Math.random() * 12;
      const duration = 8 + Math.random() * 10;
      p.style.cssText = `
        width:${size}px; height:${size}px;
        left:${left}%;
        animation-delay:${delay}s;
        animation-duration:${duration}s;
      `;
      container.appendChild(p);
    }
  }

  // ---- Tạo cánh hoa đào rơi ----
  function spawnPetals() {
    const gate = document.getElementById("memoryGate");
    if (!gate) return;

    // Tạo container nếu chưa có
    let container = document.getElementById("gatePetals");
    if (!container) {
      container = document.createElement("div");
      container.id = "gatePetals";
      container.className = "gate-petals";
      gate.appendChild(container);
    }

    // Màu cánh hoa đào — mix hồng nhạt và trắng hồng
    const colors = [
      "#F9D0DA", "#F5B8C8", "#FBDEE6", "#F2C4CE",
      "#FFE4EC", "#EDB8C8", "#FDF0F4", "#E8A0B0",
    ];

    const count = 20;
    for (let i = 0; i < count; i++) {
      const petal = document.createElement("div");
      petal.className = "gate-petal";

      // Kích thước ngẫu nhiên
      const w = 8 + Math.random() * 10;
      const h = w * (0.55 + Math.random() * 0.25); // hình bầu dục
      const color = colors[Math.floor(Math.random() * colors.length)];
      const color2 = colors[Math.floor(Math.random() * colors.length)];
      const rotate = Math.random() * 360;

      // SVG cánh hoa đào hình oval
      petal.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 20 12" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="pg${i}" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stop-color="${color2}" stop-opacity="0.95"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.7"/>
          </radialGradient>
        </defs>
        <ellipse cx="10" cy="6" rx="9.5" ry="5.5" fill="url(#pg${i})" transform="rotate(${rotate},10,6)"/>
        <ellipse cx="10" cy="6" rx="9.5" ry="5.5" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.4" transform="rotate(${rotate},10,6)"/>
      </svg>`;

      // Vị trí và animation ngẫu nhiên
      const left   = Math.random() * 100;
      const delay  = Math.random() * 12;
      const dur    = 6 + Math.random() * 7;
      const drift  = (Math.random() - 0.5) * 160;
      const spin   = (Math.random() > 0.5 ? 1 : -1) * (300 + Math.random() * 200);

      petal.style.cssText = `
        left: ${left}%;
        animation-duration: ${dur}s;
        animation-delay: ${delay}s;
        --drift: ${drift}px;
        --spin: ${spin}deg;
      `;

      container.appendChild(petal);
    }
  }

  // ---- Hiện/ẩn mật mã ----
  window.toggleGatePassword = function () {
    const inp  = document.getElementById("gatePasswordInput");
    const icon = document.getElementById("eyeIcon");
    if (!inp) return;
    if (inp.type === "password") {
      inp.type = "text";
      inp.style.webkitTextSecurity = "none";
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      inp.type = "password";
      inp.style.webkitTextSecurity = "disc";
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  };

  // ---- Hiển thị lỗi ----
  function showGateError(msg) {
    const el = document.getElementById("gateError");
    if (!el) return;
    el.textContent = msg;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "errorShake 0.4s ease";
    setTimeout(() => { el.textContent = ""; }, 4000);
  }

  // ---- Mở khóa ----
  window.unlockGate = function () {
    const inp = document.getElementById("gatePasswordInput");
    if (!inp) return;
    const val = inp.value.trim();

    if (!val) {
      showGateError("Nhập mật khẩu mới được mở");
      inp.focus();
      return;
    }

    if (val !== GATE_PASSWORD) {
      inp.value = "";
      inp.focus();
      showGateError("Rất tiếc bạn không thể vào đây :(");
      return;
    }

    // Đúng mật mã -> mở cửa
    performOpenAnimation();
  };

  // ---- Hiệu ứng mở cửa ----
  function performOpenAnimation() {
    const gate    = document.getElementById("memoryGate");
    const overlay = document.getElementById("gateOpenOverlay");
    const btn     = document.getElementById("gateBtn");

    // Khóa nút
    if (btn) { btn.disabled = true; btn.querySelector(".gate-btn-text").textContent = "Đang mở..."; }

    // Phase 1: cánh cửa mở
    if (gate) gate.classList.add("opening");

    // Phase 2: ánh sáng bùng ra (sau 0.5s)
    setTimeout(() => {
      if (overlay) overlay.classList.add("flash-in");
    }, 500);

    // Phase 3: ẩn gate, hiện nội dung (sau 1.6s)
    setTimeout(() => {
      sessionStorage.setItem(STORAGE_KEY, "true");
      if (gate) gate.classList.add("gate-hidden");
      document.body.classList.remove("gate-active");
      document.body.classList.add("gate-unlocked");
      // Xóa overlay sau khi xong
      if (overlay) overlay.classList.remove("flash-in");
    }, 1800);
  }

  // ---- Khóa lại ----
  window.lockGate = function () {
    sessionStorage.removeItem(STORAGE_KEY);
    const gate = document.getElementById("memoryGate");
    if (gate) {
      gate.classList.remove("gate-hidden", "opening");
      const inp = document.getElementById("gatePasswordInput");
      if (inp) inp.value = "";
      const err = document.getElementById("gateError");
      if (err) err.textContent = "";
      const btn = document.getElementById("gateBtn");
      if (btn) { btn.disabled = false; btn.querySelector(".gate-btn-text").textContent = "Mở Cánh Cửa"; }
    }
    document.body.classList.add("gate-active");
    document.body.classList.remove("gate-unlocked");
    // Reset mobile: về lại hero
    document.body.classList.remove("mobile-nav-revealed");
  };

  // ---- Khởi động khi DOM sẵn sàng ----
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGate);
  } else {
    initGate();
  }
})();

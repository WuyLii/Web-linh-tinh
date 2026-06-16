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
    return { secure_url: data.secure_url, resource_type: type };
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?select=*&order=created_at.desc`, { headers: this._h() });
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
    const records = items.map((it, i) => ({ memory_id: memoryId, media_url: it.url, media_type: it.type, position: i }));
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
    AppState.memories = rows.map(r => ({
      id: String(r.id),
      supabaseId: r.id,
      title: r.title || '',
      date: r.date || (r.created_at ? r.created_at.substring(0, 10) : ''),
      description: r.description || '',
      mediaType: r.media_type || 'image',
      mediaData: r.media_url || null,
      createdAt: r.created_at,
    }));
  } catch(e) {
    console.error('Lỗi tải kỷ niệm:', e);
    showToast('⚠️ Không thể tải dữ liệu!', 'error');
    AppState.memories = [];
  }
  renderTimeline();
  renderAdminMemoryList();
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
  if (src.includes('nen(test).mp4') || src.includes('background.mp4')) {
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
const LOVE_START_DATE = new Date('2025-07-11T00:00:00+07:00');

// Trả về thời điểm hiện tại tính theo múi giờ Việt Nam (UTC+7)
function nowVN() {
  const now = new Date();
  // Offset của VN so với UTC là +7 giờ (luôn cố định, không đổi giờ mùa hè)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 3600000);
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
    <div class="timeline-spacer"></div>
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
  if (!dateDisplay) { showToast('⚠️ Vui lòng nhập ngày (dd/mm/yyyy)!', 'error'); return; }
  if (!isValidDisplayDate(dateDisplay)) { showToast('⚠️ Ngày không đúng định dạng dd/mm/yyyy!', 'error'); document.getElementById('memoryDate').focus(); return; }
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
        uploadedNew.push({ url: up.secure_url, type: f.type });
      } catch(uploadErr) {
        showToast(`⚠️ Lỗi upload "${f.file.name}": ${uploadErr.message}`, 'error');
      }
    }

    // 2. Ảnh đầu tiên làm thumbnail (ảnh chính trong bảng memories)
    const allMediaUrls = [
      ...AppState.existingMedia.filter(e => e.isMain).map(e => ({ url: e.media_url, type: e.media_type })),
      ...uploadedNew,
    ];
    const firstMedia = allMediaUrls[0] || { url: '', type: 'image' };

    if (AppState.editingId && AppState.editingSupabaseId) {
      // ── UPDATE ──
      await SupabaseAdapter.updateMemory(AppState.editingSupabaseId, {
        title, date, description,
        media_url: firstMedia.url,
        media_type: firstMedia.type,
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
    await SupabaseAdapter.deleteMedia(memory.supabaseId);
    await SupabaseAdapter.deleteMemory(memory.supabaseId);
    await loadMemoriesFromSupabase();
    showToast('✓ Đã xóa kỷ niệm', 'success');
  } catch(e) { showToast(`⚠️ Lỗi: ${e.message}`, 'error'); }
}

// ====================================================
// HELPER FUNCTIONS
// ====================================================
function formatDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d + 'T00:00:00+07:00');
    const day   = String(dt.getUTCDate()).padStart(2, '0');
    const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const year  = dt.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch(e) { return d; }
}

// Chuyển yyyy-mm-dd → dd/mm/yyyy (để hiển thị trong input)
function isoToDisplay(iso) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Chuyển dd/mm/yyyy → yyyy-mm-dd (để lưu vào Supabase)
function displayToIso(display) {
  if (!display) return '';
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return display;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Kiểm tra định dạng dd/mm/yyyy có hợp lệ không
function isValidDisplayDate(val) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(val);
}

// Trả về ngày hôm nay theo giờ VN, định dạng dd/mm/yyyy
function getTodayVN() {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  return isoToDisplay(iso);
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
  observeStaticElements();

  document.getElementById('openAdminBtn')?.addEventListener('click', openAdminPanel);
  document.getElementById('openAddMemoryBtn')?.addEventListener('click', openAddMemoryModal);
  initDateInput();

  console.log(`💕 Sẵn sàng! Đã tải ${AppState.memories.length} kỷ niệm.`);
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();

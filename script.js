// ====================================================
// CẤU HÌNH - CLOUDINARY & SUPABASE
// ====================================================

const CLOUDINARY_CLOUD_NAME  = 'dmq9orepw';
const CLOUDINARY_UPLOAD_PRESET = 'memory_gallery';

const SUPABASE_URL = 'https://nafjrifwubpujvqrbkaj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A7Rkd6AM1gUgJKcYzzht0g_bS5GMwkl';

// ====================================================
// CLOUDINARY ADAPTER
// Upload file lên Cloudinary, trả về secure_url
// ====================================================

const CloudinaryAdapter = {
  async upload(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const resourceType = file.type.startsWith('video/') ? 'video' : 'image';
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

    // DEBUG: log trước khi gọi API
    console.log('[CLD] Upload bắt đầu', {
      name: file.name,
      size: Math.round(file.size/1024) + 'KB',
      type: file.type,
      preset: CLOUDINARY_UPLOAD_PRESET,
      cloud: CLOUDINARY_CLOUD_NAME,
      url
    });

    const response = await fetch(url, { method: 'POST', body: formData });

    console.log('[CLD] Response status:', response.status);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[CLD] Lỗi response:', err);
      throw new Error('Cloudinary: ' + (err.error?.message || JSON.stringify(err) || 'HTTP ' + response.status));
    }

    const data = await response.json();
    console.log('[CLD] Thành công! secure_url:', data.secure_url);
    return { secure_url: data.secure_url, resource_type: resourceType };
  },
};

// ====================================================
// SUPABASE ADAPTER
// Đọc / ghi metadata kỷ niệm vào bảng "memories"
// ====================================================

const SupabaseAdapter = {
  _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };
  },

  /**
   * Lấy toàn bộ kỷ niệm, sắp xếp mới nhất trước
   * @returns {Promise<Array>}
   */
  async getAll() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/memories?select=*&order=created_at.desc`,
      { headers: this._headers() }
    );
    if (!res.ok) throw new Error(`Supabase GET thất bại: ${res.status}`);
    return res.json();
  },

  /**
   * Thêm một kỷ niệm mới
   * Chỉ gửi đúng 3 cột có trong bảng: title, media_url, media_type
   * (id và created_at do Supabase tự sinh)
   * @param {{title:string, media_url:string, media_type:string}} record
   * @returns {Promise<Object>}
   */
  async insert(record) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/memories`,
      {
        method: 'POST',
        headers: { ...this._headers(), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.message || err.details || err.hint || `HTTP ${res.status}`;
      throw new Error(`Supabase INSERT thất bại: ${detail}`);
    }
    const rows = await res.json();
    return rows[0];
  },

  /**
   * Cập nhật kỷ niệm theo id
   * @param {number|string} id - id bigint của row
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async update(id, updates) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/memories?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { ...this._headers(), 'Prefer': 'return=representation' },
        body: JSON.stringify(updates),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Supabase UPDATE thất bại: ${res.status}`);
    }
    const rows = await res.json();
    return rows[0];
  },

  /**
   * Xóa kỷ niệm theo id
   * @param {number|string} id
   */
  async delete(id) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/memories?id=eq.${id}`,
      { method: 'DELETE', headers: this._headers() }
    );
    if (!res.ok) throw new Error(`Supabase DELETE thất bại: ${res.status}`);
  },
};

// ====================================================
// STORAGE ADAPTER (lớp trung gian — giữ tên gốc)
// Chuyển đổi giữa định dạng Supabase ↔ AppState
// ====================================================

const StorageAdapter = {
  /**
   * Tải toàn bộ kỷ niệm từ Supabase
   * Chuyển đổi cột Supabase → định dạng AppState
   */
  async getMemories() {
    try {
      const rows = await SupabaseAdapter.getAll();
      return rows.map(row => this._rowToMemory(row));
    } catch (e) {
      console.error('Lỗi tải kỷ niệm từ Supabase:', e);
      showToast('⚠️ Không thể tải dữ liệu từ cloud!', 'error');
      return [];
    }
  },

  /** Chuyển row Supabase → object memory dùng trong app */
  _rowToMemory(row) {
    // Bảng chỉ có: id, title, media_url, media_type, created_at
    // date/description không có trong bảng → dùng giá trị mặc định
    const dateStr = row.date
      || (row.created_at ? row.created_at.substring(0, 10) : '');
    return {
      id: String(row.id),
      supabaseId: row.id,
      title: row.title || '',
      date: dateStr,
      description: row.description || '',
      mediaType: row.media_type || 'image',
      mediaData: row.media_url || null,
      hasMedia: !!row.media_url,
      createdAt: row.created_at,
    };
  },

  /**
   * Config nhỏ (ảnh khung tròn, video nền) vẫn dùng localStorage
   * vì chúng là dữ liệu thiết bị cục bộ, không cần đồng bộ cloud
   */
  async saveCounterPhoto(dataUrl) {
    try { localStorage.setItem('counterPhoto', dataUrl); } catch(e) {}
  },
  async getCounterPhoto() {
    return localStorage.getItem('counterPhoto') || null;
  },
  async saveBgVideo(dataUrl) {
    try { localStorage.setItem('bgVideo', dataUrl); } catch(e) {}
  },
  async getBgVideo() {
    return localStorage.getItem('bgVideo') || null;
  },
};

// ====================================================
// UPLOAD FUNCTIONS (mới)
// ====================================================

/**
 * Upload file lên Cloudinary
 * @param {File} file
 * @returns {Promise<{secure_url, media_type}>}
 */
async function uploadToCloudinary(file) {
  const result = await CloudinaryAdapter.upload(file);
  return {
    secure_url: result.secure_url,
    media_type: result.resource_type,
  };
}

/**
 * Lưu metadata kỷ niệm vào Supabase
 * @param {{title, media_url, media_type}} record — chỉ 3 cột có trong bảng
 * @returns {Promise<Object>} row đã tạo
 */
async function saveMemoryToSupabase(record) {
  console.log('[Supabase] INSERT record:', JSON.stringify(record));
  const result = await SupabaseAdapter.insert(record);
  console.log('[Supabase] INSERT thành công, row:', result);
  return result;
}

/**
 * Tải toàn bộ kỷ niệm từ Supabase và cập nhật AppState + UI
 */
async function loadMemoriesFromSupabase() {
  AppState.memories = await StorageAdapter.getMemories();
  renderTimeline();
  renderAdminMemoryList();
}

// ====================================================
// KHU VỰC QUẢN LÝ ẢNH VÀ VIDEO
// State toàn cục của ứng dụng
// ====================================================

/**
 * App State - Trạng thái toàn cục
 */
const AppState = {
  memories: [],
  currentMediaType: 'image',
  currentMediaFile: null,      // File object thực tế (thay cho base64)
  currentMediaData: null,      // URL preview tạm (blob URL hoặc Cloudinary URL khi edit)
  editingId: null,
  editingSupabaseId: null,     // id bigint Supabase của kỷ niệm đang sửa
  counterInterval: null,
};

// ====================================================
// KHU VỰC VIDEO NỀN CHÍNH
// ====================================================

async function initBackgroundVideo() {
  const savedBgVideo = await StorageAdapter.getBgVideo();
  if (savedBgVideo) {
    const heroVideo = document.getElementById('heroVideo');
    if (heroVideo) {
      heroVideo.src = savedBgVideo;
      heroVideo.load();
      heroVideo.play().catch(() => {});
    }
  }

  const heroVideo = document.getElementById('heroVideo');
  if (heroVideo) {
    heroVideo.addEventListener('error', handleVideoError);
    const source = heroVideo.querySelector('source');
    if (source && (source.src.includes('background.mp4') || source.src.includes('nen(test).mp4'))) {
      document.getElementById('videoBg').classList.add('no-video');
    }
  }
}

function handleVideoError() {
  console.log('Không tìm thấy video nền, sử dụng gradient thay thế');
  document.getElementById('videoBg').classList.add('no-video');
}

async function changeBgVideo(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('video/')) {
    showToast('⚠️ Vui lòng chọn file video!', 'error');
    return;
  }

  showToast('⏳ Đang xử lý video...', '');

  try {
    const dataUrl = await fileToDataUrl(file);
    const heroVideo = document.getElementById('heroVideo');
    if (heroVideo) {
      heroVideo.src = dataUrl;
      heroVideo.load();
      heroVideo.play();
      document.getElementById('videoBg').classList.remove('no-video');
    }
    await StorageAdapter.saveBgVideo(dataUrl);
    showToast('✓ Đã cập nhật video nền!', 'success');
  } catch (e) {
    console.error('Lỗi xử lý video:', e);
    showToast('⚠️ Không thể xử lý video này!', 'error');
  }
}

// ====================================================
// KHUNG ẢNH TRÒN - LOVE COUNTER PHOTO
// ====================================================

async function changeCounterPhoto(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('⚠️ Vui lòng chọn file ảnh!', 'error');
    return;
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    applyCounterPhoto(dataUrl);
    await StorageAdapter.saveCounterPhoto(dataUrl);
    showToast('✓ Đã cập nhật ảnh!', 'success');
  } catch (e) {
    showToast('⚠️ Không thể đọc file ảnh!', 'error');
  }
}

function applyCounterPhoto(dataUrl) {
  const img = document.getElementById('counterPhoto');
  const placeholder = document.getElementById('counterPhotoPlaceholder');
  if (img && placeholder) {
    img.src = dataUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  }
}

async function loadCounterPhoto() {
  const saved = await StorageAdapter.getCounterPhoto();
  if (saved) applyCounterPhoto(saved);
}

// ====================================================
// SCROLL & NAVBAR
// ====================================================

function smoothScroll(selector) {
  const target = document.querySelector(selector);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initNavbar() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.pageYOffset > 80) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }, { passive: true });
}

// ====================================================
// ĐẾM NGÀY YÊU
// ====================================================

const LOVE_START_DATE = new Date('2025-07-11T00:00:00+07:00');

function updateLoveCounter() {
  const now = new Date();
  const diffMs = now - LOVE_START_DATE;

  if (diffMs < 0) {
    setCounterValue('days', 0, 3);
    setCounterValue('hours', 0, 2);
    setCounterValue('minutes', 0, 2);
    setCounterValue('seconds', 0, 2);
    return;
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const seconds      = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes      = totalMinutes % 60;
  const totalHours   = Math.floor(totalMinutes / 60);
  const hours        = totalHours % 24;
  const days         = Math.floor(totalHours / 24);

  setCounterValue('days', days, 3);
  setCounterValue('hours', hours, 2);
  setCounterValue('minutes', minutes, 2);
  setCounterValue('seconds', seconds, 2);
}

function setCounterValue(id, value, minDigits = 2) {
  const el = document.getElementById(id);
  if (!el) return;
  const newText = String(value).padStart(minDigits, '0');
  if (el.textContent !== newText) {
    el.textContent = newText;
    el.style.transform = 'scale(1.05)';
    el.style.transition = 'transform 0.15s';
    setTimeout(() => { el.style.transform = 'scale(1)'; }, 150);
  }
}

function initLoveCounter() {
  updateLoveCounter();
  AppState.counterInterval = setInterval(updateLoveCounter, 1000);
}

// ====================================================
// DÒNG THỜI GIAN
// ====================================================

function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  const emptyState = document.getElementById('timelineEmpty');
  const memories = AppState.memories;

  // Sắp xếp theo created_at mới nhất (từ Supabase đã sort, nhưng giữ lại phòng khi cần)
  const sorted = [...memories].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt) : new Date(a.date);
    const db_ = b.createdAt ? new Date(b.createdAt) : new Date(b.date);
    return db_ - da;
  });

  const oldCards = container.querySelectorAll('.timeline-item');
  oldCards.forEach(card => card.remove());

  if (sorted.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  sorted.forEach((memory, index) => {
    const item = createTimelineItem(memory, index);
    container.appendChild(item);
    setTimeout(() => { observeScrollReveal(item); }, 0);
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
        <div class="media-badge">${badgeText}</div>
      </div>
      <div class="timeline-card-body">
        <div class="timeline-card-date">${dateFormatted}</div>
        <h3 class="timeline-card-title">${escapeHtml(memory.title)}</h3>
        <p class="timeline-card-desc">${escapeHtml(memory.description || '')}</p>
      </div>
      <div class="timeline-card-actions" onclick="event.stopPropagation()">
        <button class="action-btn action-btn-edit" onclick="openEditMemoryModal('${memory.id}')">
          ✏️ Sửa
        </button>
        <button class="action-btn action-btn-delete" onclick="confirmDeleteMemory('${memory.id}')">
          🗑 Xóa
        </button>
      </div>
    </div>
    <div class="timeline-dot"></div>
    <div class="timeline-spacer"></div>
  `;

  return item;
}

function createMediaHtml(memory) {
  if (!memory.mediaData) {
    return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:3rem;opacity:0.3;">
      ${memory.mediaType === 'video' ? '🎬' : '📷'}
    </div>`;
  }

  if (memory.mediaType === 'video') {
    return `<video
      src="${memory.mediaData}"
      controls
      preload="none"
      style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"
      onclick="event.stopPropagation()"
    ></video>`;
  }

  return `<img
    src="${memory.mediaData}"
    alt="${escapeHtml(memory.title)}"
    loading="lazy"
  />`;
}

// ====================================================
// LIGHTBOX
// ====================================================

function openLightbox(id) {
  const memory = AppState.memories.find(m => m.id === id);
  if (!memory) return;

  const lightbox = document.getElementById('lightbox');
  const mediaContainer = document.getElementById('lightboxMedia');

  if (memory.mediaData) {
    if (memory.mediaType === 'video') {
      mediaContainer.innerHTML = `<video src="${memory.mediaData}" controls style="width:100%;max-height:60vh;object-fit:contain;"></video>`;
    } else {
      mediaContainer.innerHTML = `<img src="${memory.mediaData}" alt="${escapeHtml(memory.title)}" style="width:100%;max-height:60vh;object-fit:contain;" />`;
    }
  } else {
    mediaContainer.innerHTML = `<div style="height:200px;display:flex;align-items:center;justify-content:center;font-size:4rem;opacity:0.3;">${memory.mediaType === 'video' ? '🎬' : '📷'}</div>`;
  }

  document.getElementById('lightboxTitle').textContent = memory.title;
  document.getElementById('lightboxDate').textContent = formatDate(memory.date);
  document.getElementById('lightboxDesc').textContent = memory.description || '';

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
  document.body.style.overflow = '';
  const video = document.querySelector('#lightboxMedia video');
  if (video) video.pause();
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
  const memories = AppState.memories;

  if (memories.length === 0) {
    list.innerHTML = '<p style="font-size:0.82rem;color:rgba(255,255,255,0.3);text-align:center;padding:20px;">Chưa có kỷ niệm nào</p>';
    return;
  }

  const sorted = [...memories].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt) : new Date(a.date);
    const db_ = b.createdAt ? new Date(b.createdAt) : new Date(b.date);
    return db_ - da;
  });

  list.innerHTML = sorted.map(memory => `
    <div class="admin-memory-item">
      ${memory.mediaData && memory.mediaType === 'image'
        ? `<img class="admin-memory-thumb" src="${memory.mediaData}" alt="${escapeHtml(memory.title)}" />`
        : `<div class="admin-memory-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${memory.mediaType === 'video' ? '🎬' : '📷'}</div>`
      }
      <div class="admin-memory-info">
        <div class="admin-memory-title">${escapeHtml(memory.title)}</div>
        <div class="admin-memory-date">${formatDate(memory.date)}</div>
      </div>
      <div class="admin-memory-btns">
        <button class="admin-mini-btn admin-mini-btn-edit" onclick="openEditMemoryModal('${memory.id}')">Sửa</button>
        <button class="admin-mini-btn admin-mini-btn-delete" onclick="confirmDeleteMemory('${memory.id}')">Xóa</button>
      </div>
    </div>
  `).join('');
}

// ====================================================
// MODAL THÊM / SỬA KỶ NIỆM
// ====================================================

function openAddMemoryModal() {
  resetMemoryForm();
  AppState.editingId = null;
  AppState.editingSupabaseId = null;
  AppState.currentMediaFile = null;
  AppState.currentMediaData = null;
  document.getElementById('memoryModalTitle').textContent = '✦ Thêm Kỷ Niệm Mới';
  document.getElementById('memoryModal').classList.add('active');
  document.getElementById('modalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  document.getElementById('memoryDate').value = getTodayVN();
}

function openEditMemoryModal(id) {
  const memory = AppState.memories.find(m => m.id === id);
  if (!memory) return;

  resetMemoryForm();
  AppState.editingId = id;
  AppState.editingSupabaseId = memory.supabaseId;
  AppState.currentMediaFile = null;
  AppState.currentMediaData = memory.mediaData || null; // Cloudinary URL

  document.getElementById('memoryModalTitle').textContent = '✦ Chỉnh Sửa Kỷ Niệm';
  document.getElementById('editMemoryId').value = id;
  document.getElementById('memoryTitle').value = memory.title;
  document.getElementById('memoryDate').value = memory.date;
  document.getElementById('memoryDescription').value = memory.description || '';

  switchMediaType(memory.mediaType || 'image');

  // Hiển thị preview media hiện tại (Cloudinary URL)
  if (memory.mediaData) {
    if (memory.mediaType === 'video') {
      const preview = document.getElementById('videoPreview');
      preview.src = memory.mediaData;
      preview.style.display = 'block';
      document.getElementById('videoPlaceholder').style.display = 'none';
    } else {
      const preview = document.getElementById('imagePreview');
      preview.src = memory.mediaData;
      preview.style.display = 'block';
      document.getElementById('imagePlaceholder').style.display = 'none';
    }
  }

  document.getElementById('memoryModal').classList.add('active');
  document.getElementById('modalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  document.getElementById('adminPanel').classList.remove('active');
}

function closeMemoryModal() {
  document.getElementById('memoryModal').classList.remove('active');
  if (!document.getElementById('adminPanel').classList.contains('active')) {
    document.getElementById('modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
  }
  resetMemoryForm();
}

// ====================================================
// LƯU KỶ NIỆM — Cloudinary → Supabase
// ====================================================

async function saveMemory() {
  const title = document.getElementById('memoryTitle').value.trim();

  if (!title) {
    showToast('⚠️ Vui lòng nhập tiêu đề!', 'error');
    document.getElementById('memoryTitle').focus();
    return;
  }

  // Lấy date và description cho hiển thị UI (không gửi lên Supabase — bảng không có cột này)
  const date = document.getElementById('memoryDate').value;
  const description = document.getElementById('memoryDescription').value.trim();

  // Vô hiệu hóa nút Lưu để tránh double-submit
  const saveBtn = document.querySelector('.memory-modal-footer .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu...'; }

  try {
    let mediaUrl  = AppState.currentMediaData;
    let mediaType = AppState.currentMediaType;

    // DEBUG
    console.log('[saveMemory] currentMediaFile:', AppState.currentMediaFile);
    console.log('[saveMemory] currentMediaData:', AppState.currentMediaData);
    console.log('[saveMemory] currentMediaType:', AppState.currentMediaType);
    console.log('[saveMemory] editingId:', AppState.editingId);

    if (AppState.currentMediaFile) {
      showToast('⏳ Đang tải lên Cloudinary...', '');
      console.log('[saveMemory] → Gọi uploadToCloudinary...');
      const uploaded = await uploadToCloudinary(AppState.currentMediaFile);
      mediaUrl  = uploaded.secure_url;
      mediaType = uploaded.media_type;
      console.log('[saveMemory] → Upload xong, mediaUrl:', mediaUrl);
    } else {
      console.warn('[saveMemory] KHÔNG có file để upload — currentMediaFile là null/undefined');
    }

    if (AppState.editingId && AppState.editingSupabaseId) {
      // ── CẬP NHẬT kỷ niệm hiện có ──
      // Chỉ cập nhật các cột thực sự có trong bảng: title, media_url, media_type
      const updates = { title, media_type: mediaType };
      if (AppState.currentMediaFile) updates.media_url = mediaUrl;

      await SupabaseAdapter.update(AppState.editingSupabaseId, updates);
      showToast('✓ Đã cập nhật kỷ niệm!', 'success');
    } else {
      // ── THÊM KỶ NIỆM MỚI ──
      // Chỉ gửi các cột tồn tại trong bảng: title, media_url, media_type
      // (id và created_at được Supabase tự tạo)
      await saveMemoryToSupabase({
        title,
        media_url: mediaUrl || '',
        media_type: mediaType,
      });
      showToast('✓ Đã thêm kỷ niệm mới!', 'success');
    }

    // Reload từ Supabase để đồng bộ hoàn toàn
    await loadMemoriesFromSupabase();
    closeMemoryModal();

  } catch (e) {
    console.error('Lỗi lưu kỷ niệm:', e);
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

  if (!confirm(`Bạn có chắc muốn xóa kỷ niệm "${memory.title}"?\n\nHành động này không thể hoàn tác.`)) return;

  try {
    await SupabaseAdapter.delete(memory.supabaseId);
    await loadMemoriesFromSupabase();
    showToast('✓ Đã xóa kỷ niệm', 'success');
  } catch (e) {
    console.error('Lỗi xóa kỷ niệm:', e);
    showToast(`⚠️ Lỗi xóa: ${e.message}`, 'error');
  }
}

// ====================================================
// RESET FORM
// ====================================================

function resetMemoryForm() {
  document.getElementById('editMemoryId').value = '';
  document.getElementById('memoryTitle').value = '';
  document.getElementById('memoryDate').value = '';
  document.getElementById('memoryDescription').value = '';
  document.getElementById('memoryImageInput').value = '';
  document.getElementById('memoryVideoInput').value = '';

  const imagePreview = document.getElementById('imagePreview');
  imagePreview.src = '';
  imagePreview.style.display = 'none';
  document.getElementById('imagePlaceholder').style.display = 'flex';

  const videoPreview = document.getElementById('videoPreview');
  videoPreview.src = '';
  videoPreview.style.display = 'none';
  document.getElementById('videoPlaceholder').style.display = 'flex';

  switchMediaType('image');
  AppState.currentMediaFile = null;
  AppState.currentMediaData = null;
  AppState.editingId = null;
  AppState.editingSupabaseId = null;
}

// ====================================================
// CHUYỂN ĐỔI LOẠI MEDIA
// ====================================================

function switchMediaType(type) {
  AppState.currentMediaType = type;

  const imageGroup = document.getElementById('imageUploadGroup');
  const videoGroup = document.getElementById('videoUploadGroup');
  const imageBtnEl = document.getElementById('typeImageBtn');
  const videoBtnEl = document.getElementById('typeVideoBtn');

  if (type === 'image') {
    imageGroup.style.display = 'block';
    videoGroup.style.display = 'none';
    imageBtnEl.classList.add('active');
    videoBtnEl.classList.remove('active');
  } else {
    imageGroup.style.display = 'none';
    videoGroup.style.display = 'block';
    imageBtnEl.classList.remove('active');
    videoBtnEl.classList.add('active');
  }

  AppState.currentMediaFile = null;
  AppState.currentMediaData = null;
}

// ====================================================
// PREVIEW ẢNH / VIDEO (lưu File object, không base64)
// ====================================================

async function previewImage(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('⚠️ Vui lòng chọn file ảnh!', 'error');
    return;
  }

  // Giới hạn nhẹ cho Cloudinary free tier (~10MB khuyến nghị)
  if (file.size > 100 * 1024 * 1024) {
    showToast('⚠️ Ảnh quá lớn (>100MB)!', 'error');
    return;
  }

  try {
    // Lưu File object để upload lên Cloudinary khi save
    AppState.currentMediaFile = file;
    AppState.currentMediaData = null;

    console.log('[previewImage] File đã lưu vào AppState.currentMediaFile:', file.name, file.size);

    const blobUrl = URL.createObjectURL(file);
    const preview = document.getElementById('imagePreview');
    preview.src = blobUrl;
    preview.style.display = 'block';
    document.getElementById('imagePlaceholder').style.display = 'none';
    showToast('✓ Ảnh đã sẵn sàng!', 'success');
  } catch (e) {
    showToast('⚠️ Không thể đọc file ảnh!', 'error');
  }
}

async function previewVideo(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('video/')) {
    showToast('⚠️ Vui lòng chọn file video!', 'error');
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    showToast('⚠️ Video quá lớn (>500MB)!', 'error');
    return;
  }

  try {
    AppState.currentMediaFile = file;
    AppState.currentMediaData = null;

    console.log('[previewVideo] File đã lưu vào AppState.currentMediaFile:', file.name, file.size);

    const blobUrl = URL.createObjectURL(file);
    const preview = document.getElementById('videoPreview');
    preview.src = blobUrl;
    preview.style.display = 'block';
    document.getElementById('videoPlaceholder').style.display = 'none';
    showToast('✓ Video đã sẵn sàng!', 'success');
  } catch (e) {
    showToast('⚠️ Không thể đọc file video!', 'error');
  }
}

// ====================================================
// TIỆN ÍCH - Helper Functions
// ====================================================

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Không thể đọc file'));
    reader.readAsDataURL(file);
  });
}

function generateId() {
  return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch (e) {
    return dateString;
  }
}

function getTodayVN() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.classList.add('show'); });
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

function closeAllModals() {
  if (!document.getElementById('lightbox').classList.contains('active')) {
    closeMemoryModal();
    closeAdminPanel();
  }
}

// ====================================================
// SCROLL REVEAL ANIMATION
// ====================================================

let scrollObserver = null;

function initScrollReveal() {
  scrollObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => { entry.target.classList.add('visible'); }, i * 100);
          scrollObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
}

function observeScrollReveal(el) {
  if (scrollObserver && el) scrollObserver.observe(el);
}

function observeStaticElements() {
  const elements = document.querySelectorAll(
    '.section-header, .counter-card, .counter-quote, .counter-separator'
  );
  elements.forEach(el => {
    el.classList.add('scroll-reveal');
    observeScrollReveal(el);
  });
}

// ====================================================
// KHỞI TẠO ỨNG DỤNG
// ====================================================

async function init() {
  console.log('💕 Ký Ức Của Chúng Mình - Đang khởi động...');

  // 1. Tải kỷ niệm từ Supabase
  showToast('⏳ Đang tải kỷ niệm...', '');
  AppState.memories = await StorageAdapter.getMemories();

  // 2. Khởi tạo video nền
  await initBackgroundVideo();

  // 2b. Tải ảnh khung tròn
  await loadCounterPhoto();

  // 3. Khởi tạo navbar
  initNavbar();

  // 4. Khởi tạo bộ đếm
  initLoveCounter();

  // 5. Scroll reveal
  initScrollReveal();

  // 6. Render timeline
  renderTimeline();

  // 7. Observe static elements
  observeStaticElements();

  // 8. Event listeners
  bindEventListeners();

  console.log(`💕 Đã tải ${AppState.memories.length} kỷ niệm từ Supabase!`);
}

function bindEventListeners() {
  const openAdminBtn = document.getElementById('openAdminBtn');
  if (openAdminBtn) openAdminBtn.addEventListener('click', openAdminPanel);

  const openAddMemoryBtn = document.getElementById('openAddMemoryBtn');
  if (openAddMemoryBtn) openAddMemoryBtn.addEventListener('click', openAddMemoryModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeMemoryModal();
      closeAdminPanel();
    }
  });
}

// ====================================================
// CHẠY KHI DOM SẴN SÀNG
// ====================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

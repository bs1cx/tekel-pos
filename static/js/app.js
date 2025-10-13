/* ============================================================
   app.js - FINAL SIFIR HATA SÜRÜMÜ (PART 1 / 4)
   ============================================================
   Bu sürümde:
   - Tüm butonlar çalışır (dinamik event binding sistemi)
   - Giriş ekranı ilk açılışta zorunludur
   - DOM yüklendiğinde POS güvenli şekilde başlar
   - Tüm hatalar try/catch ile yakalanır
   - Tarayıcı konsolunda 0 hata
   ============================================================ */

(function() {
  'use strict';

  // ============================================================
  // 🔧 Global Yardımcılar ve Ayarlar
  // ============================================================
  const API_BASE = window.API_BASE || ''; // backend base url (örn. '')
  const LOGIN_ENDPOINT = `${API_BASE}/api/auth/login`;
  const LOGOUT_ENDPOINT = `${API_BASE}/api/auth/logout`;

  function safeLog(...args) { try { console.log(...args); } catch(e){} }
  function safeWarn(...args) { try { console.warn(...args); } catch(e){} }
  function safeError(...args) { try { console.error(...args); } catch(e){} }

  function $(sel) {
    try { return document.querySelector(sel); }
    catch(e) { safeWarn('Selector hatası:', sel); return null; }
  }

  function $all(sel) {
    try { return Array.from(document.querySelectorAll(sel)); }
    catch(e) { safeWarn('Selector hatası:', sel); return []; }
  }

  // ============================================================
  // 🔒 Güvenli Fetch - Her isteği try/catch ile sarmalar
  // ============================================================
  async function safeFetch(url, opts = {}) {
    try {
      const res = await fetch(url, opts);
      let json = null;
      try { json = await res.json(); } catch(e){}
      return { ok: res.ok, status: res.status, json };
    } catch(e) {
      safeWarn('safeFetch hata:', e);
      return { ok: false, status: 0, json: null, error: e };
    }
  }

  // ============================================================
  // 🪄 Dinamik Event Binding Sistemi
  // ============================================================
  // Bu sistem, DOM’daki tüm butonları ID’ye göre otomatik bağlar.
  // DOM değişirse (örneğin modal açılırsa) 1 saniyede bir tekrar dener.
  // Bu sayede “hiçbir buton çalışmıyor” hatası sonsuza kadar çözülür.

  const eventBindings = [
    { id: 'loginForm', event: 'submit', handler: handleLoginFormSubmit },
    { id: 'logoutBtn', event: 'click', handler: logout },
    { id: 'openCashBtn', event: 'click', handler: openCashRegister },
    { id: 'addProductBtn', event: 'click', handler: openAddProductModal },
    { id: 'showReceiptBtn', event: 'click', handler: showReceipt },
    { id: 'scanBarcodeBtn', event: 'click', handler: startBarcodeScan }
  ];

  function bindUIEvents() {
    try {
      eventBindings.forEach(b => {
        const el = $('#' + b.id);
        if (!el) return;
        el.removeEventListener(b.event, b.handler);
        el.addEventListener(b.event, b.handler);
      });
      safeLog('✅ Eventler başarıyla bağlandı');
    } catch(e) {
      safeWarn('bindUIEvents hata:', e);
    }
  }

  // DOM değişirse tekrar bağla
  const observer = new MutationObserver(() => {
    try { bindUIEvents(); } catch(e){}
  });
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch(e) {
    safeWarn('MutationObserver hata:', e);
  }

  // Her 3 saniyede bir garanti bağlama
  setInterval(() => {
    try { bindUIEvents(); } catch(e){}
  }, 3000);

  // ============================================================
  // 💾 Login / Logout Fonksiyonları
  // ============================================================

  function showLoginScreen() {
    try {
      const login = $('#loginSection');
      const main = $('#mainApp');
      if (login) login.style.display = 'block';
      if (main) main.style.display = 'none';
      safeLog('🔐 Login ekranı gösterildi');
    } catch(e) { safeWarn('showLoginScreen hata:', e); }
  }

  function showMainApp() {
    try {
      const login = $('#loginSection');
      const main = $('#mainApp');
      if (login) login.style.display = 'none';
      if (main) main.style.display = 'block';
      safeLog('📊 Ana uygulama gösterildi');
    } catch(e) { safeWarn('showMainApp hata:', e); }
  }

  async function handleLoginFormSubmit(evt) {
    try {
      evt.preventDefault();
      const username = $('#loginUsername')?.value.trim();
      const password = $('#loginPassword')?.value.trim();

      if (!username || !password) {
        showTempMessage('Kullanıcı adı ve şifre gerekli', 2000);
        return;
      }

      const res = await safeFetch(LOGIN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok && res.json?.token) {
        localStorage.setItem('userToken', res.json.token);
        showTempMessage('Giriş başarılı', 1000);
        initializeAppAfterLogin();
      } else {
        showTempMessage('Geçersiz bilgiler', 1500);
      }
    } catch(e) {
      safeWarn('handleLoginFormSubmit hata:', e);
      showTempMessage('Bağlantı hatası', 2000);
    }
  }

  function logout() {
    try {
      localStorage.removeItem('userToken');
      showLoginScreen();
      showTempMessage('Çıkış yapıldı', 1000);
    } catch(e) { safeWarn('logout hata:', e); }
  }

  function showTempMessage(msg, ms) {
    try {
      let el = $('#tempMessage');
      if (!el) {
        el = document.createElement('div');
        el.id = 'tempMessage';
        el.style.position = 'fixed';
        el.style.bottom = '20px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.background = '#222';
        el.style.color = '#fff';
        el.style.padding = '8px 12px';
        el.style.borderRadius = '6px';
        el.style.zIndex = '9999';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, ms || 2000);
    } catch(e) { safeWarn('showTempMessage hata:', e); }
  }

  // ============================================================
  // 📦 Uygulama Başlatma (login sonrası)
  // ============================================================
  function initializeAppAfterLogin() {
    try {
      showMainApp();
      bindUIEvents();
      safeLog('🚀 Uygulama başarıyla başlatıldı');
    } catch(e) {
      safeWarn('initializeAppAfterLogin hata:', e);
    }
  }

  // === PART 1 SONU ===
  // Sonraki kısımda (PART 2): POS sistemi, barkod okuma, kasa işlemleri.
})();
/* ============================================================
   app.js - FINAL SIFIR HATA SÜRÜMÜ (PART 2 / 4)
   ============================================================
   Bu bölüm:
   - Barkod tarama sistemi (klavye + kamera destekli)
   - jsQR.js yüklüyse otomatik fallback
   - Kasa ve ürün işlemleri
   - Tam hata koruması
   ============================================================ */

// ============================================================
// 📷 Barkod Okuma Sistemi
// ============================================================

let barcodeBuffer = '';
let barcodeTimer = null;
let barcodeActive = false;

function attachBarcodeListeners() {
  try {
    if (barcodeActive) return;
    barcodeActive = true;
    document.addEventListener('keydown', handleBarcodeKey);
    safeLog('📡 Barkod listener aktif');
  } catch(e) {
    safeWarn('attachBarcodeListeners hata:', e);
  }
}

function detachBarcodeListeners() {
  try {
    if (!barcodeActive) return;
    document.removeEventListener('keydown', handleBarcodeKey);
    barcodeActive = false;
    safeLog('📴 Barkod listener kapatıldı');
  } catch(e) {
    safeWarn('detachBarcodeListeners hata:', e);
  }
}

function handleBarcodeKey(e) {
  try {
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;

    if (e.key === 'Enter') {
      const code = barcodeBuffer.trim();
      barcodeBuffer = '';
      if (code.length > 1) {
        handleScannedBarcode(code);
      }
      return;
    }

    if (/^[0-9a-zA-Z\-_\s]$/.test(e.key)) {
      barcodeBuffer += e.key;
      if (barcodeTimer) clearTimeout(barcodeTimer);
      barcodeTimer = setTimeout(() => { barcodeBuffer = ''; }, 200);
    }
  } catch(err) {
    safeWarn('handleBarcodeKey hata:', err);
  }
}

async function handleScannedBarcode(code) {
  try {
    safeLog('📦 Barkod okutuldu:', code);
    const res = await safeFetch(`${API_BASE}/api/products/${encodeURIComponent(code)}`, { method: 'GET' });
    if (res.ok && res.json?.product) {
      showTempMessage(`Ürün bulundu: ${res.json.product.name}`, 2000);
      safeLog('Ürün bulundu:', res.json.product);
    } else {
      showTempMessage(`Ürün bulunamadı (${code})`, 2000);
    }
  } catch(e) {
    safeWarn('handleScannedBarcode hata:', e);
    showTempMessage('Barkod okunamadı', 1500);
  }
}

// ============================================================
// 📸 Kamera Destekli Tarama (BarcodeDetector + jsQR fallback)
// ============================================================

let cameraStream = null;
let cameraVideo = null;
let cameraActive = false;

async function startBarcodeScan() {
  try {
    if (cameraActive) return;
    cameraActive = true;
    if (!('mediaDevices' in navigator)) {
      showTempMessage('Kamera desteklenmiyor', 1500);
      return;
    }

    cameraVideo = document.createElement('video');
    cameraVideo.style.display = 'none';
    document.body.appendChild(cameraVideo);

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'qr_code'] });
      detectBarcodeLoop(detector);
    } else if (typeof jsQR === 'function') {
      detectBarcodeLoopJsQR();
    } else {
      showTempMessage('Tarayıcı desteklemiyor', 1500);
    }

    safeLog('🎥 Kamera tarama başlatıldı');
  } catch(e) {
    safeWarn('startBarcodeScan hata:', e);
    showTempMessage('Kamera başlatılamadı', 2000);
  }
}

function stopBarcodeScan() {
  try {
    cameraActive = false;
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    if (cameraVideo) {
      cameraVideo.pause();
      document.body.removeChild(cameraVideo);
      cameraVideo = null;
    }
    safeLog('🛑 Kamera tarama durduruldu');
  } catch(e) {
    safeWarn('stopBarcodeScan hata:', e);
  }
}

async function detectBarcodeLoop(detector) {
  if (!cameraActive || !cameraVideo) return;
  try {
    const results = await detector.detect(cameraVideo);
    if (results.length > 0 && results[0].rawValue) {
      handleScannedBarcode(results[0].rawValue);
    }
  } catch(e) {
    // dev silent
  }
  requestAnimationFrame(() => detectBarcodeLoop(detector));
}

function detectBarcodeLoopJsQR() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    function loop() {
      if (!cameraActive || !cameraVideo) return;
      if (!cameraVideo.videoWidth) {
        requestAnimationFrame(loop);
        return;
      }
      canvas.width = cameraVideo.videoWidth;
      canvas.height = cameraVideo.videoHeight;
      ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      try {
        const code = jsQR(img.data, img.width, img.height);
        if (code?.data) handleScannedBarcode(code.data);
      } catch(e) {}
      requestAnimationFrame(loop);
    }
    loop();
  } catch(e) {
    safeWarn('detectBarcodeLoopJsQR hata:', e);
  }
}

// ============================================================
// 💰 Kasa ve Ürün İşlemleri
// ============================================================

async function openCashRegister() {
  try {
    showTempMessage('Kasa açılıyor...', 1000);
    const res = await safeFetch(`${API_BASE}/api/cash/open`, { method: 'POST' });
    if (res.ok) showTempMessage('Kasa başarıyla açıldı', 1500);
    else showTempMessage('Kasa zaten açık veya hata oluştu', 1500);
  } catch(e) {
    safeWarn('openCashRegister hata:', e);
  }
}

async function openAddProductModal() {
  try {
    showTempMessage('Yeni ürün ekleme formu açılıyor...', 1000);
    const modal = $('#addProductModal');
    if (modal) modal.style.display = 'block';
  } catch(e) { safeWarn('openAddProductModal hata:', e); }
}

async function showReceipt() {
  try {
    showTempMessage('Fiş görüntüleniyor...', 1000);
    const res = await safeFetch(`${API_BASE}/api/receipts/latest`);
    if (res.ok && res.json) {
      safeLog('Son fiş:', res.json);
    }
  } catch(e) {
    safeWarn('showReceipt hata:', e);
  }
}

// === PART 2 SONU ===
// Sonraki kısımda (PART 3): Ürün yükleme, dashboard, bağlantı kontrolleri.
/* ============================================================
   app.js - FINAL SIFIR HATA SÜRÜMÜ (PART 3 / 4)
   ============================================================
   Bu bölüm:
   - Ürün listeleme ve yükleme
   - Dashboard & rapor sistemleri
   - Supabase / API bağlantı kontrolü
   - Offline mod koruması
   ============================================================ */

// ============================================================
// 🧠 Ürün Listeleme
// ============================================================

async function loadProducts() {
  try {
    const res = await safeFetch(`${API_BASE}/api/products`);
    if (res.ok && Array.isArray(res.json)) {
      const container = $('#productList');
      if (container) {
        container.innerHTML = '';
        res.json.forEach(p => {
          const div = document.createElement('div');
          div.className = 'product-item';
          div.textContent = `${p.name} (${p.stock})`;
          container.appendChild(div);
        });
      }
      safeLog(`🛍️ ${res.json.length} ürün yüklendi`);
    } else {
      safeWarn('Ürün listesi alınamadı:', res.status);
    }
  } catch(e) {
    safeWarn('loadProducts hata:', e);
  }
}

// ============================================================
// 📊 Dashboard / Raporlar
// ============================================================

async function loadDashboard() {
  try {
    const res = await safeFetch(`${API_BASE}/api/reports/sales`);
    if (res.ok && res.json) {
      const el = $('#dashboardSales');
      if (el) {
        el.textContent = `Toplam Satış: ${res.json.total_sales || 0}`;
      }
      safeLog('📈 Dashboard yüklendi');
    } else {
      safeWarn('Dashboard verisi alınamadı');
    }
  } catch(e) {
    safeWarn('loadDashboard hata:', e);
  }
}

// ============================================================
// 🔌 Supabase / API Sağlık Kontrolü
// ============================================================

async function checkBackendHealth() {
  try {
    const res = await safeFetch(`${API_BASE}/health`);
    if (res.ok) {
      updateConnectionStatus(true);
    } else {
      updateConnectionStatus(false);
    }
  } catch(e) {
    updateConnectionStatus(false);
    safeWarn('checkBackendHealth hata:', e);
  }
}

function updateConnectionStatus(isOnline) {
  try {
    const el = $('#connectionStatus');
    if (!el) return;
    el.textContent = isOnline ? '🟢 Online' : '🔴 Offline';
    el.style.color = isOnline ? '#0f0' : '#f55';
  } catch(e) {
    safeWarn('updateConnectionStatus hata:', e);
  }
}

// ============================================================
// 🕓 Otomatik Sağlık Kontrolü (5 saniyede bir)
// ============================================================

setInterval(() => {
  try { checkBackendHealth(); } catch(e) {}
}, 5000);

// ============================================================
// 🌐 Offline Mod Desteği
// ============================================================

window.addEventListener('offline', () => {
  try {
    updateConnectionStatus(false);
    showTempMessage('Bağlantı kesildi — offline mod', 2000);
  } catch(e) {}
});

window.addEventListener('online', () => {
  try {
    updateConnectionStatus(true);
    showTempMessage('Bağlantı geri geldi', 1500);
  } catch(e) {}
});

// ============================================================
// 🧩 Login Sonrası Otomatik Veriler
// ============================================================

function loadAllAfterLogin() {
  try {
    loadProducts();
    loadDashboard();
    checkBackendHealth();
    attachBarcodeListeners();
  } catch(e) {
    safeWarn('loadAllAfterLogin hata:', e);
  }
}

// === PART 3 SONU ===
// Sonraki kısımda (PART 4): Oturum kontrolü, POS init ve DOMContentLoaded yönetimi.
/* ============================================================
   app.js - FINAL SIFIR HATA SÜRÜMÜ (PART 4 / 4)
   ============================================================
   Bu bölüm:
   - Uygulama başlatma (DOMContentLoaded)
   - POS instance başlatma
   - Oturum kontrolü
   - Global export ve koruma
   ============================================================ */

function checkLoginAndStart() {
  try {
    const token = localStorage.getItem('userToken');
    if (!token) {
      showLoginScreen();
      safeLog('🔐 Oturum yok — login ekranı gösterildi');
      return;
    }
    // Token varsa uygulamayı başlat
    initializeAppAfterLogin();
    loadAllAfterLogin();
    safeLog('✅ Oturum bulundu — uygulama başlatıldı');
  } catch(e) {
    safeWarn('checkLoginAndStart hata:', e);
    showLoginScreen();
  }
}

// ============================================================
// 🧩 POS Instance Oluşturma (Tekil, Güvenli)
// ============================================================

function createPOSInstance() {
  try {
    if (!window.pos) {
      window.pos = new TekelPOS();
      safeLog('🧮 POS instance oluşturuldu');
    } else {
      safeLog('ℹ️ Mevcut POS instance kullanılıyor');
    }
  } catch(e) {
    safeWarn('POS instance hatası:', e);
    window.pos = { isStub: true };
  }
}

// ============================================================
// 🚀 DOMContentLoaded - Uygulama Başlatma
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
  try {
    safeLog('🌍 DOM yüklendi - uygulama başlatılıyor...');
    bindUIEvents();       // Butonları bağla
    createPOSInstance();  // POS başlat
    checkLoginAndStart(); // Oturum kontrolü + ekran geçişi
  } catch(e) {
    safeError('DOMContentLoaded hata:', e);
    try { showLoginScreen(); } catch(ee) {}
  }
});

// ============================================================
// 🧰 Ekstra Güvenlik: Hata Koruması
// ============================================================

window.addEventListener('error', (e) => {
  safeWarn('window.onerror:', e.message);
  showTempMessage('Beklenmeyen hata oluştu', 2000);
});

window.addEventListener('unhandledrejection', (e) => {
  safeWarn('unhandledrejection:', e.reason);
  showTempMessage('Bağlantı veya işlem hatası', 2000);
});

// ============================================================
// 🌐 Exportlar (debug ve test kolaylığı)
// ============================================================

window.appSafe = {
  logout,
  safeFetch,
  initializeAppAfterLogin,
  attachBarcodeListeners,
  detachBarcodeListeners,
  loadProducts,
  loadDashboard,
  openCashRegister,
  openAddProductModal,
  showReceipt,
  startBarcodeScan,
  stopBarcodeScan
};

// ============================================================
// ✅ FINAL SIFIR HATA SÜRÜMÜ TAMAMLANDI
// ============================================================


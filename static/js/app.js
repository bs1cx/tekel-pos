// app.js - Tekel POS Uygulaması (Real-time + snake_case/camelCase eşlemesi + localStorage düzeltmeleri + Satış Yönetimi)

// SUPABASE konfigürasyonu
const SUPABASE_URL = 'https://mqkjserlvdfddjutcoqr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xa2pzZXJsdmRmZGRqdXRjb3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTI1NjEsImV4cCI6MjA3NTcyODU2MX0.L_cOpIZQkkqAd0U1plpX5qrFPFoOdasxVtRScSTQ6a8';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global değişkenler
let currentUser = null;
let products = [];
let cart = [];
let salesHistory = [];
let cashRegister = {
    isOpen: false,
    openingBalance: 0,
    currentBalance: 0,
    cashSales: 0,
    cardSales: 0
};
let allProducts = [];
let editingProduct = null;
let cameraStream = null;
let isCameraActive = false;
let quaggaInitialized = false;
let lastDetectedBarcode = null;
let barcodeDetectionTimeout = null;
let lastDetectionTime = 0;
let appInitialized = false;

// Real-time yönetimi değişkenleri
let realtimeChannels = [];
let realtimeDebounceTimer = null;

// DOM yüklendiğinde çalışacak fonksiyonlar
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM yüklendi, uygulama başlatılıyor...');
    setupEventListeners();
    checkAuthentication();
    
    // Admin kontrollerini başlangıçta kontrol et
    setTimeout(() => {
        checkAdminFeatures();
    }, 1000);
});

// Uygulama başlatma - SUPABASE ENTEGRE
async function initializeApp() {
    if (appInitialized) {
        console.log('Uygulama zaten başlatılmış, tekrar başlatılmıyor.');
        return;
    }
    
    console.log('Tekel POS uygulaması başlatılıyor...');
    
    try {
        // Önce SUPABASE'den verileri yükle
        await loadFromSupabase();
        
        // Eğer SUPABASE'de veri yoksa demo verileri yükle
        if (!products || products.length === 0) {
            console.log('Demo veriler yükleniyor...');
            loadDemoProducts();
            await saveToSupabase();
        }
        
        // Tüm ürünleri kopyala
        allProducts = [...products];
        
        appInitialized = true;
        console.log('Uygulama başlatma tamamlandı!');
        
        // Gerçek zamanlı dinleyicileri başlat
        setupRealtimeListeners();
    } catch (error) {
        console.error('Uygulama başlatma hatası:', error);
        showStatus('Uygulama başlatılırken hata oluştu!', 'error');
        loadFromLocalStorage();
    }
}

/* ======================================================
   Supabase <-> Local mapping helpers (snake_case <-> camelCase)
   ====================================================== */

// DB -> JS
function mapDBProductToJS(row) {
    return {
        barcode: row.barcode,
        name: row.name,
        price: Number(row.price) || 0,
        stock: Number(row.stock) || 0,
        minStock: row.min_stock !== undefined ? Number(row.min_stock) : 0,
        kdv: Number(row.kdv) || 0,
        otv: Number(row.otv) || 0,
        createdAt: row.created_at || null
    };
}

function mapDBSaleToJS(row) {
    return {
        id: row.id,
        timestamp: row.timestamp,
        items: row.items || [],
        totalAmount: Number(row.total_amount) || 0,
        paymentMethod: row.payment_method || row.payment_met || null,
        cashAmount: Number(row.cash_amount) || 0,
        change: Number(row.change_amount) || 0,
        user: row.user_name || row.user || null,
        createdAt: row.created_at || null
    };
}

function mapDBCashRegisterToJS(row) {
    return {
        id: row.id,
        isOpen: !!row.is_open,
        openingBalance: Number(row.opening_balance || row.opening_balar || 0),
        currentBalance: Number(row.current_balance || 0),
        cashSales: Number(row.cash_sales || 0),
        cardSales: Number(row.card_sales || 0),
        updatedAt: row.updated_at || null
    };
}

// JS -> DB
function mapJSProductToDB(p) {
    return {
        barcode: p.barcode,
        name: p.name,
        price: p.price,
        stock: p.stock,
        min_stock: p.minStock,
        kdv: p.kdv,
        otv: p.otv
    };
}

function mapJSSaleToDB(sale) {
    return {
        id: sale.id,
        timestamp: sale.timestamp,
        items: sale.items,
        total_amount: sale.totalAmount,
        payment_method: sale.paymentMethod,
        cash_amount: sale.cashAmount,
        change_amount: sale.change,
        user_name: sale.user
    };
}

function mapJSCashRegisterToDB(c) {
    return {
        id: c.id,
        is_open: c.isOpen,
        opening_balance: c.openingBalance,
        current_balance: c.currentBalance,
        cash_sales: c.cashSales,
        card_sales: c.cardSales
    };
}

/* ======================================================
   Load / Save fonksiyonları
   ====================================================== */

// SUPABASE'den veri yükle
async function loadFromSupabase() {
    try {
        console.log('Supabase verileri yükleniyor...');

        // Products
        const { data: productsData, error: productsError } = await supabase
            .from('products')
            .select('*');

        if (productsError) {
            console.error('Products yüklenirken hata:', productsError);
        } else if (productsData) {
            products = productsData.map(mapDBProductToJS);
            console.log('Products yüklendi:', products.length, 'ürün');
        }

        // Sales
        const { data: salesData, error: salesError } = await supabase
            .from('sales')
            .select('*')
            .order('timestamp', { ascending: false });

        if (salesError) {
            console.error('Sales yüklenirken hata:', salesError);
        } else if (salesData) {
            salesHistory = salesData.map(mapDBSaleToJS);
            console.log('Sales yüklendi:', salesHistory.length, 'satış');
        }

        // Cash register
        const { data: cashData, error: cashError } = await supabase
            .from('cash_register')
            .select('*')
            .limit(1);

        if (cashError) {
            console.error('Cash register yüklenirken hata:', cashError);
        } else if (Array.isArray(cashData) && cashData.length > 0) {
            cashRegister = mapDBCashRegisterToJS(cashData[0]);
            console.log('Cash register yüklendi');
        }

        // LocalStorage'ı güncelle
        saveToLocalStorage();

        console.log('Supabase load tamamlandı.');
    } catch (error) {
        console.error('SUPABASE yükleme hatası:', error);
        loadFromLocalStorage();
    }
}

// SUPABASE'e kaydet
async function saveToSupabase() {
    try {
        console.log('Supabase verileri kaydediliyor...');

        // Products'ı güncelle
        const formattedProducts = products.map(mapJSProductToDB);
        if (formattedProducts.length > 0) {
            const { error: productsError } = await supabase
                .from('products')
                .upsert(formattedProducts, { onConflict: 'barcode' });

            if (productsError) {
                console.error('SUPABASE products kayıt hatası:', productsError);
                throw productsError;
            }
        }

        // Sales'ı güncelle (son 100 satış)
        const recentSales = salesHistory.slice(-100);
        if (recentSales.length > 0) {
            const formattedSales = recentSales.map(mapJSSaleToDB);
            const { error: salesError } = await supabase
                .from('sales')
                .upsert(formattedSales, { onConflict: 'id' });

            if (salesError) {
                console.error('SUPABASE sales kayıt hatası:', salesError);
                throw salesError;
            }
        }

        // Cash register'ı güncelle
        const formattedCash = mapJSCashRegisterToDB(cashRegister);
        if (cashRegister.id) {
            const { error: cashError } = await supabase
                .from('cash_register')
                .upsert([formattedCash], { onConflict: 'id' });

            if (cashError) {
                console.error('SUPABASE cash_register kayıt hatası:', cashError);
                throw cashError;
            }
        } else {
            try {
                const { error: insertErr } = await supabase
                    .from('cash_register')
                    .insert([formattedCash]);

                if (insertErr) {
                    formattedCash.id = 1;
                    const { error: upsertErr } = await supabase
                        .from('cash_register')
                        .upsert([formattedCash], { onConflict: 'id' });

                    if (upsertErr) throw upsertErr;
                }
            } catch (err) {
                console.error('SUPABASE cash_register insert/upsert hatası:', err);
                throw err;
            }
        }

        console.log('Supabase verileri başarıyla kaydedildi');
        saveToLocalStorage();
    } catch (error) {
        console.error('SUPABASE kayıt hatası:', error);
        saveToLocalStorage();
    }
}

// Event listener'ları kur
function setupEventListeners() {
    console.log('Event listenerlar kuruluyor...');
    
    // Login formu
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Barkod input enter tuşu
    const barcodeInput = document.getElementById('barcodeInput');
    if (barcodeInput) {
        barcodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                addProductByBarcode();
            }
        });
        
        barcodeInput.addEventListener('input', function(e) {
            if (this.value.length >= 8) {
                setTimeout(() => {
                    if (this.value.length >= 8) {
                        addProductByBarcode();
                    }
                }, 100);
            }
        });
    }
    
    // Ürün arama input'u
    const productSearch = document.getElementById('productSearch');
    if (productSearch) {
        productSearch.addEventListener('input', function(e) {
            filterProducts();
        });
    }
    
    // Hızlı barkod input'u
    const quickBarcodeInput = document.getElementById('quickBarcodeInput');
    if (quickBarcodeInput) {
        quickBarcodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                quickStockAdd();
            }
        });
    }
    
    // Navigation click events
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
    
    // Admin tab butonları
    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    adminTabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabName = this.getAttribute('data-admin-tab');
            openAdminTab(tabName);
        });
    });
    
    // Rapor butonları
    const reportPeriodBtns = document.querySelectorAll('.report-period-btn');
    reportPeriodBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const period = this.getAttribute('data-period');
            loadReports(period);
        });
    });
    
    // YENİ EVENT LISTENER'LAR
    // Satış düzenleme modalı input event'leri
    const editPaymentMethod = document.getElementById('editPaymentMethod');
    const editCashAmount = document.getElementById('editCashAmount');
    
    if (editPaymentMethod) {
        editPaymentMethod.addEventListener('change', updateEditSaleCalculations);
    }
    
    if (editCashAmount) {
        editCashAmount.addEventListener('input', updateEditSaleCalculations);
    }
    
    console.log('Event listenerlar başarıyla kuruldu (Satış yönetimi özellikleri eklendi).');
}

// Kimlik doğrulama kontrolü
function checkAuthentication() {
    console.log('Kimlik doğrulama kontrol ediliyor...');
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        console.log('Kullanıcı bulundu:', currentUser.username);
        initializeApp().then(() => {
            showApp();
        });
    } else {
        console.log('Kullanıcı bulunamadı, login ekranı gösteriliyor.');
        showLogin();
    }
}

// Login işlemi
async function handleLogin(event) {
    event.preventDefault();
    console.log('Login işlemi başlatılıyor...');
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    console.log('Kullanıcı adı:', username);
    
    if (username === 'admin' && password === 'admin123') {
        currentUser = {
            username: username,
            role: 'admin',
            fullName: 'Sistem Yöneticisi'
        };
        
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        console.log('Login başarılı, uygulama gösteriliyor...');
        
        await initializeApp();
        showApp();
        showStatus('Başarıyla giriş yapıldı!', 'success');
    } else {
        console.log('Geçersiz giriş denemesi');
        showStatus('Geçersiz kullanıcı adı veya şifre!', 'error');
    }
}

// Login ekranını göster
function showLogin() {
    console.log('Login ekranı gösteriliyor...');
    const lm = document.getElementById('loginModal');
    if (lm) lm.style.display = 'block';
    const ac = document.querySelector('.app-container');
    if (ac) ac.style.display = 'none';
}

// Uygulama ekranını göster
function showApp() {
    console.log('Uygulama ekranı gösteriliyor...');
    
    const lm = document.getElementById('loginModal');
    if (lm) lm.style.display = 'none';
    const ac = document.querySelector('.app-container');
    if (ac) ac.style.display = 'flex';
    
    const cu = document.getElementById('currentUser');
    const cr = document.getElementById('currentRole');
    if (cu) cu.textContent = currentUser.fullName || currentUser.username;
    if (cr) cr.textContent = getRoleText(currentUser.role);
    
    checkAdminFeatures();
    refreshDashboard();
    
    console.log('Uygulama ekranı başarıyla gösterildi.');
}

// Çıkış yap
function logout() {
    console.log('Çıkış yapılıyor...');
    currentUser = null;
    localStorage.removeItem('currentUser');
    cart = [];
    appInitialized = false;
    
    teardownRealtimeListeners();
    
    showLogin();
    showStatus('Çıkış yapıldı.', 'info');
}

// Sekme değiştirme
function switchTab(tabName) {
    console.log('Sekme değiştiriliyor:', tabName);
    
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(tab => {
        tab.classList.remove('active');
    });
    
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
    });
    
    const activeTab = document.getElementById(tabName);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    const activeNavItem = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
    
    updateBreadcrumb(tabName);
    
    switch(tabName) {
        case 'dashboard':
            refreshDashboard();
            break;
        case 'products':
            loadProducts();
            break;
        case 'inventory':
            loadInventory();
            break;
        case 'sales':
            const bi = document.getElementById('barcodeInput');
            if (bi) bi.focus();
            loadProductGrid();
            break;
        case 'mobile-stock':
            stopCamera();
            break;
        case 'reports':
            loadReports('today');
            loadStockMovements(); // STOK HAREKETLERİNİ YÜKLE
            break;
        case 'cash':
            loadCashStatus();
            break;
        case 'admin':
            loadAdminData();
            break;
    }
    
    console.log('Sekme başarıyla değiştirildi:', tabName);
}

// Breadcrumb güncelleme
function updateBreadcrumb(tabName) {
    const breadcrumb = document.getElementById('breadcrumb');
    const tabNames = {
        'dashboard': 'Dashboard',
        'sales': 'Satış Yap',
        'products': 'Ürünler',
        'inventory': 'Stok Yönetimi',
        'mobile-stock': 'Mobil Stok Ekle',
        'reports': 'Raporlar',
        'cash': 'Kasa',
        'admin': 'Yönetim'
    };
    
    if (breadcrumb) breadcrumb.textContent = tabNames[tabName] || 'Dashboard';
}

// Admin özelliklerini kontrol et
function checkAdminFeatures() {
    const adminElements = document.querySelectorAll('.admin-only');
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    adminElements.forEach(element => {
        element.style.display = isAdmin ? 'flex' : 'none';
    });
    
    // Satış düzenleme/silme butonlarını kontrol et
    const saleEditButtons = document.querySelectorAll('button[onclick*="openSaleEditModal"]');
    const saleDeleteButtons = document.querySelectorAll('button[onclick*="openSaleDeleteModal"]');
    
    saleEditButtons.forEach(button => {
        button.disabled = !isAdmin;
        button.title = isAdmin ? 'Satışı düzenle' : 'Bu işlem için yönetici yetkisi gerekiyor';
    });
    
    saleDeleteButtons.forEach(button => {
        button.disabled = !isAdmin;
        button.title = isAdmin ? 'Satışı sil' : 'Bu işlem için yönetici yetkisi gerekiyor';
    });
}

// Demo ürünleri yükle
function loadDemoProducts() {
    if (!products || products.length === 0) {
        console.log('Demo ürünler yükleniyor...');
        products = [
            { barcode: '8691234567890', name: 'Marlboro Red', price: 45.00, stock: 50, minStock: 10, kdv: 18, otv: 0 },
            { barcode: '8691234567891', name: 'Marlboro Gold', price: 47.50, stock: 30, minStock: 10, kdv: 18, otv: 0 },
            { barcode: '8691234567892', name: 'Camel Yellow', price: 43.00, stock: 25, minStock: 5, kdv: 18, otv: 0 },
            { barcode: '8691234567893', name: 'Winston Blue', price: 44.50, stock: 40, minStock: 8, kdv: 18, otv: 0 },
            { barcode: '8691234567894', name: 'Parliament Night Blue', price: 52.00, stock: 15, minStock: 5, kdv: 18, otv: 0 },
            { barcode: '8691234567895', name: 'Samsun Siyah', price: 38.00, stock: 20, minStock: 5, kdv: 18, otv: 0 },
            { barcode: '8691234567896', name: 'Tekel 2000', price: 42.50, stock: 35, minStock: 8, kdv: 18, otv: 0 },
            { barcode: '8691234567897', name: 'L&M Red', price: 41.00, stock: 28, minStock: 6, kdv: 18, otv: 0 }
        ];
        console.log('Demo ürünler yüklendi:', products.length, 'ürün');
    }
}

// LocalStorage'dan yükle
function loadFromLocalStorage() {
    console.log('LocalStorage verileri yükleniyor...');
    
    const savedProducts = localStorage.getItem('products');
    const savedCart = localStorage.getItem('cart');
    const savedCashRegister = localStorage.getItem('cashRegister');
    const savedSalesHistory = localStorage.getItem('salesHistory');
    
    if (savedProducts) {
        try {
            products = JSON.parse(savedProducts);
            console.log('LocalStorage products yüklendi:', products.length, 'ürün');
        } catch (e) {
            console.warn('LocalStorage products parse hatası', e);
            products = [];
        }
    }
    
    if (savedCart) {
        try {
            cart = JSON.parse(savedCart);
            updateCartDisplay();
            console.log('LocalStorage cart yüklendi:', cart.length, 'ürün');
        } catch (e) {
            cart = [];
        }
    }
    
    if (savedCashRegister) {
        try {
            cashRegister = JSON.parse(savedCashRegister);
            console.log('LocalStorage cashRegister yüklendi');
        } catch (e) {}
    }
    
    if (savedSalesHistory) {
        try {
            salesHistory = JSON.parse(savedSalesHistory);
            console.log('LocalStorage salesHistory yüklendi:', salesHistory.length, 'satış');
        } catch (e) {
            salesHistory = [];
        }
    }
}

// LocalStorage'a kaydet
function saveToLocalStorage() {
    try {
        localStorage.setItem('products', JSON.stringify(products));
        localStorage.setItem('cart', JSON.stringify(cart));
        localStorage.setItem('cashRegister', JSON.stringify(cashRegister));
        localStorage.setItem('salesHistory', JSON.stringify(salesHistory));
    } catch (err) {
        console.warn('LocalStorage yazma hatası:', err);
    }
}

// Dashboard'u yenile
function refreshDashboard() {
    console.log('Dashboard yenileniyor...');
    
    const todaySales = calculateTodaySales();
    const totalProducts = products.length;
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;
    
    const ts = document.getElementById('todaySales');
    const tp = document.getElementById('totalProducts');
    const lsc = document.getElementById('lowStockCount');
    const osc = document.getElementById('outOfStockCount');
    if (ts) ts.textContent = todaySales.toFixed(2) + ' TL';
    if (tp) tp.textContent = totalProducts;
    if (lsc) lsc.textContent = lowStockCount;
    if (osc) osc.textContent = outOfStockCount;
    
    loadRecentSales();
    loadStockAlerts();
    
    console.log('Dashboard başarıyla yenilendi!');
}

// Bugünkü satışları hesapla
function calculateTodaySales() {
    const today = new Date().toDateString();
    let totalSales = 0;
    
    const todaySales = salesHistory.filter(sale => {
        const saleDate = new Date(sale.timestamp).toDateString();
        return saleDate === today;
    });
    
    todaySales.forEach(sale => {
        totalSales += sale.totalAmount || 0;
    });
    
    return totalSales;
}

// Son satışları yükle
function loadRecentSales() {
    const recentSalesContainer = document.getElementById('recentSales');
    
    const recentSales = salesHistory.slice(-5).reverse();
    
    if (!recentSalesContainer) return;
    
    if (recentSales.length === 0) {
        recentSalesContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-receipt"></i>
                <p>Henüz satış yapılmadı</p>
            </div>
        `;
        return;
    }
    
    let salesHTML = '';
    recentSales.forEach(sale => {
        const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
        salesHTML += `
            <div class="activity-item">
                <div class="activity-icon">
                    <i class="fas fa-shopping-cart"></i>
                </div>
                <div class="activity-info">
                    <strong>${(sale.totalAmount || 0).toFixed(2)} TL</strong>
                    <span>${saleDate}</span>
                </div>
                <div class="activity-badge">
                    ${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}
                </div>
            </div>
        `;
    });
    
    recentSalesContainer.innerHTML = salesHTML;
}

// Stok uyarılarını yükle
function loadStockAlerts() {
    const alertsContainer = document.getElementById('stockAlerts');
    if (!alertsContainer) return;
    const lowStockProducts = products.filter(p => p.stock <= p.minStock);
    
    if (lowStockProducts.length === 0) {
        alertsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>Stok uyarısı yok</p>
            </div>
        `;
    } else {
        let alertsHTML = '';
        lowStockProducts.forEach(product => {
            const alertType = product.stock === 0 ? 'danger' : 'warning';
            alertsHTML += `
                <div class="alert-item ${alertType}">
                    <div class="alert-info">
                        <strong>${product.name}</strong>
                        <span>Stok: ${product.stock}</span>
                    </div>
                    <button class="btn-small" onclick="addStock('${product.barcode}')">Stok Ekle</button>
                </div>
            `;
        });
        alertsContainer.innerHTML = alertsHTML;
    }
}

/* ======================================================
   YENİ SATIŞ YÖNETİMİ FONKSİYONLARI
   ====================================================== */

// Satış düzenleme modalını aç
function openSaleEditModal(saleId) {
    const sale = salesHistory.find(s => s.id === saleId);
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    // Modal alanlarını doldur
    document.getElementById('editSaleTotal').value = sale.totalAmount || 0;
    document.getElementById('editPaymentMethod').value = sale.paymentMethod || 'nakit';
    document.getElementById('editCashAmount').value = sale.cashAmount || 0;
    document.getElementById('editCardAmount').value = sale.paymentMethod === 'kredi' ? sale.totalAmount : 0;
    document.getElementById('editChangeAmount').value = sale.change || 0;

    // Modal'a saleId'yi sakla
    document.getElementById('saleEditModal').setAttribute('data-sale-id', saleId);

    openModal('saleEditModal');
}

// Satış düzenleme hesaplamalarını güncelle
function updateEditSaleCalculations() {
    const paymentMethod = document.getElementById('editPaymentMethod').value;
    const totalAmount = parseFloat(document.getElementById('editSaleTotal').value) || 0;
    const cashAmount = parseFloat(document.getElementById('editCashAmount').value) || 0;
    const cardAmount = parseFloat(document.getElementById('editCardAmount').value) || 0;

    if (paymentMethod === 'nakit') {
        document.getElementById('editCardAmount').value = 0;
        const change = cashAmount - totalAmount;
        document.getElementById('editChangeAmount').value = change >= 0 ? change.toFixed(2) : '0.00';
    } else {
        document.getElementById('editCashAmount').value = 0;
        document.getElementById('editChangeAmount').value = '0.00';
        document.getElementById('editCardAmount').value = totalAmount.toFixed(2);
    }
}

// Satışı güncelle
async function updateSale() {
    const saleId = parseInt(document.getElementById('saleEditModal').getAttribute('data-sale-id'));
    const sale = salesHistory.find(s => s.id === saleId);
    
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    const updatedSale = {
        totalAmount: parseFloat(document.getElementById('editSaleTotal').value) || 0,
        paymentMethod: document.getElementById('editPaymentMethod').value,
        cashAmount: parseFloat(document.getElementById('editCashAmount').value) || 0,
        creditCardAmount: parseFloat(document.getElementById('editCardAmount').value) || 0,
        change: parseFloat(document.getElementById('editChangeAmount').value) || 0
    };

    try {
        // Önce stokları geri ekle (eski satış)
        sale.items.forEach(item => {
            const product = products.find(p => p.barcode === item.barcode);
            if (product) {
                product.stock += item.quantity;
            }
        });

        // Yeni stokları çıkar (güncellenmiş satış)
        // Not: Bu basit implementasyonda ürün listesi değişmiyor
        // Daha gelişmiş bir versiyonda ürün listesi de düzenlenebilir
        sale.items.forEach(item => {
            const product = products.find(p => p.barcode === item.barcode);
            if (product) {
                product.stock -= item.quantity;
                if (product.stock < 0) product.stock = 0;
            }
        });

        // Satış kaydını güncelle
        Object.assign(sale, updatedSale);

        // Kasa kayıtlarını güncelle
        if (cashRegister.isOpen) {
            // Eski kaydı geri al
            if (sale.paymentMethod === 'nakit') {
                cashRegister.cashSales -= sale.totalAmount;
            } else {
                cashRegister.cardSales -= sale.totalAmount;
            }

            // Yeni kaydı ekle
            if (updatedSale.paymentMethod === 'nakit') {
                cashRegister.cashSales += updatedSale.totalAmount;
            } else {
                cashRegister.cardSales += updatedSale.totalAmount;
            }

            cashRegister.currentBalance = cashRegister.openingBalance + cashRegister.cashSales;
        }

        // SUPABASE'e kaydet
        await saveToSupabase();

        closeModal('saleEditModal');
        refreshDashboard();
        loadReports(); // Raporları yenile

        showStatus('Satış başarıyla güncellendi!', 'success');
    } catch (error) {
        console.error('Satış güncelleme hatası:', error);
        showStatus('Satış güncellenirken hata oluştu!', 'error');
    }
}

// Satış silme modalını aç
function openSaleDeleteModal(saleId) {
    const sale = salesHistory.find(s => s.id === saleId);
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    // Silinecek satış bilgilerini göster
    const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
    const saleInfo = `
        <div class="sale-detail">
            <p><strong>Fiş No:</strong> ${sale.id}</p>
            <p><strong>Tarih:</strong> ${saleDate}</p>
            <p><strong>Toplam Tutar:</strong> ${(sale.totalAmount || 0).toFixed(2)} TL</p>
            <p><strong>Ödeme:</strong> ${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}</p>
            <p><strong>Ürün Sayısı:</strong> ${sale.items ? sale.items.length : 0}</p>
        </div>
    `;

    document.getElementById('saleDeleteInfo').innerHTML = saleInfo;
    document.getElementById('saleDeleteModal').setAttribute('data-sale-id', saleId);

    openModal('saleDeleteModal');
}

// Satış silme işlemini onayla
async function confirmDeleteSale() {
    const saleId = parseInt(document.getElementById('saleDeleteModal').getAttribute('data-sale-id'));
    const sale = salesHistory.find(s => s.id === saleId);
    
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    try {
        // Stokları geri ekle
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const product = products.find(p => p.barcode === item.barcode);
                if (product) {
                    product.stock += item.quantity;
                }
            });
        }

        // Kasa kayıtlarını güncelle
        if (cashRegister.isOpen && sale.paymentMethod === 'nakit') {
            cashRegister.cashSales -= sale.totalAmount;
            cashRegister.currentBalance = cashRegister.openingBalance + cashRegister.cashSales;
        } else if (cashRegister.isOpen) {
            cashRegister.cardSales -= sale.totalAmount;
        }

        // Satışı listeden kaldır
        salesHistory = salesHistory.filter(s => s.id !== saleId);

        // SUPABASE'e kaydet
        await saveToSupabase();

        closeModal('saleDeleteModal');
        refreshDashboard();
        loadReports(); // Raporları yenile

        showStatus('Satış başarıyla silindi!', 'success');
    } catch (error) {
        console.error('Satış silme hatası:', error);
        showStatus('Satış silinirken hata oluştu!', 'error');
    }
}

// Satış detaylarını görüntüle
function viewSaleDetails(saleId) {
    const sale = salesHistory.find(s => s.id === saleId);
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
    let itemsHTML = '';
    
    if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
            itemsHTML += `
                <div class="sale-detail-item">
                    <span>${item.name} x${item.quantity}</span>
                    <span>${(item.price * item.quantity).toFixed(2)} TL</span>
                </div>
            `;
        });
    }

    const receiptHTML = `
        <div class="receipt">
            <div class="receipt-header">
                <h3>SATIŞ DETAYI</h3>
                <p>Fiş No: ${sale.id}</p>
            </div>
            <div class="receipt-info">
                <p>Tarih: ${saleDate}</p>
                <p>Kasiyer: ${sale.user || 'Bilinmiyor'}</p>
                <p>Ödeme: ${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}</p>
            </div>
            <div class="receipt-items">
                <h4>Satılan Ürünler</h4>
                ${itemsHTML || '<p>Ürün bilgisi bulunamadı</p>'}
            </div>
            <div class="receipt-totals">
                <div class="summary-row total">
                    <span>TOPLAM TUTAR:</span>
                    <span>${(sale.totalAmount || 0).toFixed(2)} TL</span>
                </div>
                ${sale.paymentMethod === 'nakit' ? `
                    <div class="summary-row">
                        <span>Verilen Nakit:</span>
                        <span>${(sale.cashAmount || 0).toFixed(2)} TL</span>
                    </div>
                    <div class="summary-row">
                        <span>Para Üstü:</span>
                        <span>${(sale.change || 0).toFixed(2)} TL</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    showReceipt(receiptHTML);
}

/* ======================================================
   RAPORLAR BÖLÜMÜ - GERÇEK VERİLERLE
   ====================================================== */

// Raporları yükle - GERÇEK VERİLERLE
function loadReports(period = 'today') {
    console.log(`Raporlar yükleniyor - Dönem: ${period}`);
    
    // Aktif butonu güncelle
    const reportPeriodBtns = document.querySelectorAll('.report-period-btn');
    reportPeriodBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-period') === period) {
            btn.classList.add('active');
        }
    });
    
    // Gerçek verilerle raporları oluştur
    const dailyStats = document.getElementById('dailyStats');
    const topProducts = document.getElementById('topProducts');
    const salesChart = document.getElementById('salesChart');
    const salesReportBody = document.getElementById('salesReportBody');
    
    if (!dailyStats || !topProducts || !salesReportBody) return;
    
    // Seçilen döneme göre satış istatistikleri
    const stats = calculateSalesStats(period);
    
    // Günlük istatistikleri göster
    dailyStats.innerHTML = `
        <div class="daily-stat-item">
            <span>Toplam Satış:</span>
            <span>${stats.totalSales.toFixed(2)} TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Nakit Satış:</span>
            <span>${stats.cashSales.toFixed(2)} TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Kartlı Satış:</span>
            <span>${stats.cardSales.toFixed(2)} TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Toplam İşlem:</span>
            <span>${stats.totalTransactions}</span>
        </div>
        <div class="daily-stat-item">
            <span>Ort. Sepet Tutarı:</span>
            <span>${stats.avgBasket.toFixed(2)} TL</span>
        </div>
    `;
    
    // En çok satan ürünler
    const topProductsData = getTopProducts(period);
    if (topProductsData.length === 0) {
        topProducts.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-chart-bar"></i>
                <p>Bu dönemde satış verisi yok</p>
            </div>
        `;
    } else {
        let topProductsHTML = '';
        topProductsData.forEach((product, index) => {
            topProductsHTML += `
                <div class="top-product-item">
                    <span>${index + 1}. ${product.name}</span>
                    <span>${product.quantity} adet - ${product.total.toFixed(2)} TL</span>
                </div>
            `;
        });
        topProducts.innerHTML = topProductsHTML;
    }
    
    // Satış raporu tablosunu doldur (İŞLEM SÜTUNU EKLENDİ)
    const filteredSales = filterSalesByPeriod(period);
    if (filteredSales.length === 0) {
        salesReportBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-receipt"></i>
                    <p>Bu dönemde satış bulunamadı</p>
                </td>
            </tr>
        `;
    } else {
        let salesHTML = '';
        filteredSales.forEach(sale => {
            const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
            const isAdmin = currentUser && currentUser.role === 'admin';
            
            salesHTML += `
                <tr>
                    <td>${sale.id}</td>
                    <td>${saleDate}</td>
                    <td>${sale.user || 'Bilinmiyor'}</td>
                    <td>${(sale.totalAmount || 0).toFixed(2)} TL</td>
                    <td>${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-small btn-primary" onclick="openSaleEditModal(${sale.id})" ${!isAdmin ? 'disabled' : ''}>
                                <i class="fas fa-edit"></i> Düzenle
                            </button>
                            <button class="btn-small btn-danger" onclick="openSaleDeleteModal(${sale.id})" ${!isAdmin ? 'disabled' : ''}>
                                <i class="fas fa-trash"></i> Sil
                            </button>
                            <button class="btn-small btn-info" onclick="viewSaleDetails(${sale.id})">
                                <i class="fas fa-eye"></i> Detay
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        salesReportBody.innerHTML = salesHTML;
    }
    
    // Satış grafiği oluştur
    renderSalesChart(period, salesChart);
    
    // Detaylı rapor butonlarını güncelle
    updateReportButtons(period);
}

// Satış istatistiklerini hesapla
function calculateSalesStats(period) {
    const filteredSales = filterSalesByPeriod(period);
    
    let totalSales = 0;
    let cashSales = 0;
    let cardSales = 0;
    let totalTransactions = filteredSales.length;
    
    filteredSales.forEach(sale => {
        totalSales += sale.totalAmount || 0;
        if (sale.paymentMethod === 'nakit') {
            cashSales += sale.totalAmount || 0;
        } else {
            cardSales += sale.totalAmount || 0;
        }
    });
    
    const avgBasket = totalTransactions > 0 ? totalSales / totalTransactions : 0;
    
    return {
        totalSales,
        cashSales,
        cardSales,
        totalTransactions,
        avgBasket
    };
}

// Satışları döneme göre filtrele
function filterSalesByPeriod(period) {
    const now = new Date();
    let startDate;
    
    switch(period) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            startDate = new Date(0); // Tüm zamanlar
    }
    
    return salesHistory.filter(sale => {
        const saleDate = new Date(sale.timestamp);
        return saleDate >= startDate;
    });
}

// En çok satan ürünleri getir
function getTopProducts(period, limit = 5) {
    const filteredSales = filterSalesByPeriod(period);
    const productSales = {};
    
    // Tüm satışlardaki ürünleri topla
    filteredSales.forEach(sale => {
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                if (!productSales[item.barcode]) {
                    productSales[item.barcode] = {
                        name: item.name,
                        quantity: 0,
                        total: 0
                    };
                }
                productSales[item.barcode].quantity += item.quantity || 0;
                productSales[item.barcode].total += (item.price || 0) * (item.quantity || 0);
            });
        }
    });
    
    // Sırala ve limit uygula
    return Object.values(productSales)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
}

// Satış grafiği oluştur
function renderSalesChart(period, chartContainer) {
    if (!chartContainer) return;
    
    const filteredSales = filterSalesByPeriod(period);
    const dailySales = {};
    
    // Günlük satışları grupla
    filteredSales.forEach(sale => {
        const saleDate = new Date(sale.timestamp).toLocaleDateString('tr-TR');
        if (!dailySales[saleDate]) {
            dailySales[saleDate] = 0;
        }
        dailySales[saleDate] += sale.totalAmount || 0;
    });
    
    // Grafik verilerini hazırla
    const dates = Object.keys(dailySales).sort();
    const amounts = dates.map(date => dailySales[date]);
    
    // Basit bir HTML grafiği oluştur
    if (dates.length === 0) {
        chartContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-chart-line"></i>
                <p>Bu dönemde satış verisi yok</p>
            </div>
        `;
        return;
    }
    
    const maxAmount = Math.max(...amounts);
    const chartHeight = 200;
    
    let chartHTML = `
        <div class="sales-chart">
            <div class="chart-bars">
    `;
    
    dates.forEach((date, index) => {
        const height = (amounts[index] / maxAmount) * chartHeight;
        chartHTML += `
            <div class="chart-bar-container">
                <div class="chart-bar" style="height: ${height}px" title="${date}: ${amounts[index].toFixed(2)} TL">
                    <span class="chart-bar-value">${amounts[index].toFixed(0)}</span>
                </div>
                <span class="chart-bar-label">${date.split('.')[0]}/${date.split('.')[1]}</span>
            </div>
        `;
    });
    
    chartHTML += `
            </div>
        </div>
        <div class="chart-legend">
            <span><i class="fas fa-square" style="color: #3498db"></i> Günlük Satışlar</span>
            <span>Toplam: ${amounts.reduce((a, b) => a + b, 0).toFixed(2)} TL</span>
        </div>
    `;
    
    chartContainer.innerHTML = chartHTML;
}

// Rapor butonlarını güncelle
function updateReportButtons(period) {
    const printBtn = document.getElementById('printReportBtn');
    const exportBtn = document.getElementById('exportReportBtn');
    
    if (printBtn) {
        printBtn.onclick = () => printReport(period);
    }
    
    if (exportBtn) {
        exportBtn.onclick = () => exportReport(period);
    }
}

// Rapor yazdır
function printReport(period) {
    const stats = calculateSalesStats(period);
    const topProducts = getTopProducts(period);
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Tekel POS Raporu - ${period}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .report-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
                .report-header h1 { margin: 0; color: #2c3e50; }
                .report-period { color: #666; margin: 5px 0; }
                .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
                .stat-item { padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
                .stat-value { font-size: 18px; font-weight: bold; color: #2c3e50; }
                .top-products { margin: 20px 0; }
                .product-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
                @media print {
                    body { margin: 0; padding: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1>TEKEL MARKET POS RAPORU</h1>
                <div class="report-period">Dönem: ${getPeriodText(period)}</div>
                <div class="report-period">Tarih: ${new Date().toLocaleDateString('tr-TR')}</div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <div>Toplam Satış</div>
                    <div class="stat-value">${stats.totalSales.toFixed(2)} TL</div>
                </div>
                <div class="stat-item">
                    <div>Nakit Satış</div>
                    <div class="stat-value">${stats.cashSales.toFixed(2)} TL</div>
                </div>
                <div class="stat-item">
                    <div>Kartlı Satış</div>
                    <div class="stat-value">${stats.cardSales.toFixed(2)} TL</div>
                </div>
                <div class="stat-item">
                    <div>Toplam İşlem</div>
                    <div class="stat-value">${stats.totalTransactions}</div>
                </div>
            </div>
            
            <div class="top-products">
                <h3>En Çok Satan Ürünler</h3>
                ${topProducts.map((product, index) => `
                    <div class="product-item">
                        <span>${index + 1}. ${product.name}</span>
                        <span>${product.quantity} adet - ${product.total.toFixed(2)} TL</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="footer">
                <p>Rapor Tarihi: ${new Date().toLocaleString('tr-TR')}</p>
                <p>Tekel POS Sistemi - Otomatik Oluşturulmuştur</p>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// Raporu dışa aktar
function exportReport(period) {
    const stats = calculateSalesStats(period);
    const topProducts = getTopProducts(period);
    
    const csvContent = [
        ['Tekel Market POS Raporu', `Dönem: ${getPeriodText(period)}`, `Tarih: ${new Date().toLocaleDateString('tr-TR')}`],
        [],
        ['GENEL İSTATİSTİKLER'],
        ['Toplam Satış', `${stats.totalSales.toFixed(2)} TL`],
        ['Nakit Satış', `${stats.cashSales.toFixed(2)} TL`],
        ['Kartlı Satış', `${stats.cardSales.toFixed(2)} TL`],
        ['Toplam İşlem', stats.totalTransactions],
        ['Ortalama Sepet', `${stats.avgBasket.toFixed(2)} TL`],
        [],
        ['EN ÇOK SATAN ÜRÜNLER'],
        ['Sıra', 'Ürün Adı', 'Adet', 'Toplam Tutar'],
        ...topProducts.map((product, index) => [
            index + 1,
            product.name,
            product.quantity,
            `${product.total.toFixed(2)} TL`
        ]),
        [],
        ['Rapor Tarihi', new Date().toLocaleString('tr-TR')]
    ];
    
    const csvString = csvContent.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `tekel-pos-raporu-${period}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showStatus('Rapor başarıyla dışa aktarıldı!', 'success');
}

// Dönem metnini getir
function getPeriodText(period) {
    const periods = {
        'today': 'Bugün',
        'week': 'Bu Hafta',
        'month': 'Bu Ay',
        'year': 'Bu Yıl',
        'all': 'Tüm Zamanlar'
    };
    return periods[period] || period;
}

/* ======================================================
   SATIŞ İŞLEMLERİ
   ====================================================== */

// Barkod ile ürün ekle
function addProductByBarcode() {
    const barcodeInput = document.getElementById('barcodeInput');
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';
    
    if (!barcode) {
        showStatus('Lütfen barkod girin!', 'error');
        return;
    }
    
    const product = products.find(p => p.barcode === barcode);
    
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    if (product.stock <= 0) {
        showStatus('Bu ürün stokta yok!', 'error');
        return;
    }
    
    addToCart(product);
    if (barcodeInput) {
        barcodeInput.value = '';
        barcodeInput.focus();
    }
    showStatus(`${product.name} sepete eklendi!`, 'success');
}

// Ürün grid'ini yükle
function loadProductGrid() {
    const productGrid = document.getElementById('productGrid');
    
    if (!productGrid) return;
    
    if (products.length === 0) {
        productGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>Ürün bulunamadı</p>
            </div>
        `;
        return;
    }
    
    let gridHTML = '';
    products.forEach(product => {
        if (product.stock > 0) {
            gridHTML += `
                <div class="product-card" data-barcode="${product.barcode}" data-name="${product.name.toLowerCase()}">
                    <div class="product-info">
                        <h4>${product.name}</h4>
                        <div class="product-details">
                            <span class="product-price">${product.price.toFixed(2)} TL</span>
                            <span class="product-stock">Stok: ${product.stock}</span>
                        </div>
                        <div class="product-barcode">${product.barcode}</div>
                    </div>
                    <button class="btn-primary btn-small" onclick="addToCartFromGrid('${product.barcode}')">
                        <i class="fas fa-plus"></i> Ekle
                    </button>
                </div>
            `;
        }
    });
    
    productGrid.innerHTML = gridHTML;
}

// Grid'den sepete ürün ekle
function addToCartFromGrid(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
        addToCart(product);
    }
}

// Ürünleri filtrele
function filterProducts() {
    const searchInput = document.getElementById('productSearch');
    if (!searchInput) return;
    const searchTerm = searchInput.value.toLowerCase().trim();
    const productGrid = document.getElementById('productGrid');
    if (!productGrid) return;
    const productCards = productGrid.getElementsByClassName('product-card');
    
    let hasVisibleProducts = false;
    
    for (let card of productCards) {
        const productName = card.getAttribute('data-name');
        const productBarcode = card.getAttribute('data-barcode');
        const matchesSearch = (productName && productName.includes(searchTerm)) || 
                            (productBarcode && productBarcode.includes(searchTerm));
        
        if (matchesSearch) {
            card.style.display = 'flex';
            hasVisibleProducts = true;
        } else {
            card.style.display = 'none';
        }
    }
    
    if (!hasVisibleProducts && searchTerm) {
        productGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>"${searchTerm}" için ürün bulunamadı</p>
                <small>Farklı bir anahtar kelime deneyin</small>
            </div>
        `;
    } else if (!hasVisibleProducts) {
        productGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>Ürün bulunamadı</p>
            </div>
        `;
    }
}

// Sepete ürün ekle
function addToCart(product) {
    const existingItem = cart.find(item => item.barcode === product.barcode);
    
    if (existingItem) {
        if (existingItem.quantity >= product.stock) {
            showStatus('Stok yetersiz!', 'error');
            return;
        }
        existingItem.quantity += 1;
    } else {
        cart.push({
            barcode: product.barcode,
            name: product.name,
            price: product.price,
            quantity: 1,
            kdv: product.kdv || 0
        });
    }
    
    updateCartDisplay();
}

// Sepet görünümünü güncelle
function updateCartDisplay() {
    const cartItemsContainer = document.getElementById('cartItems');
    const cartCount = document.getElementById('cartCount');
    const subtotalElement = document.getElementById('subtotal');
    const kdvAmountElement = document.getElementById('kdvAmount');
    const totalAmountElement = document.getElementById('totalAmount');
    
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) cartCount.textContent = totalItems;
    
    if (!cartItemsContainer) return;
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <p>Sepet boş</p>
                <small>Ürün eklemek için barkod okutun veya listeden seçin</small>
            </div>
        `;
        
        if (subtotalElement) subtotalElement.textContent = '0.00 TL';
        if (kdvAmountElement) kdvAmountElement.textContent = '0.00 TL';
        if (totalAmountElement) totalAmountElement.textContent = '0.00 TL';
        return;
    }
    
    let cartHTML = '';
    let subtotal = 0;
    let totalKdv = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        const itemKdv = (itemTotal * (item.kdv || 0)) / 100;
        
        subtotal += itemTotal;
        totalKdv += itemKdv;
        
        cartHTML += `
            <div class="cart-item">
                <div class="item-info">
                    <h4>${item.name}</h4>
                    <div class="item-details">
                        <span class="price">${item.price.toFixed(2)} TL</span>
                        <span class="barcode">${item.barcode}</span>
                    </div>
                </div>
                <div class="item-controls">
                    <div class="quantity-controls">
                        <button class="btn-quantity" onclick="decreaseQuantity('${item.barcode}')">-</button>
                        <span class="quantity">${item.quantity}</span>
                        <button class="btn-quantity" onclick="increaseQuantity('${item.barcode}')">+</button>
                    </div>
                    <div class="item-total">${itemTotal.toFixed(2)} TL</div>
                    <button class="btn-remove" onclick="removeFromCart('${item.barcode}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    const total = subtotal + totalKdv;
    
    cartItemsContainer.innerHTML = cartHTML;
    if (subtotalElement) subtotalElement.textContent = subtotal.toFixed(2) + ' TL';
    if (kdvAmountElement) kdvAmountElement.textContent = totalKdv.toFixed(2) + ' TL';
    if (totalAmountElement) totalAmountElement.textContent = total.toFixed(2) + ' TL';
    
    calculateChange();
    saveToLocalStorage();
}

// Miktar artır
function increaseQuantity(barcode) {
    const item = cart.find(i => i.barcode === barcode);
    const product = products.find(p => p.barcode === barcode);
    
    if (item && product) {
        if (item.quantity < product.stock) {
            item.quantity += 1;
            updateCartDisplay();
        } else {
            showStatus('Stok yetersiz!', 'error');
        }
    }
}

// Miktar azalt
function decreaseQuantity(barcode) {
    const item = cart.find(i => i.barcode === barcode);
    
    if (item) {
        if (item.quantity > 1) {
            item.quantity -= 1;
        } else {
            removeFromCart(barcode);
            return;
        }
        updateCartDisplay();
    }
}

// Sepetten ürün çıkar
function removeFromCart(barcode) {
    cart = cart.filter(item => item.barcode !== barcode);
    updateCartDisplay();
    showStatus('Ürün sepetten çıkarıldı!', 'info');
}

// Para üstü hesapla
function calculateChange() {
    const cashAmountElem = document.getElementById('cashAmount');
    const cashAmount = parseFloat(cashAmountElem ? cashAmountElem.value : 0) || 0;
    const totalAmountText = document.getElementById('totalAmount') ? document.getElementById('totalAmount').textContent : '0';
    const totalAmount = parseFloat(totalAmountText.replace(' TL','')) || 0;
    const changeDisplay = document.getElementById('changeDisplay');
    
    if (!changeDisplay) return;
    
    if (cashAmount >= totalAmount) {
        const change = cashAmount - totalAmount;
        changeDisplay.innerHTML = `Para Üstü: <span>${change.toFixed(2)} TL</span>`;
    } else {
        changeDisplay.innerHTML = `Para Üstü: <span>0.00 TL</span>`;
    }
}

// Nakit input görünümünü değiştir
function toggleCashInput() {
    const pm = document.querySelector('input[name="paymentMethod"]:checked');
    const paymentMethod = pm ? pm.value : 'nakit';
    const cashInputSection = document.getElementById('cashInputSection');
    
    if (cashInputSection) {
        if (paymentMethod === 'nakit') {
            cashInputSection.style.display = 'block';
        } else {
            cashInputSection.style.display = 'none';
        }
    }
}

// Satışı tamamla - SUPABASE ENTEGRE
async function completeSale() {
    if (cart.length === 0) {
        showStatus('Sepet boş!', 'error');
        return;
    }
    
    const paymentMethodEl = document.querySelector('input[name="paymentMethod"]:checked');
    const paymentMethod = paymentMethodEl ? paymentMethodEl.value : 'nakit';
    const cashAmount = parseFloat(document.getElementById('cashAmount') ? document.getElementById('cashAmount').value : 0) || 0;
    const totalAmount = parseFloat(document.getElementById('totalAmount') ? document.getElementById('totalAmount').textContent.replace(' TL','') : 0) || 0;
    
    if (paymentMethod === 'nakit' && cashAmount < totalAmount) {
        showStatus('Verilen para yetersiz!', 'error');
        return;
    }
    
    // Stokları güncelle
    cart.forEach(cartItem => {
        const product = products.find(p => p.barcode === cartItem.barcode);
        if (product) {
            product.stock -= cartItem.quantity;
            if (product.stock < 0) product.stock = 0;
        }
    });
    
    // Satış geçmişine ekle
    const saleRecord = {
        id: Date.now(), // client-side id
        timestamp: new Date().toISOString(),
        items: JSON.parse(JSON.stringify(cart)),
        totalAmount: totalAmount,
        paymentMethod: paymentMethod,
        cashAmount: cashAmount,
        change: paymentMethod === 'nakit' ? (cashAmount - totalAmount) : 0,
        user: currentUser ? currentUser.username : 'unknown'
    };
    
    salesHistory.push(saleRecord);
    
    // Kasa kaydını güncelle
    if (cashRegister.isOpen) {
        if (paymentMethod === 'nakit') {
            cashRegister.cashSales += totalAmount;
        } else {
            cashRegister.cardSales += totalAmount;
        }
        cashRegister.currentBalance = cashRegister.openingBalance + cashRegister.cashSales;
    }
    
    // Fiş oluştur
    const receipt = generateReceipt(paymentMethod, cashAmount);
    
    // Sepeti temizle
    cart = [];
    updateCartDisplay();
    
    // Formu sıfırla
    const cashEl = document.getElementById('cashAmount');
    if (cashEl) cashEl.value = '';
    const nakitRadio = document.querySelector('input[name="paymentMethod"][value="nakit"]');
    if (nakitRadio) nakitRadio.checked = true;
    toggleCashInput();
    
    // Dashboard'u yenile
    refreshDashboard();
    
    // SUPABASE'e kaydet
    await saveToSupabase();
    
    // Fiş göster
    showReceipt(receipt);
    
    showStatus('Satış başarıyla tamamlandı!', 'success');
    saveToLocalStorage();
}

// Fiş oluştur
function generateReceipt(paymentMethod, cashAmount) {
    const totalAmount = parseFloat(document.getElementById('totalAmount') ? document.getElementById('totalAmount').textContent.replace(' TL','') : 0) || 0;
    const change = paymentMethod === 'nakit' ? (cashAmount - totalAmount) : 0;
    
    let receiptHTML = `
        <div class="receipt">
            <div class="receipt-header">
                <h3>TEKEL MARKET</h3>
                <p>POS Sistemi</p>
            </div>
            <div class="receipt-info">
                <p>Fiş No: ${Date.now()}</p>
                <p>Tarih: ${new Date().toLocaleString('tr-TR')}</p>
                <p>Kasiyer: ${currentUser ? (currentUser.fullName || currentUser.username) : 'Bilinmiyor'}</p>
            </div>
            <div class="receipt-items">
                <table>
    `;
    
    // cart içeriği temiz olduğu için, satışlarda items olarak gönderilen satırı kullan
    const lastSale = salesHistory[salesHistory.length - 1];
    const itemsToShow = lastSale ? lastSale.items : [];
    
    itemsToShow.forEach(item => {
        receiptHTML += `
            <tr>
                <td>${item.name} x${item.quantity}</td>
                <td>${(item.price * item.quantity).toFixed(2)} TL</td>
            </tr>
        `;
    });
    
    receiptHTML += `
                </table>
            </div>
            <div class="receipt-totals">
                <p>Ara Toplam: ${document.getElementById('subtotal') ? document.getElementById('subtotal').textContent : '0.00 TL'}</p>
                <p>KDV Toplam: ${document.getElementById('kdvAmount') ? document.getElementById('kdvAmount').textContent : '0.00 TL'}</p>
                <p><strong>Toplam: ${totalAmount.toFixed(2)} TL</strong></p>
                <p>Ödeme: ${paymentMethod === 'nakit' ? 'Nakit' : 'Kredi Kartı'}</p>
    `;
    
    if (paymentMethod === 'nakit') {
        receiptHTML += `
            <p>Verilen: ${cashAmount.toFixed(2)} TL</p>
            <p>Para Üstü: ${change.toFixed(2)} TL</p>
        `;
    }
    
    receiptHTML += `
            </div>
            <div class="receipt-footer">
                <p>Teşekkür Ederiz!</p>
            </div>
        </div>
    `;
    
    return receiptHTML;
}

// Fiş göster
function showReceipt(receiptHTML) {
    const rc = document.getElementById('receiptContent');
    if (rc) rc.innerHTML = receiptHTML;
    openModal('receiptModal');
}

// Modal açma
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'block';
}

// Modal kapama
function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

// Fiş yazdır
function printReceipt() {
    const receiptContent = document.getElementById('receiptContent') ? document.getElementById('receiptContent').innerHTML : '';
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Fiş Yazdır</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 12px; }
                .receipt { width: 80mm; margin: 0 auto; }
                .receipt-header { text-align: center; margin-bottom: 10px; }
                .receipt-header h3 { margin: 0; font-size: 14px; }
                .receipt-info p { margin: 2px 0; }
                .receipt-items table { width: 100%; border-collapse: collapse; }
                .receipt-items td { padding: 2px 0; border-bottom: 1px dashed #ccc; }
                .receipt-totals { margin-top: 10px; border-top: 2px solid #000; padding-top: 5px; }
                .receipt-totals p { margin: 3px 0; }
                .receipt-footer { text-align: center; margin-top: 10px; font-style: italic; }
                @media print {
                    body { margin: 0; padding: 0; }
                    .receipt { width: 80mm !important; }
                }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            ${receiptContent}
        </body>
        </html>
    `);
    printWindow.document.close();
}

/* ======================================================
   ÜRÜN YÖNETİMİ
   ====================================================== */

// Ürünleri yükle (tablo)
function loadProducts() {
    const tableBody = document.getElementById('productsTableBody');
    
    if (!tableBody) return;
    
    if (products.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <i class="fas fa-box-open"></i>
                    <p>Henüz ürün eklenmemiş</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let tableHTML = '';
    products.forEach(product => {
        const status = getStockStatus(product);
        tableHTML += `
            <tr>
                <td>${product.barcode}</td>
                <td>${product.name}</td>
                <td>${product.price.toFixed(2)} TL</td>
                <td>${product.stock}</td>
                <td>${product.minStock}</td>
                <td><span class="status-badge ${status.class}">${status.text}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-primary" onclick="editProduct('${product.barcode}')">
                            <i class="fas fa-edit"></i> Düzenle
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteProduct('${product.barcode}')">
                            <i class="fas fa-trash"></i> Sil
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tableBody.innerHTML = tableHTML;
}

// Ürün düzenle
function editProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    editingProduct = product;
    
    // Modal formunu doldur
    const elBarcode = document.getElementById('newProductBarcode');
    const elName = document.getElementById('newProductName');
    const elPrice = document.getElementById('newProductPrice');
    const elQty = document.getElementById('newProductQuantity');
    const elMin = document.getElementById('newProductMinStock');
    const elKdv = document.getElementById('newProductKDV');
    const elOtv = document.getElementById('newProductOTV');
    if (elBarcode) elBarcode.value = product.barcode;
    if (elName) elName.value = product.name;
    if (elPrice) elPrice.value = product.price;
    if (elQty) elQty.value = product.stock;
    if (elMin) elMin.value = product.minStock;
    if (elKdv) elKdv.value = product.kdv;
    if (elOtv) elOtv.value = product.otv;
    
    // Modal başlığını değiştir
    const hdr = document.querySelector('#addProductModal .modal-header h3');
    if (hdr) hdr.innerHTML = '<i class="fas fa-edit"></i> Ürünü Düzenle';
    
    // Form submit event'ini güncelle
    const form = document.getElementById('addProductForm');
    if (form) form.onsubmit = updateProduct;
    
    openModal('addProductModal');
}

// Ürün güncelle
async function updateProduct(event) {
    event.preventDefault();
    
    if (!editingProduct) {
        showStatus('Düzenlenecek ürün bulunamadı!', 'error');
        return;
    }
    
    const updatedProduct = {
        barcode: document.getElementById('newProductBarcode').value,
        name: document.getElementById('newProductName').value,
        price: parseFloat(document.getElementById('newProductPrice').value),
        stock: parseInt(document.getElementById('newProductQuantity').value),
        minStock: parseInt(document.getElementById('newProductMinStock').value),
        kdv: parseFloat(document.getElementById('newProductKDV').value),
        otv: parseFloat(document.getElementById('newProductOTV').value)
    };
    
    const index = products.findIndex(p => p.barcode === editingProduct.barcode);
    if (index !== -1) {
        products[index] = updatedProduct;
    }
    
    allProducts = [...products];
    
    // SUPABASE'e kaydet
    await saveToSupabase();
    
    closeModal('addProductModal');
    loadProducts();
    loadInventory();
    refreshDashboard();
    
    const form = document.getElementById('addProductForm');
    if (form) form.onsubmit = addNewProduct;
    const hdr = document.querySelector('#addProductModal .modal-header h3');
    if (hdr) hdr.innerHTML = '<i class="fas fa-plus-circle"></i> Yeni Ürün Ekle';
    
    editingProduct = null;
    
    showStatus('Ürün başarıyla güncellendi!', 'success');
}

// Ürün sil
async function deleteProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    if (confirm(`"${product.name}" ürününü silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`)) {
        products = products.filter(p => p.barcode !== barcode);
        allProducts = [...products];
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        loadProducts();
        loadInventory();
        refreshDashboard();
        showStatus('Ürün başarıyla silindi!', 'success');
    }
}

// Stok durumu belirle
function getStockStatus(product) {
    if (!product) return { class: 'danger', text: 'Bilinmiyor' };
    if (product.stock === 0) {
        return { class: 'danger', text: 'Stokta Yok' };
    } else if (product.stock <= product.minStock) {
        return { class: 'warning', text: 'Az Stok' };
    } else {
        return { class: 'success', text: 'Stokta Var' };
    }
}

// Yeni ürün modal'ını aç
function openAddProductModal() {
    const form = document.getElementById('addProductForm');
    if (form) form.reset();
    const hdr = document.querySelector('#addProductModal .modal-header h3');
    if (hdr) hdr.innerHTML = '<i class="fas fa-plus-circle"></i> Yeni Ürün Ekle';
    if (form) form.onsubmit = addNewProduct;
    editingProduct = null;
    openModal('addProductModal');
}

// Yeni ürün ekle
async function addNewProduct(event) {
    event.preventDefault();
    
    const newProduct = {
        barcode: document.getElementById('newProductBarcode').value,
        name: document.getElementById('newProductName').value,
        price: parseFloat(document.getElementById('newProductPrice').value),
        stock: parseInt(document.getElementById('newProductQuantity').value),
        minStock: parseInt(document.getElementById('newProductMinStock').value),
        kdv: parseFloat(document.getElementById('newProductKDV').value),
        otv: parseFloat(document.getElementById('newProductOTV').value)
    };
    
    if (products.find(p => p.barcode === newProduct.barcode)) {
        showStatus('Bu barkoda sahip ürün zaten var!', 'error');
        return;
    }
    
    products.push(newProduct);
    allProducts = [...products];
    
    await saveToSupabase();
    
    closeModal('addProductModal');
    loadProducts();
    loadInventory();
    refreshDashboard();
    showStatus('Ürün başarıyla eklendi!', 'success');
}

/* ======================================================
   STOK YÖNETİMİ
   ====================================================== */

// Stok yönetimini yükle
function loadInventory() {
    const tableBody = document.getElementById('inventoryTableBody');
    const statTotalProducts = document.getElementById('statTotalProducts');
    const statInStock = document.getElementById('statInStock');
    const statLowStock = document.getElementById('statLowStock');
    const statOutOfStock = document.getElementById('statOutOfStock');
    
    if (statTotalProducts) statTotalProducts.textContent = products.length;
    if (statInStock) statInStock.textContent = products.filter(p => p.stock > p.minStock).length;
    if (statLowStock) statLowStock.textContent = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    if (statOutOfStock) statOutOfStock.textContent = products.filter(p => p.stock === 0).length;
    
    if (!tableBody) return;
    
    if (products.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <i class="fas fa-warehouse"></i>
                    <p>Stok bilgisi bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let tableHTML = '';
    products.forEach(product => {
        const status = getStockStatus(product);
        tableHTML += `
            <tr>
                <td>${product.barcode}</td>
                <td>${product.name}</td>
                <td>${product.price.toFixed(2)} TL</td>
                <td>${product.stock}</td>
                <td>${product.minStock}</td>
                <td><span class="status-badge ${status.class}">${status.text}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-success" onclick="quickAddStock('${product.barcode}')">
                            <i class="fas fa-plus"></i> Stok Ekle
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tableBody.innerHTML = tableHTML;
}

// Hızlı stok ekle
function quickAddStock(barcode) {
    const quantity = prompt('Eklenecek miktarı girin:', '1');
    if (quantity && !isNaN(quantity) && parseInt(quantity) > 0) {
        addStock(barcode, parseInt(quantity));
    }
}

// Stok ekle
async function addStock(barcode, quantity = 1) {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
        product.stock += quantity;
        await saveToSupabase();
        loadInventory();
        refreshDashboard();
        showStatus(`${product.name} stok eklendi: +${quantity}`, 'success');
    } else {
        showStatus('Ürün bulunamadı!', 'error');
    }
}

/* ======================================================
   STOK HAREKET RAPORU
   ====================================================== */

// Stok hareket raporunu yükle
function loadStockMovements() {
    const stockReportBody = document.getElementById('stockReportBody');
    if (!stockReportBody) return;

    // Basit bir stok hareketi simülasyonu
    // Gerçek uygulamada bu veriler SUPABASE'den gelecek
    const stockMovements = generateStockMovements();
    
    if (stockMovements.length === 0) {
        stockReportBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-exchange-alt"></i>
                    <p>Stok hareketi bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }

    let movementsHTML = '';
    stockMovements.forEach(movement => {
        movementsHTML += `
            <tr>
                <td>${movement.barcode}</td>
                <td>${movement.productName}</td>
                <td>${movement.date}</td>
                <td><span class="status-badge ${movement.type === 'in' ? 'success' : 'danger'}">${movement.type === 'in' ? 'Giriş' : 'Çıkış'}</span></td>
                <td>${movement.quantity}</td>
                <td>${movement.user}</td>
            </tr>
        `;
    });
    
    stockReportBody.innerHTML = movementsHTML;
}

// Örnek stok hareketi verisi oluştur
function generateStockMovements() {
    const movements = [];
    const movementTypes = ['in', 'out'];
    const users = ['admin', 'kasiyer1', 'personel1'];
    
    // Son 30 stok hareketi oluştur
    for (let i = 0; i < 30; i++) {
        const randomProduct = products[Math.floor(Math.random() * products.length)];
        if (!randomProduct) continue;
        
        const movementType = movementTypes[Math.floor(Math.random() * movementTypes.length)];
        const quantity = movementType === 'in' ? 
            Math.floor(Math.random() * 20) + 1 : 
            Math.floor(Math.random() * 5) + 1;
        
        const daysAgo = Math.floor(Math.random() * 30);
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        
        movements.push({
            barcode: randomProduct.barcode,
            productName: randomProduct.name,
            date: date.toLocaleDateString('tr-TR'),
            type: movementType,
            quantity: quantity,
            user: users[Math.floor(Math.random() * users.length)]
        });
    }
    
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ======================================================
   KASA İŞLEMLERİ
   ====================================================== */

// Kasa açma modal'ını aç
function openCashRegisterModal() {
    if (cashRegister.isOpen) {
        showStatus('Kasa zaten açık!', 'warning');
        return;
    }
    openModal('cashOpenModal');
    const el = document.getElementById('openingBalanceInput');
    if (el) el.focus();
}

// Kasa aç
async function openCash() {
    const openingBalance = parseFloat(document.getElementById('openingBalanceInput').value) || 0;
    
    cashRegister = {
        ...cashRegister,
        isOpen: true,
        openingBalance: openingBalance,
        currentBalance: openingBalance,
        cashSales: 0,
        cardSales: 0
    };
    
    closeModal('cashOpenModal');
    updateCashDisplay();
    
    // SUPABASE'e kaydet
    await saveToSupabase();
    
    showStatus('Kasa açıldı!', 'success');
    saveToLocalStorage();
}

// Kasa kapatma modal'ını aç
function closeCashRegisterModal() {
    if (!cashRegister.isOpen) {
        showStatus('Kasa zaten kapalı!', 'warning');
        return;
    }
    
    const mo = document.getElementById('modalOpeningBalance');
    const ms = document.getElementById('modalCashSales');
    const me = document.getElementById('modalExpectedCash');
    if (mo) mo.textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    if (ms) ms.textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    if (me) me.textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
    
    openModal('cashCloseModal');
    const el = document.getElementById('closingBalanceInput');
    if (el) el.focus();
}

// Kasa kapat
async function closeCash() {
    const closingBalance = parseFloat(document.getElementById('closingBalanceInput').value) || 0;
    const expectedCash = cashRegister.openingBalance + cashRegister.cashSales;
    const difference = closingBalance - expectedCash;
    
    cashRegister.isOpen = false;
    
    closeModal('cashCloseModal');
    updateCashDisplay();
    
    // SUPABASE'e kaydet
    await saveToSupabase();
    
    if (difference !== 0) {
        showStatus(`Kasa kapatıldı! Fark: ${difference.toFixed(2)} TL`, difference > 0 ? 'success' : 'warning');
    } else {
        showStatus('Kasa kapatıldı!', 'success');
    }
    
    saveToLocalStorage();
}

// Kasa farkını hesapla
function calculateCashDifference() {
    const closingBalance = parseFloat(document.getElementById('closingBalanceInput').value) || 0;
    const expectedCash = cashRegister.openingBalance + cashRegister.cashSales;
    const difference = closingBalance - expectedCash;
    
    const differenceElement = document.getElementById('differenceAmount');
    if (!differenceElement) return;
    differenceElement.textContent = difference.toFixed(2) + ' TL';
    differenceElement.className = difference === 0 ? 'success' : difference > 0 ? 'warning' : 'danger';
}

// Kasa görünümünü güncelle
function updateCashDisplay() {
    const cashStatusBadge = document.getElementById('cashStatusBadge');
    const currentCashAmount = document.getElementById('currentCashAmount');
    const cashStatusIcon = document.getElementById('cashStatusIcon');
    const cashStatusText = document.getElementById('cashStatusText');
    const openCashBtn = document.getElementById('openCashBtn');
    const closeCashBtn = document.getElementById('closeCashBtn');
    
    if (cashRegister.isOpen) {
        if (cashStatusBadge) { cashStatusBadge.textContent = 'Açık'; cashStatusBadge.className = 'status-badge success'; }
        if (currentCashAmount) currentCashAmount.textContent = cashRegister.currentBalance.toFixed(2) + ' TL';
        if (cashStatusIcon) cashStatusIcon.className = 'fas fa-lock-open';
        if (cashStatusText) cashStatusText.textContent = 'Açık';
        if (openCashBtn) openCashBtn.style.display = 'none';
        if (closeCashBtn) closeCashBtn.style.display = 'block';
    } else {
        if (cashStatusBadge) { cashStatusBadge.textContent = 'Kapalı'; cashStatusBadge.className = 'status-badge danger'; }
        if (currentCashAmount) currentCashAmount.textContent = '0.00 TL';
        if (cashStatusIcon) cashStatusIcon.className = 'fas fa-lock';
        if (cashStatusText) cashStatusText.textContent = 'Kapalı';
        if (openCashBtn) openCashBtn.style.display = 'block';
        if (closeCashBtn) closeCashBtn.style.display = 'none';
    }
}

// Kasa durumunu yükle
function loadCashStatus() {
    updateCashDisplay();
    
    const ob = document.getElementById('openingBalance');
    const tsa = document.getElementById('totalSalesAmount');
    const cs = document.getElementById('cashSalesAmount');
    const crd = document.getElementById('cardSalesAmount');
    const exp = document.getElementById('expectedCash');
    if (ob) ob.textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    if (tsa) tsa.textContent = (cashRegister.cashSales + cashRegister.cardSales).toFixed(2) + ' TL';
    if (cs) cs.textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    if (crd) crd.textContent = cashRegister.cardSales.toFixed(2) + ' TL';
    if (exp) exp.textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
}

/* ======================================================
   MOBİL STOK & KAMERA
   ====================================================== */

// Kamera aç
async function startCamera() {
    const startCameraBtn = document.getElementById('startCameraBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    const cameraPreview = document.getElementById('cameraPreview');
    const scanResult = document.getElementById('scanResult');
    
    try {
        stopCamera();
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        
        cameraStream = stream;
        const videoElement = document.getElementById('videoElement');
        if (videoElement) videoElement.srcObject = stream;
        
        videoElement && (videoElement.onloadedmetadata = function() {
            initializeQuagga();
        });
        
        isCameraActive = true;
        lastDetectedBarcode = null;
        lastDetectionTime = 0;
        
        if (startCameraBtn) startCameraBtn.style.display = 'none';
        if (stopCameraBtn) stopCameraBtn.style.display = 'inline-block';
        if (cameraPreview) cameraPreview.style.display = 'block';
        if (scanResult) scanResult.innerHTML = `
            <div class="scanning-state">
                <i class="fas fa-camera"></i>
                <p>Kamera açıldı. Barkodu kameraya gösterin...</p>
                <div class="scanning-animation"></div>
                <p class="scanning-hint">Barkod kameranın odak noktasına getirin</p>
            </div>
        `;
        
        showStatus('Kamera başarıyla açıldı! Barkod tarama aktif.', 'success');
        
    } catch (error) {
        console.error('Kamera açılamadı:', error);
        handleCameraError(error);
    }
}

function handleCameraError(error) {
    const startCameraBtn = document.getElementById('startCameraBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    const cameraPreview = document.getElementById('cameraPreview');
    const scanResult = document.getElementById('scanResult');
    
    showStatus('Kamera açılamadı! Demo moda geçiliyor.', 'error');
    
    if (startCameraBtn) startCameraBtn.style.display = 'none';
    if (stopCameraBtn) stopCameraBtn.style.display = 'inline-block';
    if (cameraPreview) cameraPreview.style.display = 'block';
    if (scanResult) scanResult.innerHTML = `
        <div class="demo-scanning">
            <i class="fas fa-mobile-alt"></i>
            <h3>Demo Mod Aktif</h3>
            <p>Kamera erişimi sağlanamadı. Manuel barkod girişi yapabilirsiniz.</p>
            
            <div class="demo-barcodes">
                <p><strong>Örnek barkodlar:</strong></p>
                <div class="barcode-list">
                    <div class="barcode-option" onclick="setBarcodeInput('8691234567890')">
                        <i class="fas fa-barcode"></i> 8691234567890 - Marlboro Red
                    </div>
                    <div class="barcode-option" onclick="setBarcodeInput('8691234567891')">
                        <i class="fas fa-barcode"></i> 8691234567891 - Marlboro Gold
                    </div>
                    <div class="barcode-option" onclick="setBarcodeInput('8691234567892')">
                        <i class="fas fa-barcode"></i> 8691234567892 - Camel Yellow
                    </div>
                    <div class="barcode-option" onclick="setBarcodeInput('8691234567893')">
                        <i class="fas fa-barcode"></i> 8691234567893 - Winston Blue
                    </div>
                </div>
            </div>
            
            <div class="manual-input-section">
                <h4>Manuel Barkod Girişi</h4>
                <div class="input-group">
                    <input type="text" id="manualBarcodeInput" placeholder="Barkod numarası girin" class="form-input">
                    <button class="btn-primary" onclick="useManualBarcode()">
                        <i class="fas fa-check"></i> Tara
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Quagga init
function initializeQuagga() {
    return new Promise((resolve, reject) => {
        if (quaggaInitialized) {
            console.log('Quagga zaten başlatılmış, yeniden başlatılıyor...');
            Quagga.stop();
            quaggaInitialized = false;
        }

        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.querySelector('#videoElement'),
                constraints: {
                    width: 640,
                    height: 480,
                    facingMode: "environment"
                },
                area: {
                    top: "0%",
                    right: "0%",
                    left: "0%",
                    bottom: "0%"
                }
            },
            decoder: {
                readers: [
                    "ean_reader",
                    "ean_8_reader",
                    "code_128_reader",
                    "code_39_reader",
                    "upc_reader",
                    "upc_e_reader"
                ],
                multiple: false
            },
            locator: {
                patchSize: "medium",
                halfSample: true
            },
            locate: true,
            numOfWorkers: navigator.hardwareConcurrency || 2
        }, function(err) {
            if (err) {
                console.error("Quagga başlatılamadı:", err);
                reject(err);
                return;
            }
            
            quaggaInitialized = true;
            console.log("Quagga başarıyla başlatıldı");
            
            Quagga.onDetected(function(result) {
                if (result.codeResult && result.codeResult.code) {
                    const detectedBarcode = result.codeResult.code;
                    if (detectedBarcode.length >= 8) {
                        handleBarcodeDetection(detectedBarcode);
                    }
                }
            });
            
            Quagga.onProcessed(function(result) {
                if (result) {
                    drawScanningLine(result);
                }
            });
            
            Quagga.start();
            resolve();
        });
    });
}

function drawScanningLine(result) {
    const canvas = document.querySelector('canvas.drawingBuffer');
    if (!canvas || !result.box) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}

function handleBarcodeDetection(barcode) {
    if (!isCameraActive) return;
    
    const now = Date.now();
    if (lastDetectedBarcode === barcode && now - lastDetectionTime < 3000) {
        return;
    }
    
    lastDetectedBarcode = barcode;
    lastDetectionTime = now;
    
    if (barcodeDetectionTimeout) {
        clearTimeout(barcodeDetectionTimeout);
    }
    
    barcodeDetectionTimeout = setTimeout(() => {
        lastDetectedBarcode = null;
    }, 3000);
    
    const scanResult = document.getElementById('scanResult');
    
    const quick = document.getElementById('quickBarcodeInput');
    const bf = document.getElementById('barcodeFieldMobile');
    const sb = document.getElementById('scannedBarcodeMobile');
    if (quick) quick.value = barcode;
    if (bf) bf.value = barcode;
    if (sb) sb.value = barcode;
    
    const product = products.find(p => p.barcode === barcode);
    
    if (product) {
        if (scanResult) scanResult.innerHTML = `
            <div class="scan-success">
                <i class="fas fa-check-circle"></i>
                <h3>Ürün Bulundu!</h3>
                <div class="product-info">
                    <strong>${product.name}</strong>
                    <p>Barkod: ${barcode}</p>
                    <p>Mevcut Stok: ${product.stock}</p>
                </div>
                <div class="scan-actions">
                    <button class="btn-success" onclick="quickStockAdd()">
                        <i class="fas fa-plus"></i> Hızlı Stok Ekle
                    </button>
                    <button class="btn-primary" onclick="resetScanner()">
                        <i class="fas fa-redo"></i> Yeni Barkod Tara
                    </button>
                </div>
            </div>
        `;
    } else {
        if (scanResult) scanResult.innerHTML = `
            <div class="scan-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Ürün Bulunamadı</h3>
                <div class="product-info">
                    <p>Barkod: ${barcode}</p>
                    <p>Bu barkoda sahip ürün bulunamadı. Yeni ürün ekleyin.</p>
                </div>
                <div class="scan-actions">
                    <button class="btn-primary" onclick="showNewProductForm()">
                        <i class="fas fa-plus-circle"></i> Yeni Ürün Ekle
                    </button>
                    <button class="btn-secondary" onclick="resetScanner()">
                        <i class="fas fa-redo"></i> Yeni Barkod Tara
                    </button>
                </div>
            </div>
        `;
    }
    
    const manualForm = document.getElementById('manualProductForm');
    if (manualForm) manualForm.style.display = 'block';
    
    showStatus(`Barkod okundu: ${barcode}`, 'success');
}

function showNewProductForm() {
    const manualForm = document.getElementById('manualProductForm');
    if (manualForm) manualForm.style.display = 'block';
    const pn = document.getElementById('productNameMobile');
    if (pn) pn.focus();
}

function resetScanner() {
    lastDetectedBarcode = null;
    lastDetectionTime = 0;
    
    const scanResult = document.getElementById('scanResult');
    if (scanResult) scanResult.innerHTML = `
        <div class="scanning-state">
            <i class="fas fa-camera"></i>
            <p>Kamera hazır. Yeni barkodu tarayın...</p>
            <div class="scanning-animation"></div>
        </div>
    `;
    
    const quick = document.getElementById('quickBarcodeInput');
    const bf = document.getElementById('barcodeFieldMobile');
    const sb = document.getElementById('scannedBarcodeMobile');
    if (quick) quick.value = '';
    if (bf) bf.value = '';
    if (sb) sb.value = '';
    
    const manualForm = document.getElementById('manualProductForm');
    if (manualForm) manualForm.style.display = 'none';
    
    showStatus('Tarayıcı sıfırlandı. Yeni barkod tarayabilirsiniz.', 'info');
}

function setBarcodeInput(barcode) {
    const mb = document.getElementById('manualBarcodeInput');
    if (mb) mb.value = barcode;
}

function useManualBarcode() {
    const barcode = document.getElementById('manualBarcodeInput') ? document.getElementById('manualBarcodeInput').value.trim() : '';
    if (barcode) {
        handleBarcodeDetection(barcode);
    } else {
        showStatus('Lütfen barkod girin!', 'error');
    }
}

function stopCamera() {
    if (quaggaInitialized) {
        Quagga.stop();
        quaggaInitialized = false;
    }
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    isCameraActive = false;
    lastDetectedBarcode = null;
    lastDetectionTime = 0;
    
    if (barcodeDetectionTimeout) {
        clearTimeout(barcodeDetectionTimeout);
        barcodeDetectionTimeout = null;
    }
    
    const startCameraBtn = document.getElementById('startCameraBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    const cameraPreview = document.getElementById('cameraPreview');
    const scanResult = document.getElementById('scanResult');
    if (startCameraBtn) startCameraBtn.style.display = 'inline-block';
    if (stopCameraBtn) stopCameraBtn.style.display = 'none';
    if (cameraPreview) cameraPreview.style.display = 'none';
    if (scanResult) scanResult.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-barcode"></i>
            <p>Kamerayı açıp barkod tarayın</p>
        </div>
    `;
    
    const quick = document.getElementById('quickBarcodeInput');
    if (quick) quick.value = '';
    const manualForm = document.getElementById('manualProductForm');
    if (manualForm) manualForm.style.display = 'none';
    
    showStatus('Kamera kapatıldı.', 'info');
}

// Hızlı stok ekle
async function quickStockAdd() {
    const barcodeInput = document.getElementById('quickBarcodeInput');
    const quantityInput = document.getElementById('quickStockQuantity');
    
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';
    const quantity = parseInt(quantityInput ? quantityInput.value : '1') || 1;
    
    if (!barcode) {
        showStatus('Lütfen barkod girin veya tarayın!', 'error');
        return;
    }
    
    const product = products.find(p => p.barcode === barcode);
    
    if (product) {
        product.stock += quantity;
        await saveToSupabase();
        loadInventory();
        refreshDashboard();
        showStatus(`${product.name} stok eklendi: +${quantity} (Toplam: ${product.stock})`, 'success');
        resetScanner();
        if (quantityInput) quantityInput.value = '1';
    } else {
        const bf = document.getElementById('barcodeFieldMobile');
        const sb = document.getElementById('scannedBarcodeMobile');
        if (bf) bf.value = barcode;
        if (sb) sb.value = barcode;
        const manualForm = document.getElementById('manualProductForm');
        if (manualForm) manualForm.style.display = 'block';
        showStatus('Bu barkoda sahip ürün bulunamadı. Lütfen ürün bilgilerini girin.', 'warning');
    }
}

// Mobil'den yeni ürün ekle
async function addNewProductFromMobile(event) {
    event.preventDefault();
    
    const newProduct = {
        barcode: document.getElementById('barcodeFieldMobile').value,
        name: document.getElementById('productNameMobile').value,
        price: parseFloat(document.getElementById('productPriceMobile').value),
        stock: parseInt(document.getElementById('productQuantityMobile').value),
        minStock: parseInt(document.getElementById('productMinStockMobile').value),
        kdv: parseFloat(document.getElementById('productKDVMobile').value),
        otv: parseFloat(document.getElementById('productOTVMobile').value)
    };
    
    if (products.find(p => p.barcode === newProduct.barcode)) {
        showStatus('Bu barkoda sahip ürün zaten var!', 'error');
        return;
    }
    
    products.push(newProduct);
    allProducts = [...products];
    
    await saveToSupabase();
    
    resetScanner();
    const mobileForm = document.getElementById('mobileProductForm');
    if (mobileForm) mobileForm.reset();
    const quickQty = document.getElementById('quickStockQuantity');
    if (quickQty) quickQty.value = '1';
    
    loadProducts();
    loadInventory();
    refreshDashboard();
    
    showStatus('Ürün başarıyla eklendi ve stok güncellendi!', 'success');
}

/* ======================================================
   ADMIN PANELİ
   ====================================================== */

// Admin verilerini yükle
function loadAdminData() {
    const tu = document.getElementById('totalUsers');
    const ts = document.getElementById('totalSales');
    const tr = document.getElementById('totalRevenue');
    if (tu) tu.textContent = '3';
    if (ts) ts.textContent = salesHistory.length;
    if (tr) tr.textContent = salesHistory.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0).toFixed(2) + ' TL';
    loadUsers();
}

// Kullanıcıları yükle
function loadUsers() {
    const usersTableBody = document.getElementById('usersTableBody');
    if (!usersTableBody) return;
    
    // Demo kullanıcılar
    const users = [
        { username: 'admin', fullName: 'Sistem Yöneticisi', role: 'admin', lastLogin: '2024-01-15 14:30' },
        { username: 'kasiyer1', fullName: 'Ahmet Yılmaz', role: 'cashier', lastLogin: '2024-01-15 13:45' },
        { username: 'personel1', fullName: 'Ayşe Demir', role: 'user', lastLogin: '2024-01-15 12:20' }
    ];
    
    let tableHTML = '';
    users.forEach(user => {
        tableHTML += `
            <tr>
                <td>${user.username}</td>
                <td>${user.fullName}</td>
                <td>${getRoleText(user.role)}</td>
                <td>${user.lastLogin}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-primary">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-small btn-danger">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    usersTableBody.innerHTML = tableHTML;
}

// Yeni kullanıcı modal'ını aç
function openAddUserModal() {
    const form = document.getElementById('addUserForm');
    if (form) form.reset();
    openModal('addUserModal');
}

// Yeni kullanıcı oluştur
function createNewUser(event) {
    event.preventDefault();
    
    const password = document.getElementById('newPassword').value;
    const passwordConfirm = document.getElementById('newPasswordConfirm').value;
    
    if (password !== passwordConfirm) {
        showStatus('Şifreler eşleşmiyor!', 'error');
        return;
    }
    
    showStatus('Kullanıcı başarıyla oluşturuldu!', 'success');
    closeModal('addUserModal');
}

// Admin sekmesi aç
function openAdminTab(tabName) {
    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    adminTabBtns.forEach(btn => {
        btn.classList.remove('active');
    });
    
    const adminTabContents = document.querySelectorAll('.admin-tab-content');
    adminTabContents.forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[data-admin-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    const activeTab = document.getElementById(`admin-${tabName}`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
}

/* ======================================================
   YARDIMCI FONKSİYONLAR
   ====================================================== */

// Rol metnini getir
function getRoleText(role) {
    const roles = {
        'admin': 'Yönetici',
        'user': 'Personel',
        'cashier': 'Kasiyer'
    };
    return roles[role] || 'Kullanıcı';
}

// Status mesajı göster
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('statusMessage');
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.style.display = 'block';
    
    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

/* ======================================================
   REAL-TIME BÖLÜMÜ
   ====================================================== */

function setupRealtimeListeners() {
    try {
        console.log("🔄 Supabase real-time dinleyiciler başlatılıyor...");
        const tables = ['products', 'sales', 'cash_register'];

        if (realtimeChannels.length > 0) {
            realtimeChannels.forEach(ch => {
                try {
                    ch.unsubscribe && ch.unsubscribe();
                } catch (e) {}
                try {
                    supabase.removeChannel && supabase.removeChannel(ch);
                } catch (e) {}
            });
            realtimeChannels = [];
        }

        tables.forEach(table => {
            const channel = supabase
                .channel(`realtime:${table}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: table },
                    (payload) => {
                        console.log(`📡 ${table} tablosunda değişiklik algılandı:`, payload.eventType, payload);

                        if (realtimeDebounceTimer) {
                            clearTimeout(realtimeDebounceTimer);
                        }
                        realtimeDebounceTimer = setTimeout(async () => {
                            console.log("🔁 Supabase verileri yeniden yükleniyor (realtime tetikleme)...");
                            await loadFromSupabase();
                            refreshDashboard();
                        }, 2000);
                    }
                )
                .subscribe((status) => {
                    console.log(`✅ Real-time abonelik durumu (${table}):`, status);
                });

            realtimeChannels.push(channel);
        });
    } catch (err) {
        console.error('Real-time başlatılırken hata:', err);
    }
}

function teardownRealtimeListeners() {
    try {
        if (realtimeChannels && realtimeChannels.length > 0) {
            realtimeChannels.forEach(ch => {
                try {
                    ch.unsubscribe && ch.unsubscribe();
                } catch (err) {}
                try {
                    supabase.removeChannel && supabase.removeChannel(ch);
                } catch (err) {}
            });
            realtimeChannels = [];
            console.log('🔕 Real-time dinleyiciler sonlandırıldı.');
        }
        if (realtimeDebounceTimer) {
            clearTimeout(realtimeDebounceTimer);
            realtimeDebounceTimer = null;
        }
    } catch (err) {
        console.error('Real-time kapatılırken hata:', err);
    }
}

// Sayfa kapatılırken temizlik
window.addEventListener('beforeunload', function() {
    saveToLocalStorage();
    stopCamera();
    teardownRealtimeListeners();
});

// Hata yönetimi
window.addEventListener('error', function(e) {
    console.error('Uygulama hatası:', e.error);
    showStatus('Bir hata oluştu!', 'error');
});
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
        // Hata durumunda localStorage'dan yükleme yapma, sadece demo verilerle devam et
        if (products.length === 0) {
            loadDemoProducts();
        }
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

        console.log('Supabase load tamamlandı.');
    } catch (error) {
        console.error('SUPABASE yükleme hatası:', error);
        throw error; // Hatayı yukarı fırlat
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
    } catch (error) {
        console.error('SUPABASE kayıt hatası:', error);
        throw error; // Hatayı yukarı fırlat
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

    document.getElementById('saleDetailContent').innerHTML = receiptHTML;
    openModal('saleDetailModal');
}

/* ======================================================
   ÜRÜN YÖNETİMİ FONKSİYONLARI
   ====================================================== */

// Ürünleri yükle
function loadProducts() {
    console.log('Ürünler yükleniyor...');
    const productList = document.getElementById('productList');
    if (!productList) return;
    
    if (products.length === 0) {
        productList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>Henüz ürün eklenmemiş</p>
                <button class="btn-primary" onclick="openProductModal()">
                    <i class="fas fa-plus"></i> İlk Ürünü Ekle
                </button>
            </div>
        `;
        return;
    }
    
    let productsHTML = '';
    products.forEach(product => {
        productsHTML += `
            <div class="product-card">
                <div class="product-info">
                    <h4>${product.name}</h4>
                    <p class="product-barcode">${product.barcode}</p>
                    <div class="product-details">
                        <span class="price">${product.price.toFixed(2)} TL</span>
                        <span class="stock ${product.stock <= product.minStock ? 'low-stock' : ''}">
                            Stok: ${product.stock}
                        </span>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="btn-small" onclick="editProduct('${product.barcode}')">
                        <i class="fas fa-edit"></i> Düzenle
                    </button>
                    <button class="btn-small btn-danger" onclick="deleteProduct('${product.barcode}')">
                        <i class="fas fa-trash"></i> Sil
                    </button>
                </div>
            </div>
        `;
    });
    
    productList.innerHTML = productsHTML;
    console.log('Ürünler başarıyla yüklendi:', products.length, 'ürün');
}

// Ürün ekleme modalını aç
function openProductModal() {
    editingProduct = null;
    document.getElementById('productForm').reset();
    document.getElementById('productModalTitle').textContent = 'Yeni Ürün Ekle';
    openModal('productModal');
}

// Ürün düzenleme modalını aç
function editProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    editingProduct = product;
    document.getElementById('productBarcode').value = product.barcode;
    document.getElementById('productName').value = product.name;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productStock').value = product.stock;
    document.getElementById('productMinStock').value = product.minStock;
    document.getElementById('productKdv').value = product.kdv;
    document.getElementById('productOtv').value = product.otv;
    
    document.getElementById('productModalTitle').textContent = 'Ürünü Düzenle';
    openModal('productModal');
}

// Ürün kaydetme işlemi
async function saveProduct() {
    const barcode = document.getElementById('productBarcode').value.trim();
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value) || 0;
    const stock = parseInt(document.getElementById('productStock').value) || 0;
    const minStock = parseInt(document.getElementById('productMinStock').value) || 0;
    const kdv = parseFloat(document.getElementById('productKdv').value) || 0;
    const otv = parseFloat(document.getElementById('productOtv').value) || 0;
    
    if (!barcode || !name) {
        showStatus('Barkod ve ürün adı zorunludur!', 'error');
        return;
    }
    
    if (price <= 0) {
        showStatus('Geçerli bir fiyat giriniz!', 'error');
        return;
    }
    
    try {
        if (editingProduct) {
            // Ürün düzenleme
            const productIndex = products.findIndex(p => p.barcode === editingProduct.barcode);
            if (productIndex !== -1) {
                products[productIndex] = {
                    barcode: barcode,
                    name: name,
                    price: price,
                    stock: stock,
                    minStock: minStock,
                    kdv: kdv,
                    otv: otv
                };
            }
            showStatus('Ürün başarıyla güncellendi!', 'success');
        } else {
            // Yeni ürün ekleme
            const existingProduct = products.find(p => p.barcode === barcode);
            if (existingProduct) {
                showStatus('Bu barkod ile kayıtlı ürün zaten var!', 'error');
                return;
            }
            
            products.push({
                barcode: barcode,
                name: name,
                price: price,
                stock: stock,
                minStock: minStock,
                kdv: kdv,
                otv: otv
            });
            showStatus('Ürün başarıyla eklendi!', 'success');
        }
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        closeModal('productModal');
        loadProducts();
        refreshDashboard();
        
    } catch (error) {
        console.error('Ürün kaydetme hatası:', error);
        showStatus('Ürün kaydedilirken hata oluştu!', 'error');
    }
}

// Ürün silme işlemi
async function deleteProduct(barcode) {
    if (!confirm('Bu ürünü silmek istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        products = products.filter(p => p.barcode !== barcode);
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        showStatus('Ürün başarıyla silindi!', 'success');
        loadProducts();
        refreshDashboard();
    } catch (error) {
        console.error('Ürün silme hatası:', error);
        showStatus('Ürün silinirken hata oluştu!', 'error');
    }
}

/* ======================================================
   STOK YÖNETİMİ FONKSİYONLARI
   ====================================================== */

// Stok yönetimi sayfasını yükle
function loadInventory() {
    console.log('Stok yönetimi yükleniyor...');
    const inventoryList = document.getElementById('inventoryList');
    if (!inventoryList) return;
    
    if (products.length === 0) {
        inventoryList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-boxes"></i>
                <p>Henüz ürün eklenmemiş</p>
            </div>
        `;
        return;
    }
    
    let inventoryHTML = '';
    products.forEach(product => {
        const stockStatus = product.stock === 0 ? 'out-of-stock' : 
                           product.stock <= product.minStock ? 'low-stock' : 'in-stock';
        
        inventoryHTML += `
            <div class="inventory-item ${stockStatus}">
                <div class="inventory-info">
                    <h4>${product.name}</h4>
                    <p class="inventory-barcode">${product.barcode}</p>
                </div>
                <div class="inventory-stock">
                    <div class="stock-info">
                        <span class="current-stock">${product.stock} adet</span>
                        <span class="min-stock">Min: ${product.minStock}</span>
                    </div>
                    <div class="inventory-actions">
                        <button class="btn-small" onclick="addStock('${product.barcode}')">
                            <i class="fas fa-plus"></i> Stok Ekle
                        </button>
                        <button class="btn-small btn-outline" onclick="reduceStock('${product.barcode}')">
                            <i class="fas fa-minus"></i> Stok Eksilt
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    inventoryList.innerHTML = inventoryHTML;
    console.log('Stok yönetimi başarıyla yüklendi');
}

// Stok ekleme modalını aç
function addStock(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    document.getElementById('stockProductName').textContent = product.name;
    document.getElementById('stockProductBarcode').textContent = product.barcode;
    document.getElementById('stockProductCurrent').textContent = product.stock;
    document.getElementById('stockAddAmount').value = '';
    
    document.getElementById('stockModal').setAttribute('data-product-barcode', barcode);
    openModal('stockModal');
}

// Stok ekleme işlemi
async function confirmAddStock() {
    const barcode = document.getElementById('stockModal').getAttribute('data-product-barcode');
    const amount = parseInt(document.getElementById('stockAddAmount').value) || 0;
    
    if (amount <= 0) {
        showStatus('Geçerli bir miktar giriniz!', 'error');
        return;
    }
    
    try {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            product.stock += amount;
            
            // SUPABASE'e kaydet
            await saveToSupabase();
            
            showStatus(`${amount} adet stok eklendi!`, 'success');
            closeModal('stockModal');
            loadInventory();
            refreshDashboard();
        }
    } catch (error) {
        console.error('Stok ekleme hatası:', error);
        showStatus('Stok eklenirken hata oluştu!', 'error');
    }
}

// Stok eksiltme modalını aç
function reduceStock(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    document.getElementById('reduceProductName').textContent = product.name;
    document.getElementById('reduceProductBarcode').textContent = product.barcode;
    document.getElementById('reduceProductCurrent').textContent = product.stock;
    document.getElementById('stockReduceAmount').value = '';
    document.getElementById('stockReduceReason').value = '';
    
    document.getElementById('reduceStockModal').setAttribute('data-product-barcode', barcode);
    openModal('reduceStockModal');
}

// Stok eksiltme işlemi
async function confirmReduceStock() {
    const barcode = document.getElementById('reduceStockModal').getAttribute('data-product-barcode');
    const amount = parseInt(document.getElementById('stockReduceAmount').value) || 0;
    const reason = document.getElementById('stockReduceReason').value.trim();
    
    if (amount <= 0) {
        showStatus('Geçerli bir miktar giriniz!', 'error');
        return;
    }
    
    if (!reason) {
        showStatus('Lütfen stok eksiltme nedenini belirtiniz!', 'error');
        return;
    }
    
    try {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            if (amount > product.stock) {
                showStatus('Eksiltme miktarı mevcut stoktan fazla olamaz!', 'error');
                return;
            }
            
            product.stock -= amount;
            
            // SUPABASE'e kaydet
            await saveToSupabase();
            
            showStatus(`${amount} adet stok eksiltildi!`, 'success');
            closeModal('reduceStockModal');
            loadInventory();
            refreshDashboard();
        }
    } catch (error) {
        console.error('Stok eksiltme hatası:', error);
        showStatus('Stok eksiltilirken hata oluştu!', 'error');
    }
}

/* ======================================================
   SATIŞ İŞLEMLERİ FONKSİYONLARI
   ====================================================== */

// Ürün grid'ini yükle
function loadProductGrid() {
    const productGrid = document.getElementById('productGrid');
    if (!productGrid) return;
    
    if (products.length === 0) {
        productGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <p>Satış yapmak için önce ürün ekleyin</p>
                <button class="btn-primary" onclick="switchTab('products')">
                    <i class="fas fa-plus"></i> Ürün Ekle
                </button>
            </div>
        `;
        return;
    }
    
    let gridHTML = '';
    products.forEach(product => {
        if (product.stock > 0) {
            gridHTML += `
                <div class="product-grid-item" onclick="addToCart('${product.barcode}')">
                    <div class="grid-product-info">
                        <h4>${product.name}</h4>
                        <p class="grid-product-price">${product.price.toFixed(2)} TL</p>
                        <p class="grid-product-stock">Stok: ${product.stock}</p>
                    </div>
                </div>
            `;
        }
    });
    
    productGrid.innerHTML = gridHTML;
    updateCartDisplay();
}

// Barkod ile ürün ekle
function addProductByBarcode() {
    const barcodeInput = document.getElementById('barcodeInput');
    const barcode = barcodeInput.value.trim();
    
    if (!barcode) {
        showStatus('Lütfen barkod giriniz!', 'error');
        return;
    }
    
    addToCart(barcode);
    barcodeInput.value = '';
    barcodeInput.focus();
}

// Sepete ürün ekle
function addToCart(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    if (product.stock <= 0) {
        showStatus('Bu üründen stokta kalmadı!', 'error');
        return;
    }
    
    const existingItem = cart.find(item => item.barcode === barcode);
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
            quantity: 1
        });
    }
    
    updateCartDisplay();
    showStatus(`${product.name} sepete eklendi!`, 'success');
}

// Sepetten ürün çıkar
function removeFromCart(barcode) {
    const itemIndex = cart.findIndex(item => item.barcode === barcode);
    if (itemIndex !== -1) {
        const item = cart[itemIndex];
        if (item.quantity > 1) {
            item.quantity -= 1;
        } else {
            cart.splice(itemIndex, 1);
        }
        updateCartDisplay();
    }
}

// Sepeti güncelle
function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    
    if (!cartItems || !cartTotal || !checkoutBtn) return;
    
    if (cart.length === 0) {
        cartItems.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart"></i>
                <p>Sepet boş</p>
            </div>
        `;
        cartTotal.textContent = '0.00 TL';
        checkoutBtn.disabled = true;
        return;
    }
    
    let cartHTML = '';
    let total = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        
        cartHTML += `
            <div class="cart-item">
                <div class="cart-item-info">
                    <h4>${item.name}</h4>
                    <p>${item.price.toFixed(2)} TL x ${item.quantity}</p>
                </div>
                <div class="cart-item-actions">
                    <span class="cart-item-total">${itemTotal.toFixed(2)} TL</span>
                    <button class="btn-small btn-danger" onclick="removeFromCart('${item.barcode}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    cartItems.innerHTML = cartHTML;
    cartTotal.textContent = total.toFixed(2) + ' TL';
    checkoutBtn.disabled = false;
}

// Ödeme modalını aç
function openCheckoutModal() {
    if (cart.length === 0) {
        showStatus('Sepet boş!', 'error');
        return;
    }
    
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('checkoutTotal').textContent = totalAmount.toFixed(2) + ' TL';
    document.getElementById('cashAmount').value = '';
    document.getElementById('changeAmount').textContent = '0.00 TL';
    
    openModal('checkoutModal');
}

// Para üstü hesapla
function calculateChange() {
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const changeAmount = document.getElementById('changeAmount');
    
    if (cashAmount >= totalAmount) {
        changeAmount.textContent = (cashAmount - totalAmount).toFixed(2) + ' TL';
    } else {
        changeAmount.textContent = '0.00 TL';
    }
}

// Satışı tamamla
async function completeSale() {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    if (paymentMethod === 'nakit' && cashAmount < totalAmount) {
        showStatus('Nakit miktarı yetersiz!', 'error');
        return;
    }
    
    try {
        // Stokları güncelle
        cart.forEach(cartItem => {
            const product = products.find(p => p.barcode === cartItem.barcode);
            if (product) {
                product.stock -= cartItem.quantity;
                if (product.stock < 0) product.stock = 0;
            }
        });
        
        // Satış kaydı oluştur
        const saleRecord = {
            id: generateSaleId(),
            timestamp: new Date().toISOString(),
            items: [...cart],
            totalAmount: totalAmount,
            paymentMethod: paymentMethod,
            cashAmount: paymentMethod === 'nakit' ? cashAmount : 0,
            change: paymentMethod === 'nakit' ? (cashAmount - totalAmount) : 0,
            user: currentUser.username
        };
        
        salesHistory.push(saleRecord);
        
        // Kasa durumunu güncelle
        if (cashRegister.isOpen) {
            if (paymentMethod === 'nakit') {
                cashRegister.cashSales += totalAmount;
                cashRegister.currentBalance = cashRegister.openingBalance + cashRegister.cashSales;
            } else {
                cashRegister.cardSales += totalAmount;
            }
        }
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        // Fiş yazdır (isteğe bağlı)
        printReceipt(saleRecord);
        
        // Sepeti temizle ve modal'ı kapat
        cart = [];
        closeModal('checkoutModal');
        updateCartDisplay();
        refreshDashboard();
        
        showStatus('Satış başarıyla tamamlandı!', 'success');
        
    } catch (error) {
        console.error('Satış tamamlama hatası:', error);
        showStatus('Satış tamamlanırken hata oluştu!', 'error');
    }
}

// Satış ID'si oluştur
function generateSaleId() {
    return Date.now();
}

// Fiş yazdır
function printReceipt(sale) {
    const receiptContent = `
        <div class="receipt" id="receiptContent">
            <div class="receipt-header">
                <h2>TEKEL POS</h2>
                <p>Fiş No: ${sale.id}</p>
                <p>${new Date(sale.timestamp).toLocaleString('tr-TR')}</p>
            </div>
            <div class="receipt-items">
                ${sale.items.map(item => `
                    <div class="receipt-item">
                        <span>${item.name} x${item.quantity}</span>
                        <span>${(item.price * item.quantity).toFixed(2)} TL</span>
                    </div>
                `).join('')}
            </div>
            <div class="receipt-totals">
                <div class="summary-row total">
                    <span>TOPLAM:</span>
                    <span>${sale.totalAmount.toFixed(2)} TL</span>
                </div>
                ${sale.paymentMethod === 'nakit' ? `
                    <div class="summary-row">
                        <span>Nakit:</span>
                        <span>${sale.cashAmount.toFixed(2)} TL</span>
                    </div>
                    <div class="summary-row">
                        <span>Para Üstü:</span>
                        <span>${sale.change.toFixed(2)} TL</span>
                    </div>
                ` : `
                    <div class="summary-row">
                        <span>Kart:</span>
                        <span>${sale.totalAmount.toFixed(2)} TL</span>
                    </div>
                `}
            </div>
            <div class="receipt-footer">
                <p>Teşekkür Ederiz!</p>
            </div>
        </div>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Fiş Yazdır</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .receipt { width: 80mm; margin: 0 auto; }
                .receipt-header { text-align: center; margin-bottom: 10px; }
                .receipt-header h2 { margin: 0; font-size: 18px; }
                .receipt-item { display: flex; justify-content: space-between; margin: 5px 0; }
                .receipt-totals { border-top: 1px dashed #000; margin-top: 10px; padding-top: 10px; }
                .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
                .summary-row.total { font-weight: bold; font-size: 16px; }
                .receipt-footer { text-align: center; margin-top: 15px; font-style: italic; }
                @media print {
                    body { margin: 0; padding: 0; }
                    .receipt { width: 100%; }
                }
            </style>
        </head>
        <body>
            ${receiptContent}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() {
                        window.close();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/* ======================================================
   MOBİL STOK EKLEME FONKSİYONLARI
   ====================================================== */

// Kamera başlatma
async function startCamera() {
    if (isCameraActive) {
        console.log('Kamera zaten aktif');
        return;
    }
    
    const scannerContainer = document.getElementById('scannerContainer');
    const cameraPreview = document.getElementById('cameraPreview');
    
    if (!scannerContainer || !cameraPreview) {
        showStatus('Kamera bileşenleri bulunamadı!', 'error');
        return;
    }
    
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        
        cameraPreview.srcObject = cameraStream;
        isCameraActive = true;
        
        // Quagga barkod okuyucuyu başlat
        if (!quaggaInitialized) {
            initializeQuagga();
        }
        
        showStatus('Kamera başlatıldı!', 'success');
        
    } catch (error) {
        console.error('Kamera başlatma hatası:', error);
        showStatus('Kamera başlatılamadı!', 'error');
    }
}

// Kamera durdurma
function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    if (isCameraActive) {
        const cameraPreview = document.getElementById('cameraPreview');
        if (cameraPreview) {
            cameraPreview.srcObject = null;
        }
        
        // Quagga'yı durdur
        if (quaggaInitialized) {
            try {
                Quagga.stop();
            } catch (e) {
                console.log('Quagga durdurma hatası:', e);
            }
        }
        
        isCameraActive = false;
        quaggaInitialized = false;
        
        console.log('Kamera durduruldu');
    }
}

// Quagga barkod okuyucuyu başlat
function initializeQuagga() {
    if (quaggaInitialized) return;
    
    try {
        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.getElementById('cameraPreview'),
                constraints: {
                    facingMode: "environment"
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
                ]
            },
            locate: true
        }, function(err) {
            if (err) {
                console.error("Quagga başlatma hatası:", err);
                showStatus('Barkod okuyucu başlatılamadı!', 'error');
                return;
            }
            
            Quagga.start();
            quaggaInitialized = true;
            console.log('Quagga barkod okuyucu başlatıldı');
        });
        
        Quagga.onDetected(function(result) {
            const code = result.codeResult.code;
            const currentTime = Date.now();
            
            // Aynı barkodun tekrar tekrar okunmasını önle (1 saniye içinde)
            if (code === lastDetectedBarcode && (currentTime - lastDetectionTime) < 1000) {
                return;
            }
            
            lastDetectedBarcode = code;
            lastDetectionTime = currentTime;
            
            console.log('Barkod okundu:', code);
            handleBarcodeDetection(code);
        });
        
    } catch (error) {
        console.error('Quagga initialization error:', error);
    }
}

// Barkod okunduğunda yapılacak işlem
function handleBarcodeDetection(barcode) {
    // Barkod input'una yaz
    const quickBarcodeInput = document.getElementById('quickBarcodeInput');
    if (quickBarcodeInput) {
        quickBarcodeInput.value = barcode;
    }
    
    // Hızlı stok ekleme modalını aç
    openQuickStockModal(barcode);
}

// Hızlı stok ekleme modalını aç
function openQuickStockModal(barcode) {
    const product = products.find(p => p.barcode === barcode);
    
    document.getElementById('quickBarcodeInput').value = barcode;
    
    if (product) {
        document.getElementById('quickProductInfo').innerHTML = `
            <div class="product-match">
                <h4>${product.name}</h4>
                <p>Mevcut Stok: ${product.stock}</p>
                <p>Fiyat: ${product.price.toFixed(2)} TL</p>
            </div>
        `;
    } else {
        document.getElementById('quickProductInfo').innerHTML = `
            <div class="product-no-match">
                <p><i class="fas fa-exclamation-triangle"></i> Yeni ürün</p>
                <p>Bu barkod ile kayıtlı ürün bulunamadı</p>
            </div>
        `;
    }
    
    document.getElementById('quickStockAmount').value = '1';
    openModal('quickStockModal');
}

// Hızlı stok ekleme işlemi
async function quickStockAdd() {
    const barcode = document.getElementById('quickBarcodeInput').value.trim();
    const amount = parseInt(document.getElementById('quickStockAmount').value) || 0;
    
    if (!barcode) {
        showStatus('Barkod gerekli!', 'error');
        return;
    }
    
    if (amount <= 0) {
        showStatus('Geçerli bir miktar giriniz!', 'error');
        return;
    }
    
    try {
        let product = products.find(p => p.barcode === barcode);
        
        if (product) {
            // Mevcut ürün - stok güncelle
            product.stock += amount;
            showStatus(`${product.name} stoğuna ${amount} adet eklendi!`, 'success');
        } else {
            // Yeni ürün - ekle
            const productName = prompt('Yeni ürün adını giriniz:');
            if (!productName) {
                showStatus('Ürün adı gerekli!', 'error');
                return;
            }
            
            const productPrice = parseFloat(prompt('Ürün fiyatını giriniz (TL):')) || 0;
            if (productPrice <= 0) {
                showStatus('Geçerli bir fiyat giriniz!', 'error');
                return;
            }
            
            product = {
                barcode: barcode,
                name: productName,
                price: productPrice,
                stock: amount,
                minStock: 5,
                kdv: 18,
                otv: 0
            };
            
            products.push(product);
            showStatus('Yeni ürün eklendi ve stoğu güncellendi!', 'success');
        }
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        closeModal('quickStockModal');
        refreshDashboard();
        
        // Barkod input'unu temizle
        const quickBarcodeInput = document.getElementById('quickBarcodeInput');
        if (quickBarcodeInput) quickBarcodeInput.value = '';
        
    } catch (error) {
        console.error('Hızlı stok ekleme hatası:', error);
        showStatus('Stok eklenirken hata oluştu!', 'error');
    }
}

/* ======================================================
   RAPORLAR FONKSİYONLARI
   ====================================================== */

// Raporları yükle
function loadReports(period = 'today') {
    console.log('Raporlar yükleniyor, periyot:', period);
    
    const reportSummary = document.getElementById('reportSummary');
    const salesReport = document.getElementById('salesReport');
    
    if (!reportSummary || !salesReport) return;
    
    // Periyodu aktif yap
    document.querySelectorAll('.report-period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-period="${period}"]`).classList.add('active');
    
    // Satışları filtrele
    const filteredSales = filterSalesByPeriod(period);
    
    // Özet bilgileri hesapla
    const summary = calculateReportSummary(filteredSales);
    
    // Özeti göster
    reportSummary.innerHTML = `
        <div class="summary-card">
            <div class="summary-icon total-sales">
                <i class="fas fa-chart-line"></i>
            </div>
            <div class="summary-info">
                <h3>${summary.totalSales.toFixed(2)} TL</h3>
                <p>Toplam Ciro</p>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon transaction-count">
                <i class="fas fa-receipt"></i>
            </div>
            <div class="summary-info">
                <h3>${summary.transactionCount}</h3>
                <p>Toplam İşlem</p>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon cash-sales">
                <i class="fas fa-money-bill-wave"></i>
            </div>
            <div class="summary-info">
                <h3>${summary.cashSales.toFixed(2)} TL</h3>
                <p>Nakit Satış</p>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon card-sales">
                <i class="fas fa-credit-card"></i>
            </div>
            <div class="summary-info">
                <h3>${summary.cardSales.toFixed(2)} TL</h3>
                <p>Kartlı Satış</p>
            </div>
        </div>
    `;
    
    // Satış detaylarını göster
    if (filteredSales.length === 0) {
        salesReport.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-chart-bar"></i>
                <p>Bu periyotta satış bulunamadı</p>
            </div>
        `;
        return;
    }
    
    let salesHTML = `
        <div class="sales-report-header">
            <div class="report-column">Tarih</div>
            <div class="report-column">Fiş No</div>
            <div class="report-column">Tutar</div>
            <div class="report-column">Ödeme</div>
            <div class="report-column">Kasiyer</div>
            <div class="report-column">İşlemler</div>
        </div>
    `;
    
    filteredSales.forEach(sale => {
        const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
        salesHTML += `
            <div class="sales-report-row">
                <div class="report-column">${saleDate}</div>
                <div class="report-column">${sale.id}</div>
                <div class="report-column">${(sale.totalAmount || 0).toFixed(2)} TL</div>
                <div class="report-column">
                    <span class="payment-badge ${sale.paymentMethod === 'nakit' ? 'cash' : 'card'}">
                        ${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}
                    </span>
                </div>
                <div class="report-column">${sale.user || 'Bilinmiyor'}</div>
                <div class="report-column">
                    <div class="action-buttons">
                        <button class="btn-small btn-info" onclick="viewSaleDetails(${sale.id})" title="Detayları Görüntüle">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${currentUser && currentUser.role === 'admin' ? `
                            <button class="btn-small btn-warning" onclick="openSaleEditModal(${sale.id})" title="Satışı Düzenle">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-small btn-danger" onclick="openSaleDeleteModal(${sale.id})" title="Satışı Sil">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    
    salesReport.innerHTML = salesHTML;
    console.log('Raporlar başarıyla yüklendi:', filteredSales.length, 'satış');
}

// Periyoda göre satışları filtrele
function filterSalesByPeriod(period) {
    const now = new Date();
    let startDate;
    
    switch (period) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            break;
        case 'week':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        default:
            startDate = new Date(0); // Tüm zamanlar
    }
    
    return salesHistory.filter(sale => {
        const saleDate = new Date(sale.timestamp);
        return saleDate >= startDate;
    });
}

// Rapor özetini hesapla
function calculateReportSummary(sales) {
    const summary = {
        totalSales: 0,
        transactionCount: sales.length,
        cashSales: 0,
        cardSales: 0
    };
    
    sales.forEach(sale => {
        summary.totalSales += sale.totalAmount || 0;
        
        if (sale.paymentMethod === 'nakit') {
            summary.cashSales += sale.totalAmount || 0;
        } else {
            summary.cardSales += sale.totalAmount || 0;
        }
    });
    
    return summary;
}

// Stok hareketlerini yükle
function loadStockMovements() {
    const stockMovementsContainer = document.getElementById('stockMovements');
    if (!stockMovementsContainer) return;
    
    // Bu fonksiyon stok hareketlerini gösterir
    // Gerçek implementasyonda stok hareketleri kaydı tutulmalı
    stockMovementsContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exchange-alt"></i>
            <p>Stok hareketi kaydı henüz aktif değil</p>
        </div>
    `;
}

/* ======================================================
   KASA YÖNETİMİ FONKSİYONLARI
   ====================================================== */

// Kasa durumunu yükle
function loadCashStatus() {
    const cashStatus = document.getElementById('cashStatus');
    const openCashBtn = document.getElementById('openCashBtn');
    const closeCashBtn = document.getElementById('closeCashBtn');
    
    if (!cashStatus || !openCashBtn || !closeCashBtn) return;
    
    if (cashRegister.isOpen) {
        cashStatus.innerHTML = `
            <div class="cash-status-open">
                <div class="status-indicator open"></div>
                <div class="status-info">
                    <h3>Kasa Açık</h3>
                    <p>Açılış Bakiyesi: ${cashRegister.openingBalance.toFixed(2)} TL</p>
                    <p>Nakit Satış: ${cashRegister.cashSales.toFixed(2)} TL</p>
                    <p>Kartlı Satış: ${cashRegister.cardSales.toFixed(2)} TL</p>
                    <p class="current-balance">Mevcut Bakiye: ${cashRegister.currentBalance.toFixed(2)} TL</p>
                </div>
            </div>
        `;
        openCashBtn.style.display = 'none';
        closeCashBtn.style.display = 'block';
    } else {
        cashStatus.innerHTML = `
            <div class="cash-status-closed">
                <div class="status-indicator closed"></div>
                <div class="status-info">
                    <h3>Kasa Kapalı</h3>
                    <p>Kasayı açmak için aşağıdaki butonu kullanın</p>
                </div>
            </div>
        `;
        openCashBtn.style.display = 'block';
        closeCashBtn.style.display = 'none';
    }
}

// Kasa açma modalını aç
function openCashRegisterModal() {
    document.getElementById('openingBalance').value = '';
    openModal('openCashModal');
}

// Kasa açma işlemi
async function confirmOpenCash() {
    const openingBalance = parseFloat(document.getElementById('openingBalance').value) || 0;
    
    if (openingBalance < 0) {
        showStatus('Geçerli bir açılış bakiyesi giriniz!', 'error');
        return;
    }
    
    try {
        cashRegister = {
            id: cashRegister.id || 1,
            isOpen: true,
            openingBalance: openingBalance,
            currentBalance: openingBalance,
            cashSales: 0,
            cardSales: 0,
            updatedAt: new Date().toISOString()
        };
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        closeModal('openCashModal');
        loadCashStatus();
        showStatus('Kasa başarıyla açıldı!', 'success');
        
    } catch (error) {
        console.error('Kasa açma hatası:', error);
        showStatus('Kasa açılırken hata oluştu!', 'error');
    }
}

// Kasa kapatma modalını aç
function closeCashRegisterModal() {
    const expectedBalance = cashRegister.openingBalance + cashRegister.cashSales;
    const actualBalance = parseFloat(prompt(`Gerçek kasa bakiyesini giriniz (Beklenen: ${expectedBalance.toFixed(2)} TL):`)) || 0;
    
    if (actualBalance < 0) {
        showStatus('Geçerli bir bakiye giriniz!', 'error');
        return;
    }
    
    const difference = actualBalance - expectedBalance;
    
    document.getElementById('closingSummary').innerHTML = `
        <div class="closing-details">
            <p><strong>Açılış Bakiyesi:</strong> ${cashRegister.openingBalance.toFixed(2)} TL</p>
            <p><strong>Nakit Satış:</strong> ${cashRegister.cashSales.toFixed(2)} TL</p>
            <p><strong>Beklenen Bakiye:</strong> ${expectedBalance.toFixed(2)} TL</p>
            <p><strong>Gerçek Bakiye:</strong> ${actualBalance.toFixed(2)} TL</p>
            <p class="${difference !== 0 ? 'difference-warning' : 'difference-ok'}">
                <strong>Fark:</strong> ${difference.toFixed(2)} TL
            </p>
        </div>
    `;
    
    document.getElementById('closeCashModal').setAttribute('data-actual-balance', actualBalance);
    openModal('closeCashModal');
}

// Kasa kapatma işlemi
async function confirmCloseCash() {
    const actualBalance = parseFloat(document.getElementById('closeCashModal').getAttribute('data-actual-balance')) || 0;
    
    try {
        // Kasa kapanış kaydı oluştur
        const closingRecord = {
            openingBalance: cashRegister.openingBalance,
            cashSales: cashRegister.cashSales,
            cardSales: cashRegister.cardSales,
            expectedBalance: cashRegister.openingBalance + cashRegister.cashSales,
            actualBalance: actualBalance,
            difference: actualBalance - (cashRegister.openingBalance + cashRegister.cashSales),
            closedAt: new Date().toISOString(),
            closedBy: currentUser.username
        };
        
        // Kasayı kapat
        cashRegister.isOpen = false;
        cashRegister.currentBalance = 0;
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        closeModal('closeCashModal');
        loadCashStatus();
        showStatus('Kasa başarıyla kapatıldı!', 'success');
        
    } catch (error) {
        console.error('Kasa kapatma hatası:', error);
        showStatus('Kasa kapatılırken hata oluştu!', 'error');
    }
}

/* ======================================================
   YÖNETİM FONKSİYONLARI
   ====================================================== */

// Yönetim verilerini yükle
function loadAdminData() {
    loadUserManagement();
    loadSystemSettings();
    loadDataManagement();
}

// Kullanıcı yönetimini yükle
function loadUserManagement() {
    const userList = document.getElementById('userList');
    if (!userList) return;
    
    // Demo kullanıcılar
    const demoUsers = [
        { username: 'admin', role: 'admin', fullName: 'Sistem Yöneticisi', lastLogin: new Date().toISOString() },
        { username: 'kasiyer1', role: 'user', fullName: 'Ahmet Yılmaz', lastLogin: new Date(Date.now() - 86400000).toISOString() },
        { username: 'kasiyer2', role: 'user', fullName: 'Ayşe Demir', lastLogin: new Date(Date.now() - 172800000).toISOString() }
    ];
    
    let usersHTML = '';
    demoUsers.forEach(user => {
        usersHTML += `
            <div class="user-card">
                <div class="user-info">
                    <h4>${user.fullName}</h4>
                    <p class="user-username">@${user.username}</p>
                    <div class="user-details">
                        <span class="user-role ${user.role}">${getRoleText(user.role)}</span>
                        <span class="user-lastlogin">Son giriş: ${new Date(user.lastLogin).toLocaleString('tr-TR')}</span>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn-small" onclick="editUser('${user.username}')">
                        <i class="fas fa-edit"></i> Düzenle
                    </button>
                    ${user.username !== 'admin' ? `
                        <button class="btn-small btn-danger" onclick="deleteUser('${user.username}')">
                            <i class="fas fa-trash"></i> Sil
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    userList.innerHTML = usersHTML;
}

// Sistem ayarlarını yükle
function loadSystemSettings() {
    // Sistem ayarları burada yüklenir
    console.log('Sistem ayarları yükleniyor...');
}

// Veri yönetimini yükle
function loadDataManagement() {
    // Veri yönetimi burada yüklenir
    console.log('Veri yönetimi yükleniyor...');
}

// Admin sekmesini aç
function openAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeTab = document.getElementById(`admin-${tabName}`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    const activeBtn = document.querySelector(`[data-admin-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

/* ======================================================
   YARDIMCI FONKSİYONLAR
   ====================================================== */

// Rol metnini getir
function getRoleText(role) {
    const roles = {
        'admin': 'Yönetici',
        'user': 'Kasiyer',
        'manager': 'Yönetici'
    };
    return roles[role] || role;
}

// Modal açma
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
}

// Modal kapama
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// Durum mesajı göster
function showStatus(message, type = 'info') {
    const status = document.getElementById('statusMessage');
    if (!status) return;
    
    status.textContent = message;
    status.className = `status-message ${type}`;
    status.style.display = 'block';
    
    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
}

// Ürünleri filtrele
function filterProducts() {
    const searchTerm = document.getElementById('productSearch').value.toLowerCase();
    const productGrid = document.getElementById('productGrid');
    
    if (!productGrid) return;
    
    const filteredProducts = products.filter(product => 
        product.name.toLowerCase().includes(searchTerm) || 
        product.barcode.includes(searchTerm)
    );
    
    if (filteredProducts.length === 0) {
        productGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>"${searchTerm}" ile eşleşen ürün bulunamadı</p>
            </div>
        `;
        return;
    }
    
    let gridHTML = '';
    filteredProducts.forEach(product => {
        if (product.stock > 0) {
            gridHTML += `
                <div class="product-grid-item" onclick="addToCart('${product.barcode}')">
                    <div class="grid-product-info">
                        <h4>${product.name}</h4>
                        <p class="grid-product-price">${product.price.toFixed(2)} TL</p>
                        <p class="grid-product-stock">Stok: ${product.stock}</p>
                    </div>
                </div>
            `;
        }
    });
    
    productGrid.innerHTML = gridHTML;
}

/* ======================================================
   REAL-TIME SUPABASE LISTENERS
   ====================================================== */

// Real-time listener'ları kur
function setupRealtimeListeners() {
    console.log('Real-time listenerlar kuruluyor...');
    
    // Products real-time listener
    const productsChannel = supabase
        .channel('products-changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'products' },
            handleProductsChange
        )
        .subscribe();
    
    realtimeChannels.push(productsChannel);
    
    // Sales real-time listener
    const salesChannel = supabase
        .channel('sales-changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'sales' },
            handleSalesChange
        )
        .subscribe();
    
    realtimeChannels.push(salesChannel);
    
    // Cash register real-time listener
    const cashChannel = supabase
        .channel('cash-register-changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'cash_register' },
            handleCashRegisterChange
        )
        .subscribe();
    
    realtimeChannels.push(cashChannel);
    
    console.log('Real-time listenerlar başarıyla kuruldu');
}

// Real-time listener'ları kaldır
function teardownRealtimeListeners() {
    console.log('Real-time listenerlar kaldırılıyor...');
    
    realtimeChannels.forEach(channel => {
        supabase.removeChannel(channel);
    });
    
    realtimeChannels = [];
    console.log('Real-time listenerlar başarıyla kaldırıldı');
}

// Products değişiklik handler'ı
function handleProductsChange(payload) {
    console.log('Products real-time değişiklik:', payload);
    
    // Debounce mekanizması
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const changedProduct = mapDBProductToJS(payload.new);
            const existingIndex = products.findIndex(p => p.barcode === changedProduct.barcode);
            
            if (existingIndex !== -1) {
                products[existingIndex] = changedProduct;
            } else {
                products.push(changedProduct);
            }
        } else if (payload.eventType === 'DELETE') {
            products = products.filter(p => p.barcode !== payload.old.barcode);
        }
        
        // UI'ı güncelle
        refreshAffectedUI();
        
    }, 100);
}

// Sales değişiklik handler'ı
function handleSalesChange(payload) {
    console.log('Sales real-time değişiklik:', payload);
    
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const changedSale = mapDBSaleToJS(payload.new);
            const existingIndex = salesHistory.findIndex(s => s.id === changedSale.id);
            
            if (existingIndex !== -1) {
                salesHistory[existingIndex] = changedSale;
            } else {
                salesHistory.push(changedSale);
            }
        } else if (payload.eventType === 'DELETE') {
            salesHistory = salesHistory.filter(s => s.id !== payload.old.id);
        }
        
        // UI'ı güncelle
        refreshAffectedUI();
        
    }, 100);
}

// Cash register değişiklik handler'ı
function handleCashRegisterChange(payload) {
    console.log('Cash register real-time değişiklik:', payload);
    
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            cashRegister = mapDBCashRegisterToJS(payload.new);
        }
        
        // UI'ı güncelle
        refreshAffectedUI();
        
    }, 100);
}

// Etkilenen UI bileşenlerini yenile
function refreshAffectedUI() {
    const activeTab = document.querySelector('.tab-content.active');
    if (!activeTab) return;
    
    const activeTabId = activeTab.id;
    
    switch (activeTabId) {
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
            loadProductGrid();
            break;
        case 'reports':
            loadReports('today');
            break;
        case 'cash':
            loadCashStatus();
            break;
    }
    
    console.log('UI real-time değişikliklerle güncellendi');
}

/* ======================================================
   SAYFA YENİLEME/KAPATMA KONTROLLERİ
   ====================================================== */

// Sayfa kapanırken veya yenilenirken verileri kaydet
window.addEventListener('beforeunload', function(e) {
    if (appInitialized) {
        // Sayfa kapanırken/kaydedilirken verileri kaydet
        const saveData = async () => {
            try {
                await saveToSupabase();
                console.log('Sayfa kapanmadan önce veriler kaydedildi');
            } catch (error) {
                console.error('Sayfa kapanırken kayıt hatası:', error);
            }
        };
        
        // Async işlemi beklemek için event'i önle
        e.preventDefault();
        e.returnValue = '';
        
        // Kaydetme işlemini başlat
        saveData();
    }
});

// Online/offline durum takibi
window.addEventListener('online', function() {
    showStatus('İnternet bağlantısı sağlandı', 'success');
    // Bağlantı sağlandığında verileri senkronize et
    if (appInitialized) {
        setTimeout(async () => {
            try {
                await saveToSupabase();
                console.log('Online olduktan sonra veriler senkronize edildi');
            } catch (error) {
                console.error('Online senkronizasyon hatası:', error);
            }
        }, 1000);
    }
});

window.addEventListener('offline', function() {
    showStatus('İnternet bağlantısı kesildi - Çevrimdışı mod', 'warning');
});

// Hata yönetimi
window.addEventListener('error', function(e) {
    console.error('Global hata:', e.error);
    showStatus('Bir hata oluştu, sayfayı yenilemeyi deneyin', 'error');
});

// Promise rejection handler
window.addEventListener('unhandledrejection', function(e) {
    console.error('İşlenmemiş promise hatası:', e.reason);
    showStatus('Beklenmeyen bir hata oluştu', 'error');
    e.preventDefault();
});

console.log('Tekel POS uygulaması yüklendi ve hazır!');
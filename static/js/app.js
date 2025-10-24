// app.js - Tekel POS Uygulaması (Tam Sürüm - SUPABASE Entegre)

// SUPABASE konfigürasyonu
const SUPABASE_URL = 'https://mqkjserlvdfddjutcoqr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xa2pzZXJsdmRmZGRqdXRjb3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTI1NjEsImV4cCI6MjA3NTcyODU2MX0.L_cOpIZQkkqAd0U1plpX5qrFPFoOdasxVtRScSTQ6a8';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global değişkenler
let currentUser = null;
let products = [];
let cart = [];
let salesHistory = [];
let users = [];
let auditLogs = [];
let cashRegister = {
    isOpen: false,
    openingBalance: 0,
    currentBalance: 0,
    cashSales: 0,
    cardSales: 0
};

// DOM yüklendiğinde çalışacak fonksiyonlar
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM yüklendi, uygulama başlatılıyor...');
    setupEventListeners();
    checkAuthentication();
    getLocalIP();
});

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
    }
    
    // Ürün arama input'u
    const productSearch = document.getElementById('productSearch');
    if (productSearch) {
        productSearch.addEventListener('input', filterProducts);
    }
    
    // Navigation click events
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
    
    // Ödeme yöntemi değişikliği
    const paymentMethods = document.querySelectorAll('input[name="paymentMethod"]');
    paymentMethods.forEach(method => {
        method.addEventListener('change', toggleCashInput);
    });
    
    // Nakit miktarı input'u
    const cashAmountInput = document.getElementById('cashAmount');
    if (cashAmountInput) {
        cashAmountInput.addEventListener('input', calculateChange);
    }
    
    // Modal butonları
    setupModalEventListeners();
    
    console.log('Event listenerlar başarıyla kuruldu');
}

// Modal event listener'larını kur
function setupModalEventListeners() {
    // Kasa açma
    const confirmOpenCashBtn = document.getElementById('confirmOpenCash');
    if (confirmOpenCashBtn) {
        confirmOpenCashBtn.addEventListener('click', openCash);
    }
    
    // Kasa kapatma
    const confirmCloseCashBtn = document.getElementById('confirmCloseCash');
    if (confirmCloseCashBtn) {
        confirmCloseCashBtn.addEventListener('click', closeCash);
    }
    
    // Kasa farkı hesaplama
    const closingBalanceInput = document.getElementById('closingBalanceInput');
    if (closingBalanceInput) {
        closingBalanceInput.addEventListener('input', calculateCashDifference);
    }
    
    // Ürün ekleme
    const addProductForm = document.getElementById('addProductForm');
    if (addProductForm) {
        addProductForm.addEventListener('submit', addNewProduct);
    }
    
    // Modal kapatma butonları
    const modalCloseBtns = document.querySelectorAll('.modal-close, .btn-cancel');
    modalCloseBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                closeModal(modal.id);
            }
        });
    });
}

// Kimlik doğrulama kontrolü
function checkAuthentication() {
    console.log('Kimlik doğrulama kontrol ediliyor...');
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        console.log('Kullanıcı bulundu:', currentUser.username);
        initializeApp();
        showApp();
    } else {
        console.log('Kullanıcı bulunamadı, login ekranı gösteriliyor.');
        showLogin();
    }
}

// Login işlemi
async function handleLogin(event) {
    if (event) event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    console.log('Login denemesi:', username);
    
    // Basit authentication
    if (username === 'admin' && password === 'admin123') {
        currentUser = {
            username: username,
            role: 'admin',
            fullName: 'Sistem Yöneticisi'
        };
    } else if (username && password) {
        currentUser = {
            username: username,
            role: 'user',
            fullName: 'Kasiyer'
        };
    } else {
        showStatus('Kullanıcı adı ve şifre gerekli!', 'error');
        return;
    }
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    console.log('Login başarılı');
    
    await initializeApp();
    showApp();
    showStatus('Başarıyla giriş yapıldı!', 'success');
}

// Uygulama başlatma
async function initializeApp() {
    console.log('Uygulama başlatılıyor...');
    
    try {
        await loadFromSupabase();
        console.log('Uygulama başlatma tamamlandı');
    } catch (error) {
        console.error('Uygulama başlatma hatası:', error);
        showStatus('Uygulama başlatılırken hata oluştu!', 'error');
    }
}

// Login ekranını göster
function showLogin() {
    const loginModal = document.getElementById('loginModal');
    const appContainer = document.querySelector('.app-container');
    
    if (loginModal) loginModal.style.display = 'block';
    if (appContainer) appContainer.style.display = 'none';
}

// Uygulama ekranını göster
function showApp() {
    const loginModal = document.getElementById('loginModal');
    const appContainer = document.querySelector('.app-container');
    
    if (loginModal) loginModal.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    
    // Kullanıcı bilgilerini güncelle
    const currentUserElement = document.getElementById('currentUser');
    const currentRoleElement = document.getElementById('currentRole');
    
    if (currentUserElement) currentUserElement.textContent = currentUser.fullName;
    if (currentRoleElement) currentRoleElement.textContent = currentUser.role === 'admin' ? 'Yönetici' : 'Kasiyer';
    
    // İlk sekme olarak dashboard'u göster
    switchTab('dashboard');
}

// Çıkış yap
function logout() {
    console.log('Çıkış yapılıyor...');
    currentUser = null;
    localStorage.removeItem('currentUser');
    cart = [];
    showLogin();
    showStatus('Çıkış yapıldı.', 'info');
}

// Sekme değiştirme
function switchTab(tabName) {
    console.log('Sekme değiştiriliyor:', tabName);
    
    // Tüm tab içeriklerini gizle
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Tüm nav item'ları pasif yap
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
    });
    
    // Aktif tab'ı göster
    const activeTab = document.getElementById(tabName);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    // Aktif nav item'ı işaretle
    const activeNavItem = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
    
    // Breadcrumb'ı güncelle
    updateBreadcrumb(tabName);
    
    // Sekmeye özel içerik yükle
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
            loadProductGrid();
            const barcodeInput = document.getElementById('barcodeInput');
            if (barcodeInput) barcodeInput.focus();
            break;
        case 'reports':
            loadReports('today');
            break;
        case 'cash':
            loadCashStatus();
            break;
        case 'admin':
            loadAdminData();
            break;
    }
}

// Breadcrumb güncelleme
function updateBreadcrumb(tabName) {
    const breadcrumb = document.getElementById('breadcrumb');
    const tabNames = {
        'dashboard': 'Dashboard',
        'sales': 'Satış Yap',
        'products': 'Ürünler',
        'inventory': 'Stok Yönetimi',
        'reports': 'Raporlar',
        'cash': 'Kasa',
        'admin': 'Yönetim'
    };
    
    if (breadcrumb) {
        breadcrumb.textContent = tabNames[tabName] || 'Dashboard';
    }
}

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
            products = productsData.map(row => ({
                barcode: row.barcode,
                name: row.name,
                price: Number(row.price) || 0,
                stock: Number(row.stock) || 0,
                minStock: Number(row.min_stock) || 0,
                kdv: Number(row.kdv) || 0,
                otv: Number(row.otv) || 0
            }));
            console.log('Products yüklendi:', products.length);
        }

        // Sales
        const { data: salesData, error: salesError } = await supabase
            .from('sales')
            .select('*')
            .order('timestamp', { ascending: false });

        if (salesError) {
            console.error('Sales yüklenirken hata:', salesError);
        } else if (salesData) {
            salesHistory = salesData.map(row => ({
                id: row.id,
                timestamp: row.timestamp,
                items: row.items || [],
                totalAmount: Number(row.total_amount) || 0,
                paymentMethod: row.payment_method || 'nakit',
                cashAmount: Number(row.cash_amount) || 0,
                change: Number(row.change_amount) || 0,
                user: row.user_name || 'unknown'
            }));
            console.log('Sales yüklendi:', salesHistory.length);
        }

        // Cash register
        const { data: cashData, error: cashError } = await supabase
            .from('cash_register')
            .select('*')
            .limit(1);

        if (cashError) {
            console.error('Cash register yüklenirken hata:', cashError);
        } else if (cashData && cashData.length > 0) {
            const cash = cashData[0];
            cashRegister = {
                isOpen: !!cash.is_open,
                openingBalance: Number(cash.opening_balance) || 0,
                currentBalance: Number(cash.current_balance) || 0,
                cashSales: Number(cash.cash_sales) || 0,
                cardSales: Number(cash.card_sales) || 0
            };
            console.log('Cash register yüklendi');
        }

        // Users
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('*');

        if (usersError) {
            console.error('Users yüklenirken hata:', usersError);
        } else if (usersData) {
            users = usersData.map(row => ({
                username: row.username,
                fullName: row.full_name,
                role: row.role,
                lastLogin: row.last_login
            }));
            console.log('Users yüklendi:', users.length);
        }

        // Audit logs
        const { data: auditData, error: auditError } = await supabase
            .from('audit_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(100);

        if (auditError) {
            console.error('Audit logs yüklenirken hata:', auditError);
        } else if (auditData) {
            auditLogs = auditData.map(row => ({
                timestamp: row.timestamp,
                user: row.user_name,
                action: row.action,
                description: row.description,
                ipAddress: row.ip_address
            }));
            console.log('Audit logs yüklendi:', auditLogs.length);
        }

    } catch (error) {
        console.error('SUPABASE yükleme hatası:', error);
        throw error;
    }
}

// SUPABASE'e kaydet
async function saveToSupabase() {
    try {
        console.log('Supabase verileri kaydediliyor...');

        // Products'ı güncelle
        const formattedProducts = products.map(p => ({
            barcode: p.barcode,
            name: p.name,
            price: p.price,
            stock: p.stock,
            min_stock: p.minStock,
            kdv: p.kdv,
            otv: p.otv
        }));

        if (formattedProducts.length > 0) {
            const { error: productsError } = await supabase
                .from('products')
                .upsert(formattedProducts, { onConflict: 'barcode' });

            if (productsError) throw productsError;
        }

        // Sales'ı güncelle
        const recentSales = salesHistory.slice(-100);
        if (recentSales.length > 0) {
            const formattedSales = recentSales.map(s => ({
                id: s.id,
                timestamp: s.timestamp,
                items: s.items,
                total_amount: s.totalAmount,
                payment_method: s.paymentMethod,
                cash_amount: s.cashAmount,
                change_amount: s.change,
                user_name: s.user
            }));

            const { error: salesError } = await supabase
                .from('sales')
                .upsert(formattedSales, { onConflict: 'id' });

            if (salesError) throw salesError;
        }

        // Cash register'ı güncelle
        const formattedCash = {
            is_open: cashRegister.isOpen,
            opening_balance: cashRegister.openingBalance,
            current_balance: cashRegister.currentBalance,
            cash_sales: cashRegister.cashSales,
            card_sales: cashRegister.cardSales
        };

        const { error: cashError } = await supabase
            .from('cash_register')
            .upsert([formattedCash], { onConflict: 'id' });

        if (cashError) throw cashError;

        console.log('Supabase verileri başarıyla kaydedildi');
    } catch (error) {
        console.error('SUPABASE kayıt hatası:', error);
        throw error;
    }
}

// Dashboard'u yenile
function refreshDashboard() {
    console.log('Dashboard yenileniyor...');
    
    const todaySales = calculateTodaySales();
    const totalProducts = products.length;
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;
    
    const todaySalesElement = document.getElementById('todaySales');
    const totalProductsElement = document.getElementById('totalProducts');
    const lowStockCountElement = document.getElementById('lowStockCount');
    const outOfStockCountElement = document.getElementById('outOfStockCount');
    
    if (todaySalesElement) todaySalesElement.textContent = todaySales.toFixed(2) + ' TL';
    if (totalProductsElement) totalProductsElement.textContent = totalProducts;
    if (lowStockCountElement) lowStockCountElement.textContent = lowStockCount;
    if (outOfStockCountElement) outOfStockCountElement.textContent = outOfStockCount;
    
    loadRecentSales();
    loadStockAlerts();
}

// Bugünkü satışları hesapla
function calculateTodaySales() {
    const today = new Date().toDateString();
    return salesHistory
        .filter(sale => new Date(sale.timestamp).toDateString() === today)
        .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
}

// Son satışları yükle
function loadRecentSales() {
    const recentSalesContainer = document.getElementById('recentSales');
    if (!recentSalesContainer) return;
    
    const recentSales = salesHistory.slice(-5).reverse();
    
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
                    <button class="btn-small" onclick="quickAddStock('${product.barcode}')">
                        Stok Ekle
                    </button>
                </div>
            `;
        });
        alertsContainer.innerHTML = alertsHTML;
    }
}

// Hızlı stok ekle
function quickAddStock(barcode) {
    const quantity = prompt('Eklenecek miktarı girin:', '10');
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
        refreshDashboard();
        loadInventory();
        showStatus(`${product.name} stoğuna ${quantity} adet eklendi!`, 'success');
    }
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
                <div class="product-card" onclick="addToCartFromGrid('${product.barcode}')">
                    <div class="product-info">
                        <h4>${product.name}</h4>
                        <div class="product-details">
                            <span class="product-price">${product.price.toFixed(2)} TL</span>
                            <span class="product-stock">Stok: ${product.stock}</span>
                        </div>
                        <div class="product-barcode">${product.barcode}</div>
                    </div>
                    <button class="btn-primary btn-small">
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
    const searchTerm = searchInput.value.toLowerCase().trim();
    const productCards = document.querySelectorAll('.product-card');
    
    let hasVisibleProducts = false;
    
    productCards.forEach(card => {
        const productName = card.querySelector('h4').textContent.toLowerCase();
        const productBarcode = card.querySelector('.product-barcode').textContent;
        const matchesSearch = productName.includes(searchTerm) || productBarcode.includes(searchTerm);
        
        if (matchesSearch) {
            card.style.display = 'flex';
            hasVisibleProducts = true;
        } else {
            card.style.display = 'none';
        }
    });
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
            quantity: 1
        });
    }
    
    updateCartDisplay();
    showStatus(`${product.name} sepete eklendi!`, 'success');
}

// Sepet görünümünü güncelle
function updateCartDisplay() {
    const cartItemsContainer = document.getElementById('cartItems');
    const cartCount = document.getElementById('cartCount');
    const subtotalElement = document.getElementById('subtotal');
    const totalAmountElement = document.getElementById('totalAmount');
    
    // Sepet sayısını güncelle
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) cartCount.textContent = totalItems;
    
    if (!cartItemsContainer) return;
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <p>Sepet boş</p>
            </div>
        `;
        
        if (subtotalElement) subtotalElement.textContent = '0.00 TL';
        if (totalAmountElement) totalAmountElement.textContent = '0.00 TL';
        return;
    }
    
    let cartHTML = '';
    let subtotal = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        
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
    
    const total = subtotal; // Basit hesaplama - KDV eklenebilir
    
    cartItemsContainer.innerHTML = cartHTML;
    if (subtotalElement) subtotalElement.textContent = subtotal.toFixed(2) + ' TL';
    if (totalAmountElement) totalAmountElement.textContent = total.toFixed(2) + ' TL';
    
    calculateChange();
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

// Nakit input görünümünü değiştir
function toggleCashInput() {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashInputSection = document.getElementById('cashInputSection');
    
    if (cashInputSection) {
        cashInputSection.style.display = paymentMethod === 'nakit' ? 'block' : 'none';
    }
    
    calculateChange();
}

// Para üstü hesapla
function calculateChange() {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const totalAmount = parseFloat(document.getElementById('totalAmount').textContent.replace(' TL', '')) || 0;
    const changeDisplay = document.getElementById('changeDisplay');
    
    if (!changeDisplay) return;
    
    if (paymentMethod === 'nakit' && cashAmount >= totalAmount) {
        const change = cashAmount - totalAmount;
        changeDisplay.innerHTML = `Para Üstü: <span>${change.toFixed(2)} TL</span>`;
    } else {
        changeDisplay.innerHTML = `Para Üstü: <span>0.00 TL</span>`;
    }
}

// Satışı tamamla
async function completeSale() {
    if (cart.length === 0) {
        showStatus('Sepet boş!', 'error');
        return;
    }
    
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const totalAmount = parseFloat(document.getElementById('totalAmount').textContent.replace(' TL', '')) || 0;
    
    if (paymentMethod === 'nakit' && cashAmount < totalAmount) {
        showStatus('Verilen para yetersiz!', 'error');
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
            id: Date.now(),
            timestamp: new Date().toISOString(),
            items: JSON.parse(JSON.stringify(cart)),
            totalAmount: totalAmount,
            paymentMethod: paymentMethod,
            cashAmount: cashAmount,
            change: paymentMethod === 'nakit' ? (cashAmount - totalAmount) : 0,
            user: currentUser.username
        };
        
        salesHistory.push(saleRecord);
        
        // Kasa kaydını güncelle
        if (cashRegister.isOpen) {
            if (paymentMethod === 'nakit') {
                cashRegister.cashSales += totalAmount;
                cashRegister.currentBalance = cashRegister.openingBalance + cashRegister.cashSales;
            } else {
                cashRegister.cardSales += totalAmount;
            }
        }
        
        // Fiş oluştur ve göster
        const receipt = generateReceipt(saleRecord);
        showReceipt(receipt);
        
        // Sepeti temizle
        cart = [];
        updateCartDisplay();
        
        // Formu sıfırla
        document.getElementById('cashAmount').value = '';
        document.querySelector('input[name="paymentMethod"][value="nakit"]').checked = true;
        toggleCashInput();
        
        // SUPABASE'e kaydet
        await saveToSupabase();
        
        // Dashboard'u yenile
        refreshDashboard();
        
        showStatus('Satış başarıyla tamamlandı!', 'success');
        
    } catch (error) {
        console.error('Satış tamamlama hatası:', error);
        showStatus('Satış tamamlanırken hata oluştu!', 'error');
    }
}

// Fiş oluştur
function generateReceipt(sale) {
    return `
        <div class="receipt">
            <div class="receipt-header">
                <h3>TEKEL MARKET</h3>
                <p>POS Sistemi</p>
            </div>
            <div class="receipt-info">
                <p>Fiş No: ${sale.id}</p>
                <p>Tarih: ${new Date(sale.timestamp).toLocaleString('tr-TR')}</p>
                <p>Kasiyer: ${sale.user}</p>
            </div>
            <div class="receipt-items">
                <table>
                    ${sale.items.map(item => `
                        <tr>
                            <td>${item.name} x${item.quantity}</td>
                            <td>${(item.price * item.quantity).toFixed(2)} TL</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            <div class="receipt-totals">
                <p><strong>Toplam: ${sale.totalAmount.toFixed(2)} TL</strong></p>
                <p>Ödeme: ${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}</p>
                ${sale.paymentMethod === 'nakit' ? `
                    <p>Verilen: ${sale.cashAmount.toFixed(2)} TL</p>
                    <p>Para Üstü: ${sale.change.toFixed(2)} TL</p>
                ` : ''}
            </div>
            <div class="receipt-footer">
                <p>Teşekkür Ederiz!</p>
            </div>
        </div>
    `;
}

// Fiş göster
function showReceipt(receiptHTML) {
    const receiptContent = document.getElementById('receiptContent');
    if (receiptContent) {
        receiptContent.innerHTML = receiptHTML;
    }
    openModal('receiptModal');
}

// Fiş yazdır
function printReceipt() {
    const receiptContent = document.getElementById('receiptContent').innerHTML;
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
                .receipt-header h3 { margin: 0; font-size: 18px; }
                .receipt-info p { margin: 2px 0; font-size: 12px; }
                .receipt-items table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                .receipt-items td { padding: 2px 0; border-bottom: 1px dashed #ccc; font-size: 12px; }
                .receipt-totals { border-top: 2px solid #000; padding-top: 10px; margin-top: 10px; }
                .receipt-totals p { margin: 3px 0; font-size: 12px; }
                .receipt-footer { text-align: center; margin-top: 15px; font-style: italic; font-size: 12px; }
                @media print {
                    body { margin: 0; padding: 10px; }
                    .receipt { width: 80mm !important; }
                }
            </style>
        </head>
        <body onload="window.print(); setTimeout(() => window.close(), 500);">
            ${receiptContent}
        </body>
        </html>
    `);
    printWindow.document.close();
}

/* ======================================================
   ÜRÜN YÖNETİMİ
   ====================================================== */

// Ürünleri yükle
function loadProducts() {
    const productsTableBody = document.getElementById('productsTableBody');
    if (!productsTableBody) return;
    
    if (products.length === 0) {
        productsTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
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
                <td>${product.kdv}%</td>
                <td><span class="status-badge ${status.class}">${status.text}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-primary" onclick="editProduct('${product.barcode}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteProduct('${product.barcode}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    productsTableBody.innerHTML = tableHTML;
}

// Stok durumu belirle
function getStockStatus(product) {
    if (product.stock === 0) {
        return { class: 'danger', text: 'Stokta Yok' };
    } else if (product.stock <= product.minStock) {
        return { class: 'warning', text: 'Az Stok' };
    } else {
        return { class: 'success', text: 'Stokta Var' };
    }
}

// Ürün düzenle
function editProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    // Modal formunu doldur
    document.getElementById('editProductBarcode').value = product.barcode;
    document.getElementById('editProductName').value = product.name;
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductStock').value = product.stock;
    document.getElementById('editProductMinStock').value = product.minStock;
    document.getElementById('editProductKDV').value = product.kdv;
    document.getElementById('editProductOTV').value = product.otv;
    
    document.getElementById('editProductModal').setAttribute('data-barcode', barcode);
    openModal('editProductModal');
}

// Ürün güncelle
async function updateProduct() {
    const barcode = document.getElementById('editProductModal').getAttribute('data-barcode');
    const product = products.find(p => p.barcode === barcode);
    
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    const updatedProduct = {
        barcode: document.getElementById('editProductBarcode').value,
        name: document.getElementById('editProductName').value,
        price: parseFloat(document.getElementById('editProductPrice').value),
        stock: parseInt(document.getElementById('editProductStock').value),
        minStock: parseInt(document.getElementById('editProductMinStock').value),
        kdv: parseFloat(document.getElementById('editProductKDV').value),
        otv: parseFloat(document.getElementById('editProductOTV').value)
    };
    
    const index = products.findIndex(p => p.barcode === barcode);
    if (index !== -1) {
        products[index] = updatedProduct;
    }
    
    try {
        await saveToSupabase();
        closeModal('editProductModal');
        loadProducts();
        loadInventory();
        refreshDashboard();
        showStatus('Ürün başarıyla güncellendi!', 'success');
    } catch (error) {
        console.error('Ürün güncelleme hatası:', error);
        showStatus('Ürün güncellenirken hata oluştu!', 'error');
    }
}

// Ürün sil
async function deleteProduct(barcode) {
    if (!confirm('Bu ürünü silmek istediğinizden emin misiniz?')) {
        return;
    }
    
    products = products.filter(p => p.barcode !== barcode);
    
    try {
        await saveToSupabase();
        loadProducts();
        loadInventory();
        refreshDashboard();
        showStatus('Ürün başarıyla silindi!', 'success');
    } catch (error) {
        console.error('Ürün silme hatası:', error);
        showStatus('Ürün silinirken hata oluştu!', 'error');
    }
}

// Yeni ürün modal'ını aç
function openAddProductModal() {
    document.getElementById('addProductForm').reset();
    openModal('addProductModal');
}

// Yeni ürün ekle
async function addNewProduct(event) {
    if (event) event.preventDefault();
    
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
    
    try {
        await saveToSupabase();
        closeModal('addProductModal');
        loadProducts();
        loadInventory();
        refreshDashboard();
        showStatus('Ürün başarıyla eklendi!', 'success');
    } catch (error) {
        console.error('Ürün ekleme hatası:', error);
        showStatus('Ürün eklenirken hata oluştu!', 'error');
    }
}

/* ======================================================
   STOK YÖNETİMİ
   ====================================================== */

// Stok yönetimini yükle
function loadInventory() {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    if (!inventoryTableBody) return;
    
    // İstatistikleri güncelle
    updateInventoryStats();
    
    if (products.length === 0) {
        inventoryTableBody.innerHTML = `
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
    
    inventoryTableBody.innerHTML = tableHTML;
}

// Stok istatistiklerini güncelle
function updateInventoryStats() {
    const totalProducts = products.length;
    const inStock = products.filter(p => p.stock > p.minStock).length;
    const lowStock = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    const outOfStock = products.filter(p => p.stock === 0).length;
    
    const statTotalProducts = document.getElementById('statTotalProducts');
    const statInStock = document.getElementById('statInStock');
    const statLowStock = document.getElementById('statLowStock');
    const statOutOfStock = document.getElementById('statOutOfStock');
    
    if (statTotalProducts) statTotalProducts.textContent = totalProducts;
    if (statInStock) statInStock.textContent = inStock;
    if (statLowStock) statLowStock.textContent = lowStock;
    if (statOutOfStock) statOutOfStock.textContent = outOfStock;
}

/* ======================================================
   RAPORLAR
   ====================================================== */

// Raporları yükle
function loadReports(period = 'today') {
    console.log('Raporlar yükleniyor:', period);
    
    // Aktif butonu güncelle
    document.querySelectorAll('.btn-period').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`[data-period="${period}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const filteredSales = filterSalesByPeriod(period);
    const stats = calculateSalesStats(filteredSales);
    
    updateReportSummary(stats);
    updateSalesReport(filteredSales);
    updateTopProducts(filteredSales);
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
        case 'all':
        default:
            startDate = new Date(0);
    }
    
    return salesHistory.filter(sale => new Date(sale.timestamp) >= startDate);
}

// Satış istatistiklerini hesapla
function calculateSalesStats(sales) {
    let totalSales = 0;
    let cashSales = 0;
    let cardSales = 0;
    let totalItems = 0;
    
    sales.forEach(sale => {
        totalSales += sale.totalAmount || 0;
        if (sale.paymentMethod === 'nakit') {
            cashSales += sale.totalAmount || 0;
        } else {
            cardSales += sale.totalAmount || 0;
        }
        
        // Toplam satılan ürün sayısını hesapla
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                totalItems += item.quantity || 0;
            });
        }
    });
    
    return {
        totalSales,
        cashSales,
        cardSales,
        totalTransactions: sales.length,
        totalItems,
        avgBasket: sales.length > 0 ? totalSales / sales.length : 0
    };
}

// Rapor özetini güncelle
function updateReportSummary(stats) {
    const dailyStats = document.getElementById('dailyStats');
    if (!dailyStats) return;
    
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
            <span>Satılan Ürün:</span>
            <span>${stats.totalItems}</span>
        </div>
        <div class="daily-stat-item">
            <span>Ort. Sepet Tutarı:</span>
            <span>${stats.avgBasket.toFixed(2)} TL</span>
        </div>
    `;
}

// En çok satan ürünleri güncelle
function updateTopProducts(sales) {
    const topProductsContainer = document.getElementById('topProducts');
    if (!topProductsContainer) return;
    
    // Ürün satış istatistiklerini hesapla
    const productStats = {};
    
    sales.forEach(sale => {
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                if (!productStats[item.barcode]) {
                    productStats[item.barcode] = {
                        name: item.name,
                        quantity: 0,
                        revenue: 0
                    };
                }
                productStats[item.barcode].quantity += item.quantity || 0;
                productStats[item.barcode].revenue += (item.price || 0) * (item.quantity || 0);
            });
        }
    });
    
    // En çok satanları sırala
    const topProducts = Object.values(productStats)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);
    
    if (topProducts.length === 0) {
        topProductsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-trophy"></i>
                <p>Satış verisi yok</p>
            </div>
        `;
        return;
    }
    
    let topProductsHTML = '';
    topProducts.forEach((product, index) => {
        topProductsHTML += `
            <div class="top-product-item">
                <div class="product-rank">${index + 1}</div>
                <div class="product-info">
                    <strong>${product.name}</strong>
                    <span>${product.quantity} adet - ${product.revenue.toFixed(2)} TL</span>
                </div>
            </div>
        `;
    });
    
    topProductsContainer.innerHTML = topProductsHTML;
}

// Satış raporunu güncelle
function updateSalesReport(sales) {
    const salesReportBody = document.getElementById('salesReportBody');
    if (!salesReportBody) return;
    
    if (sales.length === 0) {
        salesReportBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-receipt"></i>
                    <p>Bu dönemde satış bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let salesHTML = '';
    sales.forEach(sale => {
        const saleDate = new Date(sale.timestamp).toLocaleString('tr-TR');
        salesHTML += `
            <tr>
                <td>${sale.id}</td>
                <td>${saleDate}</td>
                <td>${sale.user}</td>
                <td>${(sale.totalAmount || 0).toFixed(2)} TL</td>
                <td>${sale.paymentMethod === 'nakit' ? 'Nakit' : 'Kart'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-info" onclick="viewSaleDetails(${sale.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-small btn-warning" onclick="editSale(${sale.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteSale(${sale.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    salesReportBody.innerHTML = salesHTML;
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

// Satış düzenle
function editSale(saleId) {
    const sale = salesHistory.find(s => s.id === saleId);
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    document.getElementById('editSaleTotal').value = sale.totalAmount;
    document.getElementById('editPaymentMethod').value = sale.paymentMethod;
    document.getElementById('editCashAmount').value = sale.cashAmount;
    document.getElementById('editCardAmount').value = sale.paymentMethod === 'kredi' ? sale.totalAmount : 0;
    document.getElementById('editChangeAmount').value = sale.change;

    document.getElementById('saleEditModal').setAttribute('data-sale-id', saleId);
    openModal('saleEditModal');
}

// Satış güncelle
async function updateSale() {
    const saleId = document.getElementById('saleEditModal').getAttribute('data-sale-id');
    const sale = salesHistory.find(s => s.id === parseInt(saleId));
    
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    const updatedSale = {
        totalAmount: parseFloat(document.getElementById('editSaleTotal').value),
        paymentMethod: document.getElementById('editPaymentMethod').value,
        cashAmount: parseFloat(document.getElementById('editCashAmount').value),
        change: parseFloat(document.getElementById('editChangeAmount').value)
    };

    // Satışı güncelle
    const index = salesHistory.findIndex(s => s.id === parseInt(saleId));
    if (index !== -1) {
        salesHistory[index] = { ...salesHistory[index], ...updatedSale };
    }

    try {
        await saveToSupabase();
        closeModal('saleEditModal');
        loadReports();
        showStatus('Satış başarıyla güncellendi!', 'success');
    } catch (error) {
        console.error('Satış güncelleme hatası:', error);
        showStatus('Satış güncellenirken hata oluştu!', 'error');
    }
}

// Satış sil
function deleteSale(saleId) {
    const sale = salesHistory.find(s => s.id === saleId);
    if (!sale) {
        showStatus('Satış bulunamadı!', 'error');
        return;
    }

    // Silinecek satış bilgilerini göster
    const saleInfo = document.getElementById('saleDeleteInfo');
    saleInfo.innerHTML = `
        <div class="sale-info-item">
            <span>Fiş No:</span>
            <span>${sale.id}</span>
        </div>
        <div class="sale-info-item">
            <span>Tarih:</span>
            <span>${new Date(sale.timestamp).toLocaleString('tr-TR')}</span>
        </div>
        <div class="sale-info-item">
            <span>Toplam Tutar:</span>
            <span>${sale.totalAmount.toFixed(2)} TL</span>
        </div>
    `;

    document.getElementById('saleDeleteModal').setAttribute('data-sale-id', saleId);
    openModal('saleDeleteModal');
}

// Satış silmeyi onayla
async function confirmDeleteSale() {
    const saleId = document.getElementById('saleDeleteModal').getAttribute('data-sale-id');
    const sale = salesHistory.find(s => s.id === parseInt(saleId));
    
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

        // Satışı sil
        salesHistory = salesHistory.filter(s => s.id !== parseInt(saleId));

        await saveToSupabase();
        closeModal('saleDeleteModal');
        loadReports();
        refreshDashboard();
        showStatus('Satış başarıyla silindi!', 'success');
    } catch (error) {
        console.error('Satış silme hatası:', error);
        showStatus('Satış silinirken hata oluştu!', 'error');
    }
}

/* ======================================================
   KASA İŞLEMLERİ
   ====================================================== */

// Kasa durumunu yükle
function loadCashStatus() {
    updateCashDisplay();
    
    const openingBalanceElement = document.getElementById('openingBalance');
    const totalSalesAmountElement = document.getElementById('totalSalesAmount');
    const cashSalesAmountElement = document.getElementById('cashSalesAmount');
    const cardSalesAmountElement = document.getElementById('cardSalesAmount');
    const expectedCashElement = document.getElementById('expectedCash');
    
    if (openingBalanceElement) openingBalanceElement.textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    if (totalSalesAmountElement) totalSalesAmountElement.textContent = (cashRegister.cashSales + cashRegister.cardSales).toFixed(2) + ' TL';
    if (cashSalesAmountElement) cashSalesAmountElement.textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    if (cardSalesAmountElement) cardSalesAmountElement.textContent = cashRegister.cardSales.toFixed(2) + ' TL';
    if (expectedCashElement) expectedCashElement.textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
}

// Kasa görünümünü güncelle
function updateCashDisplay() {
    const cashStatusBadge = document.getElementById('cashStatusBadge');
    const currentCashAmount = document.getElementById('currentCashAmount');
    const openCashBtn = document.getElementById('openCashBtn');
    const closeCashBtn = document.getElementById('closeCashBtn');
    const cashStatusIcon = document.getElementById('cashStatusIcon');
    const cashStatusText = document.getElementById('cashStatusText');
    
    if (cashRegister.isOpen) {
        if (cashStatusBadge) { 
            cashStatusBadge.textContent = 'Açık'; 
            cashStatusBadge.className = 'status-badge success'; 
        }
        if (currentCashAmount) currentCashAmount.textContent = cashRegister.currentBalance.toFixed(2) + ' TL';
        if (openCashBtn) openCashBtn.style.display = 'none';
        if (closeCashBtn) closeCashBtn.style.display = 'block';
        if (cashStatusIcon) cashStatusIcon.className = 'fas fa-lock-open';
        if (cashStatusText) cashStatusText.textContent = 'Açık';
    } else {
        if (cashStatusBadge) { 
            cashStatusBadge.textContent = 'Kapalı'; 
            cashStatusBadge.className = 'status-badge danger'; 
        }
        if (currentCashAmount) currentCashAmount.textContent = '0.00 TL';
        if (openCashBtn) openCashBtn.style.display = 'block';
        if (closeCashBtn) closeCashBtn.style.display = 'none';
        if (cashStatusIcon) cashStatusIcon.className = 'fas fa-lock';
        if (cashStatusText) cashStatusText.textContent = 'Kapalı';
    }
}

// Kasa açma modal'ını aç
function openCashRegisterModal() {
    if (cashRegister.isOpen) {
        showStatus('Kasa zaten açık!', 'warning');
        return;
    }
    document.getElementById('openingBalanceInput').value = '';
    openModal('cashOpenModal');
}

// Kasa aç
async function openCash() {
    const openingBalance = parseFloat(document.getElementById('openingBalanceInput').value) || 0;
    
    if (openingBalance < 0) {
        showStatus('Geçerli bir açılış bakiyesi girin!', 'error');
        return;
    }
    
    cashRegister = {
        isOpen: true,
        openingBalance: openingBalance,
        currentBalance: openingBalance,
        cashSales: 0,
        cardSales: 0
    };
    
    try {
        await saveToSupabase();
        closeModal('cashOpenModal');
        loadCashStatus();
        showStatus('Kasa açıldı!', 'success');
    } catch (error) {
        console.error('Kasa açma hatası:', error);
        showStatus('Kasa açılırken hata oluştu!', 'error');
    }
}

// Kasa kapatma modal'ını aç
function closeCashRegisterModal() {
    if (!cashRegister.isOpen) {
        showStatus('Kasa zaten kapalı!', 'warning');
        return;
    }
    
    const modalOpeningBalance = document.getElementById('modalOpeningBalance');
    const modalCashSales = document.getElementById('modalCashSales');
    const modalExpectedCash = document.getElementById('modalExpectedCash');
    
    if (modalOpeningBalance) modalOpeningBalance.textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    if (modalCashSales) modalCashSales.textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    if (modalExpectedCash) modalExpectedCash.textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
    
    document.getElementById('closingBalanceInput').value = '';
    document.getElementById('differenceAmount').textContent = '0.00 TL';
    document.getElementById('differenceAmount').className = 'success';
    
    openModal('cashCloseModal');
}

// Kasa kapat
async function closeCash() {
    const closingBalance = parseFloat(document.getElementById('closingBalanceInput').value) || 0;
    const expectedCash = cashRegister.openingBalance + cashRegister.cashSales;
    const difference = closingBalance - expectedCash;
    
    cashRegister.isOpen = false;
    
    try {
        await saveToSupabase();
        closeModal('cashCloseModal');
        loadCashStatus();
        
        if (difference !== 0) {
            showStatus(`Kasa kapatıldı! Fark: ${difference.toFixed(2)} TL`, difference > 0 ? 'success' : 'warning');
        } else {
            showStatus('Kasa kapatıldı!', 'success');
        }
    } catch (error) {
        console.error('Kasa kapatma hatası:', error);
        showStatus('Kasa kapatılırken hata oluştu!', 'error');
    }
}

// Kasa farkını hesapla
function calculateCashDifference() {
    const closingBalance = parseFloat(document.getElementById('closingBalanceInput').value) || 0;
    const expectedCash = cashRegister.openingBalance + cashRegister.cashSales;
    const difference = closingBalance - expectedCash;
    
    const differenceElement = document.getElementById('differenceAmount');
    if (differenceElement) {
        differenceElement.textContent = difference.toFixed(2) + ' TL';
        differenceElement.className = difference === 0 ? 'success' : difference > 0 ? 'warning' : 'danger';
    }
}

/* ======================================================
   YÖNETİM İŞLEMLERİ
   ====================================================== */

// Yönetim verilerini yükle
function loadAdminData() {
    updateAdminStats();
    loadUsersTable();
    loadAuditLogs();
    loadBackupInfo();
}

// Yönetim istatistiklerini güncelle
function updateAdminStats() {
    const totalUsersElement = document.getElementById('totalUsers');
    const totalSalesElement = document.getElementById('totalSales');
    const totalRevenueElement = document.getElementById('totalRevenue');
    
    if (totalUsersElement) totalUsersElement.textContent = users.length;
    if (totalSalesElement) totalSalesElement.textContent = salesHistory.length;
    
    const totalRevenue = salesHistory.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
    if (totalRevenueElement) totalRevenueElement.textContent = totalRevenue.toFixed(2) + ' TL';
}

// Kullanıcı tablosunu yükle
function loadUsersTable() {
    const usersTableBody = document.getElementById('usersTableBody');
    if (!usersTableBody) return;
    
    if (users.length === 0) {
        usersTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>Kullanıcı bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let tableHTML = '';
    users.forEach(user => {
        const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleString('tr-TR') : 'Hiç giriş yapmadı';
        const roleText = user.role === 'admin' ? 'Yönetici' : user.role === 'cashier' ? 'Kasiyer' : 'Personel';
        
        tableHTML += `
            <tr>
                <td>${user.username}</td>
                <td>${user.fullName}</td>
                <td>${roleText}</td>
                <td>${lastLogin}</td>
                <td><span class="status-badge success">Aktif</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-warning" onclick="editUser('${user.username}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteUser('${user.username}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    usersTableBody.innerHTML = tableHTML;
}

// Denetim kayıtlarını yükle
function loadAuditLogs() {
    const auditLogsBody = document.getElementById('auditLogsBody');
    if (!auditLogsBody) return;
    
    if (auditLogs.length === 0) {
        auditLogsBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <i class="fas fa-clipboard-list"></i>
                    <p>Denetim kaydı bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let tableHTML = '';
    auditLogs.forEach(log => {
        const logDate = new Date(log.timestamp).toLocaleString('tr-TR');
        tableHTML += `
            <tr>
                <td>${logDate}</td>
                <td>${log.user}</td>
                <td>${log.action}</td>
                <td>${log.description}</td>
                <td>${log.ipAddress || 'N/A'}</td>
            </tr>
        `;
    });
    
    auditLogsBody.innerHTML = tableHTML;
}

// Yedekleme bilgilerini yükle
function loadBackupInfo() {
    const lastBackupElement = document.getElementById('lastBackup');
    const backupProductCountElement = document.getElementById('backupProductCount');
    const backupUserCountElement = document.getElementById('backupUserCount');
    
    if (lastBackupElement) lastBackupElement.textContent = new Date().toLocaleString('tr-TR');
    if (backupProductCountElement) backupProductCountElement.textContent = products.length;
    if (backupUserCountElement) backupUserCountElement.textContent = users.length;
}

// Yönetim sekmesi değiştirme
function openAdminTab(tabName) {
    // Tüm sekme butonlarını pasif yap
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Tüm sekme içeriklerini gizle
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Aktif sekme butonunu işaretle
    const activeBtn = document.querySelector(`[data-admin-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Aktif sekme içeriğini göster
    const activeContent = document.getElementById(`admin-${tabName}`);
    if (activeContent) activeContent.classList.add('active');
}

// Yeni kullanıcı modal'ını aç
function openAddUserModal() {
    document.getElementById('addUserForm').reset();
    openModal('addUserModal');
}

// Yeni kullanıcı oluştur
function createNewUser(event) {
    if (event) event.preventDefault();
    
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const passwordConfirm = document.getElementById('newPasswordConfirm').value;
    const fullName = document.getElementById('newFullName').value;
    const role = document.getElementById('newUserRole').value;
    
    if (password !== passwordConfirm) {
        showStatus('Şifreler eşleşmiyor!', 'error');
        return;
    }
    
    if (users.find(u => u.username === username)) {
        showStatus('Bu kullanıcı adı zaten kullanılıyor!', 'error');
        return;
    }
    
    const newUser = {
        username: username,
        fullName: fullName,
        role: role,
        lastLogin: null
    };
    
    users.push(newUser);
    closeModal('addUserModal');
    loadUsersTable();
    updateAdminStats();
    showStatus('Kullanıcı başarıyla eklendi!', 'success');
}

// Kullanıcı düzenle
function editUser(username) {
    showStatus('Kullanıcı düzenleme özelliği yakında eklenecek!', 'info');
}

// Kullanıcı sil
function deleteUser(username) {
    if (username === 'admin') {
        showStatus('Admin kullanıcısı silinemez!', 'error');
        return;
    }
    
    if (!confirm(`${username} kullanıcısını silmek istediğinizden emin misiniz?`)) {
        return;
    }
    
    users = users.filter(u => u.username !== username);
    loadUsersTable();
    updateAdminStats();
    showStatus('Kullanıcı başarıyla silindi!', 'success');
}

// Denetim kayıtlarını yenile
function refreshAuditLogs() {
    loadAuditLogs();
    showStatus('Denetim kayıtları yenilendi!', 'success');
}

// Yedek oluştur
function createBackup() {
    const backupData = {
        products: products,
        sales: salesHistory,
        users: users,
        cashRegister: cashRegister,
        timestamp: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(backupData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `tekel-pos-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    showStatus('Yedek başarıyla oluşturuldu!', 'success');
}

/* ======================================================
   YARDIMCI FONKSİYONLAR
   ====================================================== */

// Modal açma
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
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

// Local IP adresini al
async function getLocalIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        const ipElement = document.getElementById('localIP');
        if (ipElement) {
            ipElement.textContent = data.ip;
        }
    } catch (error) {
        console.error('IP adresi alınamadı:', error);
        const ipElement = document.getElementById('localIP');
        if (ipElement) {
            ipElement.textContent = '127.0.0.1';
        }
    }
}

// Sayfa kapatılırken verileri kaydet
window.addEventListener('beforeunload', function() {
    if (currentUser) {
        saveToSupabase().catch(console.error);
    }
});

console.log('Tekel POS uygulaması yüklendi!');
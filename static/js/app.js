// app.js - Tekel POS Uygulaması

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
let allProducts = []; // Tüm ürünlerin kopyası
let editingProduct = null; // Düzenlenen ürün

// DOM yüklendiğinde çalışacak fonksiyonlar
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    checkAuthentication();
});

// Uygulama başlatma
function initializeApp() {
    console.log('Tekel POS uygulaması başlatılıyor...');
    
    // Varsayılan ürünleri yükle (demo)
    loadDemoProducts();
    
    // LocalStorage'dan verileri yükle
    loadFromLocalStorage();
    
    // Tüm ürünleri kopyala
    allProducts = [...products];
    
    // Dashboard'u güncelle
    refreshDashboard();
}

// Event listener'ları kur
function setupEventListeners() {
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
        
        // Barkod input'una real-time dinleme ekle
        barcodeInput.addEventListener('input', function(e) {
            // Otomatik tarama için (barkod okuyucular genellikle hızlı giriş yapar)
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
}

// Kimlik doğrulama kontrolü
function checkAuthentication() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    } else {
        showLogin();
    }
}

// Login işlemi
function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    // Basit login kontrolü (gerçek uygulamada sunucu tarafında doğrulama yapılmalı)
    if (username === 'admin' && password === 'admin123') {
        currentUser = {
            username: username,
            role: 'admin',
            fullName: 'Sistem Yöneticisi'
        };
        
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        showApp();
        showStatus('Başarıyla giriş yapıldı!', 'success');
    } else {
        showStatus('Geçersiz kullanıcı adı veya şifre!', 'error');
    }
}

// Login ekranını göster
function showLogin() {
    document.getElementById('loginModal').style.display = 'block';
    document.querySelector('.app-container').style.display = 'none';
}

// Uygulama ekranını göster
function showApp() {
    document.getElementById('loginModal').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    
    // Kullanıcı bilgilerini güncelle
    document.getElementById('currentUser').textContent = currentUser.fullName || currentUser.username;
    document.getElementById('currentRole').textContent = getRoleText(currentUser.role);
    
    // Admin özelliklerini kontrol et
    checkAdminFeatures();
    
    // Dashboard'u yenile
    refreshDashboard();
}

// Çıkış yap
function logout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    cart = [];
    showLogin();
    showStatus('Çıkış yapıldı.', 'info');
}

// Sekme değiştirme
function switchTab(tabName) {
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
    
    // Breadcrumb'u güncelle
    updateBreadcrumb(tabName);
    
    // Tab'a özel yüklemeler
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
            // Satış sekmesine özel ayarlar
            document.getElementById('barcodeInput').focus();
            loadProductGrid(); // Ürün grid'ini yükle
            break;
        case 'reports':
            loadReports();
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
        'mobile-stock': 'Mobil Stok Ekle',
        'reports': 'Raporlar',
        'cash': 'Kasa',
        'admin': 'Yönetim'
    };
    
    breadcrumb.textContent = tabNames[tabName] || 'Dashboard';
}

// Admin özelliklerini kontrol et
function checkAdminFeatures() {
    const adminElements = document.querySelectorAll('.admin-only');
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    adminElements.forEach(element => {
        element.style.display = isAdmin ? 'flex' : 'none';
    });
}

// Demo ürünleri yükle
function loadDemoProducts() {
    // Eğer localStorage'da ürün yoksa demo ürünleri yükle
    const savedProducts = localStorage.getItem('products');
    if (!savedProducts) {
        products = [
            {
                barcode: '8691234567890',
                name: 'Marlboro Red',
                price: 45.00,
                stock: 50,
                minStock: 10,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567891',
                name: 'Marlboro Gold',
                price: 47.50,
                stock: 30,
                minStock: 10,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567892',
                name: 'Camel Yellow',
                price: 43.00,
                stock: 25,
                minStock: 5,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567893',
                name: 'Winston Blue',
                price: 44.50,
                stock: 40,
                minStock: 8,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567894',
                name: 'Parliament Night Blue',
                price: 52.00,
                stock: 15,
                minStock: 5,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567895',
                name: 'Samsun Siyah',
                price: 38.00,
                stock: 20,
                minStock: 5,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567896',
                name: 'Tekel 2000',
                price: 42.50,
                stock: 35,
                minStock: 8,
                kdv: 18,
                otv: 0
            },
            {
                barcode: '8691234567897',
                name: 'L&M Red',
                price: 41.00,
                stock: 28,
                minStock: 6,
                kdv: 18,
                otv: 0
            }
        ];
        saveToLocalStorage();
    }
}

// LocalStorage'dan yükle
function loadFromLocalStorage() {
    const savedProducts = localStorage.getItem('products');
    const savedCart = localStorage.getItem('cart');
    const savedCashRegister = localStorage.getItem('cashRegister');
    const savedSalesHistory = localStorage.getItem('salesHistory');
    
    if (savedProducts) {
        products = JSON.parse(savedProducts);
    }
    
    if (savedCart) {
        cart = JSON.parse(savedCart);
        updateCartDisplay();
    }
    
    if (savedCashRegister) {
        cashRegister = JSON.parse(savedCashRegister);
    }
    
    if (savedSalesHistory) {
        salesHistory = JSON.parse(savedSalesHistory);
    }
}

// LocalStorage'a kaydet
function saveToLocalStorage() {
    localStorage.setItem('products', JSON.stringify(products));
    localStorage.setItem('cart', JSON.stringify(cart));
    localStorage.setItem('cashRegister', JSON.stringify(cashRegister));
    localStorage.setItem('salesHistory', JSON.stringify(salesHistory));
}

// Dashboard'u yenile
function refreshDashboard() {
    console.log('Dashboard yenileniyor...');
    
    // Gerçek zamanlı verileri hesapla
    const todaySales = calculateTodaySales();
    const totalProducts = products.length;
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;
    
    // İstatistikleri güncelle
    document.getElementById('todaySales').textContent = todaySales.toFixed(2) + ' TL';
    document.getElementById('totalProducts').textContent = totalProducts;
    document.getElementById('lowStockCount').textContent = lowStockCount;
    document.getElementById('outOfStockCount').textContent = outOfStockCount;
    
    // Son satışları ve stok uyarılarını yenile
    loadRecentSales();
    loadStockAlerts();
    
    console.log('Dashboard başarıyla yenilendi!');
}

// Bugünkü satışları GERÇEK verilerle hesapla
function calculateTodaySales() {
    const today = new Date().toDateString();
    let totalSales = 0;
    
    // Bugünkü satışları filtrele ve topla
    const todaySales = salesHistory.filter(sale => {
        const saleDate = new Date(sale.timestamp).toDateString();
        return saleDate === today;
    });
    
    todaySales.forEach(sale => {
        totalSales += sale.totalAmount;
    });
    
    return totalSales;
}

// Son satışları GERÇEK verilerle yükle
function loadRecentSales() {
    const recentSalesContainer = document.getElementById('recentSales');
    
    // Son 5 satışı al (en yeniden eskiye)
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
                    <strong>${sale.totalAmount.toFixed(2)} TL</strong>
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

// Barkod ile ürün ekle
function addProductByBarcode() {
    const barcodeInput = document.getElementById('barcodeInput');
    const barcode = barcodeInput.value.trim();
    
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
    barcodeInput.value = '';
    barcodeInput.focus();
    showStatus(`${product.name} sepete eklendi!`, 'success');
}

// Ürün grid'ini yükle
function loadProductGrid() {
    const productGrid = document.getElementById('productGrid');
    
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
        if (product.stock > 0) { // Sadece stokta olan ürünleri göster
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
    const searchTerm = document.getElementById('productSearch').value.toLowerCase().trim();
    const productGrid = document.getElementById('productGrid');
    const productCards = productGrid.getElementsByClassName('product-card');
    
    let hasVisibleProducts = false;
    
    for (let card of productCards) {
        const productName = card.getAttribute('data-name');
        const productBarcode = card.getAttribute('data-barcode');
        
        // İsim veya barkodda arama yap
        const matchesSearch = productName.includes(searchTerm) || 
                            productBarcode.includes(searchTerm);
        
        if (matchesSearch) {
            card.style.display = 'flex';
            hasVisibleProducts = true;
        } else {
            card.style.display = 'none';
        }
    }
    
    // Eğer hiç ürün görünmüyorsa mesaj göster
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
            ...product,
            quantity: 1
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
    
    // Sepet sayısını güncelle
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = totalItems;
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <p>Sepet boş</p>
                <small>Ürün eklemek için barkod okutun veya listeden seçin</small>
            </div>
        `;
        
        subtotalElement.textContent = '0.00 TL';
        kdvAmountElement.textContent = '0.00 TL';
        totalAmountElement.textContent = '0.00 TL';
        return;
    }
    
    // Sepet öğelerini oluştur
    let cartHTML = '';
    let subtotal = 0;
    let totalKdv = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        const itemKdv = (itemTotal * item.kdv) / 100;
        
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
    subtotalElement.textContent = subtotal.toFixed(2) + ' TL';
    kdvAmountElement.textContent = totalKdv.toFixed(2) + ' TL';
    totalAmountElement.textContent = total.toFixed(2) + ' TL';
    
    // Para üstü hesaplamasını tetikle
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
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const totalAmount = parseFloat(document.getElementById('totalAmount').textContent) || 0;
    const changeDisplay = document.getElementById('changeDisplay');
    
    if (cashAmount >= totalAmount) {
        const change = cashAmount - totalAmount;
        changeDisplay.innerHTML = `Para Üstü: <span>${change.toFixed(2)} TL</span>`;
    } else {
        changeDisplay.innerHTML = `Para Üstü: <span>0.00 TL</span>`;
    }
}

// Nakit input görünümünü değiştir
function toggleCashInput() {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashInputSection = document.getElementById('cashInputSection');
    
    if (paymentMethod === 'nakit') {
        cashInputSection.style.display = 'block';
    } else {
        cashInputSection.style.display = 'none';
    }
}

// Satışı tamamla
function completeSale() {
    if (cart.length === 0) {
        showStatus('Sepet boş!', 'error');
        return;
    }
    
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const cashAmount = parseFloat(document.getElementById('cashAmount').value) || 0;
    const totalAmount = parseFloat(document.getElementById('totalAmount').textContent);
    
    if (paymentMethod === 'nakit' && cashAmount < totalAmount) {
        showStatus('Verilen para yetersiz!', 'error');
        return;
    }
    
    // Stokları güncelle
    cart.forEach(cartItem => {
        const product = products.find(p => p.barcode === cartItem.barcode);
        if (product) {
            product.stock -= cartItem.quantity;
        }
    });
    
    // Satış geçmişine ekle
    const saleRecord = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        items: [...cart],
        totalAmount: totalAmount,
        paymentMethod: paymentMethod,
        cashAmount: cashAmount,
        change: paymentMethod === 'nakit' ? cashAmount - totalAmount : 0,
        user: currentUser.username
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
    document.getElementById('cashAmount').value = '';
    document.querySelector('input[name="paymentMethod"][value="nakit"]').checked = true;
    toggleCashInput();
    
    // Dashboard'u yenile
    refreshDashboard();
    
    // Fiş göster
    showReceipt(receipt);
    
    showStatus('Satış başarıyla tamamlandı!', 'success');
    saveToLocalStorage();
}

// Fiş oluştur
function generateReceipt(paymentMethod, cashAmount) {
    const totalAmount = parseFloat(document.getElementById('totalAmount').textContent);
    const change = paymentMethod === 'nakit' ? cashAmount - totalAmount : 0;
    
    let receiptHTML = `
        <div class="receipt">
            <div class="receipt-header">
                <h3>TEKEL MARKET</h3>
                <p>POS Sistemi</p>
            </div>
            <div class="receipt-info">
                <p>Fiş No: ${Date.now()}</p>
                <p>Tarih: ${new Date().toLocaleString('tr-TR')}</p>
                <p>Kasiyer: ${currentUser.fullName || currentUser.username}</p>
            </div>
            <div class="receipt-items">
                <table>
    `;
    
    cart.forEach(item => {
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
                <p>Ara Toplam: ${document.getElementById('subtotal').textContent}</p>
                <p>KDV Toplam: ${document.getElementById('kdvAmount').textContent}</p>
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
    document.getElementById('receiptContent').innerHTML = receiptHTML;
    openModal('receiptModal');
}

// Modal açma
function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

// Modal kapama
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
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

// Ürünleri yükle - DÜZELTİLDİ (Edit/Delete butonları eklendi)
function loadProducts() {
    const tableBody = document.getElementById('productsTableBody');
    
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
                <td>%${product.kdv}</td>
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

// Ürün düzenle - YENİ EKLENDİ
function editProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    editingProduct = product;
    
    // Modal formunu doldur
    document.getElementById('newProductBarcode').value = product.barcode;
    document.getElementById('newProductName').value = product.name;
    document.getElementById('newProductPrice').value = product.price;
    document.getElementById('newProductQuantity').value = product.stock;
    document.getElementById('newProductMinStock').value = product.minStock;
    document.getElementById('newProductKDV').value = product.kdv;
    document.getElementById('newProductOTV').value = product.otv;
    
    // Modal başlığını değiştir
    document.querySelector('#addProductModal .modal-header h3').innerHTML = '<i class="fas fa-edit"></i> Ürünü Düzenle';
    
    // Form submit event'ini güncelle
    const form = document.getElementById('addProductForm');
    form.onsubmit = updateProduct;
    
    openModal('addProductModal');
}

// Ürün güncelle - YENİ EKLENDİ
function updateProduct(event) {
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
    
    // Ürünü güncelle
    const index = products.findIndex(p => p.barcode === editingProduct.barcode);
    if (index !== -1) {
        products[index] = updatedProduct;
    }
    
    allProducts = [...products]; // Tüm ürünleri güncelle
    saveToLocalStorage();
    closeModal('addProductModal');
    loadProducts();
    loadInventory();
    refreshDashboard();
    
    // Formu eski haline getir
    const form = document.getElementById('addProductForm');
    form.onsubmit = addNewProduct;
    document.querySelector('#addProductModal .modal-header h3').innerHTML = '<i class="fas fa-plus-circle"></i> Yeni Ürün Ekle';
    
    editingProduct = null;
    
    showStatus('Ürün başarıyla güncellendi!', 'success');
}

// Ürün sil - YENİ EKLENDİ
function deleteProduct(barcode) {
    const product = products.find(p => p.barcode === barcode);
    if (!product) {
        showStatus('Ürün bulunamadı!', 'error');
        return;
    }
    
    if (confirm(`"${product.name}" ürününü silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`)) {
        // Ürünü sil
        products = products.filter(p => p.barcode !== barcode);
        allProducts = [...products]; // Tüm ürünleri güncelle
        saveToLocalStorage();
        loadProducts();
        loadInventory();
        refreshDashboard();
        showStatus('Ürün başarıyla silindi!', 'success');
    }
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
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.style.display = 'block';
    
    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

// Kasa açma modal'ını aç
function openCashRegisterModal() {
    if (cashRegister.isOpen) {
        showStatus('Kasa zaten açık!', 'warning');
        return;
    }
    openModal('cashOpenModal');
    document.getElementById('openingBalanceInput').focus();
}

// Kasa aç
function openCash() {
    const openingBalance = parseFloat(document.getElementById('openingBalanceInput').value) || 0;
    
    cashRegister = {
        isOpen: true,
        openingBalance: openingBalance,
        currentBalance: openingBalance,
        cashSales: 0,
        cardSales: 0
    };
    
    closeModal('cashOpenModal');
    updateCashDisplay();
    showStatus('Kasa açıldı!', 'success');
    saveToLocalStorage();
}

// Kasa kapatma modal'ını aç
function closeCashRegisterModal() {
    if (!cashRegister.isOpen) {
        showStatus('Kasa zaten kapalı!', 'warning');
        return;
    }
    
    document.getElementById('modalOpeningBalance').textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    document.getElementById('modalCashSales').textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    document.getElementById('modalExpectedCash').textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
    
    openModal('cashCloseModal');
    document.getElementById('closingBalanceInput').focus();
}

// Kasa kapat
function closeCash() {
    const closingBalance = parseFloat(document.getElementById('closingBalanceInput').value) || 0;
    const expectedCash = cashRegister.openingBalance + cashRegister.cashSales;
    const difference = closingBalance - expectedCash;
    
    cashRegister.isOpen = false;
    
    closeModal('cashCloseModal');
    updateCashDisplay();
    
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
        cashStatusBadge.textContent = 'Açık';
        cashStatusBadge.className = 'status-badge success';
        currentCashAmount.textContent = cashRegister.currentBalance.toFixed(2) + ' TL';
        cashStatusIcon.className = 'fas fa-lock-open';
        cashStatusText.textContent = 'Açık';
        openCashBtn.style.display = 'none';
        closeCashBtn.style.display = 'block';
    } else {
        cashStatusBadge.textContent = 'Kapalı';
        cashStatusBadge.className = 'status-badge danger';
        currentCashAmount.textContent = '0.00 TL';
        cashStatusIcon.className = 'fas fa-lock';
        cashStatusText.textContent = 'Kapalı';
        openCashBtn.style.display = 'block';
        closeCashBtn.style.display = 'none';
    }
}

// Kasa durumunu yükle
function loadCashStatus() {
    updateCashDisplay();
    
    // Kasa detaylarını güncelle
    document.getElementById('openingBalance').textContent = cashRegister.openingBalance.toFixed(2) + ' TL';
    document.getElementById('totalSalesAmount').textContent = (cashRegister.cashSales + cashRegister.cardSales).toFixed(2) + ' TL';
    document.getElementById('cashSalesAmount').textContent = cashRegister.cashSales.toFixed(2) + ' TL';
    document.getElementById('cardSalesAmount').textContent = cashRegister.cardSales.toFixed(2) + ' TL';
    document.getElementById('expectedCash').textContent = (cashRegister.openingBalance + cashRegister.cashSales).toFixed(2) + ' TL';
}

// Stok yönetimini yükle
function loadInventory() {
    const tableBody = document.getElementById('inventoryTableBody');
    const statTotalProducts = document.getElementById('statTotalProducts');
    const statInStock = document.getElementById('statInStock');
    const statLowStock = document.getElementById('statLowStock');
    const statOutOfStock = document.getElementById('statOutOfStock');
    
    // İstatistikleri güncelle
    statTotalProducts.textContent = products.length;
    statInStock.textContent = products.filter(p => p.stock > p.minStock).length;
    statLowStock.textContent = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
    statOutOfStock.textContent = products.filter(p => p.stock === 0).length;
    
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
function addStock(barcode, quantity = 1) {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
        product.stock += quantity;
        saveToLocalStorage();
        loadInventory();
        refreshDashboard(); // Dashboard'u da güncelle
        showStatus(`${product.name} stok eklendi: +${quantity}`, 'success');
    }
}

// Yeni ürün modal'ını aç
function openAddProductModal() {
    // Formu temizle
    document.getElementById('addProductForm').reset();
    // Modal başlığını sıfırla
    document.querySelector('#addProductModal .modal-header h3').innerHTML = '<i class="fas fa-plus-circle"></i> Yeni Ürün Ekle';
    // Form submit event'ini sıfırla
    document.getElementById('addProductForm').onsubmit = addNewProduct;
    editingProduct = null;
    
    openModal('addProductModal');
}

// Yeni ürün ekle
function addNewProduct(event) {
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
    
    // Barkod kontrolü
    if (products.find(p => p.barcode === newProduct.barcode)) {
        showStatus('Bu barkoda sahip ürün zaten var!', 'error');
        return;
    }
    
    products.push(newProduct);
    allProducts = [...products]; // Tüm ürünleri güncelle
    saveToLocalStorage();
    closeModal('addProductModal');
    loadProducts();
    loadInventory();
    refreshDashboard(); // Dashboard'u da güncelle
    showStatus('Ürün başarıyla eklendi!', 'success');
}

// Raporları yükle
function loadReports() {
    // Demo rapor verileri
    const dailyStats = document.getElementById('dailyStats');
    dailyStats.innerHTML = `
        <div class="daily-stat-item">
            <span>Toplam Satış:</span>
            <span>1,250.75 TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Nakit Satış:</span>
            <span>850.50 TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Kartlı Satış:</span>
            <span>400.25 TL</span>
        </div>
        <div class="daily-stat-item">
            <span>Toplam İşlem:</span>
            <span>28</span>
        </div>
    `;
    
    const topProducts = document.getElementById('topProducts');
    topProducts.innerHTML = `
        <div class="top-product-item">
            <span>1. Marlboro Red</span>
            <span>15 adet</span>
        </div>
        <div class="top-product-item">
            <span>2. Marlboro Gold</span>
            <span>12 adet</span>
        </div>
        <div class="top-product-item">
            <span>3. Camel Yellow</span>
            <span>8 adet</span>
        </div>
    `;
}

// Admin verilerini yükle
function loadAdminData() {
    document.getElementById('totalUsers').textContent = '3';
    document.getElementById('totalSales').textContent = '156';
    document.getElementById('totalRevenue').textContent = '18,450.75 TL';
    
    // Kullanıcıları yükle
    loadUsers();
}

// Kullanıcıları yükle
function loadUsers() {
    const usersTableBody = document.getElementById('usersTableBody');
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
    document.getElementById('addUserForm').reset();
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
    
    // Burada gerçek kullanıcı oluşturma işlemi yapılacak
    showStatus('Kullanıcı başarıyla oluşturuldu!', 'success');
    closeModal('addUserModal');
}

// Admin sekmesi aç
function openAdminTab(tabName) {
    // Tüm admin tab butonlarını pasif yap
    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    adminTabBtns.forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Tüm admin tab içeriklerini gizle
    const adminTabContents = document.querySelectorAll('.admin-tab-content');
    adminTabContents.forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Aktif butonu işaretle
    const activeBtn = document.querySelector(`[data-admin-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // Aktif tab'ı göster
    const activeTab = document.getElementById(`admin-${tabName}`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
}

// Sayfa kapatılırken verileri kaydet
window.addEventListener('beforeunload', function() {
    saveToLocalStorage();
});

// Hata yönetimi
window.addEventListener('error', function(e) {
    console.error('Uygulama hatası:', e.error);
    showStatus('Bir hata oluştu!', 'error');
});
class TekelPOS {
    constructor() {
        // Singleton pattern - sadece bir instance olsun
        if (window.posInstance) {
            return window.posInstance;
        }
        window.posInstance = this;
        
        this.products = [];
        this.cart = [];
        this.currentUser = null;
        this.currentTab = 'dashboard';
        this.videoStream = null;
        this.scanning = false;
        this.canvasElement = null;
        this.canvasContext = null;
        this.jsQRInterval = null;
        
        // Polling için değişkenler
        this.pollingInterval = null;
        this.pollingEnabled = true;
        this.pollingDelay = 3000; // 3 saniye
        
        // Yeni kamera değişkenleri
        this.cameraRetryCount = 0;
        this.maxCameraRetries = 3;
        
        // Event binding kontrolü
        this._eventsBound = false;
        this._additionalEventsBound = false;
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkAuth();
        this.startPolling(); // WebSocket yerine polling başlat
    }

    // POLLING SİSTEMİ - WebSocket yerine
    startPolling() {
        console.log("🔄 Polling sistemi başlatılıyor...");
        
        // Mevcut interval'i temizle
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        
        this.pollingInterval = setInterval(async () => {
            if (this.pollingEnabled && this.currentUser) {
                try {
                    await this.pollForUpdates();
                } catch (error) {
                    console.error("Polling hatası:", error);
                }
            }
        }, this.pollingDelay);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async pollForUpdates() {
        // Sadece aktif sekmeler için güncelleme yap
        switch(this.currentTab) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'products':
                await this.loadProducts();
                break;
            case 'inventory':
                await this.loadInventory();
                break;
            case 'reports':
                await this.loadReports();
                break;
        }
        
        // Her durumda stok uyarılarını kontrol et
        await this.loadLowStock();
    }

    async checkAuth() {
        const userData = localStorage.getItem('userData');
        if (userData) {
            this.currentUser = JSON.parse(userData);
            this.showApp();
            await this.loadInitialData();
        } else {
            this.showLogin();
        }
    }

    setupEventListeners() {
        // Event'ler zaten bağlandıysa tekrar bağlama
        if (this._eventsBound) {
            console.log("ℹ️ Event listener'lar zaten bağlanmış");
            return;
        }
        this._eventsBound = true;
        
        console.log("🔗 Event listener'lar bağlanıyor...");

        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        // Barkod input
        const barcodeInput = document.getElementById('barcodeInput');
        if (barcodeInput) {
            barcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addProductByBarcode();
                }
            });
        }

        // Nakit miktarı değişikliği
        const cashAmount = document.getElementById('cashAmount');
        if (cashAmount) {
            cashAmount.addEventListener('input', () => {
                this.calculateChange();
            });
        }

        // Ödeme yöntemi değişikliği
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.toggleCashInput();
            });
        });

        // Sekme değiştirme
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = item.dataset.tab;
                if (tab) {
                    this.openTab(tab);
                }
            });
        });

        // Admin sekme değiştirme
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.adminTab;
                this.openAdminTab(tab);
            });
        });

        // Enter tuşu ile login
        document.getElementById('password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.login();
            }
        });

        // Hızlı barkod input
        const quickBarcodeInput = document.getElementById('quickBarcodeInput');
        if (quickBarcodeInput) {
            quickBarcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.quickStockAdd();
                }
            });
        }

        // Yeni event listener'lar
        this.setupAdditionalEventListeners();
    }

    setupAdditionalEventListeners() {
        if (this._additionalEventsBound) {
            return;
        }
        this._additionalEventsBound = true;

        // Kasa butonları - DELEGATION kullan
        document.addEventListener('click', (e) => {
            if (e.target.id === 'openCashBtn' || e.target.closest('#openCashBtn')) {
                this.openCashRegisterModal();
            }
            if (e.target.id === 'closeCashBtn' || e.target.closest('#closeCashBtn')) {
                this.closeCashRegisterModal();
            }
        });

        // Stok kaydetme butonları - DELEGATION kullan
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('save-stock-btn')) {
                const barcode = e.target.dataset.barcode;
                console.log(`💾 Stok kaydet: ${barcode}`);
                this.saveStock(barcode);
            }
        });

        // Hızlı stok ekleme butonları - DELEGATION kullan
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-primary') && 
                e.target.textContent.includes('+1')) {
                const barcode = e.target.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
                if (barcode) {
                    console.log(`📦 Hızlı stok +1: ${barcode}`);
                    this.quickAddStock(barcode, 1);
                }
            }
            if (e.target.classList.contains('btn-primary') && 
                e.target.textContent.includes('+5')) {
                const barcode = e.target.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
                if (barcode) {
                    console.log(`📦 Hızlı stok +5: ${barcode}`);
                    this.quickAddStock(barcode, 5);
                }
            }
            if (e.target.classList.contains('btn-primary') && 
                e.target.textContent.includes('+10')) {
                const barcode = e.target.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
                if (barcode) {
                    console.log(`📦 Hızlı stok +10: ${barcode}`);
                    this.quickAddStock(barcode, 10);
                }
            }
        });

        // Admin butonları
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-success') && e.target.textContent.includes('Yeni Kullanıcı')) {
                this.openAddUserModal();
            }
            if (e.target.classList.contains('btn-primary') && e.target.textContent.includes('Yenile')) {
                if (this.currentTab === 'admin') {
                    this.loadAuditLogs();
                }
            }
        });

        // Rapor butonları
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-primary') && e.target.textContent.includes('Filtrele')) {
                this.loadSalesReport();
            }
        });

        // Ürün butonları
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-primary') && e.target.textContent.includes('Yenile')) {
                if (this.currentTab === 'products') {
                    this.loadProducts();
                }
            }
        });
    }

    async login() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.currentUser = result.user;
                localStorage.setItem('userData', JSON.stringify(result.user));
                this.showApp();
                await this.loadInitialData();
                this.startPolling(); // Giriş yapınca polling başlat
                this.showStatus('Başarıyla giriş yapıldı', 'success');
            } else {
                this.showStatus(result.message || 'Giriş başarısız', 'error');
            }
        } catch (error) {
            this.showStatus('Sunucu hatası: ' + error.message, 'error');
        }
    }

    logout() {
        this.stopPolling(); // Çıkış yapınca polling'i durdur
        localStorage.removeItem('userData');
        this.currentUser = null;
        this.showLogin();
        this.showStatus('Çıkış yapıldı', 'success');
    }

    showLogin() {
        document.getElementById('loginModal').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
        this.stopPolling(); // Login ekranında polling durdur
    }

    showApp() {
        document.getElementById('loginModal').style.display = 'none';
        document.querySelector('.app-container').style.display = 'flex';
        
        // Kullanıcı bilgilerini güncelle
        const currentUserEl = document.getElementById('currentUser');
        const currentRoleEl = document.getElementById('currentRole');
        
        if (currentUserEl) currentUserEl.textContent = this.currentUser.full_name;
        if (currentRoleEl) currentRoleEl.textContent = this.getRoleText(this.currentUser.role);
        
        // Admin yetkilerini kontrol et
        if (this.currentUser.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
            });
        }
        
        // İlk sekmeyi aç
        this.openTab('dashboard');
    }

    getRoleText(role) {
        const roles = {
            'admin': 'Yönetici',
            'user': 'Personel', 
            'cashier': 'Kasiyer'
        };
        return roles[role] || role;
    }

    async loadInitialData() {
        await this.loadProducts();
        await this.loadDashboardData();
        await this.checkCashStatus();
    }

    // WebSocket kaldırıldı, polling sistemi eklendi

    // Sekme Yönetimi
    openTab(tabName) {
        // Eski sekmeyi kapat
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // Yeni sekmeyi aç
        const tabElement = document.getElementById(tabName);
        const navElement = document.querySelector(`[data-tab="${tabName}"]`);
        
        if (tabElement) tabElement.classList.add('active');
        if (navElement) navElement.classList.add('active');
        
        // Breadcrumb güncelle
        const breadcrumb = document.getElementById('breadcrumb');
        if (breadcrumb) breadcrumb.textContent = this.getTabTitle(tabName);
        
        this.currentTab = tabName;

        // Sekmeye özel yüklemeler
        switch(tabName) {
            case 'dashboard':
                this.loadDashboardData();
                break;
            case 'products':
                this.loadProductsTable();
                break;
            case 'inventory':
                this.loadInventory();
                break;
            case 'mobile-stock':
                this.initCamera();
                break;
            case 'reports':
                this.loadReports();
                break;
            case 'cash':
                this.loadCashManagement();
                break;
            case 'admin':
                if (this.currentUser.role === 'admin') {
                    this.loadAdminData();
                }
                break;
        }
    }

    getTabTitle(tabName) {
        const titles = {
            'dashboard': 'Dashboard',
            'sales': 'Satış Yap',
            'products': 'Ürünler',
            'inventory': 'Stok Yönetimi',
            'mobile-stock': 'Mobil Stok Ekle',
            'reports': 'Raporlar',
            'cash': 'Kasa Yönetimi',
            'admin': 'Sistem Yönetimi'
        };
        return titles[tabName] || tabName;
    }

    openAdminTab(tabName) {
        // Admin sekmelerini kapat
        document.querySelectorAll('.admin-tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Yeni admin sekmesini aç
        const tabElement = document.getElementById(`admin-${tabName}`);
        const btnElement = document.querySelector(`[data-admin-tab="${tabName}"]`);
        
        if (tabElement) tabElement.classList.add('active');
        if (btnElement) btnElement.classList.add('active');

        // Admin sekmesine özel yüklemeler
        switch(tabName) {
            case 'users':
                this.loadUsers();
                break;
            case 'audit':
                this.loadAuditLogs();
                break;
            case 'backup':
                this.loadBackupInfo();
                break;
        }
    }

    // Ürün Yönetimi
    async loadProducts() {
        try {
            const token = this.currentUser?.id;
            const response = await fetch('/api/products', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.products = result.products;
                this.renderProducts();
                this.renderProductsTable();
            } else {
                this.showStatus('Ürünler yüklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Ürünler yüklenirken hata: ' + error.message, 'error');
        }
    }

    async loadProductsTable() {
        await this.loadProducts();
    }

    renderProducts() {
        const grid = document.getElementById('productGrid');
        if (!grid) return;

        if (this.products.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-box-open"></i>
                    <p>Henüz ürün eklenmemiş</p>
                    <small>Barkod tarayarak veya stok ekleme sayfasından ürün ekleyin</small>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.products.map(product => `
            <div class="product-card" onclick="pos.addToCart('${product.barcode}')">
                <div class="product-info">
                    <h4>${product.name}</h4>
                    <div class="product-details">
                        <span class="price">${product.price} TL</span>
                        <span class="stock">Stok: ${product.quantity}</span>
                    </div>
                    <div class="barcode">${product.barcode}</div>
                </div>
                <button class="btn-primary btn-small">
                    <i class="fas fa-cart-plus"></i> Ekle
                </button>
            </div>
        `).join('');
    }

    renderProductsTable() {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;

        if (this.products.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <p>Henüz ürün eklenmemiş</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.products.map(product => `
            <tr>
                <td>${product.barcode}</td>
                <td><strong>${product.name}</strong></td>
                <td>${product.price} TL</td>
                <td>
                    <input type="number" 
                           class="stock-input" 
                           value="${product.quantity}" 
                           min="0"
                           data-barcode="${product.barcode}"
                           style="width: 80px; padding: 4px;">
                </td>
                <td>%${product.kdv}</td>
                <td>
                    <span class="status-badge ${product.quantity === 0 ? 'danger' : product.quantity <= 5 ? 'warning' : 'success'}">
                        ${product.quantity === 0 ? 'Stokta Yok' : product.quantity <= 5 ? 'Az Stok' : 'Stokta Var'}
                    </span>
                </td>
                <td>
                    <button class="btn-primary btn-small save-stock-btn" data-barcode="${product.barcode}">
                        Kaydet
                    </button>
                </td>
                <td>
                    <button class="btn-primary btn-small" onclick="pos.quickAddStock('${product.barcode}', 1)">
                        +1
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async saveStock(barcode) {
        const input = document.querySelector(`.stock-input[data-barcode="${barcode}"]`);
        if (!input) {
            this.showStatus('Stok inputu bulunamadı', 'error');
            return;
        }

        const newQuantity = parseInt(input.value) || 0;

        if (newQuantity < 0) {
            this.showStatus('Stok miktarı negatif olamaz', 'error');
            return;
        }

        try {
            // Mevcut ürünü bul
            const currentProduct = this.products.find(p => p.barcode === barcode);
            if (!currentProduct) {
                this.showStatus('Ürün bulunamadı', 'error');
                return;
            }

            // Farkı hesapla (eklenecek miktar)
            const quantityDifference = newQuantity - currentProduct.quantity;

            const response = await fetch('/api/stock/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    quantity: quantityDifference // SADECE FARKI GÖNDER
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Stok güncellendi', 'success');
                await this.loadProducts();
                await this.loadInventory();
                await this.loadDashboardData();
            } else {
                this.showStatus('Stok güncellenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Stok güncellenirken hata: ' + error.message, 'error');
        }
    }

    // Yeni Ürün Ekleme
    openAddProductModal() {
        // Formu temizle
        document.getElementById('newProductBarcode').value = '';
        document.getElementById('newProductName').value = '';
        document.getElementById('newProductQuantity').value = '1';
        document.getElementById('newProductPrice').value = '';
        document.getElementById('newProductOTV').value = '0';
        document.getElementById('newProductKDV').value = '18';
        document.getElementById('newProductMinStock').value = '5';
        
        document.getElementById('addProductModal').style.display = 'flex';
    }

    async addNewProduct() {
        const barcode = document.getElementById('newProductBarcode').value.trim();
        const name = document.getElementById('newProductName').value.trim();
        const quantity = parseInt(document.getElementById('newProductQuantity').value) || 1;
        const price = parseFloat(document.getElementById('newProductPrice').value) || 0;
        const otv = parseFloat(document.getElementById('newProductOTV').value) || 0;
        const kdv = parseFloat(document.getElementById('newProductKDV').value) || 18;

        if (!barcode || !name || price <= 0) {
            this.showStatus('Lütfen zorunlu alanları doldurun', 'error');
            return;
        }

        try {
            const response = await fetch('/api/stock/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    name: name,
                    quantity: quantity,
                    price: price,
                    otv: otv,
                    kdv: kdv
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Ürün başarıyla eklendi', 'success');
                this.closeModal('addProductModal');
                await this.loadProducts();
                await this.loadInventory();
            } else {
                this.showStatus('Ürün eklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Ürün eklenirken hata: ' + error.message, 'error');
        }
    }

    // Sepet İşlemleri
    async addProductByBarcode() {
        const barcodeInput = document.getElementById('barcodeInput');
        const barcode = barcodeInput.value.trim();
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'warning');
            return;
        }

        const product = this.products.find(p => p.barcode === barcode);
        if (!product) {
            this.showStatus('Ürün bulunamadı! Stok ekleme sayfasından ekleyin.', 'error');
            barcodeInput.value = '';
            return;
        }

        this.addToCart(product.barcode);
        barcodeInput.value = '';
        barcodeInput.focus();
    }

    addToCart(barcode) {
        const product = this.products.find(p => p.barcode === barcode);
        if (!product) {
            this.showStatus('Ürün bulunamadı', 'error');
            return;
        }

        if (product.quantity === 0) {
            this.showStatus('Bu ürün stokta yok', 'error');
            return;
        }

        const existingItem = this.cart.find(item => item.barcode === barcode);
        if (existingItem) {
            if (existingItem.quantity >= product.quantity) {
                this.showStatus('Stok yetersiz', 'error');
                return;
            }
            existingItem.quantity++;
        } else {
            this.cart.push({
                barcode: product.barcode,
                name: product.name,
                price: product.price,
                quantity: 1
            });
        }

        this.renderCart();
        this.showStatus(`${product.name} sepete eklendi`, 'success');
    }

    removeFromCart(barcode) {
        this.cart = this.cart.filter(item => item.barcode !== barcode);
        this.renderCart();
        this.showStatus('Ürün sepetten kaldırıldı', 'success');
    }

    updateCartQuantity(barcode, change) {
        const item = this.cart.find(item => item.barcode === barcode);
        if (!item) return;

        const product = this.products.find(p => p.barcode === barcode);
        if (!product) return;

        const newQuantity = item.quantity + change;
        
        if (newQuantity <= 0) {
            this.removeFromCart(barcode);
            return;
        }

        if (newQuantity > product.quantity) {
            this.showStatus('Stok yetersiz', 'error');
            return;
        }

        item.quantity = newQuantity;
        this.renderCart();
    }

    renderCart() {
        const cartItems = document.getElementById('cartItems');
        const cartCount = document.getElementById('cartCount');
        const subtotalEl = document.getElementById('subtotal');
        const kdvAmountEl = document.getElementById('kdvAmount');
        const totalAmountEl = document.getElementById('totalAmount');
        
        if (!cartItems) return;

        // Sepet sayısını güncelle
        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        if (cartCount) cartCount.textContent = totalItems;
        
        // Sepet içeriğini render et
        if (this.cart.length === 0) {
            cartItems.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-shopping-cart"></i>
                    <p>Sepet boş</p>
                    <small>Ürün eklemek için barkod okutun veya listeden seçin</small>
                </div>
            `;
            if (subtotalEl) subtotalEl.textContent = '0.00 TL';
            if (kdvAmountEl) kdvAmountEl.textContent = '0.00 TL';
            if (totalAmountEl) totalAmountEl.textContent = '0.00 TL';
            return;
        }

        cartItems.innerHTML = this.cart.map(item => {
            const itemTotal = item.price * item.quantity;
            return `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <div class="item-details">
                            <span class="price">${item.price} TL</span>
                            <span class="barcode">${item.barcode}</span>
                        </div>
                    </div>
                    <div class="cart-item-controls">
                        <div class="quantity-controls">
                            <button class="quantity-btn" onclick="pos.updateCartQuantity('${item.barcode}', -1)">-</button>
                            <span class="quantity">${item.quantity}</span>
                            <button class="quantity-btn" onclick="pos.updateCartQuantity('${item.barcode}', 1)">+</button>
                        </div>
                        <button class="remove-btn" onclick="pos.removeFromCart('${item.barcode}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Toplamları hesapla
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const kdvRate = 0.18;
        const kdvAmount = subtotal * kdvRate;
        const total = subtotal + kdvAmount;

        if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2) + ' TL';
        if (kdvAmountEl) kdvAmountEl.textContent = kdvAmount.toFixed(2) + ' TL';
        if (totalAmountEl) totalAmountEl.textContent = total.toFixed(2) + ' TL';

        // Para üstünü hesapla
        this.calculateChange();
    }

    calculateChange() {
        const cashAmount = parseFloat(document.getElementById('cashAmount')?.value) || 0;
        const totalText = document.getElementById('totalAmount')?.textContent || '0.00 TL';
        const total = parseFloat(totalText) || 0;
        const changeDisplay = document.getElementById('changeDisplay');
        
        if (changeDisplay) {
            const change = cashAmount - total;
            changeDisplay.innerHTML = `Para Üstü: <span>${change >= 0 ? change.toFixed(2) : '0.00'} TL</span>`;
        }
    }

    toggleCashInput() {
        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;
        const cashInputSection = document.getElementById('cashInputSection');
        
        if (cashInputSection) {
            cashInputSection.style.display = paymentMethod === 'nakit' ? 'block' : 'none';
        }
        
        if (paymentMethod !== 'nakit') {
            const cashAmount = document.getElementById('cashAmount');
            if (cashAmount) cashAmount.value = '';
            this.calculateChange();
        }
    }

    async completeSale() {
        if (this.cart.length === 0) {
            this.showStatus('Sepet boş', 'error');
            return;
        }

        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;
        const cashAmount = parseFloat(document.getElementById('cashAmount')?.value) || 0;
        const totalText = document.getElementById('totalAmount')?.textContent || '0.00 TL';
        const total = parseFloat(totalText);
        
        if (paymentMethod === 'nakit' && cashAmount < total) {
            this.showStatus('Verilen para toplam tutardan az olamaz', 'error');
            return;
        }

        const saleData = {
            items: this.cart,
            total: total,
            payment_method: paymentMethod,
            cash_amount: paymentMethod === 'nakit' ? cashAmount : 0,
            credit_card_amount: paymentMethod === 'kredi' ? total : 0,
            change_amount: paymentMethod === 'nakit' ? (cashAmount - total) : 0,
            user_id: this.currentUser.id
        };

        try {
            const response = await fetch('/api/sale', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify(saleData)
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Satış başarıyla tamamlandı! Fiş No: ${result.sale_id}`, 'success');
                this.cart = [];
                this.renderCart();
                await this.loadProducts();
                await this.loadDashboardData();
                
                // Barkod input'una focusla
                const barcodeInput = document.getElementById('barcodeInput');
                if (barcodeInput) barcodeInput.focus();
            } else {
                this.showStatus('Satış sırasında hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Satış sırasında hata: ' + error.message, 'error');
        }
    }

    // Dashboard
    async loadDashboardData() {
        await this.loadDailySummary();
        await this.loadLowStock();
        await this.loadRecentSales();
    }

    async loadDailySummary() {
        try {
            const response = await fetch('/api/reports/daily-summary', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                const summary = result.summary;
                const todaySales = document.getElementById('todaySales');
                const totalProducts = document.getElementById('totalProducts');
                
                if (todaySales) todaySales.textContent = (summary.total_revenue || 0).toFixed(2) + ' TL';
                if (totalProducts) totalProducts.textContent = this.products.length;
            }
        } catch (error) {
            console.error('Dashboard yüklenirken hata:', error);
        }
    }

    async loadLowStock() {
        try {
            const response = await fetch('/api/inventory/low-stock', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                const lowStockProducts = result.products || [];
                const lowStockCount = document.getElementById('lowStockCount');
                const outOfStockCount = document.getElementById('outOfStockCount');
                const alertsContainer = document.getElementById('stockAlerts');
                
                if (lowStockCount) lowStockCount.textContent = lowStockProducts.length;
                if (outOfStockCount) outOfStockCount.textContent = this.products.filter(p => p.quantity === 0).length;
                
                // Stok uyarılarını göster
                if (alertsContainer) {
                    if (lowStockProducts.length === 0) {
                        alertsContainer.innerHTML = `
                            <div class="empty-state">
                                <i class="fas fa-check-circle"></i>
                                <p>Stok uyarısı yok</p>
                            </div>
                        `;
                    } else {
                        alertsContainer.innerHTML = lowStockProducts.map(product => `
                            <div class="alert-item warning">
                                <i class="fas fa-exclamation-triangle"></i>
                                <div class="alert-info">
                                    <strong>${product.name}</strong>
                                    <span>Stok: ${product.quantity} (Min: ${product.min_stock_level || 5})</span>
                                </div>
                            </div>
                        `).join('');
                    }
                }
            }
        } catch (error) {
            console.error('Stok uyarıları yüklenirken hata:', error);
        }
    }

    async loadRecentSales() {
        try {
            const response = await fetch('/api/reports/sales?limit=5', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                const sales = result.report || [];
                const container = document.getElementById('recentSales');
                
                if (!container) return;

                if (sales.length === 0) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-receipt"></i>
                            <p>Henüz satış yapılmadı</p>
                        </div>
                    `;
                } else {
                    container.innerHTML = sales.map(sale => `
                        <div class="sale-item">
                            <div class="sale-info">
                                <strong>Fiş #${sale.id}</strong>
                                <span>${new Date(sale.sale_date).toLocaleTimeString()}</span>
                            </div>
                            <div class="sale-amount">${parseFloat(sale.total_amount).toFixed(2)} TL</div>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Son satışlar yüklenirken hata:', error);
        }
    }

    // Stok Yönetimi
    async loadInventory() {
        await this.loadStockStats();
        this.renderInventoryTable();
    }

    async loadStockStats() {
        try {
            const response = await fetch('/api/inventory/stock-value', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                const value = result.value;
                const statTotalProducts = document.getElementById('statTotalProducts');
                const statInStock = document.getElementById('statInStock');
                const statLowStock = document.getElementById('statLowStock');
                const statOutOfStock = document.getElementById('statOutOfStock');
                
                if (statTotalProducts) statTotalProducts.textContent = value.total_products || 0;
                
                // Stok durumlarını hesapla
                const inStock = this.products.filter(p => p.quantity > 5).length;
                const lowStock = this.products.filter(p => p.quantity > 0 && p.quantity <= 5).length;
                const outOfStock = this.products.filter(p => p.quantity === 0).length;
                
                if (statInStock) statInStock.textContent = inStock;
                if (statLowStock) statLowStock.textContent = lowStock;
                if (statOutOfStock) statOutOfStock.textContent = outOfStock;
            }
        } catch (error) {
            console.error('Stok istatistikleri yüklenirken hata:', error);
        }
    }

    renderInventoryTable() {
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;

        if (this.products.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <i class="fas fa-warehouse"></i>
                        <p>Stok bilgisi bulunamadı</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.products.map(product => {
            const status = product.quantity === 0 ? 'danger' : 
                          product.quantity <= 5 ? 'warning' : 'success';
            const statusText = product.quantity === 0 ? 'Stokta Yok' : 
                             product.quantity <= 5 ? 'Az Stok' : 'Stokta Var';
            
            return `
                <tr>
                    <td>${product.barcode}</td>
                    <td><strong>${product.name}</strong></td>
                    <td>${product.price} TL</td>
                    <td>
                        <input type="number" 
                               class="stock-input" 
                               value="${product.quantity}" 
                               min="0"
                               data-barcode="${product.barcode}"
                               style="width: 80px; padding: 4px;">
                    </td>
                    <td>${product.min_stock_level || 5}</td>
                    <td>
                        <span class="status-badge ${status}">${statusText}</span>
                    </td>
                    <td>
                        <button class="btn-primary btn-small save-stock-btn" data-barcode="${product.barcode}">
                            Kaydet
                        </button>
                    </td>
                    <td>
                        <button class="btn-primary btn-small" onclick="pos.quickAddStock('${product.barcode}', 1)">
                            +1
                        </button>
                        <button class="btn-primary btn-small" onclick="pos.quickAddStock('${product.barcode}', 5)">
                            +5
                        </button>
                        <button class="btn-primary btn-small" onclick="pos.quickAddStock('${product.barcode}', 10)">
                            +10
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async quickAddStock(barcode, quantity) {
        try {
            const response = await fetch('/api/stock/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    quantity: quantity
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`${quantity} adet stok eklendi`, 'success');
                await this.loadProducts();
                await this.loadInventory();
                await this.loadDashboardData();
            } else {
                this.showStatus('Stok eklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Stok eklenirken hata: ' + error.message, 'error');
        }
    }

    // Kasa Yönetimi
    async loadCashManagement() {
        await this.checkCashStatus();
        await this.loadCashTransactions();
    }

    async checkCashStatus() {
        try {
            const response = await fetch('/api/cash/status', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.updateCashUI(result.cash_status);
            }
        } catch (error) {
            console.error('Kasa durumu yüklenirken hata:', error);
            // Demo veri
            this.updateCashUI({ is_open: false, current_amount: 0 });
        }
    }

    updateCashUI(cashStatus) {
        const openBtn = document.getElementById('openCashBtn');
        const closeBtn = document.getElementById('closeCashBtn');
        const statusBadge = document.getElementById('cashStatusBadge');
        const currentAmount = document.getElementById('currentCashAmount');

        if (cashStatus.is_open) {
            if (statusBadge) {
                statusBadge.className = 'status-badge success';
                statusBadge.textContent = 'Açık';
            }
            if (openBtn) openBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'inline-block';
            if (currentAmount) {
                currentAmount.textContent = cashStatus.current_amount + ' TL';
            }
        } else {
            if (statusBadge) {
                statusBadge.className = 'status-badge danger';
                statusBadge.textContent = 'Kapalı';
            }
            if (openBtn) openBtn.style.display = 'inline-block';
            if (closeBtn) closeBtn.style.display = 'none';
            if (currentAmount) {
                currentAmount.textContent = '0.00 TL';
            }
        }
    }

    openCashRegisterModal() {
        document.getElementById('cashOpenModal').style.display = 'flex';
        // Input'a focusla
        setTimeout(() => {
            const input = document.getElementById('openingBalanceInput');
            if (input) input.focus();
        }, 100);
    }

    closeCashRegisterModal() {
        document.getElementById('cashCloseModal').style.display = 'flex';
    }

    async openCash() {
        const balanceInput = document.getElementById('openingBalanceInput');
        if (!balanceInput) {
            this.showStatus('Bakiye inputu bulunamadı', 'error');
            return;
        }

        const initialAmount = parseFloat(balanceInput.value) || 0;
        
        if (initialAmount < 0) {
            this.showStatus('Bakiye negatif olamaz', 'error');
            return;
        }

        try {
            const response = await fetch('/api/cash/open', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    user_id: this.currentUser.id,
                    initial_amount: initialAmount
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kasa açıldı', 'success');
                this.closeModal('cashOpenModal');
                await this.loadCashManagement();
            } else {
                this.showStatus('Kasa açılırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kasa açılırken hata: ' + error.message, 'error');
        }
    }

    async closeCash() {
        try {
            const response = await fetch('/api/cash/close', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    user_id: this.currentUser.id
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kasa kapatıldı', 'success');
                await this.loadCashManagement();
            } else {
                this.showStatus('Kasa kapatılırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kasa kapatılırken hata: ' + error.message, 'error');
        }
    }

    async loadCashTransactions() {
        try {
            const response = await fetch('/api/cash/transactions', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderCashTransactions(result.transactions || []);
            }
        } catch (error) {
            console.error('Kasa hareketleri yüklenirken hata:', error);
            // Demo veri
            this.renderCashTransactions([]);
        }
    }

    renderCashTransactions(transactions) {
        const tbody = document.getElementById('cashTransactionsBody');
        if (!tbody) return;

        if (transactions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <i class="fas fa-exchange-alt"></i>
                        <p>Henüz kasa hareketi yok</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = transactions.map(transaction => `
            <tr>
                <td>${new Date(transaction.transaction_date).toLocaleString('tr-TR')}</td>
                <td>${transaction.user_name}</td>
                <td>
                    <span class="transaction-type ${transaction.transaction_type}">
                        ${transaction.transaction_type === 'open' ? 'Açılış' : 
                          transaction.transaction_type === 'close' ? 'Kapanış' : 
                          transaction.transaction_type === 'sale' ? 'Satış' : 'Diğer'}
                    </span>
                </td>
                <td>${parseFloat(transaction.amount).toFixed(2)} TL</td>
                <td>${transaction.description || ''}</td>
            </tr>
        `).join('');
    }

    // Raporlar
    async loadReports() {
        await this.loadSalesReport();
        await this.loadStockReport();
    }

    async loadSalesReport() {
        try {
            const response = await fetch('/api/reports/sales?limit=50', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderSalesReport(result.report || []);
            }
        } catch (error) {
            console.error('Satış raporu yüklenirken hata:', error);
            // Demo veri
            this.renderSalesReport([]);
        }
    }

    renderSalesReport(sales) {
        const tbody = document.getElementById('salesReportBody');
        if (!tbody) return;

        if (sales.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <i class="fas fa-chart-bar"></i>
                        <p>Henüz satış raporu yok</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = sales.map(sale => `
            <tr>
                <td>${sale.id}</td>
                <td>${new Date(sale.sale_date).toLocaleDateString('tr-TR')}</td>
                <td>${sale.user_name || 'Bilinmiyor'}</td>
                <td>${parseFloat(sale.total_amount).toFixed(2)} TL</td>
                <td>
                    <span class="payment-badge ${sale.payment_method}">
                        ${sale.payment_method === 'nakit' ? 'Nakit' : 'Kredi Kartı'}
                    </span>
                </td>
                <td>
                    <button class="btn-primary btn-small" onclick="pos.viewReceipt(${sale.id})">
                        <i class="fas fa-receipt"></i> Fiş
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadStockReport() {
        try {
            const response = await fetch('/api/reports/stock-movements', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderStockReport(result.movements || []);
            }
        } catch (error) {
            console.error('Stok hareketleri yüklenirken hata:', error);
            // Demo veri
            this.renderStockReport([]);
        }
    }

    renderStockReport(movements) {
        const tbody = document.getElementById('stockReportBody');
        if (!tbody) return;

        if (movements.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <i class="fas fa-exchange-alt"></i>
                        <p>Henüz stok hareketi yok</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = movements.map(movement => `
            <tr>
                <td>${movement.barcode}</td>
                <td>${movement.product_name}</td>
                <td>${new Date(movement.movement_date).toLocaleDateString('tr-TR')}</td>
                <td>
                    <span class="movement-type ${movement.movement_type}">
                        ${movement.movement_type === 'in' ? 'Giriş' : 'Çıkış'}
                    </span>
                </td>
                <td>${movement.quantity}</td>
                <td>${movement.user_name || 'Sistem'}</td>
            </tr>
        `).join('');
    }

    // Admin İşlemleri
    async loadAdminData() {
        await this.loadUsers();
        await this.loadSystemStats();
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderUsersTable(result.users || []);
            }
        } catch (error) {
            console.error('Kullanıcılar yüklenirken hata:', error);
            // Demo veri
            this.renderUsersTable([
                { id: 1, username: 'admin', full_name: 'Sistem Yöneticisi', role: 'admin', last_login: new Date() },
                { id: 2, username: 'kasiyer1', full_name: 'Ahmet Yılmaz', role: 'cashier', last_login: new Date() }
            ]);
        }
    }

    renderUsersTable(users) {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        tbody.innerHTML = users.map(user => `
            <tr>
                <td>${user.username}</td>
                <td>${user.full_name}</td>
                <td>
                    <span class="role-badge ${user.role}">
                        ${this.getRoleText(user.role)}
                    </span>
                </td>
                <td>${user.last_login ? new Date(user.last_login).toLocaleDateString('tr-TR') : 'Hiç'}</td>
                <td>
                    <button class="btn-primary btn-small" onclick="pos.editUser(${user.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${user.id !== this.currentUser.id ? `
                        <button class="btn-danger btn-small" onclick="pos.deleteUser(${user.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    }

    async loadSystemStats() {
        try {
            const response = await fetch('/api/admin/system-stats', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                const stats = result.stats;
                const totalUsers = document.getElementById('totalUsers');
                const totalSales = document.getElementById('totalSales');
                const totalRevenue = document.getElementById('totalRevenue');
                
                if (totalUsers) totalUsers.textContent = stats.total_users || 0;
                if (totalSales) totalSales.textContent = stats.total_sales || 0;
                if (totalRevenue) totalRevenue.textContent = (stats.total_revenue || 0).toFixed(2) + ' TL';
            }
        } catch (error) {
            console.error('Sistem istatistikleri yüklenirken hata:', error);
            // Demo veri
            const totalUsers = document.getElementById('totalUsers');
            const totalSales = document.getElementById('totalSales');
            const totalRevenue = document.getElementById('totalRevenue');
            
            if (totalUsers) totalUsers.textContent = '2';
            if (totalSales) totalSales.textContent = '15';
            if (totalRevenue) totalRevenue.textContent = '1250.75 TL';
        }
    }

    async loadAuditLogs() {
        try {
            const response = await fetch('/api/audit/logs?limit=100', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderAuditLogs(result.logs || []);
            }
        } catch (error) {
            console.error('Denetim kayıtları yüklenirken hata:', error);
            this.showStatus('Denetim kayıtları yüklenemedi', 'error');
        }
    }

    renderAuditLogs(logs) {
        const tbody = document.getElementById('auditLogsBody');
        if (!tbody) return;

        if (logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <i class="fas fa-clipboard-list"></i>
                        <p>Henüz denetim kaydı yok</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = logs.map(log => `
            <tr>
                <td>${new Date(log.created_at).toLocaleString('tr-TR')}</td>
                <td>${log.full_name || log.username}</td>
                <td>${log.action}</td>
                <td>${log.description}</td>
                <td>${log.ip_address || ''}</td>
            </tr>
        `).join('');
    }

    async loadBackupInfo() {
        try {
            const response = await fetch('/api/backup/export', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderBackupInfo(result);
            }
        } catch (error) {
            console.error('Yedek bilgisi yüklenirken hata:', error);
            this.showStatus('Yedek bilgisi yüklenemedi', 'error');
        }
    }

    renderBackupInfo(info) {
        const container = document.getElementById('backupInfo');
        if (!container) return;

        container.innerHTML = `
            <div class="backup-stats">
                <div class="stat-card">
                    <h4>Son Yedek</h4>
                    <p>${info.file_path ? 'Başarıyla oluşturuldu' : 'Hiç yedek alınmamış'}</p>
                </div>
                <div class="stat-card">
                    <h4>Yedek Dosyası</h4>
                    <p>${info.file_path || 'Yok'}</p>
                </div>
            </div>
        `;
    }

    openAddUserModal() {
        document.getElementById('addUserModal').style.display = 'flex';
    }

    async createNewUser() {
        const username = document.getElementById('newUsername')?.value.trim();
        const fullName = document.getElementById('newFullName')?.value.trim();
        const password = document.getElementById('newPassword')?.value;
        const role = document.getElementById('newUserRole')?.value;

        if (!username || !fullName || !password) {
            this.showStatus('Lütfen tüm alanları doldurun', 'error');
            return;
        }

        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    username: username,
                    full_name: fullName,
                    password: password,
                    role: role
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kullanıcı başarıyla oluşturuldu', 'success');
                this.closeModal('addUserModal');
                await this.loadUsers();
            } else {
                this.showStatus('Kullanıcı oluşturulurken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kullanıcı oluşturulurken hata: ' + error.message, 'error');
        }
    }

    async refreshAuditLogs() {
        await this.loadAuditLogs();
        this.showStatus('Denetim kayıtları yenilendi', 'success');
    }

    async createBackup() {
        try {
            const response = await fetch('/api/backup/export', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Yedek başarıyla alındı', 'success');
                await this.loadBackupInfo();
            } else {
                this.showStatus('Yedek alınırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Yedek alınırken hata: ' + error.message, 'error');
        }
    }

    editUser(userId) {
        this.showStatus('Kullanıcı düzenleme özelliği yakında eklenecek', 'info');
    }

    deleteUser(userId) {
        if (confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) {
            this.showStatus('Kullanıcı silme özelliği yakında eklenecek', 'info');
        }
    }

    // Yardımcı Fonksiyonlar
    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'flex';
    }

    // Fiş Görüntüleme
    async viewReceipt(saleId) {
        try {
            const response = await fetch(`/api/reports/receipt/${saleId}`, {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showReceiptModal(result.receipt);
            } else {
                this.showStatus('Fiş bulunamadı', 'error');
            }
        } catch (error) {
            this.showStatus('Fiş yüklenirken hata: ' + error.message, 'error');
        }
    }

    showReceiptModal(receipt) {
        const modal = document.getElementById('receiptModal');
        const content = document.getElementById('receiptContent');
        
        if (!modal || !content) return;

        content.innerHTML = `
            <div class="receipt">
                <div class="receipt-header">
                    <h3>TEKEL POS</h3>
                    <p>Fiş No: ${receipt.id}</p>
                    <p>${new Date(receipt.sale_date).toLocaleString('tr-TR')}</p>
                </div>
                <div class="receipt-items">
                    ${receipt.items.map(item => `
                        <div class="receipt-item">
                            <span>${item.name}</span>
                            <span>${item.quantity} x ${item.price} TL</span>
                            <span>${(item.quantity * item.price).toFixed(2)} TL</span>
                        </div>
                    `).join('')}
                </div>
                <div class="receipt-total">
                    <strong>TOPLAM: ${parseFloat(receipt.total_amount).toFixed(2)} TL</strong>
                </div>
                <div class="receipt-footer">
                    <p>Ödeme: ${receipt.payment_method === 'nakit' ? 'Nakit' : 'Kredi Kartı'}</p>
                    <p>Kasiyer: ${receipt.user_name}</p>
                </div>
            </div>
        `;
        
        modal.style.display = 'flex';
    }

    printReceipt() {
        window.print();
    }

    // Sayfa kapatma kontrolü
    setupBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            if (this.cart.length > 0) {
                e.preventDefault();
                e.returnValue = 'Sepetinizde ürünler var. Sayfadan ayrılmak istediğinize emin misiniz?';
            }
        });
    }

    // KAMERA FONKSİYONLARI - AYNI KALDI
    initCamera() {
        console.log("📱 Gelişmiş kamera sistemi hazırlanıyor...");
        
        this.canvasElement = document.getElementById('canvasElement');
        if (this.canvasElement) {
            this.canvasContext = this.canvasElement.getContext('2d', { willReadFrequently: true });
            console.log("✅ Canvas başarıyla oluşturuldu");
        } else {
            console.error("❌ Canvas element bulunamadı!");
        }
        
        // UI'ı sıfırla
        this.resetCameraUI();
    }

    // Diğer kamera fonksiyonları aynı kalacak...
    // ... (kamera fonksiyonları değişmedi)
}

// Global POS instance'ı oluştur ve window'a ata
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 DOM yüklendi - POS sistemi başlatılıyor");
    
    // Eğer zaten bir instance varsa kullan, yoksa oluştur
    if (!window.pos) {
        window.pos = new TekelPOS();
        console.log("✅ POS instance oluşturuldu ve window.pos'a atandı");
    } else {
        console.log("ℹ️ Mevcut POS instance kullanılıyor");
    }
    
    // Kamera butonlarına event listener ekle
    const startCameraBtn = document.getElementById('startCameraBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    
    if (startCameraBtn) {
        startCameraBtn.addEventListener('click', function(e) {
            console.log("📷 Kamera başlat butonuna tıklandı");
            e.preventDefault();
            if (window.pos && typeof window.pos.startRealCamera === 'function') {
                window.pos.startRealCamera();
            } else {
                console.error("❌ POS instance veya startRealCamera bulunamadı");
                alert("Sistem hazır değil. Lütfen sayfayı yenileyin.");
            }
        });
    }
    
    if (stopCameraBtn) {
        stopCameraBtn.addEventListener('click', function(e) {
            console.log("⏹️ Kamera durdur butonuna tıklandı");
            e.preventDefault();
            if (window.pos && typeof window.pos.stopCamera === 'function') {
                window.pos.stopCamera();
            }
        });
    }
});

// Global fonksiyonlar aynı kalacak...
// ... (global fonksiyonlar değişmedi)

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', function() {
    if (window.pos) window.pos.setupBeforeUnload();
});
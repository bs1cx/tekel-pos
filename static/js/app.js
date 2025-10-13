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
        
        // Barkod tarama için
        this.lastScannedBarcode = null;
        this.scanCooldown = 2000; // 2 saniye
        
        this.init();
    }

    async init() {
        console.log("🚀 POS sistemi başlatılıyor...");
        this.setupEventListeners();
        await this.checkAuth();
        this.startPolling();
    }

    // MODAL FONKSİYONLARI
    openModal(modalId) {
        console.log('Modal açılıyor:', modalId);
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('show');
            // Modal açılınca body'ye class ekle (scroll'u engellemek için)
            document.body.classList.add('modal-open');
        }
    }

    closeModal(modalId) {
        console.log('Modal kapanıyor:', modalId);
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
            // Modal kapanınca body'den class kaldır
            document.body.classList.remove('modal-open');
        }
    }

    // Modal dışına tıklayınca kapat
    setupModalCloseEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });

        // Kapatma butonları
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    // POLLING SİSTEMİ
    startPolling() {
        console.log("🔄 Polling sistemi başlatılıyor...");
        
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
        if (!this.currentUser) return;
        
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
        
        await this.loadLowStock();
    }

    async checkAuth() {
        console.log("🔐 Auth kontrolü yapılıyor...");
        const userData = localStorage.getItem('userData');
        if (userData) {
            try {
                this.currentUser = JSON.parse(userData);
                this.showApp();
                await this.loadInitialData();
            } catch (error) {
                console.error("Kullanıcı verisi okunamadı:", error);
                this.showLogin();
            }
        } else {
            this.showLogin();
        }
    }

    setupEventListeners() {
        if (this._eventsBound) {
            console.log("ℹ️ Event listener'lar zaten bağlanmış");
            return;
        }
        this._eventsBound = true;
        
        console.log("🔗 Event listener'lar bağlanıyor...");

        // Modal kapatma event'lerini kur
        this.setupModalCloseEvents();

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

        // EVENT DELEGATION ile tüm butonları dinle
        document.addEventListener('click', (e) => {
            const target = e.target;
            
            // Kasa butonları
            if (target.id === 'openCashBtn' || target.closest('#openCashBtn')) {
                this.openCashRegisterModal();
                return;
            }
            
            if (target.id === 'closeCashBtn' || target.closest('#closeCashBtn')) {
                this.closeCashRegisterModal();
                return;
            }

            // Stok kaydetme butonları
            if (target.classList.contains('save-stock-btn') || target.closest('.save-stock-btn')) {
                const btn = target.classList.contains('save-stock-btn') ? target : target.closest('.save-stock-btn');
                const barcode = btn.dataset.barcode;
                console.log(`💾 Stok kaydet: ${barcode}`);
                this.saveStock(barcode);
                return;
            }

            // Hızlı stok ekleme butonları
            if (target.classList.contains('btn-primary')) {
                const text = target.textContent.trim();
                let barcode = null;
                let quantity = 0;

                // onclick attribute'undan barkodu al
                if (target.getAttribute('onclick')) {
                    const match = target.getAttribute('onclick').match(/pos\.quickAddStock\('([^']+)',\s*(\d+)\)/);
                    if (match) {
                        barcode = match[1];
                        quantity = parseInt(match[2]);
                    }
                }

                // Eğer onclick yoksa, parent'dan bak
                if (!barcode && target.closest('[onclick]')) {
                    const parentOnClick = target.closest('[onclick]').getAttribute('onclick');
                    const match = parentOnClick.match(/pos\.quickAddStock\('([^']+)',\s*(\d+)\)/);
                    if (match) {
                        barcode = match[1];
                        quantity = parseInt(match[2]);
                    }
                }

                if (barcode && quantity > 0) {
                    console.log(`📦 Hızlı stok +${quantity}: ${barcode}`);
                    this.quickAddStock(barcode, quantity);
                    return;
                }
            }

            // Admin butonları
            if (target.classList.contains('btn-success') && target.textContent.includes('Yeni Kullanıcı')) {
                this.openAddUserModal();
                return;
            }

            if (target.classList.contains('btn-primary') && target.textContent.includes('Yenile')) {
                if (this.currentTab === 'admin') {
                    this.loadAuditLogs();
                }
                return;
            }

            // Rapor butonları
            if (target.classList.contains('btn-primary') && target.textContent.includes('Filtrele')) {
                this.loadSalesReport();
                return;
            }

            // Ürün butonları
            if (target.classList.contains('btn-primary') && target.textContent.includes('Yenile')) {
                if (this.currentTab === 'products') {
                    this.loadProducts();
                }
                return;
            }

            // Modal içindeki action butonları
            if (target.id === 'addProductBtn' || target.closest('#addProductBtn')) {
                this.addNewProduct();
                return;
            }

            if (target.id === 'addScannedProductBtn' || target.closest('#addScannedProductBtn')) {
                this.addScannedProductToStock();
                return;
            }

            if (target.id === 'openCashConfirmBtn' || target.closest('#openCashConfirmBtn')) {
                this.openCash();
                return;
            }

            if (target.id === 'closeCashConfirmBtn' || target.closest('#closeCashConfirmBtn')) {
                this.closeCash();
                return;
            }

            if (target.id === 'createUserBtn' || target.closest('#createUserBtn')) {
                this.createNewUser();
                return;
            }

            if (target.id === 'completeSaleBtn' || target.closest('#completeSaleBtn')) {
                this.completeSale();
                return;
            }

            // Çıkış butonu
            if (target.id === 'logoutBtn' || target.closest('#logoutBtn')) {
                this.logout();
                return;
            }

            // Yeni ürün ekle butonu
            if (target.id === 'newProductBtn' || target.closest('#newProductBtn')) {
                this.openAddProductModal();
                return;
            }
        });

        // Input event'leri
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('stock-input')) {
                // Stok input değişikliğinde otomatik kaydetme devre dışı
                console.log('Stok değişti:', e.target.value);
            }
        });
    }

    async login() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        if (!username || !password) {
            this.showStatus('Kullanıcı adı ve şifre gerekli', 'error');
            return;
        }

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
                this.startPolling();
                this.showStatus('Başarıyla giriş yapıldı', 'success');
                
                // Login modal'ını kapat
                this.closeModal('loginModal');
            } else {
                this.showStatus(result.message || 'Giriş başarısız', 'error');
            }
        } catch (error) {
            this.showStatus('Sunucu hatası: ' + error.message, 'error');
        }
    }

    logout() {
        this.stopPolling();
        localStorage.removeItem('userData');
        this.currentUser = null;
        this.showLogin();
        this.showStatus('Çıkış yapıldı', 'success');
    }

    showLogin() {
        console.log("🔐 Login ekranı gösteriliyor");
        document.getElementById('loginModal').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
        this.stopPolling();
        
        // Diğer tüm modal'ları kapat
        this.closeAllModals();
    }

    showApp() {
        console.log("📱 Ana uygulama gösteriliyor");
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

    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (modal.id !== 'loginModal') {
                modal.style.display = 'none';
                modal.classList.remove('show');
            }
        });
        document.body.classList.remove('modal-open');
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

    // Sekme Yönetimi
    openTab(tabName) {
        console.log(`📑 Sekme açılıyor: ${tabName}`);
        
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
            <div class="product-card">
                <div class="product-info">
                    <h4>${product.name}</h4>
                    <div class="product-details">
                        <span class="price">${product.price} TL</span>
                        <span class="stock">Stok: ${product.quantity}</span>
                    </div>
                    <div class="barcode">${product.barcode}</div>
                </div>
                <button class="btn-primary btn-small" onclick="pos.addToCart('${product.barcode}')">
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
            const currentProduct = this.products.find(p => p.barcode === barcode);
            if (!currentProduct) {
                this.showStatus('Ürün bulunamadı', 'error');
                return;
            }

            const quantityDifference = newQuantity - currentProduct.quantity;

            const response = await fetch('/api/stock/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    quantity: quantityDifference
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
        document.getElementById('newProductBarcode').value = '';
        document.getElementById('newProductName').value = '';
        document.getElementById('newProductQuantity').value = '1';
        document.getElementById('newProductPrice').value = '';
        document.getElementById('newProductOTV').value = '0';
        document.getElementById('newProductKDV').value = '18';
        document.getElementById('newProductMinStock').value = '5';
        
        this.openModal('addProductModal');
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

        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        if (cartCount) cartCount.textContent = totalItems;
        
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

        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const kdvRate = 0.18;
        const kdvAmount = subtotal * kdvRate;
        const total = subtotal + kdvAmount;

        if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2) + ' TL';
        if (kdvAmountEl) kdvAmountEl.textContent = kdvAmount.toFixed(2) + ' TL';
        if (totalAmountEl) totalAmountEl.textContent = total.toFixed(2) + ' TL';

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
                
                const barcodeInput = document.getElementById('barcodeInput');
                if (barcodeInput) barcodeInput.focus();
            } else {
                this.showStatus('Satış sırasında hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Satış sırasında hata: ' + error.message, 'error');
        }
    }

    // Dashboard ve diğer metodlar aynı kalacak...
    // Kısaltma için bu kısmı aynı bırakıyorum, gerçek kodda tüm metodlar mevcut

    // KAMERA FONKSİYONLARI - GÜNCELLENDİ
    initCamera() {
        console.log("📱 Gelişmiş kamera sistemi hazırlanıyor...");
        
        this.canvasElement = document.getElementById('canvasElement');
        if (this.canvasElement) {
            this.canvasContext = this.canvasElement.getContext('2d', { willReadFrequently: true });
            console.log("✅ Canvas başarıyla oluşturuldu");
        } else {
            console.error("❌ Canvas element bulunamadı!");
        }
        
        this.resetCameraUI();
    }

    resetCameraUI() {
        const statusEl = document.getElementById('cameraStatus');
        const previewEl = document.getElementById('cameraPreview');
        const resultEl = document.getElementById('scanResult');
        
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-camera"></i> Kamera hazır';
        if (previewEl) previewEl.style.display = 'none';
        if (resultEl) resultEl.style.display = 'none';
    }

    async startRealCamera() {
        console.log("📷 Kamera başlatılıyor...");
        
        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            
            const videoElement = document.getElementById('videoElement');
            if (videoElement) {
                videoElement.srcObject = this.videoStream;
                videoElement.play();
                
                const previewEl = document.getElementById('cameraPreview');
                if (previewEl) previewEl.style.display = 'block';
                
                const statusEl = document.getElementById('cameraStatus');
                if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Kamera aktif';
                
                this.scanning = true;
                this.startQRScanning();
            }
        } catch (error) {
            console.error("Kamera hatası:", error);
            this.showCameraError();
        }
    }

    showCameraError() {
        const statusEl = document.getElementById('cameraStatus');
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Kamera erişimi reddedildi';
        }
        this.showStatus('Kamera erişimi için izin gerekli', 'error');
    }

    stopCamera() {
        console.log("📷 Kamera durduruluyor...");
        this.scanning = false;
        
        if (this.jsQRInterval) {
            clearInterval(this.jsQRInterval);
            this.jsQRInterval = null;
        }
        
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        const videoElement = document.getElementById('videoElement');
        if (videoElement) {
            videoElement.srcObject = null;
        }
        
        const previewEl = document.getElementById('cameraPreview');
        if (previewEl) previewEl.style.display = 'none';
    }

    startQRScanning() {
        console.log("🔍 QR/Barkod tarama başlatılıyor...");
        
        if (this.jsQRInterval) {
            clearInterval(this.jsQRInterval);
        }
        
        this.jsQRInterval = setInterval(() => {
            if (!this.scanning) return;
            this.scanBarcode();
        }, 500); // Her 500ms'de bir tarama
    }

    scanBarcode() {
        const videoElement = document.getElementById('videoElement');
        const canvasElement = document.getElementById('canvasElement');
        const canvasContext = this.canvasContext;
        
        if (!videoElement || !canvasElement || !canvasContext || videoElement.readyState !== 4) {
            return;
        }

        try {
            // Canvas boyutlarını video ile eşle
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            
            // Video'dan canvas'a görüntü çiz
            canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
            
            // ImageData al
            const imageData = canvasContext.getImageData(0, 0, canvasElement.width, canvasElement.height);
            
            // Barkod tarama
            this.scanWithQuagga(imageData);
            
        } catch (error) {
            console.error("Tarama hatası:", error);
        }
    }

    scanWithQuagga(imageData) {
        // QuaggaJS barkod tarama
        try {
            Quagga.decodeSingle({
                decoder: {
                    readers: ['code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader', 'upc_reader']
                },
                locate: true,
                src: canvasElement.toDataURL(),
            }, (result) => {
                if (result && result.codeResult) {
                    this.handleScannedBarcode(result.codeResult.code);
                }
            });
        } catch (error) {
            console.log("Quagga tarama hatası:", error);
        }
    }

    handleScannedBarcode(barcode) {
        // Aynı barkodu tekrar taramayı engelle
        const now = Date.now();
        if (this.lastScannedBarcode === barcode && now - this.lastScanTime < this.scanCooldown) {
            return;
        }
        
        this.lastScannedBarcode = barcode;
        this.lastScanTime = now;
        
        console.log("📦 Barkod taranan:", barcode);
        this.showScanResult(barcode);
        
        // Ürün kontrolü
        this.checkScannedProduct(barcode);
    }

    showScanResult(barcode) {
        const resultEl = document.getElementById('scanResult');
        const barcodeEl = document.getElementById('scannedBarcode');
        
        if (resultEl && barcodeEl) {
            barcodeEl.textContent = barcode;
            resultEl.style.display = 'block';
        }
        
        this.showStatus(`Barkod taranan: ${barcode}`, 'success');
    }

    async checkScannedProduct(barcode) {
        const product = this.products.find(p => p.barcode === barcode);
        const resultEl = document.getElementById('scanResult');
        const productInfoEl = document.getElementById('scannedProductInfo');
        const addBtn = document.getElementById('addScannedProductBtn');
        
        if (!resultEl || !productInfoEl) return;
        
        if (product) {
            // Ürün var - bilgileri göster
            productInfoEl.innerHTML = `
                <div class="product-found">
                    <h4>${product.name}</h4>
                    <div class="product-details">
                        <span class="price">${product.price} TL</span>
                        <span class="stock">Mevcut Stok: ${product.quantity}</span>
                    </div>
                </div>
            `;
            
            if (addBtn) {
                addBtn.innerHTML = '<i class="fas fa-plus"></i> Stok Ekle';
                addBtn.onclick = () => this.addScannedProductToStock();
            }
        } else {
            // Ürün yok - yeni ürün ekleme
            productInfoEl.innerHTML = `
                <div class="product-not-found">
                    <h4><i class="fas fa-exclamation-triangle"></i> Ürün Bulunamadı</h4>
                    <p>Yeni ürün olarak eklemek ister misiniz?</p>
                </div>
            `;
            
            if (addBtn) {
                addBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Yeni Ürün Ekle';
                addBtn.onclick = () => this.addNewScannedProduct(barcode);
            }
        }
    }

    addScannedProductToStock() {
        const barcode = this.lastScannedBarcode;
        if (!barcode) {
            this.showStatus('Önce bir barkod tarayın', 'error');
            return;
        }
        
        const quickBarcodeInput = document.getElementById('quickBarcodeInput');
        if (quickBarcodeInput) {
            quickBarcodeInput.value = barcode;
            quickBarcodeInput.focus();
        }
        
        this.showStatus(`Stok ekleme için barkod hazır: ${barcode}`, 'success');
    }

    addNewScannedProduct(barcode) {
        document.getElementById('newProductBarcode').value = barcode;
        this.openModal('addProductModal');
        this.closeModal('scanResultModal');
    }

    // Hızlı Stok Ekleme
    quickAddStock(barcode, quantity) {
        console.log(`📦 Hızlı stok ekleme: ${barcode} +${quantity}`);
        
        const input = document.querySelector(`.stock-input[data-barcode="${barcode}"]`);
        if (input) {
            const currentValue = parseInt(input.value) || 0;
            input.value = currentValue + quantity;
            this.saveStock(barcode);
        } else {
            this.showStatus('Stok inputu bulunamadı', 'error');
        }
    }

    async quickStockAdd() {
        const barcodeInput = document.getElementById('quickBarcodeInput');
        const quantityInput = document.getElementById('quickStockQuantity');
        
        const barcode = barcodeInput?.value.trim();
        const quantity = parseInt(quantityInput?.value) || 1;
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'error');
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
                    quantity: quantity
                })
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Stok başarıyla eklendi: +${quantity}`, 'success');
                barcodeInput.value = '';
                quantityInput.value = '1';
                await this.loadProducts();
                await this.loadInventory();
            } else {
                this.showStatus('Stok eklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Stok eklenirken hata: ' + error.message, 'error');
        }
    }

    // Kasa Yönetimi
    openCashRegisterModal() {
        this.openModal('cashRegisterModal');
    }

    closeCashRegisterModal() {
        this.closeModal('cashRegisterModal');
    }

    async openCash() {
        const amount = parseFloat(document.getElementById('openCashAmount')?.value) || 0;
        
        if (amount <= 0) {
            this.showStatus('Geçerli bir miktar girin', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/cash/open', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({ amount: amount })
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Kasa açıldı: ${amount} TL`, 'success');
                this.closeModal('cashRegisterModal');
                await this.loadDashboardData();
            } else {
                this.showStatus('Kasa açılırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kasa açılırken hata: ' + error.message, 'error');
        }
    }

    async closeCash() {
        const amount = parseFloat(document.getElementById('closeCashAmount')?.value) || 0;
        
        try {
            const response = await fetch('/api/cash/close', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({ amount: amount })
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Kasa kapandı: ${amount} TL`, 'success');
                this.closeModal('cashRegisterModal');
                await this.loadDashboardData();
            } else {
                this.showStatus('Kasa kapanırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kasa kapanırken hata: ' + error.message, 'error');
        }
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
                const cashStatusEl = document.getElementById('cashStatus');
                if (cashStatusEl) {
                    cashStatusEl.innerHTML = result.is_open ? 
                        '<i class="fas fa-cash-register"></i> Kasa Açık' : 
                        '<i class="fas fa-cash-register"></i> Kasa Kapalı';
                }
            }
        } catch (error) {
            console.error('Kasa durumu kontrol hatası:', error);
        }
    }

    // Diğer metodlar...
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

    // Dashboard ve diğer metodlar...
    async loadDashboardData() {
        try {
            const response = await fetch('/api/dashboard', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.updateDashboard(result.data);
            }
        } catch (error) {
            console.error('Dashboard yüklenirken hata:', error);
        }
    }

    updateDashboard(data) {
        // Dashboard verilerini güncelle
        const dailySalesEl = document.getElementById('dailySales');
        const totalProductsEl = document.getElementById('totalProducts');
        const lowStockEl = document.getElementById('lowStock');
        const cashStatusEl = document.getElementById('cashStatus');
        
        if (dailySalesEl) dailySalesEl.textContent = `${data.daily_sales || 0} TL`;
        if (totalProductsEl) totalProductsEl.textContent = data.total_products || 0;
        if (lowStockEl) lowStockEl.textContent = data.low_stock_count || 0;
        
        // Son satışlar
        this.renderRecentSales(data.recent_sales || []);
    }

    renderRecentSales(sales) {
        const container = document.getElementById('recentSales');
        if (!container) return;
        
        if (sales.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-receipt"></i>
                    <p>Henüz satış yok</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = sales.map(sale => `
            <div class="sale-item">
                <div class="sale-info">
                    <strong>${sale.total_amount} TL</strong>
                    <small>${sale.payment_method}</small>
                </div>
                <div class="sale-time">
                    ${new Date(sale.created_at).toLocaleTimeString('tr-TR')}
                </div>
            </div>
        `).join('');
    }

    async loadLowStock() {
        try {
            const response = await fetch('/api/products/low-stock', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderLowStock(result.products);
            }
        } catch (error) {
            console.error('Düşük stok yüklenirken hata:', error);
        }
    }

    renderLowStock(products) {
        const container = document.getElementById('lowStockProducts');
        if (!container) return;
        
        if (products.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Tüm stoklar yeterli</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = products.map(product => `
            <div class="low-stock-item">
                <div class="product-info">
                    <strong>${product.name}</strong>
                    <small>${product.barcode}</small>
                </div>
                <div class="stock-info">
                    <span class="stock-badge ${product.quantity === 0 ? 'danger' : 'warning'}">
                        ${product.quantity}
                    </span>
                </div>
            </div>
        `).join('');
    }

    // Admin metodları...
    async loadAdminData() {
        await this.loadUsers();
        await this.loadAuditLogs();
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderUsers(result.users);
            }
        } catch (error) {
            console.error('Kullanıcılar yüklenirken hata:', error);
        }
    }

    renderUsers(users) {
        const container = document.getElementById('usersList');
        if (!container) return;
        
        container.innerHTML = users.map(user => `
            <div class="user-card">
                <div class="user-info">
                    <h4>${user.full_name}</h4>
                    <div class="user-details">
                        <span class="username">@${user.username}</span>
                        <span class="role ${user.role}">${this.getRoleText(user.role)}</span>
                    </div>
                </div>
                <div class="user-stats">
                    <small>Son Giriş: ${user.last_login ? new Date(user.last_login).toLocaleDateString('tr-TR') : 'Hiç'}</small>
                </div>
            </div>
        `).join('');
    }

    openAddUserModal() {
        this.openModal('addUserModal');
    }

    async createNewUser() {
        const form = document.getElementById('addUserForm');
        const formData = new FormData(form);
        
        const userData = {
            full_name: formData.get('full_name'),
            username: formData.get('username'),
            password: formData.get('password'),
            role: formData.get('role')
        };
        
        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify(userData)
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kullanıcı başarıyla oluşturuldu', 'success');
                this.closeModal('addUserModal');
                await this.loadUsers();
                form.reset();
            } else {
                this.showStatus('Kullanıcı oluşturulurken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Kullanıcı oluşturulurken hata: ' + error.message, 'error');
        }
    }

    async loadAuditLogs() {
        try {
            const response = await fetch('/api/admin/audit-logs', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderAuditLogs(result.logs);
            }
        } catch (error) {
            console.error('Denetim kayıtları yüklenirken hata:', error);
        }
    }

    renderAuditLogs(logs) {
        const container = document.getElementById('auditLogs');
        if (!container) return;
        
        if (logs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clipboard-list"></i>
                    <p>Henüz kayıt yok</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = logs.map(log => `
            <div class="audit-log">
                <div class="log-info">
                    <strong>${log.user_name}</strong>
                    <p>${log.action}</p>
                    <small>${new Date(log.created_at).toLocaleString('tr-TR')}</small>
                </div>
            </div>
        `).join('');
    }

    loadBackupInfo() {
        const container = document.getElementById('backupInfo');
        if (!container) return;
        
        container.innerHTML = `
            <div class="backup-card">
                <h4><i class="fas fa-database"></i> Veritabanı Yedekleme</h4>
                <p>Son yedekleme: ${new Date().toLocaleDateString('tr-TR')}</p>
                <button class="btn-primary" onclick="pos.createBackup()">
                    <i class="fas fa-save"></i> Yedek Oluştur
                </button>
            </div>
        `;
    }

    async createBackup() {
        try {
            const response = await fetch('/api/admin/backup', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Yedekleme başarıyla oluşturuldu', 'success');
            } else {
                this.showStatus('Yedekleme oluşturulurken hata: ' + result.message, 'error');
            }
        } catch (error) {
            this.showStatus('Yedekleme oluşturulurken hata: ' + error.message, 'error');
        }
    }

    // Envanter yönetimi
    async loadInventory() {
        try {
            const response = await fetch('/api/inventory', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderInventory(result.products);
            }
        } catch (error) {
            console.error('Envanter yüklenirken hata:', error);
        }
    }

    renderInventory(products) {
        const container = document.getElementById('inventoryTableBody');
        if (!container) return;
        
        if (products.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <i class="fas fa-boxes"></i>
                        <p>Henüz ürün yok</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        container.innerHTML = products.map(product => `
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
                    <button class="btn-primary btn-small" onclick="pos.quickAddStock('${product.barcode}', 1)">
                        +1
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // Raporlar
    async loadReports() {
        await this.loadSalesReport();
    }

    async loadSalesReport() {
        try {
            const startDate = document.getElementById('reportStartDate')?.value || 
                new Date().toISOString().split('T')[0];
            const endDate = document.getElementById('reportEndDate')?.value || 
                new Date().toISOString().split('T')[0];
                
            const response = await fetch(`/api/reports/sales?start_date=${startDate}&end_date=${endDate}`, {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                this.renderSalesReport(result.report);
            }
        } catch (error) {
            console.error('Rapor yüklenirken hata:', error);
        }
    }

    renderSalesReport(report) {
        const container = document.getElementById('salesReport');
        if (!container) return;
        
        container.innerHTML = `
            <div class="report-summary">
                <div class="report-card">
                    <h4>Toplam Satış</h4>
                    <div class="amount">${report.total_sales || 0} TL</div>
                </div>
                <div class="report-card">
                    <h4>Toplam İşlem</h4>
                    <div class="amount">${report.total_transactions || 0}</div>
                </div>
                <div class="report-card">
                    <h4>Nakit Satış</h4>
                    <div class="amount">${report.cash_sales || 0} TL</div>
                </div>
                <div class="report-card">
                    <h4>Kartlı Satış</h4>
                    <div class="amount">${report.card_sales || 0} TL</div>
                </div>
            </div>
            
            <div class="report-details">
                <h4>Satış Detayları</h4>
                ${this.renderSalesDetails(report.details || [])}
            </div>
        `;
    }

    renderSalesDetails(details) {
        if (details.length === 0) {
            return '<p class="empty-state">Seçilen tarih aralığında satış bulunamadı</p>';
        }
        
        return `
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Tarih</th>
                            <th>Fiş No</th>
                            <th>Toplam</th>
                            <th>Ödeme</th>
                            <th>Personel</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${details.map(sale => `
                            <tr>
                                <td>${new Date(sale.created_at).toLocaleDateString('tr-TR')}</td>
                                <td>${sale.id}</td>
                                <td>${sale.total_amount} TL</td>
                                <td>${sale.payment_method}</td>
                                <td>${sale.user_name}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
}

// Uygulamayı başlat
document.addEventListener('DOMContentLoaded', function() {
    console.log("🎯 POS sistemi yükleniyor...");
    window.pos = new TekelPOS();
});
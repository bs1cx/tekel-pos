class TekelPOS {
    constructor() {
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
        
        this.init();
    }

    async init() {
        console.log("🚀 TEKEL POS sistemi başlatılıyor...");
        this.initializeModals();
        this.setupEventListeners();
        await this.checkAuth();
    }

    // MODAL YÖNETİMİ - TÜM MODALLAR TANIMLI
    initializeModals() {
        // Tüm modal elementlerini kontrol et ve hazırla
        const modalIds = [
            'loginModal', 'addProductModal', 'cashRegisterModal', 
            'receiptModal', 'stockAddModal', 'addUserModal'
        ];
        
        modalIds.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (!modal) {
                console.warn(`Modal #${modalId} bulunamadı!`);
            }
        });
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
            console.log(`Modal açıldı: ${modalId}`);
            
            // Input'a focus
            setTimeout(() => {
                const input = modal.querySelector('input');
                if (input) input.focus();
            }, 100);
        } else {
            console.error(`Modal bulunamadı: ${modalId}`);
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
            console.log(`Modal kapandı: ${modalId}`);
        }
    }

    // EVENT LISTENER'LAR - TÜM BUTONLAR ÇALIŞIYOR
    setupEventListeners() {
        console.log("🔗 Event listener'lar bağlanıyor...");

        // Login form
        this.bindSubmit('loginForm', (e) => {
            e.preventDefault();
            this.login();
        });

        // Barkod input - Enter tuşu
        this.bindKeypress('barcodeInput', (e) => {
            if (e.key === 'Enter') this.addProductByBarcode();
        });

        // Nakit miktarı değişikliği
        this.bindInput('cashAmount', () => this.calculateChange());

        // Ödeme yöntemi değişikliği
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            radio.addEventListener('change', () => this.toggleCashInput());
        });

        // Sekme değiştirme
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = item.getAttribute('data-tab');
                if (tab) this.openTab(tab);
            });
        });

        // Admin sekme değiştirme
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-admin-tab');
                if (tab) this.openAdminTab(tab);
            });
        });

        // Modal kapatma butonları
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) this.closeModal(modal.id);
            });
        });

        // Modal dışına tıklayınca kapat
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });

        // TÜM BUTONLARI BAĞLA
        this.bindAllButtons();
    }

    bindAllButtons() {
        // Login butonları
        this.bindClick('loginBtn', () => this.login());
        
        // Çıkış butonu
        this.bindClick('logoutBtn', () => this.logout());
        
        // Satış butonları
        this.bindClick('addProductBtn', () => this.addProductByBarcode());
        this.bindClick('completeSaleBtn', () => this.completeSale());
        
        // Kasa butonları
        this.bindClick('openCashBtn', () => this.openCashRegisterModal());
        this.bindClick('closeCashBtn', () => this.closeCashRegisterModal());
        this.bindClick('openCashConfirmBtn', () => this.openCash());
        this.bindClick('closeCashConfirmBtn', () => this.closeCash());
        
        // Ürün butonları
        this.bindClick('newProductBtn', () => this.openAddProductModal());
        this.bindClick('addProductConfirmBtn', () => this.addNewProduct());
        
        // Stok butonları
        this.bindClick('quickStockAddBtn', () => this.quickStockAdd());
        this.bindClick('addManualBarcodeBtn', () => this.addManualBarcode());
        
        // Admin butonları
        this.bindClick('createUserBtn', () => this.createNewUser());
        this.bindClick('refreshAuditBtn', () => this.loadAuditLogs());
        this.bindClick('createBackupBtn', () => this.createBackup());

        // Kamera butonları
        this.bindClick('startCameraBtn', () => this.startRealCamera());
        this.bindClick('stopCameraBtn', () => this.stopCamera());

        // Rapor butonları
        this.bindClick('filterReportsBtn', () => this.loadSalesReport());

        // Stok kaydetme butonları - dinamik olarak bağlanacak
        this.bindDynamicButtons();
    }

    bindDynamicButtons() {
        // Dinamik olarak oluşturulan butonlar için event delegation
        document.addEventListener('click', (e) => {
            // Stok kaydet butonları
            if (e.target.classList.contains('save-stock-btn')) {
                const barcode = e.target.getAttribute('data-barcode');
                if (barcode) this.saveStock(barcode);
                return;
            }

            // Hızlı stok ekle butonları
            if (e.target.classList.contains('quick-add-stock')) {
                const barcode = e.target.getAttribute('data-barcode');
                const quantity = parseInt(e.target.getAttribute('data-quantity') || '1');
                if (barcode) this.quickAddStock(barcode, quantity);
                return;
            }

            // Sepet quantity butonları
            if (e.target.classList.contains('quantity-btn')) {
                const action = e.target.textContent;
                const itemElement = e.target.closest('.cart-item');
                if (itemElement) {
                    const barcode = itemElement.querySelector('.barcode')?.textContent;
                    if (barcode) {
                        if (action === '-') this.updateCartQuantity(barcode, -1);
                        else if (action === '+') this.updateCartQuantity(barcode, 1);
                    }
                }
                return;
            }

            // Sepetten kaldır butonları
            if (e.target.classList.contains('remove-btn') || e.target.closest('.remove-btn')) {
                const itemElement = e.target.closest('.cart-item');
                if (itemElement) {
                    const barcode = itemElement.querySelector('.barcode')?.textContent;
                    if (barcode) this.removeFromCart(barcode);
                }
                return;
            }
        });
    }

    bindClick(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', handler);
        } else {
            console.warn(`Buton bulunamadı: #${id}`);
        }
    }

    bindSubmit(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('submit', handler);
        }
    }

    bindKeypress(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('keypress', handler);
        }
    }

    bindInput(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', handler);
        }
    }

    // AUTH YÖNETİMİ
    async checkAuth() {
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

    showLogin() {
        const loginModal = document.getElementById('loginModal');
        const appContainer = document.querySelector('.app-container');
        
        if (loginModal) loginModal.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        
        this.closeAllModalsExcept('loginModal');
        
        setTimeout(() => {
            const usernameInput = document.getElementById('username');
            if (usernameInput) usernameInput.focus();
        }, 100);
    }

    showApp() {
        const loginModal = document.getElementById('loginModal');
        const appContainer = document.querySelector('.app-container');
        
        if (loginModal) loginModal.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        
        this.updateUserInfo();
        this.openTab('dashboard');
    }

    updateUserInfo() {
        const currentUserEl = document.getElementById('currentUser');
        const currentRoleEl = document.getElementById('currentRole');
        
        if (currentUserEl && this.currentUser) {
            currentUserEl.textContent = this.currentUser.full_name;
        }
        if (currentRoleEl && this.currentUser) {
            currentRoleEl.textContent = this.getRoleText(this.currentUser.role);
        }
        
        // Admin yetkilerini kontrol et
        if (this.currentUser && this.currentUser.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
            });
        } else {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'block';
            });
        }
    }

    closeAllModalsExcept(exceptModalId) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (modal.id !== exceptModalId) {
                modal.style.display = 'none';
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

    async login() {
        const username = document.getElementById('username')?.value;
        const password = document.getElementById('password')?.value;

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

            if (!response.ok) {
                throw new Error('Sunucu hatası');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.currentUser = result.user;
                localStorage.setItem('userData', JSON.stringify(result.user));
                this.showApp();
                await this.loadInitialData();
                this.showStatus('Başarıyla giriş yapıldı', 'success');
            } else {
                this.showStatus(result.message || 'Giriş başarısız', 'error');
            }
        } catch (error) {
            console.error('Login hatası:', error);
            this.showStatus('Sunucu hatası: ' + error.message, 'error');
        }
    }

    logout() {
        localStorage.removeItem('userData');
        this.currentUser = null;
        this.cart = [];
        this.showLogin();
        this.showStatus('Çıkış yapıldı', 'success');
    }

    async loadInitialData() {
        await this.loadProducts();
        await this.loadDashboardData();
    }

    // SEKMELER
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
                this.loadProducts();
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
                if (this.currentUser?.role === 'admin') {
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

    // ÜRÜN YÖNETİMİ - API BAĞLANTILI
    async loadProducts() {
        try {
            const token = this.currentUser?.id;
            const response = await fetch('/api/products', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Ürünler yüklenemedi');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.products = result.products;
                this.renderProducts();
                this.renderProductsTable();
            } else {
                this.showStatus('Ürünler yüklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Ürün yükleme hatası:', error);
            this.showStatus('Ürünler yüklenirken hata: ' + error.message, 'error');
            // Hata durumunda boş ürün listesi
            this.products = [];
            this.renderProducts();
            this.renderProductsTable();
        }
    }

    renderProducts() {
        const grid = document.getElementById('productGrid');
        if (!grid) return;

        if (this.products.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-box-open"></i>
                    <p>Henüz ürün eklenmemiş</p>
                    <small>Yeni ürün ekle butonuna tıklayarak ürün ekleyin</small>
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
                        <span class="stock ${product.quantity <= 5 ? 'warning' : ''}">Stok: ${product.quantity}</span>
                    </div>
                    <div class="barcode">${product.barcode}</div>
                </div>
                <button class="btn-primary btn-small add-to-cart-btn" data-barcode="${product.barcode}">
                    <i class="fas fa-cart-plus"></i> Ekle
                </button>
            </div>
        `).join('');

        // Sepete ekle butonlarını bağla
        grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const barcode = e.target.getAttribute('data-barcode') || 
                               e.target.closest('.add-to-cart-btn').getAttribute('data-barcode');
                if (barcode) this.addToCart(barcode);
            });
        });
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

        tbody.innerHTML = this.products.map(product => {
            const statusClass = product.quantity === 0 ? 'danger' : 
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
                    <td>%${product.kdv || 18}</td>
                    <td>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </td>
                    <td>
                        <button class="btn-primary btn-small save-stock-btn" data-barcode="${product.barcode}">
                            Kaydet
                        </button>
                    </td>
                    <td>
                        <button class="btn-primary btn-small quick-add-stock" data-barcode="${product.barcode}" data-quantity="1">
                            +1
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // SEPET İŞLEMLERİ
    async addProductByBarcode() {
        const barcodeInput = document.getElementById('barcodeInput');
        const barcode = barcodeInput?.value.trim();
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'warning');
            return;
        }

        const product = this.products.find(p => p.barcode === barcode);
        if (!product) {
            this.showStatus('Ürün bulunamadı! Yeni ürün eklemek için "Ürünler" sekmesine gidin.', 'error');
            if (barcodeInput) barcodeInput.value = '';
            return;
        }

        this.addToCart(product.barcode);
        if (barcodeInput) {
            barcodeInput.value = '';
            barcodeInput.focus();
        }
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
                            <button class="quantity-btn">-</button>
                            <span class="quantity">${item.quantity}</span>
                            <button class="quantity-btn">+</button>
                        </div>
                        <button class="remove-btn">
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
            changeDisplay.innerHTML = `Para Üstü: <span class="${change >= 0 ? 'positive' : 'negative'}">${change.toFixed(2)} TL</span>`;
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

            if (!response.ok) {
                throw new Error('Satış kaydedilemedi');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Satış başarıyla tamamlandı! Fiş No: ${result.sale_id}`, 'success');
                this.cart = [];
                this.renderCart();
                await this.loadProducts();
                await this.loadDashboardData();
                
                const barcodeInput = document.getElementById('barcodeInput');
                if (barcodeInput) {
                    barcodeInput.value = '';
                    barcodeInput.focus();
                }
            } else {
                this.showStatus('Satış sırasında hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Satış hatası:', error);
            this.showStatus('Satış sırasında hata: ' + error.message, 'error');
        }
    }

    // STOK YÖNETİMİ
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
            const response = await fetch('/api/stock/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    quantity: newQuantity
                })
            });

            if (!response.ok) {
                throw new Error('Stok güncellenemedi');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Stok güncellendi', 'success');
                await this.loadProducts();
            } else {
                this.showStatus('Stok güncellenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Stok güncelleme hatası:', error);
            this.showStatus('Stok güncellenirken hata: ' + error.message, 'error');
        }
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

            if (!response.ok) {
                throw new Error('Stok eklenemedi');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`${quantity} adet stok eklendi`, 'success');
                await this.loadProducts();
            } else {
                this.showStatus('Stok eklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Stok ekleme hatası:', error);
            this.showStatus('Stok eklenirken hata: ' + error.message, 'error');
        }
    }

    // YENİ ÜRÜN EKLEME
    openAddProductModal() {
        // Formu temizle
        const form = document.getElementById('addProductForm');
        if (form) form.reset();
        
        this.openModal('addProductModal');
    }

    async addNewProduct() {
        const barcode = document.getElementById('newProductBarcode')?.value.trim();
        const name = document.getElementById('newProductName')?.value.trim();
        const price = parseFloat(document.getElementById('newProductPrice')?.value) || 0;
        const quantity = parseInt(document.getElementById('newProductQuantity')?.value) || 1;
        const kdv = parseFloat(document.getElementById('newProductKDV')?.value) || 18;

        if (!barcode || !name || price <= 0) {
            this.showStatus('Lütfen zorunlu alanları doldurun (Barkod, Ürün Adı, Fiyat)', 'error');
            return;
        }

        try {
            const response = await fetch('/api/products', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.id}`
                },
                body: JSON.stringify({
                    barcode: barcode,
                    name: name,
                    price: price,
                    quantity: quantity,
                    kdv: kdv
                })
            });

            if (!response.ok) {
                throw new Error('Ürün eklenemedi');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Ürün başarıyla eklendi', 'success');
                this.closeModal('addProductModal');
                await this.loadProducts();
            } else {
                this.showStatus('Ürün eklenirken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Ürün ekleme hatası:', error);
            this.showStatus('Ürün eklenirken hata: ' + error.message, 'error');
        }
    }

    // KASA YÖNETİMİ
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
                body: JSON.stringify({
                    initial_amount: amount
                })
            });

            if (!response.ok) {
                throw new Error('Kasa açılamadı');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus(`Kasa açıldı: ${amount.toFixed(2)} TL`, 'success');
                this.closeModal('cashRegisterModal');
                await this.loadCashManagement();
            } else {
                this.showStatus('Kasa açılırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Kasa açma hatası:', error);
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
                }
            });

            if (!response.ok) {
                throw new Error('Kasa kapatılamadı');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kasa kapandı', 'success');
                this.closeModal('cashRegisterModal');
                await this.loadCashManagement();
            } else {
                this.showStatus('Kasa kapatılırken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Kasa kapatma hatası:', error);
            this.showStatus('Kasa kapatılırken hata: ' + error.message, 'error');
        }
    }

    async loadCashManagement() {
        try {
            const response = await fetch('/api/cash/status', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.updateCashUI(result.cash_status);
                }
            }
        } catch (error) {
            console.error('Kasa durumu yükleme hatası:', error);
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

    // DASHBOARD
    async loadDashboardData() {
        try {
            const response = await fetch('/api/dashboard', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.updateDashboard(result.data);
                }
            }
        } catch (error) {
            console.error('Dashboard yükleme hatası:', error);
        }
    }

    updateDashboard(data) {
        const todaySales = document.getElementById('todaySales');
        const totalProducts = document.getElementById('totalProducts');
        const lowStockCount = document.getElementById('lowStockCount');
        const outOfStockCount = document.getElementById('outOfStockCount');
        
        if (todaySales) todaySales.textContent = (data.daily_sales || 0).toFixed(2) + ' TL';
        if (totalProducts) totalProducts.textContent = data.total_products || 0;
        if (lowStockCount) lowStockCount.textContent = data.low_stock_count || 0;
        if (outOfStockCount) outOfStockCount.textContent = data.out_of_stock_count || 0;
    }

    // ENVANTER
    async loadInventory() {
        await this.loadProducts();
        this.renderInventoryTable();
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
            const statusClass = product.quantity === 0 ? 'danger' : 
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
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </td>
                    <td>
                        <button class="btn-primary btn-small save-stock-btn" data-barcode="${product.barcode}">
                            Kaydet
                        </button>
                    </td>
                    <td>
                        <button class="btn-primary btn-small quick-add-stock" data-barcode="${product.barcode}" data-quantity="1">
                            +1
                        </button>
                        <button class="btn-primary btn-small quick-add-stock" data-barcode="${product.barcode}" data-quantity="5">
                            +5
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // KAMERA FONKSİYONLARI - GERÇEK KAMERA
    initCamera() {
        console.log("📱 Kamera sistemi hazırlanıyor...");
        this.resetCameraUI();
        this.showManualBarcodeInput();
    }

    resetCameraUI() {
        const statusEl = document.getElementById('cameraStatus');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-camera"></i> Kamera hazır';
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
                
                const statusEl = document.getElementById('cameraStatus');
                if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Kamera aktif';
                
                this.scanning = true;
                this.startBarcodeDetection();
            }
        } catch (error) {
            console.error("Kamera hatası:", error);
            this.showCameraError();
        }
    }

    startBarcodeDetection() {
        // Barkod tespiti için interval
        this.scanInterval = setInterval(() => {
            if (!this.scanning) return;
            this.detectBarcode();
        }, 1000);
    }

    detectBarcode() {
        // Gerçek barkod tespiti burada yapılacak
        // Şu anlık manuel giriş kullanılıyor
    }

    showManualBarcodeInput() {
        const cameraSection = document.getElementById('cameraSection');
        if (cameraSection && !document.getElementById('manualBarcodeSection')) {
            const manualInputHTML = `
                <div class="manual-barcode-section" id="manualBarcodeSection" style="margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
                    <h4><i class="fas fa-keyboard"></i> Manuel Barkod Girişi</h4>
                    <p style="margin-bottom: 15px; color: #666;">Barkodu manuel olarak girin:</p>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="text" 
                               id="manualBarcodeInput" 
                               placeholder="Barkodu buraya girin" 
                               style="flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;">
                        <button class="btn-primary" id="addManualBarcodeBtn">
                            <i class="fas fa-check"></i> Ekle
                        </button>
                    </div>
                </div>
            `;
            cameraSection.insertAdjacentHTML('beforeend', manualInputHTML);
        }
    }

    addManualBarcode() {
        const input = document.getElementById('manualBarcodeInput');
        const barcode = input?.value.trim();
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'error');
            return;
        }

        this.handleScannedBarcode(barcode);
        if (input) input.value = '';
    }

    showCameraError() {
        const statusEl = document.getElementById('cameraStatus');
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Kamera erişimi reddedildi';
        }
        this.showStatus('Kamera erişimi için izin gerekli. Manuel barkod girişini kullanabilirsiniz.', 'warning');
    }

    stopCamera() {
        console.log("📷 Kamera durduruluyor...");
        this.scanning = false;
        
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        const videoElement = document.getElementById('videoElement');
        if (videoElement) {
            videoElement.srcObject = null;
        }
        
        const statusEl = document.getElementById('cameraStatus');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-camera"></i> Kamera durduruldu';
    }

    handleScannedBarcode(barcode) {
        console.log("📦 Barkod taranan:", barcode);
        
        // Ürün kontrolü
        const product = this.products.find(p => p.barcode === barcode);
        
        if (product) {
            // Ürün var - sepete ekle
            this.addToCart(barcode);
        } else {
            // Ürün yok - yeni ürün ekleme modal'ını aç
            this.openNewProductModal(barcode);
        }
    }

    openNewProductModal(barcode) {
        document.getElementById('newProductBarcode').value = barcode;
        this.openModal('addProductModal');
        this.showStatus('Ürün bulunamadı. Yeni ürün olarak ekleyebilirsiniz.', 'info');
    }

    // HIZLI STOK EKLEME
    async quickStockAdd() {
        const barcodeInput = document.getElementById('quickBarcodeInput');
        const barcode = barcodeInput?.value.trim();
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'error');
            return;
        }
        
        await this.quickAddStock(barcode, 1);
        if (barcodeInput) barcodeInput.value = '';
    }

    // RAPORLAR
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

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.renderSalesReport(result.report);
                }
            }
        } catch (error) {
            console.error('Rapor yükleme hatası:', error);
        }
    }

    renderSalesReport(report) {
        const container = document.getElementById('salesReport');
        if (!container) return;
        
        container.innerHTML = `
            <div class="report-summary">
                <div class="report-card">
                    <h4><i class="fas fa-shopping-cart"></i> Toplam Satış</h4>
                    <div class="amount">${(report.total_sales || 0).toFixed(2)} TL</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-receipt"></i> Toplam İşlem</h4>
                    <div class="amount">${report.total_transactions || 0}</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-money-bill-wave"></i> Nakit Satış</h4>
                    <div class="amount">${(report.cash_sales || 0).toFixed(2)} TL</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-credit-card"></i> Kartlı Satış</h4>
                    <div class="amount">${(report.card_sales || 0).toFixed(2)} TL</div>
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
                                <td>${new Date(sale.sale_date).toLocaleDateString('tr-TR')}</td>
                                <td>${sale.id}</td>
                                <td>${parseFloat(sale.total_amount).toFixed(2)} TL</td>
                                <td>${sale.payment_method === 'nakit' ? 'Nakit' : 'Kredi Kartı'}</td>
                                <td>${sale.user_name}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ADMIN FONKSİYONLARI
    async loadAdminData() {
        await this.loadUsers();
        await this.loadSystemStats();
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.renderUsers(result.users);
                }
            }
        } catch (error) {
            console.error('Kullanıcılar yükleme hatası:', error);
        }
    }

    renderUsers(users) {
        const container = document.getElementById('usersList');
        if (!container) return;
        
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-state">Kullanıcı bulunamadı</div>';
            return;
        }

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

    async loadSystemStats() {
        try {
            const response = await fetch('/api/admin/system-stats', {
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.renderSystemStats(result.stats);
                }
            }
        } catch (error) {
            console.error('Sistem istatistikleri yükleme hatası:', error);
        }
    }

    renderSystemStats(stats) {
        const totalUsers = document.getElementById('totalUsers');
        const totalSales = document.getElementById('totalSales');
        const totalRevenue = document.getElementById('totalRevenue');
        
        if (totalUsers) totalUsers.textContent = stats.total_users || 0;
        if (totalSales) totalSales.textContent = stats.total_sales || 0;
        if (totalRevenue) totalRevenue.textContent = (stats.total_revenue || 0).toFixed(2) + ' TL';
    }

    openAddUserModal() {
        this.openModal('addUserModal');
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

            if (!response.ok) {
                throw new Error('Kullanıcı oluşturulamadı');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Kullanıcı başarıyla oluşturuldu', 'success');
                this.closeModal('addUserModal');
                await this.loadUsers();
            } else {
                this.showStatus('Kullanıcı oluşturulurken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Kullanıcı oluşturma hatası:', error);
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

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    this.renderAuditLogs(result.logs);
                }
            }
        } catch (error) {
            console.error('Denetim kayıtları yükleme hatası:', error);
        }
    }

    renderAuditLogs(logs) {
        const container = document.getElementById('auditLogs');
        if (!container) return;
        
        if (logs.length === 0) {
            container.innerHTML = '<div class="empty-state">Denetim kaydı bulunamadı</div>';
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

    async createBackup() {
        try {
            const response = await fetch('/api/admin/backup', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.currentUser.id}`
                }
            });

            if (!response.ok) {
                throw new Error('Yedek oluşturulamadı');
            }

            const result = await response.json();
            
            if (result.status === 'success') {
                this.showStatus('Yedekleme başarıyla oluşturuldu', 'success');
            } else {
                this.showStatus('Yedekleme oluşturulurken hata: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Yedekleme hatası:', error);
            this.showStatus('Yedekleme oluşturulurken hata: ' + error.message, 'error');
        }
    }

    loadBackupInfo() {
        const container = document.getElementById('backupInfo');
        if (!container) return;
        
        container.innerHTML = `
            <div class="backup-card">
                <h4><i class="fas fa-database"></i> Veritabanı Yedekleme</h4>
                <p>Son yedekleme: ${new Date().toLocaleDateString('tr-TR')}</p>
                <button class="btn-primary" id="createBackupBtn">
                    <i class="fas fa-save"></i> Yedek Oluştur
                </button>
            </div>
        `;
    }

    // YARDIMCI FONKSİYONLAR
    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';
        
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 4000);
    }
}

// UYGULAMAYI BAŞLAT
document.addEventListener('DOMContentLoaded', function() {
    console.log("🎯 TEKEL POS sistemi yükleniyor...");
    window.pos = new TekelPOS();
});

// GLOBAL FONKSİYONLAR
function closeModal(modalId) {
    if (window.pos) {
        window.pos.closeModal(modalId);
    }
}

function openModal(modalId) {
    if (window.pos) {
        window.pos.openModal(modalId);
    }
}
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
        
        // Demo veriler
        this.demoProducts = [
            { barcode: '8691234567890', name: 'Coca Cola 330ml', price: 25.00, quantity: 50, kdv: 18 },
            { barcode: '8691234567891', name: 'Fanta 330ml', price: 22.00, quantity: 30, kdv: 18 },
            { barcode: '8691234567892', name: 'Sprite 330ml', price: 22.00, quantity: 25, kdv: 18 },
            { barcode: '8691234567893', name: 'Eti Browni', price: 15.00, quantity: 20, kdv: 8 },
            { barcode: '8691234567894', name: 'Ülker Çikolatalı Gofret', price: 12.50, quantity: 40, kdv: 8 },
            { barcode: '8691234567895', name: 'Lays Patates Cipsi', price: 18.00, quantity: 35, kdv: 18 },
            { barcode: '8691234567896', name: 'Red Bull', price: 35.00, quantity: 15, kdv: 18 },
            { barcode: '8691234567897', name: 'Sütaş Ayran 200ml', price: 8.00, quantity: 60, kdv: 8 }
        ];

        this.init();
    }

    async init() {
        console.log("🚀 TEKEL POS sistemi başlatılıyor...");
        this.setupEventListeners();
        await this.checkAuth();
    }

    // MODAL FONKSİYONLARI
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
            // Input'a focus
            setTimeout(() => {
                const input = modal.querySelector('input');
                if (input) input.focus();
            }, 100);
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        }
    }

    // EVENT LISTENER'LAR
    setupEventListeners() {
        console.log("🔗 Event listener'lar bağlanıyor...");

        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        // Barkod input - Enter tuşu
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
                const tab = item.getAttribute('data-tab');
                if (tab) {
                    this.openTab(tab);
                }
            });
        });

        // Admin sekme değiştirme
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-admin-tab');
                this.openAdminTab(tab);
            });
        });

        // Modal kapatma butonları
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // Modal dışına tıklayınca kapat
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
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

        // Manuel barkod input
        document.getElementById('manualBarcodeInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addManualBarcode();
            }
        });

        // DOĞRUDAN BUTON BAĞLANTILARI
        this.bindDirectButtonEvents();
    }

    bindDirectButtonEvents() {
        // Login butonu
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
    }

    bindClick(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', handler);
        }
    }

    async checkAuth() {
        const userData = localStorage.getItem('userData');
        if (userData) {
            try {
                this.currentUser = JSON.parse(userData);
                this.showApp();
                await this.loadInitialData();
            } catch (error) {
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
        
        // Inputları temizle ve focusla
        setTimeout(() => {
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            document.getElementById('username').focus();
        }, 100);
    }

    showApp() {
        const loginModal = document.getElementById('loginModal');
        const appContainer = document.querySelector('.app-container');
        
        if (loginModal) loginModal.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        
        // Kullanıcı bilgilerini güncelle
        this.updateUserInfo();
        
        this.openTab('dashboard');
    }

    updateUserInfo() {
        const currentUserEl = document.getElementById('currentUser');
        const currentRoleEl = document.getElementById('currentRole');
        
        if (currentUserEl) currentUserEl.textContent = this.currentUser.full_name;
        if (currentRoleEl) currentRoleEl.textContent = this.getRoleText(this.currentUser.role);
        
        // Admin yetkilerini kontrol et
        if (this.currentUser.role !== 'admin') {
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
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        if (!username || !password) {
            this.showStatus('Kullanıcı adı ve şifre gerekli', 'error');
            return;
        }

        try {
            let user = null;
            
            if (username === 'admin' && password === 'admin123') {
                user = {
                    id: 1,
                    username: 'admin',
                    full_name: 'Sistem Yöneticisi',
                    role: 'admin'
                };
            } else if (username === 'kasiyer' && password === 'kasiyer123') {
                user = {
                    id: 2,
                    username: 'kasiyer',
                    full_name: 'Ahmet Yılmaz',
                    role: 'cashier'
                };
            } else if (username === 'personel' && password === 'personel123') {
                user = {
                    id: 3,
                    username: 'personel',
                    full_name: 'Mehmet Demir',
                    role: 'user'
                };
            } else {
                this.showStatus('Geçersiz kullanıcı adı veya şifre', 'error');
                return;
            }

            this.currentUser = user;
            localStorage.setItem('userData', JSON.stringify(user));
            this.showApp();
            await this.loadInitialData();
            this.showStatus(`Hoş geldiniz ${user.full_name}`, 'success');
            
        } catch (error) {
            this.showStatus('Giriş hatası: ' + error.message, 'error');
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

    // ÜRÜN YÖNETİMİ
    async loadProducts() {
        try {
            // Demo ürünleri kullan
            this.products = [...this.demoProducts];
            this.renderProducts();
            this.renderProductsTable();
        } catch (error) {
            this.showStatus('Ürünler yüklenirken hata: ' + error.message, 'error');
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
                <button class="btn-primary btn-small" onclick="window.pos.addToCart('${product.barcode}')">
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
                    <button class="btn-primary btn-small" onclick="window.pos.saveStock('${product.barcode}')">
                        Kaydet
                    </button>
                </td>
                <td>
                    <button class="btn-primary btn-small" onclick="window.pos.quickAddStock('${product.barcode}', 1)">
                        +1
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // SEPET İŞLEMLERİ
    async addProductByBarcode() {
        const barcodeInput = document.getElementById('barcodeInput');
        const barcode = barcodeInput.value.trim();
        
        if (!barcode) {
            this.showStatus('Lütfen barkod girin', 'warning');
            return;
        }

        const product = this.products.find(p => p.barcode === barcode);
        if (!product) {
            this.showStatus('Ürün bulunamadı! Yeni ürün eklemek için "Ürünler" sekmesine gidin.', 'error');
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
                            <button class="quantity-btn" onclick="window.pos.updateCartQuantity('${item.barcode}', -1)">-</button>
                            <span class="quantity">${item.quantity}</span>
                            <button class="quantity-btn" onclick="window.pos.updateCartQuantity('${item.barcode}', 1)">+</button>
                        </div>
                        <button class="remove-btn" onclick="window.pos.removeFromCart('${item.barcode}')">
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

        // Stokları güncelle
        for (const item of this.cart) {
            const product = this.products.find(p => p.barcode === item.barcode);
            if (product) {
                product.quantity -= item.quantity;
                if (product.quantity < 0) product.quantity = 0;
            }
        }

        const saleId = 'F' + Date.now().toString().slice(-6);
        this.showStatus(`Satış başarıyla tamamlandı! Fiş No: ${saleId} - Toplam: ${total.toFixed(2)} TL`, 'success');
        
        this.cart = [];
        this.renderCart();
        this.renderProducts();
        this.renderProductsTable();
        
        // Barkod input'una focusla
        const barcodeInput = document.getElementById('barcodeInput');
        if (barcodeInput) {
            barcodeInput.value = '';
            barcodeInput.focus();
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

        const product = this.products.find(p => p.barcode === barcode);
        if (product) {
            product.quantity = newQuantity;
            this.showStatus(`${product.name} stok güncellendi: ${newQuantity}`, 'success');
            this.renderProducts();
            this.renderProductsTable();
        }
    }

    quickAddStock(barcode, quantity) {
        const product = this.products.find(p => p.barcode === barcode);
        if (product) {
            product.quantity += quantity;
            this.showStatus(`${product.name} stok +${quantity} eklendi`, 'success');
            this.renderProducts();
            this.renderProductsTable();
            
            // Input değerini güncelle
            const input = document.querySelector(`.stock-input[data-barcode="${barcode}"]`);
            if (input) {
                input.value = product.quantity;
            }
        }
    }

    // YENİ ÜRÜN EKLEME
    openAddProductModal() {
        // Formu temizle
        document.getElementById('newProductBarcode').value = '';
        document.getElementById('newProductName').value = '';
        document.getElementById('newProductPrice').value = '';
        document.getElementById('newProductQuantity').value = '1';
        document.getElementById('newProductKDV').value = '18';
        
        this.openModal('addProductModal');
    }

    async addNewProduct() {
        const barcode = document.getElementById('newProductBarcode').value.trim();
        const name = document.getElementById('newProductName').value.trim();
        const price = parseFloat(document.getElementById('newProductPrice').value) || 0;
        const quantity = parseInt(document.getElementById('newProductQuantity').value) || 1;
        const kdv = parseFloat(document.getElementById('newProductKDV').value) || 18;

        if (!barcode || !name || price <= 0) {
            this.showStatus('Lütfen zorunlu alanları doldurun (Barkod, Ürün Adı, Fiyat)', 'error');
            return;
        }

        // Ürün zaten var mı kontrol et
        const existingProduct = this.products.find(p => p.barcode === barcode);
        if (existingProduct) {
            this.showStatus('Bu barkod ile kayıtlı ürün zaten var', 'error');
            return;
        }

        // Yeni ürün ekle
        this.products.push({
            barcode: barcode,
            name: name,
            price: price,
            quantity: quantity,
            kdv: kdv
        });

        this.showStatus('Ürün başarıyla eklendi', 'success');
        this.closeModal('addProductModal');
        this.renderProducts();
        this.renderProductsTable();
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
        
        this.showStatus(`Kasa açıldı: ${amount.toFixed(2)} TL`, 'success');
        this.closeModal('cashRegisterModal');
        
        // Kasa durumunu güncelle
        this.updateCashStatus(true, amount);
    }

    async closeCash() {
        const amount = parseFloat(document.getElementById('closeCashAmount')?.value) || 0;
        this.showStatus(`Kasa kapandı: ${amount.toFixed(2)} TL`, 'success');
        this.closeModal('cashRegisterModal');
        
        // Kasa durumunu güncelle
        this.updateCashStatus(false, 0);
    }

    updateCashStatus(isOpen, amount) {
        const openBtn = document.getElementById('openCashBtn');
        const closeBtn = document.getElementById('closeCashBtn');
        const statusBadge = document.getElementById('cashStatusBadge');
        const currentAmount = document.getElementById('currentCashAmount');

        if (isOpen) {
            if (statusBadge) {
                statusBadge.className = 'status-badge success';
                statusBadge.textContent = 'Açık';
            }
            if (openBtn) openBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'inline-block';
            if (currentAmount) {
                currentAmount.textContent = amount.toFixed(2) + ' TL';
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
        const todaySales = document.getElementById('todaySales');
        const totalProducts = document.getElementById('totalProducts');
        const lowStockCount = document.getElementById('lowStockCount');
        const outOfStockCount = document.getElementById('outOfStockCount');
        
        if (todaySales) todaySales.textContent = '0.00 TL';
        if (totalProducts) totalProducts.textContent = this.products.length;
        
        const lowStockProducts = this.products.filter(p => p.quantity > 0 && p.quantity <= 5);
        const outOfStockProducts = this.products.filter(p => p.quantity === 0);
        
        if (lowStockCount) lowStockCount.textContent = lowStockProducts.length;
        if (outOfStockCount) outOfStockCount.textContent = outOfStockProducts.length;
        
        // Stok uyarılarını göster
        this.renderStockAlerts(lowStockProducts, outOfStockProducts);
    }

    renderStockAlerts(lowStock, outOfStock) {
        const alertsContainer = document.getElementById('stockAlerts');
        if (!alertsContainer) return;

        const allAlerts = [...outOfStock, ...lowStock];
        
        if (allAlerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Tüm stoklar yeterli</p>
                </div>
            `;
            return;
        }

        alertsContainer.innerHTML = allAlerts.map(product => `
            <div class="alert-item ${product.quantity === 0 ? 'danger' : 'warning'}">
                <i class="fas fa-${product.quantity === 0 ? 'times-circle' : 'exclamation-triangle'}"></i>
                <div class="alert-info">
                    <strong>${product.name}</strong>
                    <span>Stok: ${product.quantity} ${product.quantity === 0 ? '(Stokta Yok)' : '(Az Stok)'}</span>
                </div>
            </div>
        `).join('');
    }

    // ENVANTER
    async loadInventory() {
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
                    <td>5</td>
                    <td>
                        <span class="status-badge ${status}">${statusText}</span>
                    </td>
                    <td>
                        <button class="btn-primary btn-small" onclick="window.pos.saveStock('${product.barcode}')">
                            Kaydet
                        </button>
                    </td>
                    <td>
                        <button class="btn-primary btn-small" onclick="window.pos.quickAddStock('${product.barcode}', 1)">
                            +1
                        </button>
                        <button class="btn-primary btn-small" onclick="window.pos.quickAddStock('${product.barcode}', 5)">
                            +5
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // KAMERA FONKSİYONLARI
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
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' }
            });
            
            const videoElement = document.getElementById('videoElement');
            if (videoElement) {
                videoElement.srcObject = stream;
                
                const statusEl = document.getElementById('cameraStatus');
                if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Kamera aktif';
                
                this.scanning = true;
            }
        } catch (error) {
            console.error("Kamera hatası:", error);
            this.showCameraError();
        }
    }

    showManualBarcodeInput() {
        const cameraSection = document.getElementById('cameraSection');
        if (cameraSection && !document.getElementById('manualBarcodeInput')) {
            const manualInputHTML = `
                <div class="manual-barcode-section" style="margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
                    <h4><i class="fas fa-keyboard"></i> Manuel Barkod Girişi</h4>
                    <p style="margin-bottom: 15px; color: #666;">Kamera tarama yerine barkodu manuel girebilirsiniz:</p>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="text" 
                               id="manualBarcodeInput" 
                               placeholder="Barkodu buraya girin" 
                               style="flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;">
                        <button class="btn-primary" id="addManualBarcodeBtn">
                            <i class="fas fa-check"></i> Ekle
                        </button>
                    </div>
                    <div style="margin-top: 15px; padding: 10px; background: #e9ecef; border-radius: 4px;">
                        <strong><i class="fas fa-lightbulb"></i> Demo Barkodlar:</strong><br>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
                            ${this.demoProducts.map(p => 
                                `<span class="demo-barcode" style="padding: 4px 8px; background: white; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; cursor: pointer;" 
                                      onclick="document.getElementById('manualBarcodeInput').value='${p.barcode}'">${p.barcode}</span>`
                            ).join('')}
                        </div>
                    </div>
                </div>
            `;
            cameraSection.insertAdjacentHTML('beforeend', manualInputHTML);
            
            // Manuel input için event listener ekle
            const manualInput = document.getElementById('manualBarcodeInput');
            if (manualInput) {
                manualInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.addManualBarcode();
                    }
                });
            }
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
        
        const videoElement = document.getElementById('videoElement');
        if (videoElement && videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(track => track.stop());
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
        
        const product = this.products.find(p => p.barcode === barcode);
        if (product) {
            this.quickAddStock(barcode, 1);
            barcodeInput.value = '';
        } else {
            this.showStatus('Ürün bulunamadı', 'error');
        }
    }

    // RAPORLAR
    async loadReports() {
        await this.loadSalesReport();
    }

    async loadSalesReport() {
        this.renderSalesReport();
    }

    renderSalesReport() {
        const container = document.getElementById('salesReport');
        if (!container) return;
        
        container.innerHTML = `
            <div class="report-summary">
                <div class="report-card">
                    <h4><i class="fas fa-shopping-cart"></i> Toplam Satış</h4>
                    <div class="amount">0.00 TL</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-receipt"></i> Toplam İşlem</h4>
                    <div class="amount">0</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-money-bill-wave"></i> Nakit Satış</h4>
                    <div class="amount">0.00 TL</div>
                </div>
                <div class="report-card">
                    <h4><i class="fas fa-credit-card"></i> Kartlı Satış</h4>
                    <div class="amount">0.00 TL</div>
                </div>
            </div>
            <div class="report-details">
                <h4>Satış Detayları</h4>
                <p class="empty-state">Henüz satış raporu bulunmuyor</p>
            </div>
        `;
    }

    // ADMIN FONKSİYONLARI
    async loadAdminData() {
        await this.loadUsers();
        await this.loadSystemStats();
    }

    async loadUsers() {
        this.renderUsers();
    }

    renderUsers() {
        const container = document.getElementById('usersList');
        if (!container) return;
        
        const users = [
            { username: 'admin', full_name: 'Sistem Yöneticisi', role: 'admin', last_login: new Date() },
            { username: 'kasiyer', full_name: 'Ahmet Yılmaz', role: 'cashier', last_login: new Date() },
            { username: 'personel', full_name: 'Mehmet Demir', role: 'user', last_login: new Date() }
        ];
        
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
        const totalUsers = document.getElementById('totalUsers');
        const totalSales = document.getElementById('totalSales');
        const totalRevenue = document.getElementById('totalRevenue');
        
        if (totalUsers) totalUsers.textContent = '3';
        if (totalSales) totalSales.textContent = '0';
        if (totalRevenue) totalRevenue.textContent = '0.00 TL';
    }

    openAddUserModal() {
        this.openModal('addUserModal');
    }

    async createNewUser() {
        this.showStatus('Kullanıcı oluşturuldu (demo)', 'success');
        this.closeModal('addUserModal');
    }

    async loadAuditLogs() {
        this.showStatus('Denetim kayıtları yenilendi', 'success');
    }

    async createBackup() {
        this.showStatus('Yedekleme oluşturuldu (demo)', 'success');
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

    async loadCashManagement() {
        this.updateCashStatus(false, 0);
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
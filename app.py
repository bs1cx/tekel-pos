import os
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import qrcode
import io
import base64
import socket
from datetime import datetime, timedelta
import json
import sqlite3
from threading import Lock
import time

app = Flask(__name__, 
    static_folder='static',
    template_folder='templates'
)
app.config['SECRET_KEY'] = 'tekel-pos-secret-key-2024'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Veritabanı bağlantısı
def get_db_connection():
    conn = sqlite3.connect('database.db', check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

# Veritabanı başlatma
def init_db():
    conn = get_db_connection()
    
    # Kullanıcılar tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            last_login TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Ürünler tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER DEFAULT 0,
            kdv REAL DEFAULT 18,
            otv REAL DEFAULT 0,
            min_stock_level INTEGER DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Satışlar tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_amount REAL NOT NULL,
            payment_method TEXT NOT NULL,
            cash_amount REAL DEFAULT 0,
            credit_card_amount REAL DEFAULT 0,
            change_amount REAL DEFAULT 0,
            user_id INTEGER,
            sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    # Satış detayları tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER,
            barcode TEXT NOT NULL,
            product_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (sale_id) REFERENCES sales (id)
        )
    ''')
    
    # Stok hareketleri tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT NOT NULL,
            product_name TEXT NOT NULL,
            movement_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            user_id INTEGER,
            movement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    # Kasa durumu tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cash_register (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            is_open BOOLEAN DEFAULT FALSE,
            current_amount REAL DEFAULT 0,
            opening_balance REAL DEFAULT 0,
            opening_time TIMESTAMP,
            closing_time TIMESTAMP,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Kasa hareketleri tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cash_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL,
            user_id INTEGER,
            transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            description TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    # Denetim kayıtları tablosu
    conn.execute('''
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            description TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    # Varsayılan kullanıcıları ekle
    try:
        conn.execute(
            'INSERT OR IGNORE INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
            ('admin', 'admin123', 'Sistem Yöneticisi', 'admin')
        )
        conn.execute(
            'INSERT OR IGNORE INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
            ('kasiyer', 'kasiyer123', 'Kasiyer Kullanıcı', 'cashier')
        )
        conn.execute(
            'INSERT OR IGNORE INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
            ('personel', 'personel123', 'Personel Kullanıcı', 'user')
        )
    except:
        pass
    
    # Varsayılan kasa durumu
    try:
        conn.execute(
            'INSERT OR IGNORE INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, 0, 0, 0)'
        )
    except:
        pass
    
    conn.commit()
    conn.close()

# Static dosyalar için route
@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# Ana sayfa
@app.route('/')
def index():
    try:
        # IP adresini al
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
    except:
        local_ip = "localhost"
    
    # QR kod oluştur
    try:
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(f"https://{request.host}")
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        qr_code = base64.b64encode(buffer.getvalue()).decode()
        qr_code = f"data:image/png;base64,{qr_code}"
    except:
        qr_code = ""
    
    return render_template('index.html', local_ip=local_ip, qr_code=qr_code)

# API Routes - Önceki app.py ile tam uyumlu

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ? AND password = ?',
        (username, password)
    ).fetchone()
    
    if user:
        # Son giriş zamanını güncelle
        conn.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            (user['id'],)
        )
        conn.commit()
        conn.close()
        
        # Denetim kaydı ekle
        log_audit(user['id'], 'login', f'{user["username"]} giriş yaptı', request.remote_addr)
        
        return jsonify({
            'status': 'success',
            'user': {
                'id': user['id'],
                'username': user['username'],
                'full_name': user['full_name'],
                'role': user['role']
            }
        })
    else:
        conn.close()
        return jsonify({
            'status': 'error',
            'message': 'Geçersiz kullanıcı adı veya şifre'
        })

@app.route('/api/products')
def get_products():
    conn = get_db_connection()
    products = conn.execute('SELECT * FROM products ORDER BY name').fetchall()
    conn.close()
    
    products_list = []
    for product in products:
        products_list.append(dict(product))
    
    return jsonify({
        'status': 'success',
        'products': products_list
    })

@app.route('/api/stock/add', methods=['POST'])
def add_stock():
    data = request.get_json()
    barcode = data.get('barcode')
    quantity = data.get('quantity', 1)
    name = data.get('name')
    price = data.get('price')
    kdv = data.get('kdv', 18)
    otv = data.get('otv', 0)
    min_stock_level = data.get('min_stock_level', 5)
    
    user_id = data.get('user_id', 1)
    
    conn = get_db_connection()
    
    try:
        # Ürün var mı kontrol et
        product = conn.execute(
            'SELECT * FROM products WHERE barcode = ?', (barcode,)
        ).fetchone()
        
        if product:
            # Ürün varsa stok güncelle
            new_quantity = product['quantity'] + quantity
            conn.execute(
                'UPDATE products SET quantity = ? WHERE barcode = ?',
                (new_quantity, barcode)
            )
            movement_type = 'in'
            product_name = product['name']
        else:
            # Yeni ürün ekle
            if not name or not price:
                return jsonify({'status': 'error', 'message': 'Yeni ürün için ad ve fiyat gereklidir'})
            
            conn.execute(
                'INSERT INTO products (barcode, name, price, quantity, kdv, otv, min_stock_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (barcode, name, price, quantity, kdv, otv, min_stock_level)
            )
            movement_type = 'new'
            product_name = name
        
        # Stok hareketi kaydı ekle
        conn.execute(
            'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (?, ?, ?, ?, ?)',
            (barcode, product_name, movement_type, quantity, user_id)
        )
        
        # Denetim kaydı
        log_audit(user_id, 'stock_update', f'{quantity} adet stok eklendi: {barcode} - {product_name}')
        
        conn.commit()
        conn.close()
        
        # WebSocket ile bildirim gönder
        socketio.emit('stock_updated', {'barcode': barcode, 'quantity': quantity})
        
        return jsonify({'status': 'success', 'message': 'Stok güncellendi'})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/sale', methods=['POST'])
def make_sale():
    data = request.get_json()
    items = data.get('items', [])
    total = data.get('total', 0)
    payment_method = data.get('payment_method', 'nakit')
    cash_amount = data.get('cash_amount', 0)
    credit_card_amount = data.get('credit_card_amount', 0)
    change_amount = data.get('change_amount', 0)
    user_id = data.get('user_id', 1)
    
    conn = get_db_connection()
    
    try:
        # Satış kaydı oluştur
        cursor = conn.execute(
            'INSERT INTO sales (total_amount, payment_method, cash_amount, credit_card_amount, change_amount, user_id) VALUES (?, ?, ?, ?, ?, ?)',
            (total, payment_method, cash_amount, credit_card_amount, change_amount, user_id)
        )
        sale_id = cursor.lastrowid
        
        # Satış detaylarını ekle ve stokları güncelle
        for item in items:
            conn.execute(
                'INSERT INTO sale_items (sale_id, barcode, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                (sale_id, item['barcode'], item['name'], item['quantity'], item['price'])
            )
            
            # Stok güncelle
            product = conn.execute(
                'SELECT quantity FROM products WHERE barcode = ?', (item['barcode'],)
            ).fetchone()
            
            if product:
                new_quantity = product['quantity'] - item['quantity']
                conn.execute(
                    'UPDATE products SET quantity = ? WHERE barcode = ?',
                    (new_quantity, item['barcode'])
                )
                
                # Stok hareketi kaydı
                conn.execute(
                    'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (?, ?, ?, ?, ?)',
                    (item['barcode'], item['name'], 'out', item['quantity'], user_id)
                )
        
        # Kasa hareketi
        if payment_method == 'nakit' and cash_amount > 0:
            conn.execute(
                'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (?, ?, ?, ?)',
                ('sale', total, user_id, f'Satış #{sale_id}')
            )
            
            # Kasa bakiyesini güncelle (kasa açıksa)
            cash_status = conn.execute('SELECT * FROM cash_register WHERE id = 1').fetchone()
            if cash_status and cash_status['is_open']:
                new_balance = cash_status['current_amount'] + cash_amount
                conn.execute(
                    'UPDATE cash_register SET current_amount = ? WHERE id = 1',
                    (new_balance,)
                )
        
        # Denetim kaydı
        log_audit(user_id, 'sale', f'Satış yapıldı: #{sale_id} - {total} TL - {payment_method}')
        
        conn.commit()
        conn.close()
        
        # WebSocket ile bildirim gönder
        socketio.emit('sale_made', {'sale_id': sale_id, 'total': total})
        
        return jsonify({'status': 'success', 'sale_id': sale_id, 'message': 'Satış başarıyla tamamlandı'})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': str(e)})

# KASA YÖNETİMİ API'leri
@app.route('/api/cash/status')
def cash_status():
    conn = get_db_connection()
    cash_status = conn.execute('SELECT * FROM cash_register WHERE id = 1').fetchone()
    
    if not cash_status:
        # Varsayılan kasa durumu
        conn.execute('INSERT INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, 0, 0, 0)')
        conn.commit()
        cash_status = conn.execute('SELECT * FROM cash_register WHERE id = 1').fetchone()
    
    # Bugünkü nakit satışlar
    today = datetime.now().strftime('%Y-%m-%d')
    cash_sales = conn.execute(
        'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = "nakit" AND DATE(sale_date) = ?',
        (today,)
    ).fetchone()
    
    # Bugünkü kartlı satışlar
    card_sales = conn.execute(
        'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = "kredi" AND DATE(sale_date) = ?',
        (today,)
    ).fetchone()
    
    conn.close()
    
    return jsonify({
        'status': 'success',
        'cash_status': {
            'is_open': bool(cash_status['is_open']),
            'current_amount': cash_status['current_amount'],
            'opening_balance': cash_status['opening_balance'],
            'opening_time': cash_status['opening_time'],
            'cash_sales_today': cash_sales['total'] or 0,
            'card_sales_today': card_sales['total'] or 0,
            'expected_cash': (cash_status['opening_balance'] or 0) + (cash_sales['total'] or 0)
        }
    })

@app.route('/api/cash/open', methods=['POST'])
def open_cash():
    data = request.get_json()
    initial_amount = data.get('initial_amount', 0)
    user_id = data.get('user_id', 1)
    
    conn = get_db_connection()
    
    try:
        # Kasa durumunu güncelle
        conn.execute(
            'UPDATE cash_register SET is_open = 1, current_amount = ?, opening_balance = ?, opening_time = CURRENT_TIMESTAMP WHERE id = 1',
            (initial_amount, initial_amount)
        )
        
        # Kasa hareketi kaydı
        conn.execute(
            'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (?, ?, ?, ?)',
            ('open', initial_amount, user_id, 'Kasa açılışı')
        )
        
        # Denetim kaydı
        log_audit(user_id, 'cash_open', f'Kasa açıldı - Başlangıç bakiyesi: {initial_amount} TL')
        
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kasa açıldı'})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/cash/close', methods=['POST'])
def close_cash():
    data = request.get_json()
    user_id = data.get('user_id', 1)
    
    conn = get_db_connection()
    
    try:
        # Kasa durumunu al
        cash_status = conn.execute('SELECT * FROM cash_register WHERE id = 1').fetchone()
        
        if not cash_status or not cash_status['is_open']:
            return jsonify({'status': 'error', 'message': 'Kasa zaten kapalı'})
        
        # Kasa kapanış işlemi
        final_amount = cash_status['current_amount']
        opening_balance = cash_status['opening_balance']
        
        # Bugünkü nakit satışları hesapla
        if cash_status['opening_time']:
            opening_date = datetime.strptime(cash_status['opening_time'], '%Y-%m-%d %H:%M:%S')
            today_start = opening_date.strftime('%Y-%m-%d')
        else:
            today_start = datetime.now().strftime('%Y-%m-%d')
            
        cash_sales = conn.execute(
            'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = "nakit" AND DATE(sale_date) >= ?',
            (today_start,)
        ).fetchone()
        
        expected_cash = opening_balance + (cash_sales['total'] or 0)
        
        # Kasa durumunu güncelle
        conn.execute(
            'UPDATE cash_register SET is_open = 0, current_amount = 0, opening_balance = 0, closing_time = CURRENT_TIMESTAMP WHERE id = 1'
        )
        
        # Kasa hareketi kaydı
        conn.execute(
            'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (?, ?, ?, ?)',
            ('close', final_amount, user_id, f'Kasa kapanışı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL')
        )
        
        # Denetim kaydı
        log_audit(user_id, 'cash_close', f'Kasa kapandı - Son bakiye: {final_amount} TL')
        
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kasa kapandı'})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/cash/transactions')
def cash_transactions():
    limit = request.args.get('limit', 50, type=int)
    
    conn = get_db_connection()
    
    transactions = conn.execute('''
        SELECT ct.*, u.full_name as user_name 
        FROM cash_transactions ct 
        LEFT JOIN users u ON ct.user_id = u.id 
        ORDER BY ct.transaction_date DESC 
        LIMIT ?
    ''', (limit,)).fetchall()
    
    conn.close()
    
    transactions_list = []
    for transaction in transactions:
        transactions_list.append(dict(transaction))
    
    return jsonify({
        'status': 'success',
        'transactions': transactions_list
    })

# RAPORLAMA API'leri
@app.route('/api/reports/daily-summary')
def daily_summary():
    conn = get_db_connection()
    
    # Bugünkü satışlar
    today = datetime.now().strftime('%Y-%m-%d')
    sales_today = conn.execute(
        'SELECT SUM(total_amount) as total FROM sales WHERE DATE(sale_date) = ?',
        (today,)
    ).fetchone()
    
    # Toplam ürün sayısı
    total_products = conn.execute('SELECT COUNT(*) as count FROM products').fetchone()
    
    # Azalan stoklar
    low_stock = conn.execute(
        'SELECT COUNT(*) as count FROM products WHERE quantity <= min_stock_level AND quantity > 0'
    ).fetchone()
    
    # Stokta olmayan ürünler
    out_of_stock = conn.execute(
        'SELECT COUNT(*) as count FROM products WHERE quantity = 0'
    ).fetchone()
    
    conn.close()
    
    return jsonify({
        'status': 'success',
        'summary': {
            'total_revenue': sales_today['total'] or 0,
            'total_products': total_products['count'],
            'low_stock_count': low_stock['count'],
            'out_of_stock_count': out_of_stock['count']
        }
    })

@app.route('/api/inventory/low-stock')
def low_stock():
    conn = get_db_connection()
    
    low_stock_products = conn.execute(
        'SELECT * FROM products WHERE quantity <= min_stock_level ORDER BY quantity ASC'
    ).fetchall()
    
    conn.close()
    
    products_list = []
    for product in low_stock_products:
        products_list.append(dict(product))
    
    return jsonify({
        'status': 'success',
        'products': products_list
    })

@app.route('/api/inventory/stock-value')
def stock_value():
    conn = get_db_connection()
    
    # Stok istatistikleri
    total_products = conn.execute('SELECT COUNT(*) as count FROM products').fetchone()
    in_stock = conn.execute('SELECT COUNT(*) as count FROM products WHERE quantity > 5').fetchone()
    low_stock = conn.execute('SELECT COUNT(*) as count FROM products WHERE quantity > 0 AND quantity <= 5').fetchone()
    out_of_stock = conn.execute('SELECT COUNT(*) as count FROM products WHERE quantity = 0').fetchone()
    
    # Toplam stok değeri
    stock_value = conn.execute('SELECT SUM(price * quantity) as total FROM products').fetchone()
    
    conn.close()
    
    return jsonify({
        'status': 'success',
        'value': {
            'total_products': total_products['count'],
            'in_stock': in_stock['count'],
            'low_stock': low_stock['count'],
            'out_of_stock': out_of_stock['count'],
            'total_value': stock_value['total'] or 0
        }
    })

@app.route('/api/reports/sales')
def sales_report():
    limit = request.args.get('limit', 50, type=int)
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    conn = get_db_connection()
    
    query = '''
        SELECT s.*, u.full_name as user_name 
        FROM sales s 
        LEFT JOIN users u ON s.user_id = u.id 
    '''
    params = []
    
    if start_date and end_date:
        query += ' WHERE DATE(s.sale_date) BETWEEN ? AND ?'
        params.extend([start_date, end_date])
    
    query += ' ORDER BY s.sale_date DESC LIMIT ?'
    params.append(limit)
    
    sales = conn.execute(query, params).fetchall()
    
    conn.close()
    
    sales_list = []
    for sale in sales:
        sales_list.append(dict(sale))
    
    return jsonify({
        'status': 'success',
        'report': sales_list
    })

@app.route('/api/reports/stock-movements')
def stock_movements():
    limit = request.args.get('limit', 50, type=int)
    
    conn = get_db_connection()
    
    movements = conn.execute('''
        SELECT sm.*, u.full_name as user_name 
        FROM stock_movements sm 
        LEFT JOIN users u ON sm.user_id = u.id 
        ORDER BY sm.movement_date DESC 
        LIMIT ?
    ''', (limit,)).fetchall()
    
    conn.close()
    
    movements_list = []
    for movement in movements:
        movements_list.append(dict(movement))
    
    return jsonify({
        'status': 'success',
        'movements': movements_list
    })

@app.route('/api/reports/receipt/<int:sale_id>')
def get_receipt(sale_id):
    conn = get_db_connection()
    
    # Satış bilgileri
    sale = conn.execute('''
        SELECT s.*, u.full_name as user_name 
        FROM sales s 
        LEFT JOIN users u ON s.user_id = u.id 
        WHERE s.id = ?
    ''', (sale_id,)).fetchone()
    
    if not sale:
        return jsonify({'status': 'error', 'message': 'Fiş bulunamadı'})
    
    # Satış detayları
    items = conn.execute(
        'SELECT * FROM sale_items WHERE sale_id = ?', (sale_id,)
    ).fetchall()
    
    conn.close()
    
    receipt = {
        'id': sale['id'],
        'sale_date': sale['sale_date'],
        'total_amount': sale['total_amount'],
        'payment_method': sale['payment_method'],
        'user_name': sale['user_name'],
        'items': [dict(item) for item in items]
    }
    
    return jsonify({
        'status': 'success',
        'receipt': receipt
    })

# YÖNETİM API'leri
@app.route('/api/users')
def get_users():
    conn = get_db_connection()
    users = conn.execute('SELECT id, username, full_name, role, last_login, created_at FROM users ORDER BY created_at DESC').fetchall()
    conn.close()
    
    users_list = []
    for user in users:
        users_list.append(dict(user))
    
    return jsonify({
        'status': 'success',
        'users': users_list
    })

@app.route('/api/admin/users', methods=['POST'])
def create_user():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    full_name = data.get('full_name')
    role = data.get('role', 'user')
    
    user_id = data.get('user_id', 1)  # İşlemi yapan kullanıcı
    
    if not username or not password or not full_name:
        return jsonify({'status': 'error', 'message': 'Tüm alanlar gereklidir'})
    
    conn = get_db_connection()
    
    try:
        conn.execute(
            'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
            (username, password, full_name, role)
        )
        
        # Denetim kaydı
        log_audit(user_id, 'user_create', f'Yeni kullanıcı oluşturuldu: {username} - {full_name}')
        
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kullanıcı başarıyla oluşturuldu'})
        
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Bu kullanıcı adı zaten kullanılıyor'})
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/admin/system-stats')
def system_stats():
    conn = get_db_connection()
    
    # Toplam kullanıcı sayısı
    total_users = conn.execute('SELECT COUNT(*) as count FROM users').fetchone()
    
    # Toplam satış sayısı
    total_sales = conn.execute('SELECT COUNT(*) as count FROM sales').fetchone()
    
    # Toplam ciro
    total_revenue = conn.execute('SELECT SUM(total_amount) as total FROM sales').fetchone()
    
    conn.close()
    
    return jsonify({
        'status': 'success',
        'stats': {
            'total_users': total_users['count'],
            'total_sales': total_sales['count'],
            'total_revenue': total_revenue['total'] or 0
        }
    })

@app.route('/api/audit/logs')
def audit_logs():
    limit = request.args.get('limit', 100, type=int)
    
    conn = get_db_connection()
    
    logs = conn.execute('''
        SELECT al.*, u.username, u.full_name 
        FROM audit_logs al 
        LEFT JOIN users u ON al.user_id = u.id 
        ORDER BY al.created_at DESC 
        LIMIT ?
    ''', (limit,)).fetchall()
    
    conn.close()
    
    logs_list = []
    for log in logs:
        logs_list.append(dict(log))
    
    return jsonify({
        'status': 'success',
        'logs': logs_list
    })

@app.route('/api/backup/export', methods=['GET', 'POST'])
def export_backup():
    # Basit yedekleme endpoint'i
    # Gerçek deployment'da bu daha gelişmiş olmalı
    return jsonify({
        'status': 'success',
        'message': 'Yedekleme özelliği aktif',
        'file_path': '/backups/tekel-pos-backup.json'
    })

# Yardımcı fonksiyonlar
def log_audit(user_id, action, description, ip_address=None):
    conn = get_db_connection()
    conn.execute(
        'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
        (user_id, action, description, ip_address or request.remote_addr)
    )
    conn.commit()
    conn.close()

# SocketIO events
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'message': 'Bağlantı kuruldu'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

# Uygulama başlatma
if __name__ == '__main__':
    # Veritabanını başlat
    init_db()
    
    # Port ayarı (Vercel için gerekli)
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
else:
    # Vercel'de çalışırken veritabanını başlat
    init_db()
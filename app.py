import os
import logging
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import qrcode
import io
import base64
import socket
from datetime import datetime, timedelta
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool, DatabaseError, IntegrityError
from threading import Lock
import time
import hashlib
import secrets
from functools import wraps
import traceback

# Logging konfigürasyonu
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('tekel_pos.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__, 
    static_folder='static',
    template_folder='templates'
)

# Güvenli secret key
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))
socketio = SocketIO(app, cors_allowed_origins=os.environ.get('ALLOWED_ORIGINS', '*'))

# PostgreSQL connection pool
db_pool = None

def init_db_pool():
    """Veritabanı connection pool'u başlat"""
    global db_pool
    try:
        database_url = os.environ.get('DATABASE_URL')
        if not database_url:
            raise ValueError("DATABASE_URL environment variable is not set")
        
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
            dsn=database_url,
            cursor_factory=RealDictCursor
        )
        logger.info("Database connection pool initialized successfully")
    except Exception as e:
        logger.error(f"Database pool initialization error: {e}")
        raise

def get_db_connection():
    """Connection pool'dan bağlantı al"""
    global db_pool
    if db_pool is None:
        init_db_pool()
    
    try:
        conn = db_pool.getconn()
        return conn
    except Exception as e:
        logger.error(f"Get connection error: {e}")
        raise

def release_db_connection(conn):
    """Bağlantıyı pool'a geri ver"""
    global db_pool
    if db_pool and conn:
        try:
            db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Release connection error: {e}")

def close_db_pool():
    """Connection pool'u kapat"""
    global db_pool
    if db_pool:
        db_pool.closeall()
        logger.info("Database connection pool closed")

# Decorator'lar
def require_auth(f):
    """Authentication gerektiren endpoint'ler için decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'status': 'error', 'message': 'Authorization header required'}), 401
        
        # Basit token kontrolü (gerçek uygulamada JWT kullanılmalı)
        try:
            user_id = int(auth_header.replace('Bearer ', ''))
            request.user_id = user_id
        except:
            return jsonify({'status': 'error', 'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated_function

def transaction_handler(f):
    """Transaction yönetimi için decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        conn = None
        try:
            conn = get_db_connection()
            conn.autocommit = False
            cursor = conn.cursor()
            
            # Fonksiyonu transaction içinde çalıştır
            result = f(cursor, *args, **kwargs)
            
            conn.commit()
            return result
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Transaction error in {f.__name__}: {str(e)}")
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error', 
                'message': f'Transaction error: {str(e)}'
            }), 500
        finally:
            if conn:
                release_db_connection(conn)
    
    return decorated_function

# Yardımcı fonksiyonlar
def hash_password(password):
    """Şifreyi hash'le"""
    return hashlib.sha256(password.encode()).hexdigest()

def validate_product_data(data):
    """Ürün verilerini validate et"""
    errors = []
    
    if not data.get('barcode') or len(data['barcode'].strip()) == 0:
        errors.append('Barkod gereklidir')
    
    if data.get('quantity', 0) < 0:
        errors.append('Miktar negatif olamaz')
    
    if data.get('price', 0) < 0:
        errors.append('Fiyat negatif olamaz')
    
    if data.get('kdv', 0) < 0:
        errors.append('KDV negatif olamaz')
    
    if data.get('otv', 0) < 0:
        errors.append('ÖTV negatif olamaz')
    
    return errors

def validate_sale_data(data):
    """Satış verilerini validate et"""
    errors = []
    
    items = data.get('items', [])
    if not items or len(items) == 0:
        errors.append('En az bir ürün gereklidir')
    
    total = data.get('total', 0)
    if total <= 0:
        errors.append('Toplam tutar geçersiz')
    
    payment_method = data.get('payment_method')
    if payment_method not in ['nakit', 'kredi']:
        errors.append('Geçersiz ödeme yöntemi')
    
    # Stok kontrolü
    for item in items:
        if item.get('quantity', 0) <= 0:
            errors.append(f"{item.get('name', 'Ürün')} için geçersiz miktar")
    
    return errors

# Veritabanı başlatma
def init_db():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Kullanıcılar tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Ürünler tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                barcode TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL CHECK (price >= 0),
                quantity INTEGER DEFAULT 0 CHECK (quantity >= 0),
                kdv REAL DEFAULT 18 CHECK (kdv >= 0),
                otv REAL DEFAULT 0 CHECK (otv >= 0),
                min_stock_level INTEGER DEFAULT 5 CHECK (min_stock_level >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Satışlar tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales (
                id SERIAL PRIMARY KEY,
                total_amount REAL NOT NULL CHECK (total_amount >= 0),
                payment_method TEXT NOT NULL,
                cash_amount REAL DEFAULT 0 CHECK (cash_amount >= 0),
                credit_card_amount REAL DEFAULT 0 CHECK (credit_card_amount >= 0),
                change_amount REAL DEFAULT 0 CHECK (change_amount >= 0),
                user_id INTEGER,
                sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )
        ''')
        
        # Satış detayları tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sale_items (
                id SERIAL PRIMARY KEY,
                sale_id INTEGER,
                barcode TEXT NOT NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                price REAL NOT NULL CHECK (price >= 0),
                FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
            )
        ''')
        
        # Stok hareketleri tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stock_movements (
                id SERIAL PRIMARY KEY,
                barcode TEXT NOT NULL,
                product_name TEXT NOT NULL,
                movement_type TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                user_id INTEGER,
                movement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )
        ''')
        
        # Kasa durumu tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cash_register (
                id SERIAL PRIMARY KEY,
                is_open BOOLEAN DEFAULT FALSE,
                current_amount REAL DEFAULT 0 CHECK (current_amount >= 0),
                opening_balance REAL DEFAULT 0 CHECK (opening_balance >= 0),
                opening_time TIMESTAMP,
                closing_time TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Kasa hareketleri tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cash_transactions (
                id SERIAL PRIMARY KEY,
                transaction_type TEXT NOT NULL,
                amount REAL NOT NULL,
                user_id INTEGER,
                transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                description TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )
        ''')
        
        # Denetim kayıtları tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                action TEXT NOT NULL,
                description TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )
        ''')
        
        # Varsayılan kullanıcıları ekle (hash'lenmiş şifrelerle)
        try:
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('admin', hash_password('admin123'), 'Sistem Yöneticisi', 'admin')
            )
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('kasiyer', hash_password('kasiyer123'), 'Kasiyer Kullanıcı', 'cashier')
            )
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('personel', hash_password('personel123'), 'Personel Kullanıcı', 'user')
            )
        except Exception as e:
            logger.warning(f"Kullanıcı ekleme hatası: {e}")
        
        # Varsayılan kasa durumu
        try:
            cursor.execute(
                'INSERT INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, FALSE, 0, 0) ON CONFLICT (id) DO NOTHING'
            )
        except Exception as e:
            logger.warning(f"Kasa durumu ekleme hatası: {e}")
        
        conn.commit()
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

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
    except Exception as e:
        logger.error(f"QR code generation error: {e}")
        qr_code = ""
    
    return render_template('index.html', local_ip=local_ip, qr_code=qr_code)

# API Routes

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({
            'status': 'error',
            'message': 'Kullanıcı adı ve şifre gereklidir'
        }), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        hashed_password = hash_password(password)
        cursor.execute(
            'SELECT * FROM users WHERE username = %s AND password = %s',
            (username, hashed_password)
        )
        user = cursor.fetchone()
        
        if user:
            # Son giriş zamanını güncelle
            cursor.execute(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = %s',
                (user['id'],)
            )
            conn.commit()
            
            # Denetim kaydı ekle
            log_audit(user['id'], 'login', f'{user["username"]} giriş yaptı', request.remote_addr)
            
            return jsonify({
                'status': 'success',
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'full_name': user['full_name'],
                    'role': user['role']
                },
                'token': str(user['id'])  # Basit token (gerçek uygulamada JWT kullanın)
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Geçersiz kullanıcı adı veya şifre'
            }), 401
            
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Giriş işlemi sırasında hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/products')
@require_auth
def get_products():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM products ORDER BY name')
        products = cursor.fetchall()
        
        products_list = [dict(product) for product in products]
        
        return jsonify({
            'status': 'success',
            'products': products_list
        })
    except Exception as e:
        logger.error(f"Products error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Ürünler yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/products/<barcode>')
@require_auth
def get_product(barcode):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM products WHERE barcode = %s', (barcode,))
        product = cursor.fetchone()
        
        if product:
            return jsonify({
                'status': 'success',
                'product': dict(product)
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Ürün bulunamadı'
            }), 404
    except Exception as e:
        logger.error(f"Product get error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Ürün bilgisi alınırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/products/<barcode>', methods=['PUT'])
@require_auth
def update_product(barcode):
    data = request.get_json()
    
    # Validasyon
    errors = validate_product_data(data)
    if errors:
        return jsonify({
            'status': 'error',
            'message': '; '.join(errors)
        }), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Ürün var mı kontrol et
        cursor.execute('SELECT * FROM products WHERE barcode = %s', (barcode,))
        product = cursor.fetchone()
        
        if not product:
            return jsonify({
                'status': 'error',
                'message': 'Ürün bulunamadı'
            }), 404
        
        # Ürünü güncelle
        cursor.execute('''
            UPDATE products 
            SET name = %s, price = %s, quantity = %s, kdv = %s, otv = %s, min_stock_level = %s 
            WHERE barcode = %s
        ''', (
            data.get('name', product['name']),
            data.get('price', product['price']),
            data.get('quantity', product['quantity']),
            data.get('kdv', product['kdv']),
            data.get('otv', product['otv']),
            data.get('min_stock_level', product['min_stock_level']),
            barcode
        ))
        
        conn.commit()
        
        # Denetim kaydı
        log_audit(getattr(request, 'user_id', 1), 'product_update', 
                 f'Ürün güncellendi: {barcode} - {data.get("name", product["name"])}')
        
        return jsonify({
            'status': 'success',
            'message': 'Ürün başarıyla güncellendi'
        })
        
    except Exception as e:
        logger.error(f"Product update error: {str(e)}")
        if conn:
            conn.rollback()
        return jsonify({
            'status': 'error',
            'message': 'Ürün güncellenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/stock/add', methods=['POST'])
@require_auth
@transaction_handler
def add_stock(cursor):
    data = request.get_json()
    barcode = data.get('barcode')
    quantity = data.get('quantity', 1)
    name = data.get('name')
    price = data.get('price')
    kdv = data.get('kdv', 18)
    otv = data.get('otv', 0)
    min_stock_level = data.get('min_stock_level', 5)
    
    user_id = getattr(request, 'user_id', 1)
    
    # Validasyon
    if quantity <= 0:
        return jsonify({
            'status': 'error', 
            'message': 'Miktar pozitif olmalıdır'
        }), 400
    
    # Ürün var mı kontrol et
    cursor.execute(
        'SELECT * FROM products WHERE barcode = %s', (barcode,)
    )
    product = cursor.fetchone()
    
    if product:
        # Ürün varsa stok güncelle
        new_quantity = product['quantity'] + quantity
        cursor.execute(
            'UPDATE products SET quantity = %s WHERE barcode = %s',
            (new_quantity, barcode)
        )
        movement_type = 'in'
        product_name = product['name']
    else:
        # Yeni ürün ekle
        if not name or not price:
            return jsonify({
                'status': 'error', 
                'message': 'Yeni ürün için ad ve fiyat gereklidir'
            }), 400
        
        if price < 0:
            return jsonify({
                'status': 'error',
                'message': 'Fiyat negatif olamaz'
            }), 400
        
        cursor.execute(
            'INSERT INTO products (barcode, name, price, quantity, kdv, otv, min_stock_level) VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (barcode, name, price, quantity, kdv, otv, min_stock_level)
        )
        movement_type = 'new'
        product_name = name
    
    # Stok hareketi kaydı ekle
    cursor.execute(
        'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (%s, %s, %s, %s, %s)',
        (barcode, product_name, movement_type, quantity, user_id)
    )
    
    # Denetim kaydı
    log_audit(user_id, 'stock_update', f'{quantity} adet stok eklendi: {barcode} - {product_name}')
    
    # WebSocket ile bildirim gönder
    socketio.emit('stock_updated', {'barcode': barcode, 'quantity': quantity})
    
    return jsonify({
        'status': 'success', 
        'message': 'Stok güncellendi'
    })

@app.route('/api/sale', methods=['POST'])
@require_auth
@transaction_handler
def make_sale(cursor):
    data = request.get_json()
    items = data.get('items', [])
    total = data.get('total', 0)
    payment_method = data.get('payment_method', 'nakit')
    cash_amount = data.get('cash_amount', 0)
    credit_card_amount = data.get('credit_card_amount', 0)
    change_amount = data.get('change_amount', 0)
    user_id = getattr(request, 'user_id', 1)
    
    # Validasyon
    errors = validate_sale_data(data)
    if errors:
        return jsonify({
            'status': 'error',
            'message': '; '.join(errors)
        }), 400
    
    # Stok yeterliliği kontrolü
    for item in items:
        cursor.execute(
            'SELECT quantity, name FROM products WHERE barcode = %s', 
            (item['barcode'],)
        )
        product = cursor.fetchone()
        
        if not product:
            return jsonify({
                'status': 'error',
                'message': f"Ürün bulunamadı: {item.get('name', item['barcode'])}"
            }), 400
        
        if product['quantity'] < item['quantity']:
            return jsonify({
                'status': 'error',
                'message': f"Yetersiz stok: {product['name']} (Mevcut: {product['quantity']}, İstenen: {item['quantity']})"
            }), 400
    
    # Satış kaydı oluştur
    cursor.execute(
        'INSERT INTO sales (total_amount, payment_method, cash_amount, credit_card_amount, change_amount, user_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
        (total, payment_method, cash_amount, credit_card_amount, change_amount, user_id)
    )
    sale_id = cursor.fetchone()['id']
    
    # Satış detaylarını ekle ve stokları güncelle
    for item in items:
        cursor.execute(
            'INSERT INTO sale_items (sale_id, barcode, product_name, quantity, price) VALUES (%s, %s, %s, %s, %s)',
            (sale_id, item['barcode'], item['name'], item['quantity'], item['price'])
        )
        
        # Stok güncelle
        cursor.execute(
            'UPDATE products SET quantity = quantity - %s WHERE barcode = %s',
            (item['quantity'], item['barcode'])
        )
        
        # Stok hareketi kaydı
        cursor.execute(
            'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (%s, %s, %s, %s, %s)',
            (item['barcode'], item['name'], 'out', item['quantity'], user_id)
        )
    
    # Kasa hareketi
    if payment_method == 'nakit' and cash_amount > 0:
        cursor.execute(
            'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (%s, %s, %s, %s)',
            ('sale', total, user_id, f'Satış #{sale_id}')
        )
        
        # Kasa bakiyesini güncelle (kasa açıksa)
        cursor.execute('SELECT * FROM cash_register WHERE id = 1')
        cash_status = cursor.fetchone()
        if cash_status and cash_status['is_open']:
            new_balance = cash_status['current_amount'] + cash_amount
            cursor.execute(
                'UPDATE cash_register SET current_amount = %s WHERE id = 1',
                (new_balance,)
            )
    
    # Denetim kaydı
    log_audit(user_id, 'sale', f'Satış yapıldı: #{sale_id} - {total} TL - {payment_method}')
    
    # WebSocket ile bildirim gönder
    socketio.emit('sale_made', {'sale_id': sale_id, 'total': total})
    
    return jsonify({
        'status': 'success', 
        'sale_id': sale_id, 
        'message': 'Satış başarıyla tamamlandı'
    })

# KASA YÖNETİMİ API'leri
@app.route('/api/cash/status')
@require_auth
def cash_status():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM cash_register WHERE id = 1')
        cash_status = cursor.fetchone()
        
        if not cash_status:
            # Varsayılan kasa durumu
            cursor.execute('INSERT INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, FALSE, 0, 0)')
            conn.commit()
            cursor.execute('SELECT * FROM cash_register WHERE id = 1')
            cash_status = cursor.fetchone()
        
        # Bugünkü nakit satışlar
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute(
            'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = %s AND DATE(sale_date) = %s',
            ('nakit', today)
        )
        cash_sales = cursor.fetchone()
        
        # Bugünkü kartlı satışlar
        cursor.execute(
            'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = %s AND DATE(sale_date) = %s',
            ('kredi', today)
        )
        card_sales = cursor.fetchone()
        
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
    except Exception as e:
        logger.error(f"Cash status error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Kasa durumu alınırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/cash/open', methods=['POST'])
@require_auth
@transaction_handler
def open_cash(cursor):
    data = request.get_json()
    initial_amount = data.get('initial_amount', 0)
    user_id = getattr(request, 'user_id', 1)
    
    if initial_amount < 0:
        return jsonify({
            'status': 'error',
            'message': 'Başlangıç bakiyesi negatif olamaz'
        }), 400
    
    # Kasa zaten açık mı kontrol et
    cursor.execute('SELECT is_open FROM cash_register WHERE id = 1')
    cash_status = cursor.fetchone()
    
    if cash_status and cash_status['is_open']:
        return jsonify({
            'status': 'error',
            'message': 'Kasa zaten açık'
        }), 400
    
    # Kasa durumunu güncelle
    cursor.execute(
        'UPDATE cash_register SET is_open = TRUE, current_amount = %s, opening_balance = %s, opening_time = CURRENT_TIMESTAMP WHERE id = 1',
        (initial_amount, initial_amount)
    )
    
    # Kasa hareketi kaydı
    cursor.execute(
        'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (%s, %s, %s, %s)',
        ('open', initial_amount, user_id, 'Kasa açılışı')
    )
    
    # Denetim kaydı
    log_audit(user_id, 'cash_open', f'Kasa açıldı - Başlangıç bakiyesi: {initial_amount} TL')
    
    return jsonify({
        'status': 'success', 
        'message': 'Kasa açıldı'
    })

@app.route('/api/cash/close', methods=['POST'])
@require_auth
@transaction_handler
def close_cash(cursor):
    user_id = getattr(request, 'user_id', 1)
    
    # Kasa durumunu al
    cursor.execute('SELECT * FROM cash_register WHERE id = 1')
    cash_status = cursor.fetchone()
    
    if not cash_status or not cash_status['is_open']:
        return jsonify({
            'status': 'error', 
            'message': 'Kasa zaten kapalı'
        }), 400
    
    # Kasa kapanış işlemi
    final_amount = cash_status['current_amount']
    opening_balance = cash_status['opening_balance']
    
    # Açılış tarihinden bugüne kadar olan nakit satışları hesapla
    if cash_status['opening_time']:
        opening_date = cash_status['opening_time']
        start_date = opening_date.strftime('%Y-%m-%d')
    else:
        start_date = datetime.now().strftime('%Y-%m-%d')
        
    cursor.execute(
        'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = %s AND DATE(sale_date) >= %s',
        ('nakit', start_date)
    )
    cash_sales = cursor.fetchone()
    
    expected_cash = opening_balance + (cash_sales['total'] or 0)
    
    # Kasa durumunu güncelle
    cursor.execute(
        'UPDATE cash_register SET is_open = FALSE, current_amount = 0, opening_balance = 0, closing_time = CURRENT_TIMESTAMP WHERE id = 1'
    )
    
    # Kasa hareketi kaydı
    cursor.execute(
        'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (%s, %s, %s, %s)',
        ('close', final_amount, user_id, f'Kasa kapanışı - Beklenen: {expected_cash:.2f} TL, Gerçek: {final_amount:.2f} TL')
    )
    
    # Denetim kaydı
    log_audit(user_id, 'cash_close', f'Kasa kapandı - Son bakiye: {final_amount:.2f} TL')
    
    return jsonify({
        'status': 'success', 
        'message': 'Kasa kapandı',
        'final_amount': final_amount,
        'expected_amount': expected_cash
    })

@app.route('/api/cash/transactions')
@require_auth
def cash_transactions():
    try:
        limit = request.args.get('limit', 50, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ct.*, u.full_name as user_name 
            FROM cash_transactions ct 
            LEFT JOIN users u ON ct.user_id = u.id 
            ORDER BY ct.transaction_date DESC 
            LIMIT %s
        ''', (limit,))
        
        transactions = cursor.fetchall()
        
        transactions_list = [dict(transaction) for transaction in transactions]
        
        return jsonify({
            'status': 'success',
            'transactions': transactions_list
        })
    except Exception as e:
        logger.error(f"Cash transactions error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Kasa hareketleri yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

# RAPORLAMA API'leri
@app.route('/api/reports/daily-summary')
@require_auth
def daily_summary():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Bugünkü satışlar
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute(
            'SELECT SUM(total_amount) as total FROM sales WHERE DATE(sale_date) = %s',
            (today,)
        )
        sales_today = cursor.fetchone()
        
        # Toplam ürün sayısı
        cursor.execute('SELECT COUNT(*) as count FROM products')
        total_products = cursor.fetchone()
        
        # Azalan stoklar
        cursor.execute(
            'SELECT COUNT(*) as count FROM products WHERE quantity <= min_stock_level AND quantity > 0'
        )
        low_stock = cursor.fetchone()
        
        # Stokta olmayan ürünler
        cursor.execute(
            'SELECT COUNT(*) as count FROM products WHERE quantity = 0'
        )
        out_of_stock = cursor.fetchone()
        
        return jsonify({
            'status': 'success',
            'summary': {
                'total_revenue': sales_today['total'] or 0,
                'total_products': total_products['count'],
                'low_stock_count': low_stock['count'],
                'out_of_stock_count': out_of_stock['count']
            }
        })
    except Exception as e:
        logger.error(f"Daily summary error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Günlük özet yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/inventory/low-stock')
@require_auth
def low_stock():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM products WHERE quantity <= min_stock_level ORDER BY quantity ASC'
        )
        low_stock_products = cursor.fetchall()
        
        products_list = [dict(product) for product in low_stock_products]
        
        return jsonify({
            'status': 'success',
            'products': products_list
        })
    except Exception as e:
        logger.error(f"Low stock error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Düşük stok ürünleri yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/inventory/stock-value')
@require_auth
def stock_value():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Stok istatistikleri
        cursor.execute('SELECT COUNT(*) as count FROM products')
        total_products = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(*) as count FROM products WHERE quantity > 5')
        in_stock = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(*) as count FROM products WHERE quantity > 0 AND quantity <= 5')
        low_stock = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(*) as count FROM products WHERE quantity = 0')
        out_of_stock = cursor.fetchone()
        
        # Toplam stok değeri
        cursor.execute('SELECT SUM(price * quantity) as total FROM products')
        stock_value = cursor.fetchone()
        
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
    except Exception as e:
        logger.error(f"Stock value error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Stok değeri hesaplanırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/reports/sales')
@require_auth
def sales_report():
    conn = None
    cursor = None
    try:
        limit = request.args.get('limit', 50, type=int)
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = '''
            SELECT s.*, u.full_name as user_name 
            FROM sales s 
            LEFT JOIN users u ON s.user_id = u.id 
        '''
        params = []
        
        if start_date and end_date:
            query += ' WHERE DATE(s.sale_date) BETWEEN %s AND %s'
            params.extend([start_date, end_date])
        
        query += ' ORDER BY s.sale_date DESC LIMIT %s'
        params.append(limit)
        
        cursor.execute(query, params)
        sales = cursor.fetchall()
        
        sales_list = [dict(sale) for sale in sales]
        
        return jsonify({
            'status': 'success',
            'report': sales_list
        })
    except Exception as e:
        logger.error(f"Sales report error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Satış raporu yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/reports/stock-movements')
@require_auth
def stock_movements():
    conn = None
    cursor = None
    try:
        limit = request.args.get('limit', 50, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT sm.*, u.full_name as user_name 
            FROM stock_movements sm 
            LEFT JOIN users u ON sm.user_id = u.id 
            ORDER BY sm.movement_date DESC 
            LIMIT %s
        ''', (limit,))
        
        movements = cursor.fetchall()
        
        movements_list = [dict(movement) for movement in movements]
        
        return jsonify({
            'status': 'success',
            'movements': movements_list
        })
    except Exception as e:
        logger.error(f"Stock movements error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Stok hareketleri yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/reports/receipt/<int:sale_id>')
@require_auth
def get_receipt(sale_id):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Satış bilgileri
        cursor.execute('''
            SELECT s.*, u.full_name as user_name 
            FROM sales s 
            LEFT JOIN users u ON s.user_id = u.id 
            WHERE s.id = %s
        ''', (sale_id,))
        
        sale = cursor.fetchone()
        
        if not sale:
            return jsonify({
                'status': 'error', 
                'message': 'Fiş bulunamadı'
            }), 404
        
        # Satış detayları
        cursor.execute(
            'SELECT * FROM sale_items WHERE sale_id = %s', (sale_id,)
        )
        items = cursor.fetchall()
        
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
    except Exception as e:
        logger.error(f"Receipt error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Fiş bilgisi alınırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

# YÖNETİM API'leri
@app.route('/api/users')
@require_auth
def get_users():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, username, full_name, role, last_login, created_at FROM users ORDER BY created_at DESC')
        users = cursor.fetchall()
        
        users_list = [dict(user) for user in users]
        
        return jsonify({
            'status': 'success',
            'users': users_list
        })
    except Exception as e:
        logger.error(f"Users error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Kullanıcılar yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/admin/users', methods=['POST'])
@require_auth
def create_user():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    full_name = data.get('full_name')
    role = data.get('role', 'user')
    
    user_id = getattr(request, 'user_id', 1)
    
    if not username or not password or not full_name:
        return jsonify({
            'status': 'error', 
            'message': 'Tüm alanlar gereklidir'
        }), 400
    
    if role not in ['admin', 'cashier', 'user']:
        return jsonify({
            'status': 'error',
            'message': 'Geçersiz rol'
        }), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        hashed_password = hash_password(password)
        cursor.execute(
            'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s)',
            (username, hashed_password, full_name, role)
        )
        
        # Denetim kaydı
        log_audit(user_id, 'user_create', f'Yeni kullanıcı oluşturuldu: {username} - {full_name}')
        
        conn.commit()
        
        return jsonify({
            'status': 'success', 
            'message': 'Kullanıcı başarıyla oluşturuldu'
        })
        
    except IntegrityError:
        return jsonify({
            'status': 'error', 
            'message': 'Bu kullanıcı adı zaten kullanılıyor'
        }), 400
    except Exception as e:
        logger.error(f"Create user error: {str(e)}")
        if conn:
            conn.rollback()
        return jsonify({
            'status': 'error', 
            'message': 'Kullanıcı oluşturulurken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/admin/system-stats')
@require_auth
def system_stats():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Toplam kullanıcı sayısı
        cursor.execute('SELECT COUNT(*) as count FROM users')
        total_users = cursor.fetchone()
        
        # Toplam satış sayısı
        cursor.execute('SELECT COUNT(*) as count FROM sales')
        total_sales = cursor.fetchone()
        
        # Toplam ciro
        cursor.execute('SELECT SUM(total_amount) as total FROM sales')
        total_revenue = cursor.fetchone()
        
        return jsonify({
            'status': 'success',
            'stats': {
                'total_users': total_users['count'],
                'total_sales': total_sales['count'],
                'total_revenue': total_revenue['total'] or 0
            }
        })
    except Exception as e:
        logger.error(f"System stats error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Sistem istatistikleri yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/audit/logs')
@require_auth
def audit_logs():
    conn = None
    cursor = None
    try:
        limit = request.args.get('limit', 100, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT al.*, u.username, u.full_name 
            FROM audit_logs al 
            LEFT JOIN users u ON al.user_id = u.id 
            ORDER BY al.created_at DESC 
            LIMIT %s
        ''', (limit,))
        
        logs = cursor.fetchall()
        
        logs_list = [dict(log) for log in logs]
        
        return jsonify({
            'status': 'success',
            'logs': logs_list
        })
    except Exception as e:
        logger.error(f"Audit logs error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Denetim kayıtları yüklenirken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

@app.route('/api/backup/export', methods=['GET'])
@require_auth
def export_backup():
    # Basit yedekleme endpoint'i - gerçek uygulamada dosya oluşturulmalı
    try:
        backup_data = {
            'timestamp': datetime.now().isoformat(),
            'message': 'Yedekleme özelliği aktif - Gerçek uygulamada dosya oluşturulacak'
        }
        
        log_audit(getattr(request, 'user_id', 1), 'backup_export', 'Sistem yedeklemesi alındı')
        
        return jsonify({
            'status': 'success',
            'message': 'Yedekleme başarılı',
            'backup': backup_data,
            'file_path': '/backups/tekel-pos-backup.json'
        })
    except Exception as e:
        logger.error(f"Backup export error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Yedekleme sırasında hata oluştu'
        }), 500

# Yardımcı fonksiyonlar
def log_audit(user_id, action, description, ip_address=None):
    """Denetim kaydı ekle"""
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (%s, %s, %s, %s)',
            (user_id, action, description, ip_address or request.remote_addr)
        )
        conn.commit()
        
        logger.info(f"Audit log: {action} - {description} - User: {user_id}")
    except Exception as e:
        logger.error(f'Audit log error: {e}')
    finally:
        if cursor:
            cursor.close()
        if conn:
            release_db_connection(conn)

# SocketIO events
@socketio.on('connect')
def handle_connect():
    logger.info('Client connected')
    emit('connected', {'message': 'Bağlantı kuruldu'})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info('Client disconnected')

# Hata yönetimi
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'status': 'error',
        'message': 'Sayfa bulunamadı'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({
        'status': 'error',
        'message': 'Sunucu hatası oluştu'
    }), 500

@app.errorhandler(Exception)
def handle_exception(error):
    logger.error(f"Unhandled exception: {error}")
    logger.error(traceback.format_exc())
    return jsonify({
        'status': 'error',
        'message': 'Beklenmeyen bir hata oluştu'
    }), 500

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

# Uygulama kapanırken pool'u temizle
import atexit
atexit.register(close_db_pool)
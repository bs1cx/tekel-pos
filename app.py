import os
import logging
from flask import Flask, render_template, request, jsonify, send_from_directory
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

# Database bağlantısı ve init kontrolü
_db_initialized = False
_db_init_lock = Lock()

def get_db_connection():
    """Supabase PostgreSQL bağlantısı"""
    max_retries = 3
    retry_delay = 1
    
    for attempt in range(max_retries):
        try:
            # Supabase environment variables'larını kullan
            db_host = os.environ.get('POSTGRES_HOST')
            db_user = os.environ.get('POSTGRES_USER')
            db_password = os.environ.get('POSTGRES_PASSWORD')
            db_name = os.environ.get('POSTGRES_DATABASE')
            
            # Connection string oluştur
            if db_host and db_user and db_password and db_name:
                database_url = f"postgresql://{db_user}:{db_password}@{db_host}:5432/{db_name}"
            else:
                # Fallback olarak DATABASE_URL veya direct Supabase URL
                database_url = os.environ.get('DATABASE_URL')
                if not database_url:
                    database_url = "postgresql://postgres.mqkjserlvdfddjutcoqr:RwhjxIGj71vVJNoB@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
            
            logger.info(f"Supabase connection attempt {attempt + 1}")
            conn = psycopg2.connect(
                database_url,
                cursor_factory=RealDictCursor
            )
            logger.info("Supabase connection successful")
            return conn
                
        except Exception as e:
            logger.error(f"Connection attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                logger.error(f"All connection attempts failed: {e}")
                raise

def ensure_db_initialized():
    """Database'in initialize edildiğinden emin ol"""
    global _db_initialized
    
    if _db_initialized:
        return True
    
    with _db_init_lock:
        if _db_initialized:
            return True
            
        try:
            init_db()
            _db_initialized = True
            logger.info("Database initialization completed")
            return True
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            return False

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
                conn.close()
    
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
        
        logger.info("Starting Supabase database initialization...")
        
        # Önce tabloların var olup olmadığını kontrol et
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        """)
        users_table_exists = cursor.fetchone()['exists']
        
        if not users_table_exists:
            logger.info("Creating tables in Supabase...")
            
            # Kullanıcılar tablosu
            cursor.execute('''
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    last_login TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            logger.info("Users table created")
            
            # Ürünler tablosu
            cursor.execute('''
                CREATE TABLE products (
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
            logger.info("Products table created")
            
            # Satışlar tablosu
            cursor.execute('''
                CREATE TABLE sales (
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
            logger.info("Sales table created")
            
            # Satış detayları tablosu
            cursor.execute('''
                CREATE TABLE sale_items (
                    id SERIAL PRIMARY KEY,
                    sale_id INTEGER,
                    barcode TEXT NOT NULL,
                    product_name TEXT NOT NULL,
                    quantity INTEGER NOT NULL CHECK (quantity > 0),
                    price REAL NOT NULL CHECK (price >= 0),
                    FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
                )
            ''')
            logger.info("Sale items table created")
            
            # Stok hareketleri tablosu
            cursor.execute('''
                CREATE TABLE stock_movements (
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
            logger.info("Stock movements table created")
            
            # Kasa durumu tablosu
            cursor.execute('''
                CREATE TABLE cash_register (
                    id SERIAL PRIMARY KEY,
                    is_open BOOLEAN DEFAULT FALSE,
                    current_amount REAL DEFAULT 0 CHECK (current_amount >= 0),
                    opening_balance REAL DEFAULT 0 CHECK (opening_balance >= 0),
                    opening_time TIMESTAMP,
                    closing_time TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            logger.info("Cash register table created")
            
            # Kasa hareketleri tablosu
            cursor.execute('''
                CREATE TABLE cash_transactions (
                    id SERIAL PRIMARY KEY,
                    transaction_type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    user_id INTEGER,
                    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    description TEXT,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
                )
            ''')
            logger.info("Cash transactions table created")
            
            # Denetim kayıtları tablosu
            cursor.execute('''
                CREATE TABLE audit_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER,
                    action TEXT NOT NULL,
                    description TEXT,
                    ip_address TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
                )
            ''')
            logger.info("Audit logs table created")
            
            # Varsayılan kullanıcıları ekle (hash'lenmiş şifrelerle)
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
            logger.info("Default users created")
            
            # Varsayılan kasa durumu
            cursor.execute(
                'INSERT INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, FALSE, 0, 0) ON CONFLICT (id) DO NOTHING'
            )
            logger.info("Cash register default state created")
            
            conn.commit()
            logger.info("All tables created successfully in Supabase")
        else:
            logger.info("Tables already exist in Supabase, skipping creation")
        
    except Exception as e:
        logger.error(f"Supabase database initialization error: {e}")
        logger.error(traceback.format_exc())
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# Static dosyalar için route
@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# Ana sayfa
@app.route('/')
def index():
    try:
        # Database'i initialize et
        ensure_db_initialized()
        
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
    # Önce database'in initialize edildiğinden emin ol
    if not ensure_db_initialized():
        return jsonify({
            'status': 'error',
            'message': 'Database başlatılamadı. Lütfen daha sonra tekrar deneyin.'
        }), 500
    
    data = request.get_json()
    
    if not data:
        return jsonify({
            'status': 'error',
            'message': 'Geçersiz JSON verisi'
        }), 400
    
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
        logger.info(f"Login attempt for username: {username}")
        
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
            
            logger.info(f"Successful login for user: {username}")
            
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
            logger.warning(f"Failed login attempt for username: {username}")
            return jsonify({
                'status': 'error',
                'message': 'Geçersiz kullanıcı adı veya şifre'
            }), 401
            
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'message': 'Giriş işlemi sırasında hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

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
            conn.close()

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
            conn.close()

@app.route('/api/products', methods=['POST'])
@require_auth
@transaction_handler
def create_product(cursor):
    data = request.get_json()
    
    # Validasyon
    errors = validate_product_data(data)
    if errors:
        return jsonify({
            'status': 'error',
            'message': '; '.join(errors)
        }), 400
    
    barcode = data.get('barcode')
    name = data.get('name')
    price = data.get('price', 0)
    quantity = data.get('quantity', 0)
    kdv = data.get('kdv', 18)
    otv = data.get('otv', 0)
    min_stock_level = data.get('min_stock_level', 5)
    user_id = getattr(request, 'user_id', 1)
    
    # Ürün var mı kontrol et
    cursor.execute('SELECT * FROM products WHERE barcode = %s', (barcode,))
    existing_product = cursor.fetchone()
    
    if existing_product:
        return jsonify({
            'status': 'error',
            'message': 'Bu barkod zaten kullanılıyor'
        }), 400
    
    # Yeni ürün ekle
    cursor.execute('''
        INSERT INTO products (barcode, name, price, quantity, kdv, otv, min_stock_level) 
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    ''', (barcode, name, price, quantity, kdv, otv, min_stock_level))
    
    # Stok hareketi kaydı (yeni ürün)
    if quantity > 0:
        cursor.execute(
            'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (%s, %s, %s, %s, %s)',
            (barcode, name, 'new', quantity, user_id)
        )
    
    # Denetim kaydı
    log_audit(user_id, 'product_create', f'Yeni ürün eklendi: {barcode} - {name}')
    
    return jsonify({
        'status': 'success',
        'message': 'Ürün başarıyla eklendi'
    })

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
        
        # Eski miktarı kaydet
        old_quantity = product['quantity']
        new_quantity = data.get('quantity', old_quantity)
        quantity_diff = new_quantity - old_quantity
        
        # Ürünü güncelle
        cursor.execute('''
            UPDATE products 
            SET name = %s, price = %s, quantity = %s, kdv = %s, otv = %s, min_stock_level = %s 
            WHERE barcode = %s
        ''', (
            data.get('name', product['name']),
            data.get('price', product['price']),
            new_quantity,
            data.get('kdv', product['kdv']),
            data.get('otv', product['otv']),
            data.get('min_stock_level', product['min_stock_level']),
            barcode
        ))
        
        # Stok hareketi kaydı (miktar değiştiyse)
        if quantity_diff != 0:
            movement_type = 'in' if quantity_diff > 0 else 'out'
            cursor.execute(
                'INSERT INTO stock_movements (barcode, product_name, movement_type, quantity, user_id) VALUES (%s, %s, %s, %s, %s)',
                (barcode, data.get('name', product['name']), movement_type, abs(quantity_diff), getattr(request, 'user_id', 1))
            )
        
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
            conn.close()

@app.route('/api/products/<barcode>', methods=['DELETE'])
@require_auth
@transaction_handler
def delete_product(cursor, barcode):
    user_id = getattr(request, 'user_id', 1)
    
    # Ürün var mı kontrol et
    cursor.execute('SELECT * FROM products WHERE barcode = %s', (barcode,))
    product = cursor.fetchone()
    
    if not product:
        return jsonify({
            'status': 'error',
            'message': 'Ürün bulunamadı'
        }), 404
    
    # Ürünü sil
    cursor.execute('DELETE FROM products WHERE barcode = %s', (barcode,))
    
    # Denetim kaydı
    log_audit(user_id, 'product_delete', f'Ürün silindi: {barcode} - {product["name"]}')
    
    return jsonify({
        'status': 'success',
        'message': 'Ürün başarıyla silindi'
    })

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
            conn.close()

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
    log_audit(user_id, 'cash_open', f'Kasa açıldı - Başlangıç: {initial_amount} TL')
    
    return jsonify({
        'status': 'success',
        'message': 'Kasa başarıyla açıldı'
    })

@app.route('/api/cash/close', methods=['POST'])
@require_auth
@transaction_handler
def close_cash(cursor):
    data = request.get_json()
    final_amount = data.get('final_amount', 0)
    user_id = getattr(request, 'user_id', 1)
    
    if final_amount < 0:
        return jsonify({
            'status': 'error',
            'message': 'Kapanış bakiyesi negatif olamaz'
        }), 400
    
    # Kasa açık mı kontrol et
    cursor.execute('SELECT * FROM cash_register WHERE id = 1')
    cash_status = cursor.fetchone()
    
    if not cash_status or not cash_status['is_open']:
        return jsonify({
            'status': 'error',
            'message': 'Kasa zaten kapalı'
        }), 400
    
    # Bugünkü nakit satışları hesapla
    cursor.execute(
        'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = %s AND DATE(sale_date) = %s',
        ('nakit', datetime.now().strftime('%Y-%m-%d'))
    )
    cash_sales = cursor.fetchone()
    cash_sales_total = cash_sales['total'] or 0
    
    # Beklenen nakit miktarı
    expected_cash = (cash_status['opening_balance'] or 0) + cash_sales_total
    
    # Kasa durumunu güncelle
    cursor.execute(
        'UPDATE cash_register SET is_open = FALSE, current_amount = 0, closing_time = CURRENT_TIMESTAMP WHERE id = 1'
    )
    
    # Kasa hareketi kaydı
    cursor.execute(
        'INSERT INTO cash_transactions (transaction_type, amount, user_id, description) VALUES (%s, %s, %s, %s)',
        ('close', final_amount, user_id, f'Kasa kapanışı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL')
    )
    
    # Denetim kaydı
    log_audit(user_id, 'cash_close', 
             f'Kasa kapandı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL')
    
    return jsonify({
        'status': 'success',
        'message': 'Kasa başarıyla kapandı',
        'summary': {
            'opening_balance': cash_status['opening_balance'],
            'cash_sales': cash_sales_total,
            'expected_cash': expected_cash,
            'actual_cash': final_amount,
            'difference': final_amount - expected_cash
        }
    })

# RAPORLAMA API'leri
@app.route('/api/reports/sales')
@require_auth
def sales_report():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        query = '''
            SELECT s.*, u.full_name as user_name 
            FROM sales s 
            LEFT JOIN users u ON s.user_id = u.id 
            WHERE 1=1
        '''
        params = []
        
        if start_date:
            query += ' AND DATE(s.sale_date) >= %s'
            params.append(start_date)
        
        if end_date:
            query += ' AND DATE(s.sale_date) <= %s'
            params.append(end_date)
        
        query += ' ORDER BY s.sale_date DESC'
        
        cursor.execute(query, params)
        sales = cursor.fetchall()
        
        return jsonify({
            'status': 'success',
            'sales': [dict(sale) for sale in sales]
        })
    except Exception as e:
        logger.error(f"Sales report error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Satış raporu alınırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route('/api/reports/stock')
@require_auth
def stock_report():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Düşük stoklu ürünler
        cursor.execute('''
            SELECT * FROM products 
            WHERE quantity <= min_stock_level 
            ORDER BY quantity ASC
        ''')
        low_stock = cursor.fetchall()
        
        # Stok hareketleri
        cursor.execute('''
            SELECT sm.*, u.full_name as user_name 
            FROM stock_movements sm 
            LEFT JOIN users u ON sm.user_id = u.id 
            ORDER BY sm.movement_date DESC 
            LIMIT 100
        ''')
        movements = cursor.fetchall()
        
        return jsonify({
            'status': 'success',
            'low_stock': [dict(product) for product in low_stock],
            'movements': [dict(movement) for movement in movements]
        })
    except Exception as e:
        logger.error(f"Stock report error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Stok raporu alınırken hata oluştu'
        }), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# Denetim kaydı fonksiyonu
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
    except Exception as e:
        logger.error(f"Audit log error: {str(e)}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# Hata yönetimi
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'status': 'error',
        'message': 'Sayfa bulunamadı'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    logger.error(traceback.format_exc())
    return jsonify({
        'status': 'error',
        'message': 'Sunucu hatası oluştu'
    }), 500

@app.before_request
def before_request():
    """Her request'ten önce database'in hazır olduğundan emin ol"""
    if request.endpoint and request.endpoint != 'static':
        ensure_db_initialized()

# Uygulama başlatma
if __name__ == '__main__':
    try:
        logger.info("Initializing database...")
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        logger.error(traceback.format_exc())
    
    # Render için port ayarı
    port = int(os.environ.get('PORT', 5000))
    
    # Render'da production modunda çalıştır
    if os.environ.get('RENDER'):
        # Production için Waitress kullan
        from waitress import serve
        logger.info(f"Starting production server on port {port}")
        serve(app, host='0.0.0.0', port=port)
    else:
        # Development için Flask built-in server
        logger.info(f"Starting development server on port {port}")
        app.run(
            host='0.0.0.0', 
            port=port, 
            debug=True
        )
import os
import logging
from flask import Flask, render_template, request, jsonify, send_from_directory
import qrcode
import io
import base64
import socket
from datetime import datetime
import hashlib
import secrets
from functools import wraps
import requests
import traceback
import time

# =========================================================
# LOGGING KONFİGÜRASYONU
# =========================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# =========================================================
# FLASK UYGULAMASI
# =========================================================
app = Flask(__name__,
    static_folder='static',
    template_folder='templates'
)

# Güvenli secret key
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# =========================================================
# SUPABASE (REST) AYARLARI
# =========================================================
# Bu değerleri sen verdin — doğrudan kullanıyorum.
SUPABASE_URL = "https://mqkjserlvdfddjutcoqr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xa2pzZXJsdmRmZGRqdXRjb3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTI1NjEsImV4cCI6MjA3NTcyODU2MX0.L_cOpIZQkkqAd0U1plpX5qrFPFoOdasxVtRScSTQ6a8"

# Opsiyonel: service role key varsa init sırasında DDL çalıştırılabilir (kullanıcı dikkatli olsun)
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

# Eğer service role key verilmişse güvenlikli header
SUPABASE_SERVICE_HEADERS = None
if SUPABASE_SERVICE_ROLE_KEY:
    SUPABASE_SERVICE_HEADERS = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

# =========================================================
# YARDIMCI: Supabase REST wrapper fonksiyonları
# =========================================================
# Not: PostgREST endpoint'leri tablo isimleri ile çalışır: /rest/v1/<table>
# Filtreler PostgREST query param formatında verilir (örn. ?id=eq.1)
# Bu wrapper'lar response ve HTTP kodlarını kontrol eder.

def supabase_get(table, params=None, headers=None, timeout=10):
    """GET /rest/v1/<table>?<params>"""
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=timeout)
        if resp.status_code >= 400:
            logger.error(f"Supabase GET {table} failed: {resp.status_code} - {resp.text}")
            return None, resp.status_code
        return resp.json(), resp.status_code
    except Exception as e:
        logger.error(f"Supabase GET exception for {table}: {e}")
        return None, 500

def supabase_post(table, data, headers=None, timeout=10):
    """POST /rest/v1/<table>"""
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = requests.post(url, headers=headers, json=data, timeout=timeout)
        if resp.status_code >= 400:
            logger.error(f"Supabase POST {table} failed: {resp.status_code} - {resp.text}")
            return None, resp.status_code
        # PostgREST returns created rows (if wants) or empty; try parse
        try:
            return resp.json(), resp.status_code
        except:
            return resp.text, resp.status_code
    except Exception as e:
        logger.error(f"Supabase POST exception for {table}: {e}")
        return None, 500

def supabase_patch(table, filters, data, headers=None, timeout=10):
    """PATCH /rest/v1/<table>?<filters>"""
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = requests.patch(url, headers=headers, params=filters, json=data, timeout=timeout)
        if resp.status_code >= 400:
            logger.error(f"Supabase PATCH {table} failed: {resp.status_code} - {resp.text}")
            return None, resp.status_code
        try:
            return resp.json(), resp.status_code
        except:
            return resp.text, resp.status_code
    except Exception as e:
        logger.error(f"Supabase PATCH exception for {table}: {e}")
        return None, 500

def supabase_delete(table, filters, headers=None, timeout=10):
    """DELETE /rest/v1/<table>?<filters>"""
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = requests.delete(url, headers=headers, params=filters, timeout=timeout)
        if resp.status_code >= 400:
            logger.error(f"Supabase DELETE {table} failed: {resp.status_code} - {resp.text}")
            return None, resp.status_code
        try:
            return resp.json(), resp.status_code
        except:
            return resp.text, resp.status_code
    except Exception as e:
        logger.error(f"Supabase DELETE exception for {table}: {e}")
        return None, 500

# Helper: parametrized filter builder (dict -> PostgREST params)
def build_filters(d):
    """
    d is a dict like {"username": "eq.john", "id": "eq.1"} or {"id": "eq.1"}
    If user supplies a plain value, we will convert to eq.<value>.
    """
    params = {}
    if not d:
        return params
    for k, v in d.items():
        if isinstance(v, str) and (v.startswith("eq.") or v.startswith("like.") or v.startswith("gt.") or v.startswith("lt.") or v.startswith("ilike.") or v.startswith("neq.")):
            params[k] = v
        else:
            # assume equality
            params[k] = f"eq.{v}"
    return params

# =========================================================
# HELPERS: password hashing and simple utilities
# =========================================================
def hash_password(password):
    if password is None:
        return None
    return hashlib.sha256(password.encode()).hexdigest()

def now_iso():
    return datetime.utcnow().isoformat()

# =========================================================
# DB INIT (checks only) - cannot create tables with anon key in general
# =========================================================
_db_initialized = False
_db_init_lock = False

def ensure_db_initialized(retries=3, delay=1):
    """
    Try to confirm the main tables exist. With anon key we cannot run DDL reliably.
    We'll attempt to GET /users limit=1. If 200 -> ok. If 404 or other, log instructions.
    """
    global _db_initialized, _db_init_lock
    if _db_initialized:
        return True

    # simple lock to avoid concurrent init attempts
    if _db_init_lock:
        # another thread doing init; be optimistic and return False (or wait)
        return False

    _db_init_lock = True
    try:
        attempt = 0
        while attempt < retries:
            attempt += 1
            users, status = supabase_get("users", params={"select": "id", "limit": 1})
            if users is not None and status == 200:
                logger.info("Supabase tables reachable.")
                # ensure default users exist (if none, create them)
                try:
                    users_all, s2 = supabase_get("users", params={"select": "id,username"})
                    if users_all is not None and isinstance(users_all, list) and len(users_all) == 0:
                        logger.info("No users exist, creating default users.")
                        # create default users (hash passwords)
                        default_users = [
                            {"username": "admin", "password": hash_password("admin123"), "full_name": "Sistem Yöneticisi", "role": "admin", "created_at": now_iso()},
                            {"username": "kasiyer", "password": hash_password("kasiyer123"), "full_name": "Kasiyer Kullanıcı", "role": "cashier", "created_at": now_iso()},
                            {"username": "personel", "password": hash_password("personel123"), "full_name": "Personel Kullanıcı", "role": "user", "created_at": now_iso()}
                        ]
                        for u in default_users:
                            r, st = supabase_post("users", u)
                            logger.info(f"Created default user, status {st}")
                    _db_initialized = True
                    _db_init_lock = False
                    return True
                except Exception as e:
                    logger.warning(f"While ensuring default users: {e}")
                    _db_init_lock = False
                    return True
            else:
                logger.warning(f"Supabase users check failed (attempt {attempt}): status {status}. Retrying in {delay}s")
                time.sleep(delay)
        # after retries, log a helpful message and return False
        logger.error(
            "Supabase tables appear unreachable via anon key. "
            "If tables are not created, create them in Supabase Dashboard. "
            "If you want automated table creation, set SUPABASE_SERVICE_ROLE_KEY env var (careful: keep it secret)."
        )
        _db_init_lock = False
        return False
    except Exception as e:
        logger.error(f"ensure_db_initialized exception: {e}")
        _db_init_lock = False
        return False

# =========================================================
# AUTH DECORATOR
# =========================================================
def require_auth(f):
    """Simple Authorization check: ensures Authorization header present.
       You can replace with real JWT logic later using SUPABASE_JWT_SECRET or Supabase auth.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'status': 'error', 'message': 'Authorization header required'}), 401
        # For backward compatibility with old code that used token = user id,
        # allow "Bearer <user_id>" style tokens for local/dev usage.
        try:
            token = auth_header.replace('Bearer ', '').strip()
            # if numeric, place into request.user_id
            if token.isdigit():
                request.user_id = int(token)
        except:
            pass
        return f(*args, **kwargs)
    return decorated_function

# =========================================================
# TRANSACTION HANDLER ADAPTATION
# =========================================================
def transaction_handler(f):
    """
    In REST setup we cannot have DB-level transactions spanning multiple HTTP calls.
    This decorator will just run the function and catch errors, returning 500 on failure.
    Functions should use the supabase_* helpers for atomic operations where possible.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Transaction-like handler caught error in {f.__name__}: {e}")
            logger.error(traceback.format_exc())
            return jsonify({'status': 'error', 'message': f'Transaction error: {str(e)}'}), 500
    return decorated_function

# =========================================================
# VALIDATION HELPERS (aynı orijinal mantık)
# =========================================================
def validate_product_data(data):
    """Ürün verilerini validate et"""
    errors = []
    
    if not data.get('barcode') or len(str(data['barcode']).strip()) == 0:
        errors.append('Barkod gereklidir')
    
    if int(data.get('quantity', 0)) < 0:
        errors.append('Miktar negatif olamaz')
    
    if float(data.get('price', 0)) < 0:
        errors.append('Fiyat negatif olamaz')
    
    if float(data.get('kdv', 0)) < 0:
        errors.append('KDV negatif olamaz')
    
    if float(data.get('otv', 0)) < 0:
        errors.append('ÖTV negatif olamaz')
    
    return errors

def validate_sale_data(data):
    """Satış verilerini validate et"""
    errors = []
    
    items = data.get('items', [])
    if not items or len(items) == 0:
        errors.append('En az bir ürün gereklidir')
    
    total = data.get('total', 0)
    try:
        if float(total) <= 0:
            errors.append('Toplam tutar geçersiz')
    except:
        errors.append('Toplam tutar geçersiz')
    
    payment_method = data.get('payment_method')
    if payment_method not in ['nakit', 'kredi']:
        errors.append('Geçersiz ödeme yöntemi')
    
    # Stok kontrolü
    for item in items:
        if int(item.get('quantity', 0)) <= 0:
            errors.append(f"{item.get('name', 'Ürün')} için geçersiz miktar")
    
    return errors

# =========================================================
# INIT - Logically similar to original, but using REST
# =========================================================
@app.before_first_request
def app_init():
    # Ensure DB/Tables available
    initialized = ensure_db_initialized()
    if not initialized:
        logger.warning("Database not fully initialized or not reachable. Some operations may fail. "
                       "Please ensure tables (users, products, sales, sale_items, stock_movements, cash_register, cash_transactions, audit_logs) exist in Supabase.")
    else:
        logger.info("Application initialization completed with Supabase reachable.")

# =========================================================
# Static route (unchanged)
# =========================================================
@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# =========================================================
# INDEX (unchanged functionality)
# =========================================================
@app.route('/')
def index():
    try:
        # Check DB quickly
        ensure_db_initialized()
        
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

# =========================================================
# AUTH / LOGIN (REST-based)
# =========================================================
@app.route('/api/auth/login', methods=['POST'])
def login():
    # Ensure DB
    if not ensure_db_initialized():
        return jsonify({
            'status': 'error',
            'message': 'Database erişilemedi. Lütfen yapılandırmayı kontrol edin.'
        }), 500
    
    data = request.get_json()
    if not data:
        return jsonify({'status': 'error', 'message': 'Geçersiz JSON verisi'}), 400
    
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'status': 'error', 'message': 'Kullanıcı adı ve şifre gereklidir'}), 400
    
    hashed_password = hash_password(password)
    # Query users table via Supabase REST
    params = build_filters({"username": f"eq.{username}", "password": f"eq.{hashed_password}"})
    users, status = supabase_get("users", params=params)
    if users is None:
        return jsonify({'status': 'error', 'message': 'Kullanıcı doğrulama sırasında hata oluştu'}), 500
    if isinstance(users, list) and len(users) == 0:
        logger.warning(f"Failed login attempt for username: {username}")
        return jsonify({'status': 'error', 'message': 'Geçersiz kullanıcı adı veya şifre'}), 401
    
    user = users[0]
    # Update last_login
    try:
        supabase_patch("users", {"id": f"eq.{user.get('id')}"}, {"last_login": now_iso()})
    except Exception as e:
        logger.warning(f"Updating last_login failed: {e}")
    # Audit log
    try:
        audit = {
            "user_id": user.get('id'),
            "action": "login",
            "description": f"{user.get('username')} giriş yaptı",
            "ip_address": request.remote_addr,
            "created_at": now_iso()
        }
        supabase_post("audit_logs", audit)
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")

    return jsonify({
        'status': 'success',
        'user': {
            'id': user.get('id'),
            'username': user.get('username'),
            'full_name': user.get('full_name'),
            'role': user.get('role')
        },
        'token': str(user.get('id'))  # same simple token approach for compatibility
    })

# =========================================================
# PRODUCTS: GET ALL
# =========================================================
@app.route('/api/products')
@require_auth
def get_products():
    try:
        products, status = supabase_get("products", params={"order": "name.asc"})
        if products is None:
            return jsonify({'status': 'error', 'message': 'Ürünler yüklenirken hata oluştu'}), 500
        return jsonify({'status': 'success', 'products': products})
    except Exception as e:
        logger.error(f"Products error: {e}")
        return jsonify({'status': 'error', 'message': 'Ürünler yüklenirken hata oluştu'}), 500

# =========================================================
# PRODUCT: GET single by barcode
# =========================================================
@app.route('/api/products/<barcode>')
@require_auth
def get_product(barcode):
    try:
        params = build_filters({"barcode": f"eq.{barcode}"})
        products, status = supabase_get("products", params=params)
        if products is None:
            return jsonify({'status': 'error', 'message': 'Ürün bilgisi alınırken hata oluştu'}), 500
        if isinstance(products, list) and len(products) == 0:
            return jsonify({'status': 'error', 'message': 'Ürün bulunamadı'}), 404
        return jsonify({'status': 'success', 'product': products[0]})
    except Exception as e:
        logger.error(f"Product get error: {e}")
        return jsonify({'status': 'error', 'message': 'Ürün bilgisi alınırken hata oluştu'}), 500

# =========================================================
# CREATE PRODUCT (was transaction_handler)
# =========================================================
@app.route('/api/products', methods=['POST'])
@require_auth
@transaction_handler
def create_product():
    data = request.get_json()
    # Validation
    errors = validate_product_data(data)
    if errors:
        return jsonify({'status': 'error', 'message': '; '.join(errors)}), 400

    barcode = data.get('barcode')
    name = data.get('name')
    price = float(data.get('price', 0))
    quantity = int(data.get('quantity', 0))
    kdv = float(data.get('kdv', 18))
    otv = float(data.get('otv', 0))
    min_stock_level = int(data.get('min_stock_level', 5))
    user_id = getattr(request, 'user_id', 1)

    # Check existing product by barcode
    try:
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({'status': 'error', 'message': 'Veritabanı hatası'}), 500
        if isinstance(existing, list) and len(existing) > 0:
            return jsonify({'status': 'error', 'message': 'Bu barkod zaten kullanılıyor'}), 400
    except Exception as e:
        logger.error(f"Product check error: {e}")
        return jsonify({'status': 'error', 'message': 'Ürün kontrolü sırasında hata oluştu'}), 500

    # Insert product
    product_payload = {
        "barcode": barcode,
        "name": name,
        "price": price,
        "quantity": quantity,
        "kdv": kdv,
        "otv": otv,
        "min_stock_level": min_stock_level,
        "created_at": now_iso()
    }
    created, st = supabase_post("products", product_payload)
    if created is None:
        return jsonify({'status': 'error', 'message': 'Ürün eklenirken hata oluştu'}), 500

    # Stock movement if quantity > 0
    try:
        if quantity > 0:
            stock_payload = {
                "barcode": barcode,
                "product_name": name,
                "movement_type": "new",
                "quantity": quantity,
                "user_id": user_id,
                "movement_date": now_iso()
            }
            supabase_post("stock_movements", stock_payload)
    except Exception as e:
        logger.warning(f"Stock movement creation failed: {e}")

    # Audit log
    try:
        log = {
            "user_id": user_id,
            "action": "product_create",
            "description": f"Yeni ürün eklendi: {barcode} - {name}",
            "created_at": now_iso()
        }
        supabase_post("audit_logs", log)
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")

    return jsonify({'status': 'success', 'message': 'Ürün başarıyla eklendi'})

# =========================================================
# UPDATE PRODUCT
# =========================================================
@app.route('/api/products/<barcode>', methods=['PUT'])
@require_auth
def update_product(barcode):
    data = request.get_json()
    errors = validate_product_data(data)
    if errors:
        return jsonify({'status': 'error', 'message': '; '.join(errors)}), 400

    try:
        # Get product
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({'status': 'error', 'message': 'Veritabanı hatası'}), 500
        if isinstance(existing, list) and len(existing) == 0:
            return jsonify({'status': 'error', 'message': 'Ürün bulunamadı'}), 404

        product = existing[0]
        old_quantity = int(product.get('quantity', 0))
        new_quantity = int(data.get('quantity', old_quantity))
        quantity_diff = new_quantity - old_quantity

        update_payload = {
            "name": data.get('name', product.get('name')),
            "price": float(data.get('price', product.get('price', 0))),
            "quantity": new_quantity,
            "kdv": float(data.get('kdv', product.get('kdv', 18))),
            "otv": float(data.get('otv', product.get('otv', 0))),
            "min_stock_level": int(data.get('min_stock_level', product.get('min_stock_level', 5)))
        }

        supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), update_payload)

        # Create stock movement if change
        try:
            if quantity_diff != 0:
                movement_type = 'in' if quantity_diff > 0 else 'out'
                movement_payload = {
                    "barcode": barcode,
                    "product_name": update_payload["name"],
                    "movement_type": movement_type,
                    "quantity": abs(quantity_diff),
                    "user_id": getattr(request, 'user_id', 1),
                    "movement_date": now_iso()
                }
                supabase_post("stock_movements", movement_payload)
        except Exception as e:
            logger.warning(f"Stock movement after update failed: {e}")

        # Audit log
        log_audit_payload = {
            "user_id": getattr(request, 'user_id', 1),
            "action": "product_update",
            "description": f"Ürün güncellendi: {barcode} - {update_payload['name']}",
            "created_at": now_iso()
        }
        supabase_post("audit_logs", log_audit_payload)

        return jsonify({'status': 'success', 'message': 'Ürün başarıyla güncellendi'})
    except Exception as e:
        logger.error(f"Product update error: {e}")
        return jsonify({'status': 'error', 'message': 'Ürün güncellenirken hata oluştu'}), 500

# =========================================================
# DELETE PRODUCT
# =========================================================
@app.route('/api/products/<barcode>', methods=['DELETE'])
@require_auth
@transaction_handler
def delete_product(barcode):
    try:
        # Check product exists
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({'status': 'error', 'message': 'Veritabanı hatası'}), 500
        if isinstance(existing, list) and len(existing) == 0:
            return jsonify({'status': 'error', 'message': 'Ürün bulunamadı'}), 404

        product = existing[0]
        # Delete product
        supabase_delete("products", build_filters({"barcode": f"eq.{barcode}"}))

        # Audit log
        log = {
            "user_id": getattr(request, 'user_id', 1),
            "action": "product_delete",
            "description": f"Ürün silindi: {barcode} - {product.get('name')}",
            "created_at": now_iso()
        }
        supabase_post("audit_logs", log)

        return jsonify({'status': 'success', 'message': 'Ürün başarıyla silindi'})
    except Exception as e:
        logger.error(f"Delete product error: {e}")
        return jsonify({'status': 'error', 'message': 'Ürün silinirken hata oluştu'}), 500

# =========================================================
# ADD STOCK
# =========================================================
@app.route('/api/stock/add', methods=['POST'])
@require_auth
@transaction_handler
def add_stock():
    try:
        data = request.get_json()
        barcode = data.get('barcode')
        quantity = int(data.get('quantity', 1))
        name = data.get('name')
        price = float(data.get('price', 0)) if data.get('price') is not None else None
        kdv = float(data.get('kdv', 18))
        otv = float(data.get('otv', 0))
        min_stock_level = int(data.get('min_stock_level', 5))
        user_id = getattr(request, 'user_id', 1)

        if quantity <= 0:
            return jsonify({'status': 'error', 'message': 'Miktar pozitif olmalıdır'}), 400

        # Check product existence
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({'status': 'error', 'message': 'Veritabanı hatası'}), 500

        if isinstance(existing, list) and len(existing) > 0:
            product = existing[0]
            new_quantity = int(product.get('quantity', 0)) + quantity
            supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), {"quantity": new_quantity})
            movement_type = 'in'
            product_name = product.get('name')
        else:
            # create new product
            if not name or price is None:
                return jsonify({'status': 'error', 'message': 'Yeni ürün için ad ve fiyat gereklidir'}), 400
            if price < 0:
                return jsonify({'status': 'error', 'message': 'Fiyat negatif olamaz'}), 400
            product_payload = {
                "barcode": barcode,
                "name": name,
                "price": price,
                "quantity": quantity,
                "kdv": kdv,
                "otv": otv,
                "min_stock_level": min_stock_level,
                "created_at": now_iso()
            }
            supabase_post("products", product_payload)
            movement_type = 'new'
            product_name = name

        # Stock movement
        stock_payload = {
            "barcode": barcode,
            "product_name": product_name,
            "movement_type": movement_type,
            "quantity": quantity,
            "user_id": user_id,
            "movement_date": now_iso()
        }
        supabase_post("stock_movements", stock_payload)

        # Audit log
        supabase_post("audit_logs", {
            "user_id": user_id,
            "action": "stock_update",
            "description": f"{quantity} adet stok eklendi: {barcode} - {product_name}",
            "created_at": now_iso()
        })

        return jsonify({'status': 'success', 'message': 'Stok güncellendi'})
    except Exception as e:
        logger.error(f"Add stock error: {e}")
        return jsonify({'status': 'error', 'message': 'Stok güncellenirken hata oluştu'}), 500

# =========================================================
# MAKE SALE (complex)
# =========================================================
@app.route('/api/sale', methods=['POST'])
@require_auth
@transaction_handler
def make_sale():
    try:
        data = request.get_json()
        items = data.get('items', [])
        total = float(data.get('total', 0))
        payment_method = data.get('payment_method', 'nakit')
        cash_amount = float(data.get('cash_amount', 0))
        credit_card_amount = float(data.get('credit_card_amount', 0))
        change_amount = float(data.get('change_amount', 0))
        user_id = getattr(request, 'user_id', 1)

        # Validation
        errors = validate_sale_data(data)
        if errors:
            return jsonify({'status': 'error', 'message': '; '.join(errors)}), 400

        # Check stock availability for each item
        for item in items:
            barcode = item.get('barcode')
            req_qty = int(item.get('quantity', 0))
            prod_list, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
            if prod_list is None:
                return jsonify({'status': 'error', 'message': 'Veritabanı hatası'}), 500
            if isinstance(prod_list, list) and len(prod_list) == 0:
                return jsonify({'status': 'error', 'message': f"Ürün bulunamadı: {item.get('name', barcode)}"}), 400
            prod = prod_list[0]
            if int(prod.get('quantity', 0)) < req_qty:
                return jsonify({'status': 'error', 'message': f"Yetersiz stok: {prod.get('name')} (Mevcut: {prod.get('quantity')}, İstenen: {req_qty})"}), 400

        # Create sale record
        sale_payload = {
            "total_amount": total,
            "payment_method": payment_method,
            "cash_amount": cash_amount,
            "credit_card_amount": credit_card_amount,
            "change_amount": change_amount,
            "user_id": user_id,
            "sale_date": now_iso()
        }
        # Post sale
        created_sale, st = supabase_post("sales", sale_payload)
        # Note: PostgREST often returns empty body; to get sale id you may need to set returning=representation or use SQL
        # We'll attempt to fetch last inserted sale by filtering by timestamp and user_id (best-effort)
        sale_id = None
        if isinstance(created_sale, list) and len(created_sale) > 0 and created_sale[0].get('id'):
            sale_id = created_sale[0]['id']
        else:
            # Try to find sale by matching on timestamp and user_id (approx)
            recent_sales, s2 = supabase_get("sales", params=build_filters({"user_id": f"eq.{user_id}"}))
            if recent_sales:
                # pick the most recent (best-effort)
                try:
                    sale_id = sorted(recent_sales, key=lambda x: x.get('sale_date', ''))[-1].get('id')
                except:
                    sale_id = None

        # If we can't determine sale_id, still proceed but some references will miss id
        # Insert sale_items and update product quantities
        for item in items:
            barcode = item.get('barcode')
            name = item.get('name')
            qty = int(item.get('quantity'))
            price = float(item.get('price', 0))
            sale_item_payload = {
                "sale_id": sale_id,
                "barcode": barcode,
                "product_name": name,
                "quantity": qty,
                "price": price
            }
            supabase_post("sale_items", sale_item_payload)
            # decrement product quantity
            prod_list, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
            if prod_list and isinstance(prod_list, list) and len(prod_list) > 0:
                prod = prod_list[0]
                new_qty = int(prod.get('quantity', 0)) - qty
                if new_qty < 0:
                    new_qty = 0
                supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), {"quantity": new_qty})
            # stock movement
            supabase_post("stock_movements", {
                "barcode": barcode,
                "product_name": name,
                "movement_type": "out",
                "quantity": qty,
                "user_id": user_id,
                "movement_date": now_iso()
            })

        # Cash transactions and cash register updates
        if payment_method == 'nakit' and cash_amount > 0:
            # insert into cash_transactions
            supabase_post("cash_transactions", {
                "transaction_type": "sale",
                "amount": total,
                "user_id": user_id,
                "transaction_date": now_iso(),
                "description": f"Satış #{sale_id}"
            })
            # update cash_register current_amount if open
            cash_regs, s3 = supabase_get("cash_register", params=build_filters({"id": f"eq.1"}))
            if cash_regs and isinstance(cash_regs, list) and len(cash_regs) > 0:
                reg = cash_regs[0]
                if reg.get('is_open'):
                    new_balance = (reg.get('current_amount') or 0) + cash_amount
                    supabase_patch("cash_register", build_filters({"id": f"eq.1"}), {"current_amount": new_balance})

        # Audit log for sale
        supabase_post("audit_logs", {
            "user_id": user_id,
            "action": "sale",
            "description": f"Satış yapıldı: #{sale_id} - {total} TL - {payment_method}",
            "created_at": now_iso()
        })

        return jsonify({'status': 'success', 'sale_id': sale_id, 'message': 'Satış başarıyla tamamlandı'})
    except Exception as e:
        logger.error(f"Make sale error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'status': 'error', 'message': 'Satış sırasında hata oluştu'}), 500

# =========================================================
# CASH endpoints
# =========================================================
@app.route('/api/cash/status')
@require_auth
def cash_status():
    try:
        cash_regs, st = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if cash_regs is None:
            return jsonify({'status': 'error', 'message': 'Kasa durumu alınırken hata oluştu'}), 500
        if isinstance(cash_regs, list) and len(cash_regs) == 0:
            # create default if not exists (anon key can create)
            supabase_post("cash_register", {"id": 1, "is_open": False, "current_amount": 0, "opening_balance": 0, "last_updated": now_iso()})
            cash_regs, st = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        cash_status = cash_regs[0] if isinstance(cash_regs, list) and len(cash_regs) > 0 else cash_regs

        # today's cash sales
        today = datetime.now().strftime('%Y-%m-%d')
        cash_sales, s1 = supabase_get("sales", params={"payment_method": f"eq.nakit", "sale_date": f"gte.{today}"})
        # PostgREST filter by date might need DATE() - but we use a best-effort approach
        # sum totals client-side if possible
        cash_total = 0
        if isinstance(cash_sales, list):
            for s in cash_sales:
                try:
                    cash_total += float(s.get('total_amount', 0))
                except:
                    pass

        card_sales, s2 = supabase_get("sales", params={"payment_method": f"eq.kredi", "sale_date": f"gte.{today}"})
        card_total = 0
        if isinstance(card_sales, list):
            for s in card_sales:
                try:
                    card_total += float(s.get('total_amount', 0))
                except:
                    pass

        return jsonify({
            'status': 'success',
            'cash_status': {
                'is_open': bool(cash_status.get('is_open')),
                'current_amount': cash_status.get('current_amount'),
                'opening_balance': cash_status.get('opening_balance'),
                'opening_time': cash_status.get('opening_time'),
                'cash_sales_today': cash_total,
                'card_sales_today': card_total,
                'expected_cash': (cash_status.get('opening_balance') or 0) + cash_total
            }
        })
    except Exception as e:
        logger.error(f"Cash status error: {e}")
        return jsonify({'status': 'error', 'message': 'Kasa durumu alınırken hata oluştu'}), 500

@app.route('/api/cash/open', methods=['POST'])
@require_auth
@transaction_handler
def open_cash():
    try:
        data = request.get_json()
        initial_amount = float(data.get('initial_amount', 0))
        user_id = getattr(request, 'user_id', 1)
        if initial_amount < 0:
            return jsonify({'status': 'error', 'message': 'Başlangıç bakiyesi negatif olamaz'}), 400

        # check existing
        regs, s = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if regs and isinstance(regs, list) and len(regs) > 0 and regs[0].get('is_open'):
            return jsonify({'status': 'error', 'message': 'Kasa zaten açık'}), 400

        # update or create
        if regs and isinstance(regs, list) and len(regs) > 0:
            supabase_patch("cash_register", build_filters({"id": "eq.1"}), {"is_open": True, "current_amount": initial_amount, "opening_balance": initial_amount, "opening_time": now_iso()})
        else:
            supabase_post("cash_register", {"id": 1, "is_open": True, "current_amount": initial_amount, "opening_balance": initial_amount, "opening_time": now_iso(), "last_updated": now_iso()})

        supabase_post("cash_transactions", {"transaction_type": "open", "amount": initial_amount, "user_id": user_id, "transaction_date": now_iso(), "description": "Kasa açılışı"})
        supabase_post("audit_logs", {"user_id": user_id, "action": "cash_open", "description": f"Kasa açıldı - Başlangıç: {initial_amount} TL", "created_at": now_iso()})

        return jsonify({'status': 'success', 'message': 'Kasa başarıyla açıldı'})
    except Exception as e:
        logger.error(f"Open cash error: {e}")
        return jsonify({'status': 'error', 'message': 'Kasa açılırken hata oluştu'}), 500

@app.route('/api/cash/close', methods=['POST'])
@require_auth
@transaction_handler
def close_cash():
    try:
        data = request.get_json()
        final_amount = float(data.get('final_amount', 0))
        user_id = getattr(request, 'user_id', 1)
        if final_amount < 0:
            return jsonify({'status': 'error', 'message': 'Kapanış bakiyesi negatif olamaz'}), 400

        regs, s = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if regs is None or len(regs) == 0:
            return jsonify({'status': 'error', 'message': 'Kasa zaten kapalı veya tanımlı değil'}), 400
        cash_status = regs[0]
        if not cash_status.get('is_open'):
            return jsonify({'status': 'error', 'message': 'Kasa zaten kapalı'}), 400

        # calculate today's cash sales
        today = datetime.now().strftime('%Y-%m-%d')
        cash_sales, s1 = supabase_get("sales", params={"payment_method": f"eq.nakit", "sale_date": f"gte.{today}"})
        cash_sales_total = 0
        if isinstance(cash_sales, list):
            for s in cash_sales:
                try:
                    cash_sales_total += float(s.get('total_amount', 0))
                except:
                    pass

        expected_cash = (cash_status.get('opening_balance') or 0) + cash_sales_total

        # update cash_register to closed
        supabase_patch("cash_register", build_filters({"id": "eq.1"}), {"is_open": False, "current_amount": 0, "closing_time": now_iso()})

        supabase_post("cash_transactions", {"transaction_type": "close", "amount": final_amount, "user_id": user_id, "transaction_date": now_iso(), "description": f"Kasa kapanışı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL"})
        supabase_post("audit_logs", {"user_id": user_id, "action": "cash_close", "description": f"Kasa kapandı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL", "created_at": now_iso()})

        return jsonify({
            'status': 'success',
            'message': 'Kasa başarıyla kapandı',
            'summary': {
                'opening_balance': cash_status.get('opening_balance'),
                'cash_sales': cash_sales_total,
                'expected_cash': expected_cash,
                'actual_cash': final_amount,
                'difference': final_amount - expected_cash
            }
        })
    except Exception as e:
        logger.error(f"Close cash error: {e}")
        return jsonify({'status': 'error', 'message': 'Kasa kapanırken hata oluştu'}), 500

# =========================================================
# REPORTS
# =========================================================
@app.route('/api/reports/sales')
@require_auth
def sales_report():
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        # Build filters for supabase
        params = {}
        if start_date:
            # using gte on sale_date
            params["sale_date"] = f"gte.{start_date}"
        if end_date:
            # using lte on sale_date
            params["sale_date"] = f"lte.{end_date}"
        # We want joined user name; PostgREST supports select=*,users(full_name) if foreign key configured.
        # If not, return sales and user_id, user names can be fetched on client as needed.
        sales, st = supabase_get("sales", params=params)
        if sales is None:
            return jsonify({'status': 'error', 'message': 'Satış raporu alınırken hata oluştu'}), 500
        return jsonify({'status': 'success', 'sales': sales})
    except Exception as e:
        logger.error(f"Sales report error: {e}")
        return jsonify({'status': 'error', 'message': 'Satış raporu alınırken hata oluştu'}), 500

@app.route('/api/reports/stock')
@require_auth
def stock_report():
    try:
        # low stock items
        low_stock, st = supabase_get("products", params={"quantity": f"lte.min_stock_level", "order": "quantity.asc"})
        # fallback: if server doesn't support that comparator, fetch all and filter locally
        if low_stock is None:
            all_products, st2 = supabase_get("products")
            if all_products is None:
                return jsonify({'status': 'error', 'message': 'Stok raporu alınırken hata oluştu'}), 500
            low_stock = [p for p in all_products if int(p.get('quantity',0)) <= int(p.get('min_stock_level',5))]
        movements, st3 = supabase_get("stock_movements", params={"order": "movement_date.desc", "limit": 100})
        if movements is None:
            movements = []
        return jsonify({
            'status': 'success',
            'low_stock': low_stock,
            'movements': movements
        })
    except Exception as e:
        logger.error(f"Stock report error: {e}")
        return jsonify({'status': 'error', 'message': 'Stok raporu alınırken hata oluştu'}), 500

# =========================================================
# Audit log helper (keeps same interface)
# =========================================================
def log_audit(user_id, action, description, ip_address=None):
    """Denetim kaydı ekle (REST)"""
    try:
        payload = {
            "user_id": user_id,
            "action": action,
            "description": description,
            "ip_address": ip_address or request.remote_addr,
            "created_at": now_iso()
        }
        supabase_post("audit_logs", payload)
    except Exception as e:
        logger.error(f"Audit log error: {e}")

# =========================================================
# ERROR HANDLING
# =========================================================
@app.errorhandler(404)
def not_found(error):
    return jsonify({'status': 'error', 'message': 'Sayfa bulunamadı'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    logger.error(traceback.format_exc())
    return jsonify({'status': 'error', 'message': 'Sunucu hatası oluştu'}), 500

@app.before_request
def before_request():
    """Her request'ten önce (opsiyonel) DB hazır mı kontrol et"""
    # Not forcing init on every request to prevent extra load, but keep basic check
    # We skip static endpoints
    if request.endpoint and request.endpoint != 'static':
        # not blocking requests if false — many endpoints handle DB errors themselves
        ensure_db_initialized()

# =========================================================
# MAIN ENTRY POINT
# =========================================================
if __name__ == '__main__':
    try:
        # On startup try to ensure DB reachable
        ensure_db_initialized()
    except Exception as e:
        logger.warning(f"Startup DB check produced an error: {e}")

    port = int(os.environ.get('PORT', 5000))
    # If running on Render or production choose production server, else default flask
    if os.environ.get('RENDER'):
        try:
            from waitress import serve
            logger.info(f"Starting production server on port {port}")
            serve(app, host='0.0.0.0', port=port)
        except Exception as e:
            logger.info(f"Waitress start failed, starting Flask dev server: {e}")
            app.run(host='0.0.0.0', port=port, debug=False)
    else:
        logger.info(f"Starting development server on port {port}")
        app.run(host='0.0.0.0', port=port, debug=True)

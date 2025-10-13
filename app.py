# app.py
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
import traceback
import time
import ssl

# =========================================================
# HTTP CLIENT: try to import requests, otherwise provide urllib fallback
# =========================================================
try:
    import requests  # type: ignore
    _HAS_REQUESTS = True
except Exception:
    _HAS_REQUESTS = False
    import urllib.request as _urllib_request
    import urllib.parse as _urllib_parse
    import urllib.error as _urllib_error
    import json as _json

    class _SimpleResponse:
        def __init__(self, status_code, text, headers=None):
            self.status_code = status_code
            self.text = text
            self.headers = headers or {}

        def json(self):
            try:
                return _json.loads(self.text)
            except Exception:
                return None

    def _urllib_request_func(method, url, headers=None, params=None, json_data=None, timeout=10):
        # Build full URL with querystring if params provided
        if params:
            # params may be dict; urllib.parse.urlencode handles simple params (not repeated keys)
            qs = _urllib_parse.urlencode(params)
            url_full = f"{url}?{qs}"
        else:
            url_full = url

        data = None
        if json_data is not None:
            data = _json.dumps(json_data).encode("utf-8")
            if headers is None:
                headers = {}
            headers.setdefault("Content-Type", "application/json")

        req = _urllib_request.Request(url_full, data=data, method=method)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        ctx = ssl.create_default_context()
        try:
            with _urllib_request.urlopen(req, timeout=timeout, context=ctx) as resp:
                resp_text = resp.read().decode("utf-8")
                return _SimpleResponse(resp.getcode(), resp_text, dict(resp.getheaders()))
        except _urllib_error.HTTPError as e:
            try:
                txt = e.read().decode("utf-8")
            except Exception:
                txt = ""
            return _SimpleResponse(e.code, txt)
        except Exception as e:
            return _SimpleResponse(500, str(e))

    def requests_get(url, headers=None, params=None, timeout=10):
        return _urllib_request_func("GET", url, headers=headers, params=params, timeout=timeout)

    def requests_post(url, headers=None, json=None, timeout=10):
        return _urllib_request_func("POST", url, headers=headers, json_data=json, timeout=timeout)

    def requests_patch(url, headers=None, params=None, json=None, timeout=10):
        return _urllib_request_func("PATCH", url, headers=headers, params=params, json_data=json, timeout=timeout)

    def requests_delete(url, headers=None, params=None, timeout=10):
        return _urllib_request_func("DELETE", url, headers=headers, params=params, timeout=timeout)

# =========================================================
# LOGGING KONFİGÜRASYONU
# =========================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)
# Reduce werkzeug info noise
logging.getLogger("werkzeug").setLevel(logging.ERROR)

# =========================================================
# FLASK UYGULAMASI
# =========================================================
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# =========================================================
# SUPABASE AYARLARI (ENV first, fallback to hardcoded values you provided)
# =========================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://mqkjserlvdfddjutcoqr.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xa2pzZXJsdmRmZGRqdXRjb3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTI1NjEsImV4cCI6MjA3NTcyODU2MX0.L_cOpIZQkkqAd0U1plpX5qrFPFoOdasxVtRScSTQ6a8")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

SUPABASE_SERVICE_HEADERS = None
if SUPABASE_SERVICE_ROLE_KEY:
    SUPABASE_SERVICE_HEADERS = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

# =========================================================
# SAFETY: required envs check (fail-fast with clear logs if missing)
# =========================================================
_required_envs = ["SUPABASE_URL", "SUPABASE_KEY"]
_missing_envs = []
for _v in _required_envs:
    if not os.environ.get(_v) and _v == "SUPABASE_KEY" and SUPABASE_KEY:
        # fallback exists — allowed
        continue
    if not os.environ.get(_v) and _v == "SUPABASE_URL" and SUPABASE_URL:
        continue
    if not os.environ.get(_v):
        _missing_envs.append(_v)

if _missing_envs:
    # Log an explicit message (do not raise — allow running but warn heavily)
    logger.error(f"Missing environment variables: {_missing_envs}. Application will attempt to run with fallbacks, but set them in Vercel for security.")
else:
    logger.info("Environment variables for Supabase present or fallbacks used.")

# =========================================================
# SAFE REQUEST WRAPPER (retries, backoff)
# =========================================================
def safe_request(method, url, headers=None, params=None, json_data=None, timeout=10, retries=3, backoff=1.5):
    """
    method: 'get'|'post'|'patch'|'delete'
    """
    attempt = 0
    last_exc = None
    while attempt < retries:
        attempt += 1
        try:
            if _HAS_REQUESTS:
                if method == "get":
                    resp = requests.get(url, headers=headers, params=params, timeout=timeout)
                elif method == "post":
                    resp = requests.post(url, headers=headers, json=json_data, timeout=timeout)
                elif method == "patch":
                    resp = requests.patch(url, headers=headers, params=params, json=json_data, timeout=timeout)
                elif method == "delete":
                    resp = requests.delete(url, headers=headers, params=params, timeout=timeout)
                else:
                    raise ValueError("Unsupported HTTP method")
            else:
                if method == "get":
                    resp = requests_get(url, headers=headers, params=params, timeout=timeout)
                elif method == "post":
                    resp = requests_post(url, headers=headers, json=json_data, timeout=timeout)
                elif method == "patch":
                    resp = requests_patch(url, headers=headers, params=params, json=json_data, timeout=timeout)
                elif method == "delete":
                    resp = requests_delete(url, headers=headers, params=params, timeout=timeout)
                else:
                    raise ValueError("Unsupported HTTP method")

            # If response object has status_code attribute and it's successful -> return
            status = getattr(resp, "status_code", None)
            if status is None:
                # fallback: treat as success-ish if text exists
                return resp
            if status < 400:
                return resp
            # Log and retry on 5xx, maybe not on 4xx (client error)
            logger.warning(f"safe_request attempt {attempt} returned status {status} for {url}")
            if 500 <= status < 600:
                last_exc = Exception(f"Server error {status} on attempt {attempt}")
            else:
                # client error - don't retry
                return resp
        except Exception as e:
            logger.warning(f"safe_request attempt {attempt} exception for {url}: {e}")
            last_exc = e

        # backoff before next attempt
        try:
            time.sleep(backoff ** attempt)
        except Exception:
            time.sleep(1)

    # after retries
    if last_exc:
        raise last_exc
    return resp

# =========================================================
# Supabase helper functions (use safe_request)
# =========================================================
def supabase_get(table, params=None, headers=None, timeout=10):
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = safe_request("get", url, headers=headers, params=params, timeout=timeout)
        status = getattr(resp, "status_code", None)
        if status is None:
            data = resp.json()
            return data, 200
        if status >= 400:
            logger.error(f"Supabase GET {table} failed: {status} - {getattr(resp, 'text', '')}")
            return None, status
        return resp.json(), status
    except Exception as e:
        logger.error(f"Supabase GET exception for {table}: {e}")
        return None, 500

def supabase_post(table, data, headers=None, timeout=10):
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = safe_request("post", url, headers=headers, json_data=data, timeout=timeout)
        status = getattr(resp, "status_code", None)
        if status is None:
            return resp.json(), 200
        if status >= 400:
            logger.error(f"Supabase POST {table} failed: {status} - {getattr(resp,'text','')}")
            return None, status
        try:
            return resp.json(), status
        except Exception:
            return getattr(resp, "text", ""), status
    except Exception as e:
        logger.error(f"Supabase POST exception for {table}: {e}")
        return None, 500

def supabase_patch(table, filters, data, headers=None, timeout=10):
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = safe_request("patch", url, headers=headers, params=filters, json_data=data, timeout=timeout)
        status = getattr(resp, "status_code", None)
        if status is None:
            return resp.json(), 200
        if status >= 400:
            logger.error(f"Supabase PATCH {table} failed: {status} - {getattr(resp,'text','')}")
            return None, status
        try:
            return resp.json(), status
        except Exception:
            return getattr(resp, "text", ""), status
    except Exception as e:
        logger.error(f"Supabase PATCH exception for {table}: {e}")
        return None, 500

def supabase_delete(table, filters, headers=None, timeout=10):
    if headers is None:
        headers = SUPABASE_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        resp = safe_request("delete", url, headers=headers, params=filters, timeout=timeout)
        status = getattr(resp, "status_code", None)
        if status is None:
            return resp.json(), 200
        if status >= 400:
            logger.error(f"Supabase DELETE {table} failed: {status} - {getattr(resp,'text','')}")
            return None, status
        try:
            return resp.json(), status
        except Exception:
            return getattr(resp, "text", ""), status
    except Exception as e:
        logger.error(f"Supabase DELETE exception for {table}: {e}")
        return None, 500

# =========================================================
# Helper: build_filters
# =========================================================
def build_filters(d):
    params = {}
    if not d:
        return params
    for k, v in d.items():
        if isinstance(v, str) and (v.startswith("eq.") or v.startswith("like.") or v.startswith("gt.") or v.startswith("lt.") or v.startswith("ilike.") or v.startswith("neq.") or v.startswith("gte.") or v.startswith("lte.")):
            params[k] = v
        else:
            params[k] = f"eq.{v}"
    return params

# =========================================================
# Helpers: password hashing and time
# =========================================================
def hash_password(password):
    if password is None:
        return None
    return hashlib.sha256(password.encode()).hexdigest()

def now_iso():
    return datetime.utcnow().isoformat()

# =========================================================
# DB INIT (checks only; with retries)
# =========================================================
_db_initialized = False
_db_init_in_progress = False

def ensure_db_initialized(retries=3, delay=1):
    global _db_initialized, _db_init_in_progress
    if _db_initialized:
        return True
    if _db_init_in_progress:
        # avoid concurrent inits; wait briefly
        time.sleep(0.1)
        return _db_initialized
    _db_init_in_progress = True
    attempt = 0
    while attempt < retries:
        attempt += 1
        try:
            users, status = supabase_get("users", params={"select": "id", "limit": 1})
            if users is not None and status == 200:
                # Optionally seed default users if none exist
                try:
                    users_all, s2 = supabase_get("users", params={"select": "id,username", "limit": 1})
                    if users_all is not None and isinstance(users_all, list) and len(users_all) == 0:
                        # create default users
                        default_users = [
                            {"username": "admin", "password": hash_password("admin123"), "full_name": "Sistem Yöneticisi", "role": "admin", "created_at": now_iso()},
                            {"username": "kasiyer", "password": hash_password("kasiyer123"), "full_name": "Kasiyer Kullanıcı", "role": "cashier", "created_at": now_iso()},
                            {"username": "personel", "password": hash_password("personel123"), "full_name": "Personel Kullanıcı", "role": "user", "created_at": now_iso()}
                        ]
                        for u in default_users:
                            supabase_post("users", u)
                except Exception as e:
                    logger.warning(f"Seeding default users encountered issue: {e}")
                _db_initialized = True
                _db_init_in_progress = False
                return True
            else:
                logger.warning(f"ensure_db_initialized attempt {attempt} failed (status={status}). Retrying in {delay}s")
                time.sleep(delay)
        except Exception as e:
            logger.warning(f"ensure_db_initialized exception on attempt {attempt}: {e}")
            time.sleep(delay)
    logger.error("Could not confirm Supabase tables reachable after retries. Ensure tables exist in Supabase Dashboard or provide SERVICE_ROLE_KEY for DDL.")
    _db_init_in_progress = False
    return False

# =========================================================
# AUTH DECORATOR
# =========================================================
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return jsonify({"status": "error", "message": "Authorization header required"}), 401
        try:
            token = auth_header.replace("Bearer ", "").strip()
            if token.isdigit():
                request.user_id = int(token)
            else:
                # keep token available for future JWT logic
                request.token = token
        except Exception:
            pass
        return f(*args, **kwargs)
    return decorated_function

# =========================================================
# transaction_handler (error wrapper for REST)
# =========================================================
def transaction_handler(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Transaction-like handler caught error in {f.__name__}: {e}")
            logger.error(traceback.format_exc())
            return jsonify({"status": "error", "message": f"Transaction error: {str(e)}"}), 500
    return decorated_function

# =========================================================
# Validation helpers
# =========================================================
def validate_product_data(data):
    errors = []
    if not data:
        errors.append("Veri boş")
        return errors
    if not data.get("barcode") or len(str(data.get("barcode")).strip()) == 0:
        errors.append("Barkod gereklidir")
    try:
        if int(data.get("quantity", 0)) < 0:
            errors.append("Miktar negatif olamaz")
    except Exception:
        errors.append("Miktar numeric olmalıdır")
    try:
        if float(data.get("price", 0)) < 0:
            errors.append("Fiyat negatif olamaz")
    except Exception:
        errors.append("Fiyat numeric olmalıdır")
    try:
        if float(data.get("kdv", 0)) < 0:
            errors.append("KDV negatif olamaz")
    except Exception:
        errors.append("KDV numeric olmalıdır")
    try:
        if float(data.get("otv", 0)) < 0:
            errors.append("ÖTV negatif olamaz")
    except Exception:
        errors.append("ÖTV numeric olmalıdır")
    return errors

def validate_sale_data(data):
    errors = []
    if not data:
        errors.append("Veri boş")
        return errors
    items = data.get("items", [])
    if not items or len(items) == 0:
        errors.append("En az bir ürün gereklidir")
    try:
        if float(data.get("total", 0)) <= 0:
            errors.append("Toplam tutar geçersiz")
    except Exception:
        errors.append("Toplam tutar numeric olmalıdır")
    payment_method = data.get("payment_method")
    if payment_method not in ["nakit", "kredi"]:
        errors.append("Geçersiz ödeme yöntemi")
    for item in items:
        try:
            if int(item.get("quantity", 0)) <= 0:
                errors.append(f"{item.get('name', 'Ürün')} için geçersiz miktar")
        except Exception:
            errors.append(f"{item.get('name', 'Ürün')} miktarı numeric olmalıdır")
    return errors

# =========================================================
# App init
# =========================================================
@app.before_first_request
def app_init():
    ok = ensure_db_initialized()
    if not ok:
        logger.warning("DB init check failed. App will continue but DB-dependent endpoints may return errors. Ensure tables exist in Supabase or set SUPABASE_SERVICE_ROLE_KEY for automated creation.")

# =========================================================
# Static and index routes
# =========================================================
@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)

@app.route("/")
def index():
    try:
        ensure_db_initialized()
        hostname = socket.gethostname()
        try:
            local_ip = socket.gethostbyname(hostname)
        except Exception:
            local_ip = "localhost"
    except Exception:
        local_ip = "localhost"
    # QR kod
    try:
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(f"https://{request.host}")
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        qr_code = base64.b64encode(buffer.getvalue()).decode()
        qr_code = f"data:image/png;base64,{qr_code}"
    except Exception as e:
        logger.warning(f"QR generation failed: {e}")
        qr_code = ""
    try:
        return render_template("index.html", local_ip=local_ip, qr_code=qr_code)
    except Exception as e:
        # If templates don't exist, return a simple JSON fallback
        logger.warning(f"Rendering index template failed: {e}")
        return jsonify({"status": "success", "local_ip": local_ip, "qr_code": qr_code})

# =========================================================
# Health endpoint
# =========================================================
@app.route("/health")
def health():
    try:
        ok = ensure_db_initialized()
        return jsonify({"status": "ok", "db_reachable": bool(ok), "timestamp": now_iso()})
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# =========================================================
# AUTH / LOGIN
# =========================================================
@app.route("/api/auth/login", methods=["POST"])
def login():
    if not ensure_db_initialized():
        return jsonify({"status": "error", "message": "Database erişilemedi. Lütfen yapılandırmayı kontrol edin."}), 500
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Geçersiz JSON verisi"}), 400
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"status": "error", "message": "Kullanıcı adı ve şifre gereklidir"}), 400
    hashed_password = hash_password(password)
    params = build_filters({"username": f"eq.{username}", "password": f"eq.{hashed_password}"})
    users, status = supabase_get("users", params=params)
    if users is None:
        return jsonify({"status": "error", "message": "Kullanıcı doğrulama sırasında hata oluştu"}), 500
    if isinstance(users, list) and len(users) == 0:
        logger.warning(f"Failed login attempt for username: {username}")
        return jsonify({"status": "error", "message": "Geçersiz kullanıcı adı veya şifre"}), 401
    user = users[0]
    try:
        supabase_patch("users", {"id": f"eq.{user.get('id')}"}, {"last_login": now_iso()})
    except Exception as e:
        logger.warning(f"Updating last_login failed: {e}")
    try:
        audit = {"user_id": user.get("id"), "action": "login", "description": f"{user.get('username')} giriş yaptı", "ip_address": request.remote_addr, "created_at": now_iso()}
        supabase_post("audit_logs", audit)
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")
    return jsonify({"status": "success", "user": {"id": user.get("id"), "username": user.get("username"), "full_name": user.get("full_name"), "role": user.get("role")}, "token": str(user.get("id"))})

# =========================================================
# PRODUCTS endpoints
# =========================================================
@app.route("/api/products", methods=["GET"])
@require_auth
def get_products():
    try:
        products, status = supabase_get("products", params={"order": "name.asc"})
        if products is None:
            return jsonify({"status": "error", "message": "Ürünler yüklenirken hata oluştu"}), 500
        return jsonify({"status": "success", "products": products})
    except Exception as e:
        logger.error(f"Products error: {e}")
        return jsonify({"status": "error", "message": "Ürünler yüklenirken hata oluştu"}), 500

@app.route("/api/products/<barcode>", methods=["GET"])
@require_auth
def get_product(barcode):
    try:
        params = build_filters({"barcode": f"eq.{barcode}"})
        products, status = supabase_get("products", params=params)
        if products is None:
            return jsonify({"status": "error", "message": "Ürün bilgisi alınırken hata oluştu"}), 500
        if isinstance(products, list) and len(products) == 0:
            return jsonify({"status": "error", "message": "Ürün bulunamadı"}), 404
        return jsonify({"status": "success", "product": products[0]})
    except Exception as e:
        logger.error(f"Product get error: {e}")
        return jsonify({"status": "error", "message": "Ürün bilgisi alınırken hata oluştu"}), 500

@app.route("/api/products", methods=["POST"])
@require_auth
@transaction_handler
def create_product():
    data = request.get_json()
    errors = validate_product_data(data)
    if errors:
        return jsonify({"status": "error", "message": "; ".join(errors)}), 400
    barcode = data.get("barcode")
    name = data.get("name")
    try:
        price = float(data.get("price", 0))
    except Exception:
        price = 0.0
    try:
        quantity = int(data.get("quantity", 0))
    except Exception:
        quantity = 0
    kdv = float(data.get("kdv", 18)) if data.get("kdv") is not None else 18.0
    otv = float(data.get("otv", 0)) if data.get("otv") is not None else 0.0
    min_stock_level = int(data.get("min_stock_level", 5)) if data.get("min_stock_level") is not None else 5
    user_id = getattr(request, "user_id", 1)

    try:
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({"status": "error", "message": "Veritabanı hatası"}), 500
        if isinstance(existing, list) and len(existing) > 0:
            return jsonify({"status": "error", "message": "Bu barkod zaten kullanılıyor"}), 400
    except Exception as e:
        logger.error(f"Product check error: {e}")
        return jsonify({"status": "error", "message": "Ürün kontrolü sırasında hata oluştu"}), 500

    product_payload = {"barcode": barcode, "name": name, "price": price, "quantity": quantity, "kdv": kdv, "otv": otv, "min_stock_level": min_stock_level, "created_at": now_iso()}
    created, st = supabase_post("products", product_payload)
    if created is None:
        return jsonify({"status": "error", "message": "Ürün eklenirken hata oluştu"}), 500

    try:
        if quantity > 0:
            stock_payload = {"barcode": barcode, "product_name": name, "movement_type": "new", "quantity": quantity, "user_id": user_id, "movement_date": now_iso()}
            supabase_post("stock_movements", stock_payload)
    except Exception as e:
        logger.warning(f"Stock movement creation failed: {e}")

    try:
        log = {"user_id": user_id, "action": "product_create", "description": f"Yeni ürün eklendi: {barcode} - {name}", "created_at": now_iso()}
        supabase_post("audit_logs", log)
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")

    return jsonify({"status": "success", "message": "Ürün başarıyla eklendi"})

@app.route("/api/products/<barcode>", methods=["PUT"])
@require_auth
def update_product(barcode):
    data = request.get_json()
    errors = validate_product_data(data)
    if errors:
        return jsonify({"status": "error", "message": "; ".join(errors)}), 400
    try:
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({"status": "error", "message": "Veritabanı hatası"}), 500
        if isinstance(existing, list) and len(existing) == 0:
            return jsonify({"status": "error", "message": "Ürün bulunamadı"}), 404
        product = existing[0]
        old_quantity = int(product.get("quantity", 0))
        new_quantity = int(data.get("quantity", old_quantity))
        quantity_diff = new_quantity - old_quantity
        update_payload = {"name": data.get("name", product.get("name")), "price": float(data.get("price", product.get("price", 0))), "quantity": new_quantity, "kdv": float(data.get("kdv", product.get("kdv", 18))), "otv": float(data.get("otv", product.get("otv", 0))), "min_stock_level": int(data.get("min_stock_level", product.get("min_stock_level", 5)))}
        supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), update_payload)
        try:
            if quantity_diff != 0:
                movement_type = "in" if quantity_diff > 0 else "out"
                movement_payload = {"barcode": barcode, "product_name": update_payload["name"], "movement_type": movement_type, "quantity": abs(quantity_diff), "user_id": getattr(request, "user_id", 1), "movement_date": now_iso()}
                supabase_post("stock_movements", movement_payload)
        except Exception as e:
            logger.warning(f"Stock movement after update failed: {e}")
        log_audit_payload = {"user_id": getattr(request, "user_id", 1), "action": "product_update", "description": f"Ürün güncellendi: {barcode} - {update_payload['name']}", "created_at": now_iso()}
        supabase_post("audit_logs", log_audit_payload)
        return jsonify({"status": "success", "message": "Ürün başarıyla güncellendi"})
    except Exception as e:
        logger.error(f"Product update error: {e}")
        return jsonify({"status": "error", "message": "Ürün güncellenirken hata oluştu"}), 500

@app.route("/api/products/<barcode>", methods=["DELETE"])
@require_auth
@transaction_handler
def delete_product(barcode):
    try:
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({"status": "error", "message": "Veritabanı hatası"}), 500
        if isinstance(existing, list) and len(existing) == 0:
            return jsonify({"status": "error", "message": "Ürün bulunamadı"}), 404
        product = existing[0]
        supabase_delete("products", build_filters({"barcode": f"eq.{barcode}"}))
        log = {"user_id": getattr(request, "user_id", 1), "action": "product_delete", "description": f"Ürün silindi: {barcode} - {product.get('name')}", "created_at": now_iso()}
        supabase_post("audit_logs", log)
        return jsonify({"status": "success", "message": "Ürün başarıyla silindi"})
    except Exception as e:
        logger.error(f"Delete product error: {e}")
        return jsonify({"status": "error", "message": "Ürün silinirken hata oluştu"}), 500

# =========================================================
# Stock endpoints
# =========================================================
@app.route("/api/stock/add", methods=["POST"])
@require_auth
@transaction_handler
def add_stock():
    try:
        data = request.get_json()
        barcode = data.get("barcode")
        try:
            quantity = int(data.get("quantity", 1))
        except Exception:
            return jsonify({"status": "error", "message": "Miktar numeric olmalıdır"}), 400
        name = data.get("name")
        price = float(data.get("price", 0)) if data.get("price") is not None else None
        kdv = float(data.get("kdv", 18))
        otv = float(data.get("otv", 0))
        min_stock_level = int(data.get("min_stock_level", 5))
        user_id = getattr(request, "user_id", 1)
        if quantity <= 0:
            return jsonify({"status": "error", "message": "Miktar pozitif olmalıdır"}), 400
        existing, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
        if existing is None:
            return jsonify({"status": "error", "message": "Veritabanı hatası"}), 500
        if isinstance(existing, list) and len(existing) > 0:
            product = existing[0]
            new_quantity = int(product.get("quantity", 0)) + quantity
            supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), {"quantity": new_quantity})
            movement_type = "in"
            product_name = product.get("name")
        else:
            if not name or price is None:
                return jsonify({"status": "error", "message": "Yeni ürün için ad ve fiyat gereklidir"}), 400
            if price < 0:
                return jsonify({"status": "error", "message": "Fiyat negatif olamaz"}), 400
            product_payload = {"barcode": barcode, "name": name, "price": price, "quantity": quantity, "kdv": kdv, "otv": otv, "min_stock_level": min_stock_level, "created_at": now_iso()}
            supabase_post("products", product_payload)
            movement_type = "new"
            product_name = name
        stock_payload = {"barcode": barcode, "product_name": product_name, "movement_type": movement_type, "quantity": quantity, "user_id": user_id, "movement_date": now_iso()}
        supabase_post("stock_movements", stock_payload)
        supabase_post("audit_logs", {"user_id": user_id, "action": "stock_update", "description": f"{quantity} adet stok eklendi: {barcode} - {product_name}", "created_at": now_iso()})
        return jsonify({"status": "success", "message": "Stok güncellendi"})
    except Exception as e:
        logger.error(f"Add stock error: {e}")
        return jsonify({"status": "error", "message": "Stok güncellenirken hata oluştu"}), 500

# =========================================================
# Make sale
# =========================================================
@app.route("/api/sale", methods=["POST"])
@require_auth
@transaction_handler
def make_sale():
    try:
        data = request.get_json()
        items = data.get("items", [])
        try:
            total = float(data.get("total", 0))
        except Exception:
            return jsonify({"status": "error", "message": "Toplam tutar numeric olmalıdır"}), 400
        payment_method = data.get("payment_method", "nakit")
        try:
            cash_amount = float(data.get("cash_amount", 0))
        except Exception:
            cash_amount = 0.0
        try:
            credit_card_amount = float(data.get("credit_card_amount", 0))
        except Exception:
            credit_card_amount = 0.0
        try:
            change_amount = float(data.get("change_amount", 0))
        except Exception:
            change_amount = 0.0
        user_id = getattr(request, "user_id", 1)
        errors = validate_sale_data(data)
        if errors:
            return jsonify({"status": "error", "message": "; ".join(errors)}), 400
        for item in items:
            barcode = item.get("barcode")
            req_qty = int(item.get("quantity", 0))
            prod_list, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
            if prod_list is None:
                return jsonify({"status": "error", "message": "Veritabanı hatası"}), 500
            if isinstance(prod_list, list) and len(prod_list) == 0:
                return jsonify({"status": "error", "message": f"Ürün bulunamadı: {item.get('name', barcode)}"}), 400
            prod = prod_list[0]
            if int(prod.get("quantity", 0)) < req_qty:
                return jsonify({"status": "error", "message": f"Yetersiz stok: {prod.get('name')} (Mevcut: {prod.get('quantity')}, İstenen: {req_qty})"}), 400
        sale_payload = {"total_amount": total, "payment_method": payment_method, "cash_amount": cash_amount, "credit_card_amount": credit_card_amount, "change_amount": change_amount, "user_id": user_id, "sale_date": now_iso()}
        created_sale, st = supabase_post("sales", sale_payload)
        sale_id = None
        if isinstance(created_sale, list) and len(created_sale) > 0 and created_sale[0].get("id"):
            sale_id = created_sale[0]["id"]
        else:
            recent_sales, s2 = supabase_get("sales", params=build_filters({"user_id": f"eq.{user_id}"}))
            if recent_sales:
                try:
                    sale_id = sorted(recent_sales, key=lambda x: x.get("sale_date", ""))[-1].get("id")
                except Exception:
                    sale_id = None
        for item in items:
            barcode = item.get("barcode")
            name = item.get("name")
            qty = int(item.get("quantity"))
            price = float(item.get("price", 0))
            sale_item_payload = {"sale_id": sale_id, "barcode": barcode, "product_name": name, "quantity": qty, "price": price}
            supabase_post("sale_items", sale_item_payload)
            prod_list, st = supabase_get("products", params=build_filters({"barcode": f"eq.{barcode}"}))
            if prod_list and isinstance(prod_list, list) and len(prod_list) > 0:
                prod = prod_list[0]
                new_qty = int(prod.get("quantity", 0)) - qty
                if new_qty < 0:
                    new_qty = 0
                supabase_patch("products", build_filters({"barcode": f"eq.{barcode}"}), {"quantity": new_qty})
            supabase_post("stock_movements", {"barcode": barcode, "product_name": name, "movement_type": "out", "quantity": qty, "user_id": user_id, "movement_date": now_iso()})
        if payment_method == "nakit" and cash_amount > 0:
            supabase_post("cash_transactions", {"transaction_type": "sale", "amount": total, "user_id": user_id, "transaction_date": now_iso(), "description": f"Satış #{sale_id}"})
            cash_regs, s3 = supabase_get("cash_register", params=build_filters({"id": f"eq.1"}))
            if cash_regs and isinstance(cash_regs, list) and len(cash_regs) > 0:
                reg = cash_regs[0]
                if reg.get("is_open"):
                    new_balance = (reg.get("current_amount") or 0) + cash_amount
                    supabase_patch("cash_register", build_filters({"id": f"eq.1"}), {"current_amount": new_balance})
        supabase_post("audit_logs", {"user_id": user_id, "action": "sale", "description": f"Satış yapıldı: #{sale_id} - {total} TL - {payment_method}", "created_at": now_iso()})
        return jsonify({"status": "success", "sale_id": sale_id, "message": "Satış başarıyla tamamlandı"})
    except Exception as e:
        logger.error(f"Make sale error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"status": "error", "message": "Satış sırasında hata oluştu"}), 500

# =========================================================
# CASH endpoints (status, open, close)
# =========================================================
@app.route("/api/cash/status", methods=["GET"])
@require_auth
def cash_status():
    try:
        cash_regs, st = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if cash_regs is None:
            return jsonify({"status": "error", "message": "Kasa durumu alınırken hata oluştu"}), 500
        if isinstance(cash_regs, list) and len(cash_regs) == 0:
            supabase_post("cash_register", {"id": 1, "is_open": False, "current_amount": 0, "opening_balance": 0, "last_updated": now_iso()})
            cash_regs, st = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        cash_status = cash_regs[0] if isinstance(cash_regs, list) and len(cash_regs) > 0 else cash_regs
        today = datetime.now().strftime("%Y-%m-%d")
        cash_sales, s1 = supabase_get("sales", params={"payment_method": f"eq.nakit", "sale_date": f"gte.{today}"})
        cash_total = 0
        if isinstance(cash_sales, list):
            for s in cash_sales:
                try:
                    cash_total += float(s.get("total_amount", 0))
                except:
                    pass
        card_sales, s2 = supabase_get("sales", params={"payment_method": f"eq.kredi", "sale_date": f"gte.{today}"})
        card_total = 0
        if isinstance(card_sales, list):
            for s in card_sales:
                try:
                    card_total += float(s.get("total_amount", 0))
                except:
                    pass
        return jsonify({"status": "success", "cash_status": {"is_open": bool(cash_status.get("is_open")), "current_amount": cash_status.get("current_amount"), "opening_balance": cash_status.get("opening_balance"), "opening_time": cash_status.get("opening_time"), "cash_sales_today": cash_total, "card_sales_today": card_total, "expected_cash": (cash_status.get("opening_balance") or 0) + cash_total}})
    except Exception as e:
        logger.error(f"Cash status error: {e}")
        return jsonify({"status": "error", "message": "Kasa durumu alınırken hata oluştu"}), 500

@app.route("/api/cash/open", methods=["POST"])
@require_auth
@transaction_handler
def open_cash():
    try:
        data = request.get_json()
        try:
            initial_amount = float(data.get("initial_amount", 0))
        except Exception:
            return jsonify({"status": "error", "message": "Başlangıç bakiyesi numeric olmalıdır"}), 400
        user_id = getattr(request, "user_id", 1)
        if initial_amount < 0:
            return jsonify({"status": "error", "message": "Başlangıç bakiyesi negatif olamaz"}), 400
        regs, s = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if regs and isinstance(regs, list) and len(regs) > 0 and regs[0].get("is_open"):
            return jsonify({"status": "error", "message": "Kasa zaten açık"}), 400
        if regs and isinstance(regs, list) and len(regs) > 0:
            supabase_patch("cash_register", build_filters({"id": "eq.1"}), {"is_open": True, "current_amount": initial_amount, "opening_balance": initial_amount, "opening_time": now_iso()})
        else:
            supabase_post("cash_register", {"id": 1, "is_open": True, "current_amount": initial_amount, "opening_balance": initial_amount, "opening_time": now_iso(), "last_updated": now_iso()})
        supabase_post("cash_transactions", {"transaction_type": "open", "amount": initial_amount, "user_id": user_id, "transaction_date": now_iso(), "description": "Kasa açılışı"})
        supabase_post("audit_logs", {"user_id": user_id, "action": "cash_open", "description": f"Kasa açıldı - Başlangıç: {initial_amount} TL", "created_at": now_iso()})
        return jsonify({"status": "success", "message": "Kasa başarıyla açıldı"})
    except Exception as e:
        logger.error(f"Open cash error: {e}")
        return jsonify({"status": "error", "message": "Kasa açılırken hata oluştu"}), 500

@app.route("/api/cash/close", methods=["POST"])
@require_auth
@transaction_handler
def close_cash():
    try:
        data = request.get_json()
        try:
            final_amount = float(data.get("final_amount", 0))
        except Exception:
            return jsonify({"status": "error", "message": "Kapanış bakiyesi numeric olmalıdır"}), 400
        user_id = getattr(request, "user_id", 1)
        if final_amount < 0:
            return jsonify({"status": "error", "message": "Kapanış bakiyesi negatif olamaz"}), 400
        regs, s = supabase_get("cash_register", params=build_filters({"id": "eq.1"}))
        if regs is None or len(regs) == 0:
            return jsonify({"status": "error", "message": "Kasa zaten kapalı veya tanımlı değil"}), 400
        cash_status = regs[0]
        if not cash_status.get("is_open"):
            return jsonify({"status": "error", "message": "Kasa zaten kapalı"}), 400
        today = datetime.now().strftime("%Y-%m-%d")
        cash_sales, s1 = supabase_get("sales", params={"payment_method": f"eq.nakit", "sale_date": f"gte.{today}"})
        cash_sales_total = 0
        if isinstance(cash_sales, list):
            for s in cash_sales:
                try:
                    cash_sales_total += float(s.get("total_amount", 0))
                except:
                    pass
        expected_cash = (cash_status.get("opening_balance") or 0) + cash_sales_total
        supabase_patch("cash_register", build_filters({"id": "eq.1"}), {"is_open": False, "current_amount": 0, "closing_time": now_iso()})
        supabase_post("cash_transactions", {"transaction_type": "close", "amount": final_amount, "user_id": user_id, "transaction_date": now_iso(), "description": f"Kasa kapanışı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL"})
        supabase_post("audit_logs", {"user_id": user_id, "action": "cash_close", "description": f"Kasa kapandı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL", "created_at": now_iso()})
        return jsonify({"status": "success", "message": "Kasa başarıyla kapandı", "summary": {"opening_balance": cash_status.get("opening_balance"), "cash_sales": cash_sales_total, "expected_cash": expected_cash, "actual_cash": final_amount, "difference": final_amount - expected_cash}})
    except Exception as e:
        logger.error(f"Close cash error: {e}")
        return jsonify({"status": "error", "message": "Kasa kapanırken hata oluştu"}), 500

# =========================================================
# Reports
# =========================================================
@app.route("/api/reports/sales", methods=["GET"])
@require_auth
def sales_report():
    try:
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        params = {}
        if start_date:
            params["sale_date"] = f"gte.{start_date}"
        if end_date:
            params["sale_date"] = f"lte.{end_date}"
        sales, st = supabase_get("sales", params=params)
        if sales is None:
            return jsonify({"status": "error", "message": "Satış raporu alınırken hata oluştu"}), 500
        return jsonify({"status": "success", "sales": sales})
    except Exception as e:
        logger.error(f"Sales report error: {e}")
        return jsonify({"status": "error", "message": "Satış raporu alınırken hata oluştu"}), 500

@app.route("/api/reports/stock", methods=["GET"])
@require_auth
def stock_report():
    try:
        low_stock, st = supabase_get("products", params={"quantity": f"lte.min_stock_level", "order": "quantity.asc"})
        if low_stock is None:
            all_products, st2 = supabase_get("products")
            if all_products is None:
                return jsonify({"status": "error", "message": "Stok raporu alınırken hata oluştu"}), 500
            low_stock = [p for p in all_products if int(p.get("quantity", 0)) <= int(p.get("min_stock_level", 5))]
        movements, st3 = supabase_get("stock_movements", params={"order": "movement_date.desc", "limit": 100})
        if movements is None:
            movements = []
        return jsonify({"status": "success", "low_stock": low_stock, "movements": movements})
    except Exception as e:
        logger.error(f"Stock report error: {e}")
        return jsonify({"status": "error", "message": "Stok raporu alınırken hata oluştu"}), 500

# =========================================================
# Audit helper
# =========================================================
def log_audit(user_id, action, description, ip_address=None):
    try:
        payload = {"user_id": user_id, "action": action, "description": description, "ip_address": ip_address or request.remote_addr, "created_at": now_iso()}
        supabase_post("audit_logs", payload)
    except Exception as e:
        logger.error(f"Audit log error: {e}")

# =========================================================
# Global error handler (catches everything and returns JSON)
# =========================================================
@app.errorhandler(Exception)
def handle_all_exceptions(error):
    trace = traceback.format_exc()
    logger.error(f"[GLOBAL ERROR] {error}\n{trace}")
    # Return safe JSON to client
    return jsonify({"status": "error", "message": str(error)}), 500

# =========================================================
# 404 / 500 handlers (kept for clarity)
# =========================================================
@app.errorhandler(404)
def not_found(error):
    return jsonify({"status": "error", "message": "Sayfa bulunamadı"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    logger.error(traceback.format_exc())
    return jsonify({"status": "error", "message": "Sunucu hatası oluştu"}), 500

@app.before_request
def before_request():
    if request.endpoint and request.endpoint != "static":
        # Do not block requests; just ensure DB init attempted
        ensure_db_initialized()

# =========================================================
# MAIN
# =========================================================
if __name__ == "__main__":
    try:
        ensure_db_initialized()
    except Exception as e:
        logger.warning(f"Startup DB check produced an error: {e}")
    port = int(os.environ.get("PORT", 5000))
    # Production choice: if RENDER or other env provided, use waitress, otherwise Flask dev
    if os.environ.get("RENDER"):
        try:
            from waitress import serve
            logger.info(f"Starting production server on port {port}")
            serve(app, host="0.0.0.0", port=port)
        except Exception as e:
            logger.info(f"Waitress start failed, fallback to Flask dev server: {e}")
            app.run(host="0.0.0.0", port=port, debug=False)
    else:
        logger.info(f"Starting development server on port {port}")
        app.run(host="0.0.0.0", port=port, debug=True)

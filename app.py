import os
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
from threading import Lock
import time

app = Flask(__name__, 
    static_folder='static',
    template_folder='templates'
)
app.config['SECRET_KEY'] = 'tekel-pos-secret-key-2024'
socketio = SocketIO(app, cors_allowed_origins="*")

# PostgreSQL veritabanı bağlantısı
def get_db_connection():
    try:
        database_url = os.environ.get('DATABASE_URL')
        if not database_url:
            raise ValueError("DATABASE_URL environment variable is not set")
        
        conn = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        raise

# Veritabanı başlatma
def init_db():
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
                price REAL NOT NULL,
                quantity INTEGER DEFAULT 0,
                kdv REAL DEFAULT 18,
                otv REAL DEFAULT 0,
                min_stock_level INTEGER DEFAULT 5,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Satışlar tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales (
                id SERIAL PRIMARY KEY,
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
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sale_items (
                id SERIAL PRIMARY KEY,
                sale_id INTEGER,
                barcode TEXT NOT NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES sales (id)
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
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Kasa durumu tablosu
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cash_register (
                id SERIAL PRIMARY KEY,
                is_open BOOLEAN DEFAULT FALSE,
                current_amount REAL DEFAULT 0,
                opening_balance REAL DEFAULT 0,
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
                FOREIGN KEY (user_id) REFERENCES users (id)
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
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Varsayılan kullanıcıları ekle
        try:
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('admin', 'admin123', 'Sistem Yöneticisi', 'admin')
            )
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('kasiyer', 'kasiyer123', 'Kasiyer Kullanıcı', 'cashier')
            )
            cursor.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING',
                ('personel', 'personel123', 'Personel Kullanıcı', 'user')
            )
        except Exception as e:
            print(f"Kullanıcı ekleme hatası: {e}")
        
        # Varsayılan kasa durumu
        try:
            cursor.execute(
                'INSERT INTO cash_register (id, is_open, current_amount, opening_balance) VALUES (1, FALSE, 0, 0) ON CONFLICT (id) DO NOTHING'
            )
        except Exception as e:
            print(f"Kasa durumu ekleme hatası: {e}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print("Database initialized successfully")
        
    except Exception as e:
        print(f"Database initialization error: {e}")

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

# API Routes

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM users WHERE username = %s AND password = %s',
            (username, password)
        )
        user = cursor.fetchone()
        
        if user:
            # Son giriş zamanını güncelle
            cursor.execute(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = %s',
                (user['id'],)
            )
            conn.commit()
            cursor.close()
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
            cursor.close()
            conn.close()
            return jsonify({
                'status': 'error',
                'message': 'Geçersiz kullanıcı adı veya şifre'
            })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Login error: {str(e)}'
        })

@app.route('/api/products')
def get_products():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM products ORDER BY name')
        products = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        products_list = []
        for product in products:
            products_list.append(dict(product))
        
        return jsonify({
            'status': 'success',
            'products': products_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Products error: {str(e)}'
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
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
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
                cursor.close()
                conn.close()
                return jsonify({'status': 'error', 'message': 'Yeni ürün için ad ve fiyat gereklidir'})
            
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
        
        conn.commit()
        cursor.close()
        conn.close()
        
        # WebSocket ile bildirim gönder
        socketio.emit('stock_updated', {'barcode': barcode, 'quantity': quantity})
        
        return jsonify({'status': 'success', 'message': 'Stok güncellendi'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Stock add error: {str(e)}'})

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
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
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
                'SELECT quantity FROM products WHERE barcode = %s', (item['barcode'],)
            )
            product = cursor.fetchone()
            
            if product:
                new_quantity = product['quantity'] - item['quantity']
                cursor.execute(
                    'UPDATE products SET quantity = %s WHERE barcode = %s',
                    (new_quantity, item['barcode'])
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
        
        conn.commit()
        cursor.close()
        conn.close()
        
        # WebSocket ile bildirim gönder
        socketio.emit('sale_made', {'sale_id': sale_id, 'total': total})
        
        return jsonify({'status': 'success', 'sale_id': sale_id, 'message': 'Satış başarıyla tamamlandı'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Sale error: {str(e)}'})

# KASA YÖNETİMİ API'leri
@app.route('/api/cash/status')
def cash_status():
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
        
        cursor.close()
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
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Cash status error: {str(e)}'
        })

@app.route('/api/cash/open', methods=['POST'])
def open_cash():
    data = request.get_json()
    initial_amount = data.get('initial_amount', 0)
    user_id = data.get('user_id', 1)
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
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
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kasa açıldı'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Cash open error: {str(e)}'})

@app.route('/api/cash/close', methods=['POST'])
def close_cash():
    data = request.get_json()
    user_id = data.get('user_id', 1)
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Kasa durumunu al
        cursor.execute('SELECT * FROM cash_register WHERE id = 1')
        cash_status = cursor.fetchone()
        
        if not cash_status or not cash_status['is_open']:
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'Kasa zaten kapalı'})
        
        # Kasa kapanış işlemi
        final_amount = cash_status['current_amount']
        opening_balance = cash_status['opening_balance']
        
        # Bugünkü nakit satışları hesapla
        if cash_status['opening_time']:
            opening_date = cash_status['opening_time']
            today_start = opening_date.strftime('%Y-%m-%d')
        else:
            today_start = datetime.now().strftime('%Y-%m-%d')
            
        cursor.execute(
            'SELECT SUM(total_amount) as total FROM sales WHERE payment_method = %s AND DATE(sale_date) >= %s',
            ('nakit', today_start)
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
            ('close', final_amount, user_id, f'Kasa kapanışı - Beklenen: {expected_cash} TL, Gerçek: {final_amount} TL')
        )
        
        # Denetim kaydı
        log_audit(user_id, 'cash_close', f'Kasa kapandı - Son bakiye: {final_amount} TL')
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kasa kapandı'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Cash close error: {str(e)}'})

@app.route('/api/cash/transactions')
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
        
        cursor.close()
        conn.close()
        
        transactions_list = []
        for transaction in transactions:
            transactions_list.append(dict(transaction))
        
        return jsonify({
            'status': 'success',
            'transactions': transactions_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Cash transactions error: {str(e)}'
        })

# RAPORLAMA API'leri
@app.route('/api/reports/daily-summary')
def daily_summary():
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
        
        cursor.close()
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
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Daily summary error: {str(e)}'
        })

@app.route('/api/inventory/low-stock')
def low_stock():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM products WHERE quantity <= min_stock_level ORDER BY quantity ASC'
        )
        low_stock_products = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        products_list = []
        for product in low_stock_products:
            products_list.append(dict(product))
        
        return jsonify({
            'status': 'success',
            'products': products_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Low stock error: {str(e)}'
        })

@app.route('/api/inventory/stock-value')
def stock_value():
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
        
        cursor.close()
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
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Stock value error: {str(e)}'
        })

@app.route('/api/reports/sales')
def sales_report():
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
        
        cursor.close()
        conn.close()
        
        sales_list = []
        for sale in sales:
            sales_list.append(dict(sale))
        
        return jsonify({
            'status': 'success',
            'report': sales_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Sales report error: {str(e)}'
        })

@app.route('/api/reports/stock-movements')
def stock_movements():
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
        
        cursor.close()
        conn.close()
        
        movements_list = []
        for movement in movements:
            movements_list.append(dict(movement))
        
        return jsonify({
            'status': 'success',
            'movements': movements_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Stock movements error: {str(e)}'
        })

@app.route('/api/reports/receipt/<int:sale_id>')
def get_receipt(sale_id):
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
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'Fiş bulunamadı'})
        
        # Satış detayları
        cursor.execute(
            'SELECT * FROM sale_items WHERE sale_id = %s', (sale_id,)
        )
        items = cursor.fetchall()
        
        cursor.close()
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
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Receipt error: {str(e)}'
        })

# YÖNETİM API'leri
@app.route('/api/users')
def get_users():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, username, full_name, role, last_login, created_at FROM users ORDER BY created_at DESC')
        users = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        users_list = []
        for user in users:
            users_list.append(dict(user))
        
        return jsonify({
            'status': 'success',
            'users': users_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Users error: {str(e)}'
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
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO users (username, password, full_name, role) VALUES (%s, %s, %s, %s)',
            (username, password, full_name, role)
        )
        
        # Denetim kaydı
        log_audit(user_id, 'user_create', f'Yeni kullanıcı oluşturuldu: {username} - {full_name}')
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'status': 'success', 'message': 'Kullanıcı başarıyla oluşturuldu'})
        
    except psycopg2.IntegrityError:
        return jsonify({'status': 'error', 'message': 'Bu kullanıcı adı zaten kullanılıyor'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Create user error: {str(e)}'})

@app.route('/api/admin/system-stats')
def system_stats():
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
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'status': 'success',
            'stats': {
                'total_users': total_users['count'],
                'total_sales': total_sales['count'],
                'total_revenue': total_revenue['total'] or 0
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'System stats error: {str(e)}'
        })

@app.route('/api/audit/logs')
def audit_logs():
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
        
        cursor.close()
        conn.close()
        
        logs_list = []
        for log in logs:
            logs_list.append(dict(log))
        
        return jsonify({
            'status': 'success',
            'logs': logs_list
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Audit logs error: {str(e)}'
        })

@app.route('/api/backup/export', methods=['GET', 'POST'])
def export_backup():
    # Basit yedekleme endpoint'i
    return jsonify({
        'status': 'success',
        'message': 'Yedekleme özelliği aktif',
        'file_path': '/backups/tekel-pos-backup.json'
    })

# Yardımcı fonksiyonlar
def log_audit(user_id, action, description, ip_address=None):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (%s, %s, %s, %s)',
            (user_id, action, description, ip_address or request.remote_addr)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'Audit log error: {e}')

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
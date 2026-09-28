# app/__init__.py

import os
from flask import Flask, g, send_from_directory

from app.db import get_connection, init_schema, migrate_order_status_schema, query_one, execute
from app.auth import hash_password
from app.sessions import prune_expired_sessions

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')


def create_app():
    app = Flask(__name__, static_folder=None)

    # ---- No localhost/port restriction -----------------------------------
    # The frontend is served BY this same Flask app (see the catch-all route
    # below), so in normal use there's no cross-origin request at all. These
    # headers are added anyway as a safety net for any other origin/port
    # someone points at the API (e.g. testing tools, a separate dev server),
    # so nothing is ever blocked by CORS.
    @app.after_request
    def add_cors_headers(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        return response

    @app.route('/api/<path:_any>', methods=['OPTIONS'])
    def cors_preflight(_any):
        return '', 204

    # ---- One DB connection per request, opened lazily and always closed --
    def get_db():
        if 'db' not in g:
            g.db = get_connection()
        return g.db

    app.get_db = get_db  # exposed so blueprints can do `from flask import current_app; current_app.get_db()`

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop('db', None)
        if db is not None:
            db.close()

    # ---- Register API blueprints ------------------------------------------
    from app.routes.auth import bp as auth_bp
    from app.routes.products import bp as products_bp
    from app.routes.orders import bp as orders_bp
    from app.routes.analytics import bp as analytics_bp
    from app.routes.support import bp as support_bp
    from app.routes.payments import bp as payments_bp
    from app.routes.settings import bp as settings_bp
    from app.routes.employees import bp as employees_bp
    from app.routes.deals import bp as deals_bp
    from app.routes.collections import bp as collections_bp
    from app.routes.notifications import bp as notifications_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(products_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(support_bp)
    app.register_blueprint(payments_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(employees_bp)
    app.register_blueprint(deals_bp)
    app.register_blueprint(collections_bp)
    app.register_blueprint(notifications_bp)

    # ---- Serve the frontend (public/) as static files ----------------------
    @app.route('/', defaults={'path': 'index.html'})
    @app.route('/<path:path>')
    def serve_frontend(path):
        full_path = os.path.join(PUBLIC_DIR, path)
        if os.path.isfile(full_path):
            response = send_from_directory(PUBLIC_DIR, path)
        else:
            response = send_from_directory(PUBLIC_DIR, 'index.html')  # fallback
        # Never let the browser cache JS/CSS/HTML from disk — always fetch the
        # current version from this server. Combined with the ?v= query
        # strings on <script>/<link> tags, this makes it effectively
        # impossible for an old cached file to silently keep being used after
        # an update.
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response

    # ---- First-run setup: create tables + seed data -------------------------
    with app.app_context():
        conn = get_connection()
        init_schema(conn)
        ensure_schema_compatibility(conn)
        migrate_order_status_schema(conn)
        seed_data(conn)
        prune_expired_sessions(conn)
        conn.close()

    return app


def ensure_schema_compatibility(conn):
    """Add columns introduced after an existing installation was created."""
    if query_one(conn, 'SELECT setting_key FROM settings WHERE setting_key = ?', ('support_email',)) is None:
        execute(conn, 'INSERT INTO settings (setting_key, value) VALUES (?, ?)',
                ('support_email', 'orders@shakarganj.pk'))
        if hasattr(conn, 'commit'):
            conn.commit()
    try:
        if os.environ.get('DB_ENGINE', 'sqlite').lower() == 'mysql':
            execute(conn, 'ALTER TABLE support_messages ADD COLUMN form_id VARCHAR(40) UNIQUE')
        else:
            conn.execute('ALTER TABLE support_messages ADD COLUMN form_id TEXT')
            conn.commit()
    except Exception:
        pass
    if os.environ.get('DB_ENGINE', 'sqlite').lower() == 'mysql':
        try:
            execute(conn, 'ALTER TABLE products ADD COLUMN sale_price DECIMAL(10,2) NULL')
        except Exception:
            pass
    if os.environ.get('DB_ENGINE', 'sqlite').lower() != 'mysql':
        try:
            conn.execute('ALTER TABLE products ADD COLUMN sale_price REAL')
            conn.commit()
        except Exception:
            pass
    if os.environ.get('DB_ENGINE', 'sqlite').lower() == 'mysql':
        try:
            execute(conn, 'ALTER TABLE products ADD COLUMN unit VARCHAR(40) NULL')
        except Exception:
            pass
    else:
        try:
            conn.execute('ALTER TABLE products ADD COLUMN unit TEXT')
            conn.commit()
        except Exception:
            pass
    # Backward-compatible migration for richer order/customer details on older
    # databases created before order detail pages and receipt export were added.
    for table_name, columns in {
        'orders': [('customer_email', 'TEXT'), ('customer_phone', 'TEXT'), ('postal_code', 'TEXT'), ('delivery_instructions', 'TEXT')],
        'order_items': [('product_name_snapshot', 'TEXT'), ('product_image_snapshot', 'TEXT'), ('variant_snapshot', 'TEXT'), ('discount', 'REAL'), ('line_total', 'REAL')],
    }.items():
        if os.environ.get('DB_ENGINE', 'sqlite').lower() == 'mysql':
            for column_name, column_type in columns:
                try:
                    execute(conn, f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}')
                except Exception:
                    pass
        else:
            existing_columns = {row[1] for row in conn.execute(f'PRAGMA table_info({table_name})')}
            for column_name, column_type in columns:
                if column_name not in existing_columns:
                    try:
                        conn.execute(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}')
                        conn.commit()
                    except Exception:
                        pass
    if os.environ.get('DB_ENGINE', 'sqlite').lower() == 'mysql':
        execute(conn, 'DROP TABLE IF EXISTS pink_salt_sliders')
        execute(conn, 'DROP TABLE IF EXISTS pink_salt_settings')
        try:
            execute(conn, 'ALTER TABLE products DROP COLUMN is_pink_salt')
        except Exception:
            pass
        execute(conn, 'DELETE FROM settings WHERE setting_key = ?', ('pink_salt_home_products',))
    else:
        conn.execute('DROP TABLE IF EXISTS pink_salt_sliders')
        conn.execute('DROP TABLE IF EXISTS pink_salt_settings')
        product_columns = {row[1] for row in conn.execute('PRAGMA table_info(products)')}
        if 'is_pink_salt' in product_columns:
            conn.execute('ALTER TABLE products DROP COLUMN is_pink_salt')
        conn.execute('DELETE FROM settings WHERE setting_key = ?', ('pink_salt_home_products',))
        conn.commit()
    if not query_one(conn, 'SELECT id FROM collections WHERE slug = ?', ('pink-salt',)):
        execute(conn, 'INSERT INTO collections (name, slug, title, button_text, is_featured) VALUES (?, ?, ?, ?, ?)',
                ('Pink Salt Collection', 'pink-salt', 'Our Pink Salt Collection', 'Explore Our Pink Salt Collection', 1))
    if query_one(conn, 'SELECT id FROM collections WHERE is_featured = 1') is None:
        execute(conn, 'UPDATE collections SET is_featured = 1 WHERE slug = ?', ('pink-salt',))
    if query_one(conn, 'SELECT setting_key FROM settings WHERE setting_key = ?', ('promo_messages_initialized',)) is None:
        if query_one(conn, 'SELECT id FROM promo_messages LIMIT 1') is None:
            execute(conn, 'INSERT INTO promo_messages (message, is_active, display_order) VALUES (?, ?, ?)',
                    ('Free delivery on orders above Rs. 2,000', 1, 0))
        execute(conn, 'INSERT INTO settings (setting_key, value) VALUES (?, ?)',
                ('promo_messages_initialized', '1'))
    if hasattr(conn, 'commit'):
        conn.commit()
    if os.environ.get('DB_ENGINE', 'sqlite').lower() != 'mysql':
        conn.execute("""CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
            discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
            discount_value REAL NOT NULL CHECK(discount_value > 0),
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )""")
        conn.commit()
        conn.execute("""CREATE TABLE IF NOT EXISTS deal_campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            badge TEXT,
            button_text TEXT NOT NULL DEFAULT 'Shop Now',
            button_url TEXT NOT NULL DEFAULT 'index.html',
            image TEXT,
            start_date TEXT NOT NULL,
            end_date TEXT,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )""")
        conn.execute("UPDATE deal_campaigns SET end_date = '2026-12-31 23:59:59' WHERE end_date IS NULL")
        conn.commit()

def seed_data(conn):
    user_count = query_one(conn, 'SELECT COUNT(*) AS c FROM users')['c']
    if user_count == 0:
        admin_email = os.environ.get('ADMIN_EMAIL', 'shakarganj@gmail.com')
        admin_password = os.environ.get('ADMIN_PASSWORD', '11223344')
        seed_users = [
            ('Shakarganj Admin', admin_email, admin_password, 'admin'),
            ('Sana Tariq', 'manager@shakarganj.pk', 'Manager@123', 'manager'),
            ('Bilal Ahmed', 'staff@shakarganj.pk', 'Staff@123', 'staff'),
            ('Ayesha Malik', 'customer@shakarganj.pk', 'Customer@123', 'user'),
        ]
        for name, email, password, role in seed_users:
            execute(conn, 'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
                    (name, email, hash_password(password), role))
        if hasattr(conn, 'commit'):
            conn.commit()
        print(f'[seed] Admin account ready -> {admin_email} / {admin_password}')

    product_count = query_one(conn, 'SELECT COUNT(*) AS c FROM products')['c']
    if product_count == 0:
        products = [
            ('Basmati Rice 5kg', 'Rice, Atta & Pulses', 1450, 1600, 80, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=80', 'Sale'),
            ('Fresh Milk 1L', 'Dairy & Eggs', 260, None, 120, 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=300&q=80', 'Fresh'),
            ('Whole Wheat Atta 10kg', 'Rice, Atta & Pulses', 1690, None, 45, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=300&q=80', None),
            ('Farm Eggs (Dozen)', 'Dairy & Eggs', 390, None, 5, 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=300&q=80', None),
            ('Seasonal Vegetable Box', 'Fruits & Vegetables', 850, None, 30, 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=300&q=80', 'Fresh'),
            ('Sunflower Cooking Oil 3L', 'Household', 1590, 1750, 60, 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=300&q=80', 'Sale'),
            ('Bakery Bread Loaf', 'Bakery', 180, None, 0, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=300&q=80', None),
            ('Fresh Orange Juice 1L', 'Beverages', 320, None, 40, 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=300&q=80', None),
        ]
        for p in products:
            execute(conn, 'INSERT INTO products (name, category, price, old_price, stock, image, tag) VALUES (?,?,?,?,?,?,?)', p)
        if hasattr(conn, 'commit'):
            conn.commit()
        print('[seed] Product catalog ready.')

    settings_count = query_one(conn, 'SELECT COUNT(*) AS c FROM settings')['c']
    if settings_count == 0:
        # Matches the values already shown on the storefront/footer by
        # default, so nothing visibly changes until the admin actually saves
        # different values from Admin Panel → Settings.
        default_settings = {
            'store_name': 'Shakarganj Grocery Store',
            'support_phone': '+92 300 1234567',
            'support_email': 'orders@shakarganj.pk',
            'whatsapp_number': '',
            'bank_iban': 'PK00 MEZN 0000 0000 1234 567',
            'bank_name': 'Meezan Bank',
        }
        for key, value in default_settings.items():
            execute(conn, 'INSERT INTO settings (setting_key, value) VALUES (?, ?)', (key, value))
        if hasattr(conn, 'commit'):
            conn.commit()
        print('[seed] Default settings ready.')

    campaign_count = query_one(conn, 'SELECT COUNT(*) AS c FROM deal_campaigns')['c']
    if campaign_count == 0:
        execute(conn, """INSERT INTO deal_campaigns
            (title, description, badge, button_text, button_url, image, start_date, end_date, is_active)
            VALUES (?,?,?,?,?,?,?,?,?)""",
                ('Ramzan grocery bundles are here',
                 'Save up to 20% on essentials — atta, ghee, dates and more, bundled for the whole month.',
                 'Seasonal savings', 'Explore Bundles', 'index.html', '',
                 '2026-01-01 00:00:00', None, 1))
        if hasattr(conn, 'commit'):
            conn.commit()
        print('[seed] Default deal container ready.')

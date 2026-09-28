# app/db.py
#
# Database connection layer. Two engines are supported, chosen by the
# DB_ENGINE environment variable:
#
#   DB_ENGINE=sqlite (default) — zero setup, uses Python's built-in sqlite3
#     module. The whole database is one file at data/shakarganj.db.
#
#   DB_ENGINE=mysql — connects to a real MySQL/MariaDB server using PyMySQL.
#     Set MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD /
#     MYSQL_DATABASE in .env. Run `pip install pymysql` first (it's a pure
#     -Python MySQL driver, no compiler/system libraries needed).
#
# The rest of the app writes queries with `?` placeholders (SQLite style).
# When running against MySQL, execute() below transparently swaps them for
# `%s` (PyMySQL's style) — so route code never needs to know which engine
# is active.

import os
import sqlite3

DB_ENGINE = os.environ.get('DB_ENGINE', 'sqlite').lower()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
SQLITE_PATH = os.path.join(DATA_DIR, 'shakarganj.db')


def get_connection():
    """Returns a new DB-API connection. Caller is responsible for closing it
    (routes use it via Flask's `g` — see app/__init__.py get_db())."""
    if DB_ENGINE == 'mysql':
        import pymysql
        import pymysql.cursors
        # Most managed MySQL providers (Aiven, PlanetScale, TiDB Cloud, etc.)
        # require an encrypted connection and refuse plain ones outright.
        # Set MYSQL_SSL=true in .env / your host's environment variables to
        # enable it — a plain local MySQL install usually doesn't need this.
        ssl_kwargs = {'ssl': {'ssl': {}}} if os.environ.get('MYSQL_SSL', '').lower() == 'true' else {}
        return pymysql.connect(
            host=os.environ.get('MYSQL_HOST', 'localhost'),
            port=int(os.environ.get('MYSQL_PORT', '3306')),
            user=os.environ.get('MYSQL_USER', 'root'),
            password=os.environ.get('MYSQL_PASSWORD', ''),
            database=os.environ.get('MYSQL_DATABASE', 'shakarganj'),
            autocommit=True,
            cursorclass=pymysql.cursors.DictCursor,
            **ssl_kwargs,
        )
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        return conn


def execute(conn, sql, params=()):
    """Runs a query, adapting `?` placeholders to MySQL's `%s` when needed.
    Returns the cursor (use .fetchone()/.fetchall()/.lastrowid on it)."""
    cur = conn.cursor()
    if DB_ENGINE == 'mysql':
        sql = sql.replace('?', '%s')
    cur.execute(sql, params)
    return cur


def query_one(conn, sql, params=()):
    cur = execute(conn, sql, params)
    row = cur.fetchone()
    return dict(row) if row is not None else None


def query_all(conn, sql, params=()):
    cur = execute(conn, sql, params)
    return [dict(row) for row in cur.fetchall()]


def init_schema(conn):
    statements = SCHEMA_MYSQL if DB_ENGINE == 'mysql' else SCHEMA_SQLITE
    for stmt in statements:
        conn.execute(stmt) if DB_ENGINE != 'mysql' else execute(conn, stmt)
    if DB_ENGINE != 'mysql':
        conn.commit()


def migrate_order_status_schema(conn):
    if DB_ENGINE == 'mysql':
        constraints = query_all(conn, """SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
            FROM information_schema.TABLE_CONSTRAINTS tc
            JOIN information_schema.CHECK_CONSTRAINTS cc
              ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
             AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
            WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
              AND tc.TABLE_NAME = 'orders'
              AND tc.CONSTRAINT_TYPE = 'CHECK'""")
        status_constraints = [item for item in constraints if 'order_status' in item['CHECK_CLAUSE'].lower()]
        if status_constraints and all('returned' in item['CHECK_CLAUSE'].lower() for item in status_constraints):
            return
        for item in status_constraints:
            name = item['CONSTRAINT_NAME'].replace('`', '``')
            execute(conn, f'ALTER TABLE orders DROP CHECK `{name}`')
        execute(conn, """ALTER TABLE orders ADD CONSTRAINT chk_orders_order_status
            CHECK (order_status IN ('processing','confirmed','out_for_delivery','delivered','returned','cancelled'))""")
        return

    schema = query_one(conn, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    if not schema or 'returned' in schema['sql'].lower():
        return

    conn.commit()
    conn.execute('PRAGMA foreign_keys = OFF')
    try:
        conn.execute('BEGIN')
        conn.execute("""CREATE TABLE orders_migrated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_code TEXT UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            customer_name TEXT NOT NULL,
            customer_email TEXT,
            customer_phone TEXT,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT,
            postal_code TEXT,
            delivery_slot TEXT,
            delivery_instructions TEXT,
            subtotal REAL NOT NULL,
            delivery_fee REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL,
            payment_method TEXT NOT NULL CHECK(payment_method IN ('jazzcash','bank','cod')),
            payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','cod_pending','refunded')),
            gateway TEXT,
            gateway_txn_ref TEXT,
            order_status TEXT NOT NULL DEFAULT 'processing' CHECK(order_status IN ('processing','confirmed','out_for_delivery','delivered','returned','cancelled')),
            created_at TEXT DEFAULT (datetime('now'))
        )""")
        columns = [row[1] for row in conn.execute('PRAGMA table_info(orders)')]
        column_list = ', '.join(f'"{column}"' for column in columns)
        conn.execute(f'INSERT INTO orders_migrated ({column_list}) SELECT {column_list} FROM orders')
        conn.execute('DROP TABLE orders')
        conn.execute('ALTER TABLE orders_migrated RENAME TO orders')
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute('PRAGMA foreign_keys = ON')


# ---------------------------------------------------------------------------
# Schema — kept as two explicit dialects rather than one abstraction, so the
# actual SQL running against each database is easy to read and verify.
# ---------------------------------------------------------------------------

SCHEMA_SQLITE = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','staff','employee','user')),
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        sale_price REAL,
        old_price REAL,
        stock INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        tag TEXT,
        unit TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
        discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
        discount_value REAL NOT NULL CHECK(discount_value > 0),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS deal_campaigns (
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
    )""",
    """CREATE TABLE IF NOT EXISTS admin_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_type TEXT NOT NULL,
        entity_id INTEGER,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        read_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT,
        customer_phone TEXT,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT,
        postal_code TEXT,
        delivery_slot TEXT,
        delivery_instructions TEXT,
        subtotal REAL NOT NULL,
        delivery_fee REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK(payment_method IN ('jazzcash','bank','cod')),
        payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','cod_pending','refunded')),
        gateway TEXT,
        gateway_txn_ref TEXT,
        order_status TEXT NOT NULL DEFAULT 'processing' CHECK(order_status IN ('processing','confirmed','out_for_delivery','delivered','returned','cancelled')),
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        product_name_snapshot TEXT,
        product_image_snapshot TEXT,
        variant_snapshot TEXT,
        unit_price REAL NOT NULL,
        qty INTEGER NOT NULL,
        discount REAL DEFAULT 0,
        line_total REAL DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        form_id TEXT UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        topic TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS jazzcash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        txn_ref_no TEXT UNIQUE,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        response_code TEXT,
        response_message TEXT,
        raw_payload TEXT,
        received_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS settings (
        setting_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        button_text TEXT NOT NULL DEFAULT 'Explore Collection',
        is_featured INTEGER NOT NULL DEFAULT 0 CHECK(is_featured IN (0,1)),
        rotation_interval_minutes INTEGER NOT NULL DEFAULT 30,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS collection_products (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        display_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, product_id)
    )""",
    """CREATE TABLE IF NOT EXISTS promo_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
]

SCHEMA_MYSQL = [
    """CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK(role IN ('admin','manager','staff','employee','user')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(120) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        sale_price DECIMAL(10,2),
        old_price DECIMAL(10,2),
        stock INT NOT NULL DEFAULT 0,
        image TEXT,
        tag VARCHAR(40),
        unit VARCHAR(40),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS deals (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL UNIQUE,
        discount_type VARCHAR(20) NOT NULL CHECK(discount_type IN ('percentage','fixed')),
        discount_value DECIMAL(10,2) NOT NULL CHECK(discount_value > 0),
        start_date DATETIME NOT NULL,
        end_date DATETIME NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS deal_campaigns (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        badge VARCHAR(120),
        button_text VARCHAR(80) NOT NULL DEFAULT 'Shop Now',
        button_url VARCHAR(500) NOT NULL DEFAULT 'index.html',
        image TEXT,
        start_date DATETIME NOT NULL,
        end_date DATETIME NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS admin_notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        notification_type VARCHAR(60) NOT NULL,
        entity_id INT,
        message VARCHAR(500) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_code VARCHAR(40) UNIQUE NOT NULL,
        user_id INT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        customer_phone VARCHAR(30),
        phone VARCHAR(30) NOT NULL,
        address TEXT NOT NULL,
        city VARCHAR(100),
        postal_code VARCHAR(30),
        delivery_slot VARCHAR(100),
        delivery_instructions TEXT,
        subtotal DECIMAL(10,2) NOT NULL,
        delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL CHECK(payment_method IN ('jazzcash','bank','cod')),
        payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','cod_pending','refunded')),
        gateway VARCHAR(30),
        gateway_txn_ref VARCHAR(60),
        order_status VARCHAR(30) NOT NULL DEFAULT 'processing',
        CONSTRAINT chk_orders_order_status CHECK(order_status IN ('processing','confirmed','out_for_delivery','delivered','returned','cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS order_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_id INT NOT NULL,
        product_id INT,
        product_name VARCHAR(255) NOT NULL,
        product_name_snapshot VARCHAR(255),
        product_image_snapshot TEXT,
        variant_snapshot VARCHAR(255),
        unit_price DECIMAL(10,2) NOT NULL,
        qty INT NOT NULL,
        discount DECIMAL(10,2) DEFAULT 0,
        line_total DECIMAL(10,2) DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS support_messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        form_id VARCHAR(40) UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        topic VARCHAR(100),
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS jazzcash_transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        txn_ref_no VARCHAR(60) UNIQUE,
        order_id INT NULL,
        response_code VARCHAR(10),
        response_message VARCHAR(255),
        raw_payload TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(255) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS collections (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(120) NOT NULL,
        slug VARCHAR(140) NOT NULL UNIQUE,
        title VARCHAR(180) NOT NULL,
        button_text VARCHAR(120) NOT NULL DEFAULT 'Explore Collection',
        is_featured TINYINT(1) NOT NULL DEFAULT 0,
        rotation_interval_minutes INT NOT NULL DEFAULT 30,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS collection_products (
        collection_id INT NOT NULL,
        product_id INT NOT NULL,
        display_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, product_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS promo_messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        message VARCHAR(500) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
]

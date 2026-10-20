# Shakarganj Grocery — Python (Flask) Full-Stack Project

A complete grocery e-commerce site with a **Python (Flask) backend**, real
JazzCash payment integration, a SQL database (SQLite by default, MySQL-ready),
role-based admin/user panels, and a Help & Support widget.

## Requirements

- **Python 3.10+**
- `pip install -r requirements.txt`

## Running it

```bash
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Then open **http://localhost:5000/** in your browser. Flask serves both the
API and the frontend from the same origin, so use this server rather than a
separate static-file server. Cross-origin API access is disabled unless the
request origin matches the explicitly configured `CORS_ALLOWED_ORIGIN`.

## Admin login

As requested, the seeded admin account is:

| Field    | Value                |
|----------|----------------------|
| Email    | `shakarganj@gmail.com` |
| Password | `11223344`             |

Sign in at **http://localhost:5000/login.html** — there is no separate admin
URL. The backend checks the account's role and redirects automatically:
`admin` (and `manager`/`staff`) → **Admin Panel** (`admin.html`); `user`
(customer) accounts → **User Panel** (`user-dashboard.html`).

You can change the seeded admin email/password by editing `ADMIN_EMAIL` /
`ADMIN_PASSWORD` in `.env` **before the very first run** (they're only used
to create the account the first time the database is empty). To change them
afterwards, either delete `data/shakarganj.db` and restart (this wipes all
data), or update the row directly in the database.

Other demo accounts (also seeded):

| Role     | Email                     | Password     |
|----------|---------------------------|--------------|
| Manager  | manager@shakarganj.pk     | Manager@123  |
| Staff    | staff@shakarganj.pk       | Staff@123    |
| Customer | customer@shakarganj.pk    | Customer@123 |

## Database — SQLite by default, MySQL-ready

By default this runs on **SQLite** (`DB_ENGINE=sqlite` in `.env`) — a single
file at `data/shakarganj.db`, created and seeded automatically. Nothing to
install or configure.

### Connecting your own SQL (MySQL) database

Since you mentioned wanting to attach your own SQL database, here's exactly
how:

1. Install the MySQL driver (pure Python, no compiler needed):
   ```bash
   pip install pymysql
   ```
2. Create an empty database on your MySQL server, e.g.:
   ```sql
   CREATE DATABASE shakarganj CHARACTER SET utf8mb4;
   ```
3. In `.env`, set:
   ```
   DB_ENGINE=mysql
   MYSQL_HOST=localhost
   MYSQL_PORT=3306
   MYSQL_USER=your_mysql_user
   MYSQL_PASSWORD=your_mysql_password
   MYSQL_DATABASE=shakarganj
   ```
4. Run `python app.py` — the app detects `DB_ENGINE=mysql`, connects with
   PyMySQL, and creates all the same tables in your MySQL database
   automatically on first run (see `app/db.py` for the exact `CREATE TABLE`
   statements — there's a dedicated MySQL-dialect schema, not just the
   SQLite one reused).

No route/business-logic code needs to change either way — every route talks
to the database through `app/db.py`'s `query_one()` / `query_all()` /
`execute()` helpers, which work identically against both engines.

### Writing your own SQL queries in the code

Every route file (`app/routes/*.py`) talks to the database through three
small helpers imported from `app/db.py` — this is the pattern to follow
anywhere you add new functionality:

```python
from app.db import query_one, query_all, execute

# SELECT one row -> dict, or None if not found
product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))

# SELECT many rows -> list of dicts
products = query_all(db, 'SELECT * FROM products WHERE category = ?', ('Bakery',))

# INSERT / UPDATE / DELETE
cur = execute(db, 'INSERT INTO products (name, price) VALUES (?, ?)', ('New Item', 250))
new_id = cur.lastrowid   # the auto-generated ID of the row you just inserted
if hasattr(db, 'commit'):
    db.commit()           # SQLite needs an explicit commit; MySQL (autocommit=True) doesn't, hence the check
```

Always write placeholders as `?` (SQLite style) even though the values get
sent as a separate `params` tuple — `execute()` automatically translates `?`
to `%s` when `DB_ENGINE=mysql`, so you never have to write two versions of a
query. **Never** build SQL by string-concatenating user input (e.g.
`f"...WHERE id = {product_id}"`) — always pass values through the `params`
tuple like the examples above; that's what prevents SQL injection.

`db` in every route is obtained via `current_app.get_db()` (see any file in
`app/routes/` for the exact pattern) — Flask hands you the same connection
for the lifetime of that one request, and it's closed automatically
afterwards (see `close_db()` in `app/__init__.py`).

**Adding a new table:** add a `CREATE TABLE IF NOT EXISTS ...` statement to
*both* `SCHEMA_SQLITE` and `SCHEMA_MYSQL` lists near the bottom of
`app/db.py` (each dialect needs its own `CREATE TABLE` syntax, as explained
above) — it'll be created automatically the next time the app starts.

**Inspecting the data directly**, outside of the app:
- SQLite: `sqlite3 data/shakarganj.db` then e.g. `SELECT * FROM orders;` (the
  `sqlite3` command-line tool ships with Python; if it's not on your PATH,
  any SQLite GUI like "DB Browser for SQLite" works too — just open
  `data/shakarganj.db`).
- MySQL: connect with any client (MySQL Workbench, `mysql` CLI, TablePlus,
  etc.) using the same `MYSQL_*` credentials from your `.env`.

## JazzCash integration

This project integrates with **JazzCash's Hosted Checkout Page (HCP)** — the
standard redirect-based integration most Pakistani merchants use. The flow in
`app/payments_jazzcash.py` and `app/routes/orders.py` / `app/routes/
payments.py` follows JazzCash's documented request format exactly:

1. `POST /api/orders` (payment method `jazzcash`) builds the complete set of
   `pp_*` fields JazzCash expects: `pp_MerchantID`, `pp_Amount` (in paisa),
   `pp_TxnRefNo`, `pp_TxnDateTime`, `pp_ReturnURL`, etc.
2. `pp_SecureHash` is computed exactly per JazzCash's documented algorithm:
   all `pp_*` values sorted alphabetically by field name, joined with `&`,
   prefixed with the Integrity Salt, then HMAC-SHA256'd using the Integrity
   Salt as the key.
3. The frontend (`public/js/app.js`, `submitJazzCashForm()`) builds a real
   HTML `<form method="post">` from those fields and submits it — the
   browser navigates to JazzCash's Hosted Checkout Page directly, so wallet
   PINs and card numbers are entered on JazzCash's own page and never touch
   our server.
4. JazzCash redirects the browser back to `pp_ReturnURL`
   (`/api/payments/jazzcash/return`) with the result, including
   `pp_ResponseCode` and its own `pp_SecureHash` — which we verify before
   trusting the result — then forwards to `order-confirmation.html`.

### Sandbox mode (default — works immediately, no JazzCash account needed)

Until real credentials are in `.env`, JazzCash orders submit that same real
HTML form to our own `/api/payments/mock-checkout` route instead of
JazzCash's servers. It shows you the exact `pp_*` fields (including the
computed secure hash) that would be sent, and lets you simulate a successful
or failed payment — so you can demo and test the entire cart → checkout →
payment → order-confirmation → admin order-status flow with zero setup.

### Going live

1. Apply for a JazzCash merchant account through the JazzCash Business /
   Developer Portal. You'll receive a **Merchant ID**, **Password**, and
   **Integrity Salt**.
2. Fill these into `.env`:
   ```
   JAZZCASH_MODE=sandbox        # switch to production when ready
   JAZZCASH_MERCHANT_ID=your_merchant_id
   JAZZCASH_PASSWORD=your_password
   JAZZCASH_INTEGRITY_SALT=your_integrity_salt
   PUBLIC_BASE_URL=https://yourdomain.pk
   ```
3. Restart the server. No code changes needed — the exact same form-building
   code now targets JazzCash's real sandbox/production endpoint instead of
   `/api/payments/mock-checkout`.

## Authentication & sessions

One unified login (`POST /api/auth/login`) for every account type — there is
**no separate admin login page or button anywhere**. The backend alone
decides the role from the database; the frontend just redirects based on
whatever role comes back:

```
Email + Password → Backend checks credentials → { token, user.role }
                                                        |
                              -----------------------------------------------
                    role = admin/manager/staff                        role = user
                              |                                                |
                     redirect to admin.html                     redirect to user-dashboard.html
```

Sessions are **real server-side sessions** (see `app/sessions.py`), not
self-signed tokens: the browser's token is a random opaque string that only
means something because it matches a row in the `sessions` table. Logging
out deletes that row — the token stops working immediately, not just
"forgotten" by one browser tab. Sessions also expire automatically after 8
hours. Passwords are hashed with `werkzeug.security` (scrypt) — never stored
in plain text.

## Product recommendations and personalization

The home page's existing product row is ranked by `GET /api/recommendations`.
This is a deterministic, lightweight hybrid recommender implemented in
Python and SQL; it adds no ML dependencies and does not change search, cart,
pricing, inventory, checkout, or order processing.

### Signals and ranking

- **Popularity fallback:** in-stock products are ranked using valid purchase
  quantities/order counts and recent product impressions. Anonymous visitors
  and customers without usable history receive this fallback.
- **Personal preferences:** for signed-in customer accounts, product views,
  recommendation impressions, and add-to-cart events are combined with
  eligible purchase history. Interaction events are limited to the last 180
  days and use a 45-day recency decay scale; eligible purchases contribute
  recency-weighted purchase frequency and spend signals.
- **Category affinity:** customer signals are aggregated by the products'
  current categories.
- **Related products:** products appearing with the customer's purchased
  products in eligible orders receive a co-purchase signal.
- **Inventory and order validity:** out-of-stock products are excluded.
  Purchase signals ignore failed, refunded, cancelled, and returned orders;
  `paid` and `cod_pending` orders are eligible.

Signals are normalized and combined with explicit weights in
`app/recommendations.py`. The engine evaluates at most 500 in-stock candidates
and returns up to 24 products per request (the storefront asks for 8). It
recomputes the ranking from current data on request; there is no scheduled
training job or precomputed recommendation cache.

### Event collection and privacy

Only authenticated accounts with the customer (`user`) role can submit
product events. The storefront records product impressions after at least
25% of a product card becomes visible, and records cart additions with their
source. Repeated view/impression events for the same customer, product, and
event type are deduplicated for six hours. Event writes are limited to 300
per customer per hour.

The `user_product_events` table stores customer ID, product ID, event type,
and timestamp. It has foreign keys and indexes in both supported database
schemas; removing a customer or product cascades their associated events.
Recommendation responses are marked `private, no-store` and use only the
authenticated customer's signals. Admin analytics return aggregates rather
than customer-level behavior.

### Recommendation API

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/recommendations?limit=8` | Public; personalized only for a signed-in customer | Returns ranked in-stock products and a `strategy` of `popular` or `personalized`. `limit` must be 1–24. |
| `POST /api/recommendations/events` | Signed-in customer | Records one supported product interaction. |
| `GET /api/analytics/recommendations` | Admin or manager | Returns aggregate interaction metrics for the last 30 days. |

Supported event payload:

```json
{
  "productId": 42,
  "eventType": "view"
}
```

Supported `eventType` values are `view`, `cart_add`,
`recommendation_view`, and `recommendation_add`. The server rejects malformed
events and unavailable products. Analytics include recommendation impressions,
recommendation additions and add rate, engaged customers, and the most viewed
recommendation products. These are operational measurements, not offline
precision/recall scores or proof of recommendation quality.

## Project structure

```
shakarganj-python/
├── app.py                       Entry point — run this: python app.py
├── requirements.txt
├── .env.example
├── app/
│   ├── __init__.py               Flask app factory, CORS, static serving, seeding
│   ├── db.py                      DB layer — SQLite + MySQL, dual schema
│   ├── auth.py                     Password hashing (werkzeug/scrypt)
│   ├── sessions.py                  Server-side session management
│   ├── recommendations.py           Hybrid product ranking and preference scoring
│   ├── payments_jazzcash.py          JazzCash HCP integration
│   └── routes/
│       ├── auth.py                    /api/auth/*  (register, login, logout, me)
│       ├── products.py                 /api/products/*
│       ├── recommendations.py           /api/recommendations/* (ranking + event collection)
│       ├── orders.py                    /api/orders/*
│       ├── payments.py                   /api/payments/* + JazzCash return + sandbox
│       ├── analytics.py                   /api/analytics/* (store + recommendation metrics)
│       └── support.py                      /api/support/* (FAQs + contact form)
├── public/                      Frontend (served by Flask itself)
│   ├── index.html                Storefront + splash screen
│   ├── login.html                 Unified sign in / sign up
│   ├── admin.html                  Admin Panel
│   ├── user-dashboard.html          User Panel (customer order history)
│   ├── order-confirmation.html       Order status / JazzCash payment result
│   ├── css/style.css                  Shared theme (maroon + white)
│   ├── js/                             app.js, admin.js, user.js, api.js, support-widget.js
│   └── assets/                          logo.jpg, trolley.png
└── data/shakarganj.db            Created automatically (SQLite mode only)
```

## Help & Support widget — emailing submissions to Gmail (Formspree)

The floating "Help & Support" button on the storefront (bottom-right) has a
contact form. Every submission is always saved to the database (visible in
the Admin Panel's **Support Inbox**) — but to *also* get an email straight to
your Gmail the moment someone submits it, connect a free
[Formspree](https://formspree.io) form:

1. Go to https://formspree.io and sign up.
2. Create a new form, and enter the Gmail address you want submissions sent
   to. Formspree emails that address a confirmation link — click it.
3. Formspree shows you a form endpoint like `https://formspree.io/f/abcdwxyz`
   — copy just the ID part after `/f/` (e.g. `abcdwxyz`).
4. Open **`public/js/support-widget.js`** and find this line near the top:
   ```js
   const FORMSPREE_FORM_ID = ''; // <-- paste your Formspree form ID here, e.g. 'abcdwxyz'
   ```
   Paste your ID between the quotes:
   ```js
   const FORMSPREE_FORM_ID = 'abcdwxyz';
   ```
5. Save the file and refresh the site (no server restart needed — this is a
   frontend-only file). That's it — new "Ask a question" submissions now
   land in your Gmail inbox *and* in the Admin Support Inbox.

Leaving `FORMSPREE_FORM_ID` empty just skips the email step — messages still
save to the database as normal, so nothing breaks if you don't set it up.

## What's real vs. placeholder

- **Real**: product catalog, cart, order creation, stock decrementing,
  unified role-based auth with hashed passwords and revocable sessions,
  order status tracking, per-customer order history, analytics, JazzCash
  Hosted Checkout Page integration (sandbox by default, live once
  configured — request building and secure-hash verification are genuine),
  Help & Support FAQ + contact form (stored in the database, visible in the
  admin Support Inbox), the hybrid recommendation system with customer event
  collection and aggregate admin metrics, admin settings persistence, and
  staff/member management subject to role permissions.
- **Partial / needs evaluation**: recommendations use transparent,
  rule-weighted signals, not a trained machine-learning model. Recommendation
  add rate is an early engagement metric; larger datasets and controlled
  evaluation are needed before claiming recommendation lift.
- **Your job before launch**: get real JazzCash merchant credentials, point
  `DB_ENGINE` at a real MySQL database if you want one outside SQLite,
  change the seeded demo passwords, and replace stock photos with real
  product photography.

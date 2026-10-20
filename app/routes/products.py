# app/routes/products.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed
from app.deal_utils import active_deal_for_product
from app.product_images import save_product_image, remove_unreferenced_image


def enrich_product(db, product):
    result = dict(product)
    deal = active_deal_for_product(db, product['id'])
    result['deal'] = deal
    result['effective_price'] = deal['final_price'] if deal else float(product['sale_price'] or product['price'])
    result['has_sale_price'] = bool(product['sale_price'] and float(product['sale_price']) < float(product['price']))
    return result




def parse_product_fields(body, existing=None):
    source = {**(existing or {}), **(body or {})}
    name = str(source.get('name') or '').strip()
    category = str(source.get('category') or '').strip()
    if not name or not category:
        raise ValueError('Product name and category are required.')
    if len(name) > 180 or len(category) > 120:
        raise ValueError('Product name or category is too long.')
    try:
        price = float(source.get('price'))
    except (TypeError, ValueError):
        raise ValueError('Price must be a valid number.')
    if price <= 0 or price > 100000000:
        raise ValueError('Price must be greater than 0 and within a valid range.')
    try:
        stock = int(source.get('stock', 0))
    except (TypeError, ValueError):
        raise ValueError('Stock must be a whole number.')
    if stock < 0 or stock > 100000000:
        raise ValueError('Stock cannot be negative or exceed the allowed range.')
    image = source.get('image') or None
    tag = source.get('tag')
    if image is not None and len(str(image)) > 1000:
        raise ValueError('Image reference is too long.')
    if tag is not None and len(str(tag)) > 60:
        raise ValueError('Product tag is too long.')
    return name, category, price, stock, image, tag

def parse_sale_price(body, original_price):
    value = body.get('salePrice', body.get('sale_price'))
    if value in (None, ''):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError('Sale price must be a valid number.')
    if value <= 0 or value >= float(original_price):
        raise ValueError('Sale price must be less than the original price.')
    return value

bp = Blueprint('products', __name__, url_prefix='/api/products')


def product_request_body():
    if request.mimetype == 'multipart/form-data':
        return request.form.to_dict()
    return request.get_json(silent=True) or {}


def uploaded_image():
    file = request.files.get('image_file')
    if file is None or not file.filename:
        return None
    return save_product_image(file, current_app.config['PRODUCT_IMAGE_UPLOAD_DIR'])


def cleanup_replaced_image(db, old_image, new_image):
    if old_image and old_image != new_image:
        remove_unreferenced_image(db, old_image, current_app.config['PRODUCT_IMAGE_UPLOAD_DIR'])


@bp.get('')
def list_products():
    db = current_app.get_db()
    category = request.args.get('category')  # optional ?category=Bakery filter, used by category.html
    search = request.args.get('q', '').strip()
    if len(search) > 200:
        return jsonify(error='Search query is too long.'), 400

    if search:
        pattern = f'%{search}%'
        products = query_all(
            db,
            '''SELECT * FROM products
               WHERE LOWER(name) LIKE LOWER(?)
                  OR LOWER(category) LIKE LOWER(?)
               ORDER BY created_at DESC''',
            (pattern, pattern),
        )
    elif category:
        products = query_all(db, 'SELECT * FROM products WHERE category = ? ORDER BY created_at DESC', (category,))
    else:
        products = query_all(db, 'SELECT * FROM products ORDER BY created_at DESC')
    return jsonify(products=[enrich_product(db, product) for product in products])


@bp.get('/categories')
def list_categories():
    """Distinct category names currently in the catalog, with a live product
    count each — powers the storefront's category browsing pages and cards.
    Since this reads straight from the products table, it always reflects
    whatever an Admin has added/edited/removed in the Admin Panel."""
    db = current_app.get_db()
    rows = query_all(db, 'SELECT category, COUNT(*) AS product_count FROM products GROUP BY category ORDER BY category')
    return jsonify(categories=rows)


@bp.get('/<int:product_id>')
def get_product(product_id):
    db = current_app.get_db()
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not product:
        return jsonify(error='Product not found.'), 404
    return jsonify(product=enrich_product(db, product))


@bp.post('')
def create_product():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Admin or manager access required.'), 403

    body = product_request_body()
    try:
        name, category, price, stock, image, tag = parse_product_fields(body)
        sale_price = parse_sale_price(body, price)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    unit = str(body.get('unit') or '').strip()
    if len(unit) > 40:
        return jsonify(error='Measurement unit must be 40 characters or fewer.'), 400
    try:
        old_price = float(body.get('oldPrice')) if body.get('oldPrice') not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify(error='Old price must be a valid number.'), 400
    if old_price is not None and old_price <= 0:
        return jsonify(error='Old price must be greater than 0.'), 400
    try:
        saved_image = uploaded_image()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    if saved_image:
        image = saved_image
    try:
        cur = execute(db, 'INSERT INTO products (name, category, price, sale_price, old_price, stock, image, tag, unit) VALUES (?,?,?,?,?,?,?,?,?)',
                      (name, category, price, sale_price, old_price, stock, image, tag, unit or None))
        if hasattr(db, 'commit'):
            db.commit()
    except Exception:
        if hasattr(db, 'rollback'):
            db.rollback()
        if saved_image:
            remove_unreferenced_image(db, saved_image, current_app.config['PRODUCT_IMAGE_UPLOAD_DIR'])
        raise
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (cur.lastrowid,))
    return jsonify(product=product), 201


@bp.put('/<int:product_id>')
def update_product(product_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Admin or manager access required.'), 403

    existing = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not existing:
        return jsonify(error='Product not found.'), 404

    body = product_request_body()
    merged = {**existing, **body}
    try:
        name, category, price, stock, image, tag = parse_product_fields(body, existing)
        sale_price = parse_sale_price(body, price) if ('salePrice' in body or 'sale_price' in body) else existing.get('sale_price')
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    unit = str(merged.get('unit') or '').strip()
    if len(unit) > 40:
        return jsonify(error='Measurement unit must be 40 characters or fewer.'), 400
    old_price_value = merged.get('old_price') if 'old_price' in merged else merged.get('oldPrice')
    try:
        old_price = float(old_price_value) if old_price_value not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify(error='Old price must be a valid number.'), 400
    if old_price is not None and old_price <= 0:
        return jsonify(error='Old price must be greater than 0.'), 400
    try:
        saved_image = uploaded_image()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    if saved_image:
        image = saved_image
    try:
        execute(db, 'UPDATE products SET name=?, category=?, price=?, sale_price=?, old_price=?, stock=?, image=?, tag=?, unit=? WHERE id=?',
                (name, category, price, sale_price, old_price, stock, image, tag, unit or None, product_id))
        if hasattr(db, 'commit'):
            db.commit()
    except Exception:
        if hasattr(db, 'rollback'):
            db.rollback()
        if saved_image:
            remove_unreferenced_image(db, saved_image, current_app.config['PRODUCT_IMAGE_UPLOAD_DIR'])
        raise
    cleanup_replaced_image(db, existing.get('image'), image)
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    return jsonify(product=enrich_product(db, product))


@bp.delete('/<int:product_id>')
def delete_product(product_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    existing = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not existing:
        return jsonify(error='Product not found.'), 404

    execute(db, 'DELETE FROM products WHERE id = ?', (product_id,))
    if hasattr(db, 'commit'):
        db.commit()
    cleanup_replaced_image(db, existing.get('image'), None)
    return jsonify(success=True)

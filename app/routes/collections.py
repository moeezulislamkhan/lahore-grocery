import re

from flask import Blueprint, current_app, jsonify, request

from app.db import execute, query_all, query_one
from app.routes.products import enrich_product
from app.sessions import get_session_user, role_allowed

bp = Blueprint('collections', __name__, url_prefix='/api')
MANAGE_ROLES = ['admin', 'manager', 'employee']


def _admin_user(db):
    user = get_session_user(db, request)
    return user if role_allowed(user, MANAGE_ROLES) else None


def _collection(row, include_products=False):
    result = dict(row)
    result['is_featured'] = bool(result.get('is_featured'))
    if include_products:
        db = current_app.get_db()
        products = query_all(
            db,
            '''SELECT p.*, cp.display_order FROM products p
               JOIN collection_products cp ON cp.product_id = p.id
               WHERE cp.collection_id = ? ORDER BY cp.display_order, p.name''',
            (result['id'],),
        )
        result['products'] = [enrich_product(db, product) for product in products]
        result['product_ids'] = [product['id'] for product in result['products']]
    return result


def _slugify(value):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', value.lower())).strip('-')


def _validate_collection(body, existing=None):
    body = body or {}
    name = str(body.get('name', existing['name'] if existing else '')).strip()
    title = str(body.get('title', existing['title'] if existing else '')).strip()
    slug_source = body.get('slug') or (existing['slug'] if existing else '') or name
    slug = _slugify(str(slug_source).strip())
    button_text = str(body.get('button_text', existing.get('button_text', 'Explore Collection') if existing else 'Explore Collection')).strip()
    featured = body.get('is_featured', existing.get('is_featured', 0) if existing else False)
    try:
        interval = int(body.get('rotation_interval_minutes', existing.get('rotation_interval_minutes', 30) if existing else 30))
    except (TypeError, ValueError) as exc:
        raise ValueError('Rotation interval must be a whole number of minutes.') from exc
    if not name or not title or not slug:
        raise ValueError('Collection name, slug, and title are required.')
    if len(name) > 120 or len(title) > 180 or len(slug) > 140 or len(button_text) > 120:
        raise ValueError('Collection fields exceed their maximum length.')
    if interval < 1 or interval > 10080:
        raise ValueError('Rotation interval must be between 1 and 10080 minutes.')
    return name, slug, title, button_text or 'Explore Collection', int(bool(featured)), interval


def _set_featured(db, collection_id):
    execute(db, 'UPDATE collections SET is_featured = 0')
    execute(db, 'UPDATE collections SET is_featured = 1 WHERE id = ?', (collection_id,))


@bp.get('/collections')
def public_collections():
    db = current_app.get_db()
    rows = query_all(db, 'SELECT * FROM collections ORDER BY name')
    return jsonify(collections=[_collection(row) for row in rows])


@bp.get('/collections/featured')
def public_featured_collection():
    db = current_app.get_db()
    row = query_one(db, 'SELECT * FROM collections WHERE is_featured = 1 ORDER BY id LIMIT 1')
    return jsonify(collection=_collection(row, True) if row else None)


@bp.get('/collections/<slug>')
def public_collection(slug):
    db = current_app.get_db()
    row = query_one(db, 'SELECT * FROM collections WHERE slug = ?', (slug,))
    if not row:
        return jsonify(error='Collection not found.'), 404
    return jsonify(collection=_collection(row, True))


@bp.get('/admin/collections')
def admin_collections():
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    collections = query_all(db, 'SELECT * FROM collections ORDER BY name')
    products = query_all(db, 'SELECT id, name, category, price, sale_price, image FROM products ORDER BY name')
    return jsonify(collections=[_collection(row, True) for row in collections], products=products)


@bp.post('/admin/collections')
def create_collection():
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    body = request.get_json(silent=True) or {}
    try:
        values = _validate_collection(body)
        if query_one(db, 'SELECT id FROM collections WHERE slug = ?', (values[1],)):
            return jsonify(error='A collection with this slug already exists.'), 409
        cur = execute(db, '''INSERT INTO collections (name, slug, title, button_text, is_featured, rotation_interval_minutes)
                             VALUES (?, ?, ?, ?, ?, ?)''', values)
        if values[4]:
            _set_featured(db, cur.lastrowid)
        db.commit()
        row = query_one(db, 'SELECT * FROM collections WHERE id = ?', (cur.lastrowid,))
        return jsonify(collection=_collection(row)), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@bp.put('/admin/collections/<int:collection_id>')
def update_collection(collection_id):
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT * FROM collections WHERE id = ?', (collection_id,))
    if not existing:
        return jsonify(error='Collection not found.'), 404
    try:
        values = _validate_collection(request.get_json(silent=True), existing)
        duplicate = query_one(db, 'SELECT id FROM collections WHERE slug = ? AND id != ?', (values[1], collection_id))
        if duplicate:
            return jsonify(error='A collection with this slug already exists.'), 409
        execute(db, '''UPDATE collections SET name=?, slug=?, title=?, button_text=?, is_featured=?,
                       rotation_interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?''', values + (collection_id,))
        if values[4]:
            _set_featured(db, collection_id)
        elif existing['is_featured']:
            replacement = query_one(db, 'SELECT id FROM collections WHERE id != ? ORDER BY id LIMIT 1', (collection_id,))
            if replacement:
                _set_featured(db, replacement['id'])
        db.commit()
        row = query_one(db, 'SELECT * FROM collections WHERE id = ?', (collection_id,))
        return jsonify(collection=_collection(row))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@bp.put('/admin/collections/<int:collection_id>/products')
def assign_collection_products(collection_id):
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    if not query_one(db, 'SELECT id FROM collections WHERE id = ?', (collection_id,)):
        return jsonify(error='Collection not found.'), 404
    product_ids = (request.get_json(silent=True) or {}).get('product_ids')
    if not isinstance(product_ids, list):
        return jsonify(error='product_ids must be a list.'), 400
    try:
        product_ids = list(dict.fromkeys(int(product_id) for product_id in product_ids))
    except (TypeError, ValueError):
        return jsonify(error='Product IDs must be integers.'), 400
    for product_id in product_ids:
        if not query_one(db, 'SELECT id FROM products WHERE id = ?', (product_id,)):
            return jsonify(error=f'Product {product_id} was not found.'), 400
    execute(db, 'DELETE FROM collection_products WHERE collection_id = ?', (collection_id,))
    for order, product_id in enumerate(product_ids):
        execute(db, 'INSERT INTO collection_products (collection_id, product_id, display_order) VALUES (?, ?, ?)',
                (collection_id, product_id, order))
    db.commit()
    return jsonify(collection=_collection(query_one(db, 'SELECT * FROM collections WHERE id = ?', (collection_id,)), True))


@bp.delete('/admin/collections/<int:collection_id>')
def delete_collection(collection_id):
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT * FROM collections WHERE id = ?', (collection_id,))
    if not existing:
        return jsonify(error='Collection not found.'), 404
    execute(db, 'DELETE FROM collections WHERE id = ?', (collection_id,))
    if existing['is_featured']:
        replacement = query_one(db, 'SELECT id FROM collections ORDER BY id LIMIT 1')
        if replacement:
            _set_featured(db, replacement['id'])
    db.commit()
    return jsonify(success=True)


@bp.get('/promo-messages')
def public_promo_messages():
    rows = query_all(current_app.get_db(), 'SELECT id, message, display_order FROM promo_messages WHERE is_active = 1 ORDER BY display_order, id')
    return jsonify(messages=rows)


@bp.get('/admin/promo-messages')
def admin_promo_messages():
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    return jsonify(messages=query_all(db, 'SELECT * FROM promo_messages ORDER BY display_order, id'))


@bp.post('/admin/promo-messages')
def create_promo_message():
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or '').strip()
    if not message or len(message) > 500:
        return jsonify(error='Enter a message up to 500 characters.'), 400
    cur = execute(db, 'INSERT INTO promo_messages (message, is_active, display_order) VALUES (?, ?, ?)',
                  (message, int(bool(body.get('is_active', True))), int(body.get('display_order') or 0)))
    db.commit()
    return jsonify(message=query_one(db, 'SELECT * FROM promo_messages WHERE id = ?', (cur.lastrowid,))), 201


@bp.put('/admin/promo-messages/<int:message_id>')
def update_promo_message(message_id):
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or '').strip()
    if not message or len(message) > 500:
        return jsonify(error='Enter a message up to 500 characters.'), 400
    if not query_one(db, 'SELECT id FROM promo_messages WHERE id = ?', (message_id,)):
        return jsonify(error='Promotional message not found.'), 404
    execute(db, 'UPDATE promo_messages SET message=?, is_active=?, display_order=? WHERE id=?',
            (message, int(bool(body.get('is_active', True))), int(body.get('display_order') or 0), message_id))
    db.commit()
    return jsonify(message=query_one(db, 'SELECT * FROM promo_messages WHERE id = ?', (message_id,)))


@bp.delete('/admin/promo-messages/<int:message_id>')
def delete_promo_message(message_id):
    db = current_app.get_db()
    if not _admin_user(db):
        return jsonify(error='Admin access required.'), 403
    if not query_one(db, 'SELECT id FROM promo_messages WHERE id = ?', (message_id,)):
        return jsonify(error='Promotional message not found.'), 404
    execute(db, 'DELETE FROM promo_messages WHERE id = ?', (message_id,))
    db.commit()
    return jsonify(success=True)

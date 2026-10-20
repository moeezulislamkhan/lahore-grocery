from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request

from app.db import execute, query_all, query_one
from app.recommendations import get_recommendations
from app.sessions import get_session_user, role_allowed
from app.deal_utils import deal_status, serialize_deal

bp = Blueprint('recommendations', __name__, url_prefix='/api/recommendations')
ALLOWED_EVENTS = {'view', 'cart_add', 'recommendation_view', 'recommendation_add'}
EVENTS_PER_HOUR_LIMIT = 300
VIEW_DEDUPE_HOURS = 6


def _serialize_recommended_products(db, products):
    if not products:
        return []
    product_ids = [product['id'] for product in products]
    placeholders = ','.join('?' for _ in product_ids)
    deals = query_all(
        db,
        f'SELECT * FROM deals WHERE product_id IN ({placeholders})',
        tuple(product_ids),
    )
    deal_by_product = {int(deal['product_id']): deal for deal in deals}

    serialized = []
    for product in products:
        result = dict(product)
        deal = deal_by_product.get(int(product['id']))
        result['deal'] = (
            serialize_deal(deal, product)
            if deal and deal_status(deal) == 'active'
            else None
        )
        result['effective_price'] = (
            result['deal']['final_price']
            if result['deal']
            else float(product['sale_price'] or product['price'])
        )
        result['has_sale_price'] = bool(
            product['sale_price'] and float(product['sale_price']) < float(product['price'])
        )
        serialized.append(result)
    return serialized


@bp.get('')
def recommendations():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if user and user['role'] != 'user':
        user = None
    try:
        limit = int(request.args.get('limit', '8'))
    except (TypeError, ValueError):
        return jsonify(error='Limit must be a whole number.'), 400
    if limit < 1 or limit > 24:
        return jsonify(error='Limit must be between 1 and 24.'), 400

    ranked, personalized = get_recommendations(
        db, user['id'] if user else None, limit=limit,
    )
    response = jsonify(
        products=_serialize_recommended_products(db, ranked),
        personalized=personalized,
        strategy='personalized' if personalized else 'popular',
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@bp.post('/events')
def record_product_event():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not user:
        return jsonify(error='Sign in to record product preferences.'), 401
    if not role_allowed(user, ['user']):
        return jsonify(error='Customer account required.'), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error='A JSON event payload is required.'), 400
    product_id = body.get('productId')
    event_type = body.get('eventType')
    if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id < 1:
        return jsonify(error='A valid productId is required.'), 400
    if event_type not in ALLOWED_EVENTS:
        return jsonify(error='Unsupported product event.'), 400

    product = query_one(db, 'SELECT id FROM products WHERE id = ? AND stock > 0', (product_id,))
    if not product:
        return jsonify(error='Available product not found.'), 404

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    hour_ago = (now - timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
    recent_count = query_one(
        db,
        'SELECT COUNT(*) AS event_count FROM user_product_events WHERE user_id = ? AND created_at >= ?',
        (user['id'], hour_ago),
    )['event_count']
    if recent_count >= EVENTS_PER_HOUR_LIMIT:
        return jsonify(error='Too many product events. Please try again later.'), 429

    if event_type in {'view', 'recommendation_view'}:
        dedupe_since = (now - timedelta(hours=VIEW_DEDUPE_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
        existing = query_one(
            db,
            '''SELECT id FROM user_product_events
               WHERE user_id = ? AND product_id = ? AND event_type = ? AND created_at >= ?
               LIMIT 1''',
            (user['id'], product_id, event_type, dedupe_since),
        )
        if existing:
            return jsonify(tracked=False), 200

    execute(
        db,
        'INSERT INTO user_product_events (user_id, product_id, event_type) VALUES (?, ?, ?)',
        (user['id'], product_id, event_type),
    )
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(tracked=True), 201

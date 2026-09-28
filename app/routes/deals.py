from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from app.db import execute, query_all, query_one
from app.deal_utils import db_datetime, deal_status, parse_deal_datetime, serialize_deal
from app.sessions import get_session_user, role_allowed

bp = Blueprint('deals', __name__)
MANAGE_ROLES = ['admin', 'manager', 'employee']


def require_manager(db, request):
    user = get_session_user(db, request)
    return user if role_allowed(user, MANAGE_ROLES) else None


def validate_deal_body(db, body, existing=None):
    product_id = body.get('product_id', existing['product_id'] if existing else None)
    discount_type = body.get('discount_type', existing['discount_type'] if existing else None)
    discount_value = body.get('discount_value', existing['discount_value'] if existing else None)
    start_value = body.get('start_date', existing['start_date'] if existing else None)
    end_value = body.get('end_date', existing['end_date'] if existing else None)
    if not product_id or discount_type not in {'percentage', 'fixed'}:
        raise ValueError('Choose an existing product and a valid discount type.')
    try:
        product_id = int(product_id)
        discount_value = float(discount_value)
    except (TypeError, ValueError) as exc:
        raise ValueError('Discount value must be a valid number.') from exc
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not product:
        raise ValueError('Product not found.')
    if discount_value <= 0:
        raise ValueError('Discount value must be greater than zero.')
    if discount_type == 'percentage' and discount_value > 100:
        raise ValueError('Percentage discount cannot exceed 100%.')
    if discount_type == 'fixed' and discount_value >= float(product['price']):
        raise ValueError('Fixed discount must be less than the product price.')
    start_date = parse_deal_datetime(start_value)
    end_date = parse_deal_datetime(end_value)
    if end_date <= start_date:
        raise ValueError('Deal expiry must be after the start date.')
    return product_id, discount_type, discount_value, db_datetime(start_date), db_datetime(end_date), product


def admin_deal(deal):
    product = query_one(current_app.get_db(), 'SELECT * FROM products WHERE id = ?', (deal['product_id'],))
    return serialize_deal(deal, product)


def campaign_status(campaign, now=None):
    now = now or datetime.utcnow()
    if not campaign['is_active']:
        return 'disabled'
    start = datetime.fromisoformat(str(campaign['start_date']))
    end = datetime.fromisoformat(str(campaign['end_date'])) if campaign.get('end_date') else None
    if now < start:
        return 'scheduled'
    if end and now >= end:
        return 'expired'
    return 'active'


def serialize_campaign(campaign, now=None):
    result = dict(campaign)
    for key in ('start_date', 'end_date', 'created_at', 'updated_at'):
        value = result.get(key)
        if hasattr(value, 'strftime'):
            result[key] = value.strftime('%Y-%m-%d %H:%M:%S')
    result['is_active'] = bool(campaign['is_active'])
    result['status'] = campaign_status(campaign, now)
    return result


def validate_campaign_body(body, existing=None):
    body = body or {}
    required = ['title', 'description', 'end_date']
    if any(not str(body.get(key, existing.get(key, '') if existing else '')).strip() for key in required):
        raise ValueError('Title, description and start date are required.')
    title = str(body.get('title', existing['title'] if existing else '')).strip()
    description = str(body.get('description', existing['description'] if existing else '')).strip()
    badge = str(body.get('badge', existing.get('badge') if existing else '') or '').strip()
    button_text = str(body.get('button_text', existing.get('button_text', 'Shop Now') if existing else 'Shop Now') or 'Shop Now').strip()
    button_url = str(body.get('button_url', existing.get('button_url', 'index.html') if existing else 'index.html') or 'index.html').strip()
    image = str(body.get('image', existing.get('image') if existing else '') or '').strip()
    if len(title) > 255 or len(button_text) > 80:
        raise ValueError('Title or button text is too long.')
    if button_url.lower().startswith(('javascript:', 'data:', 'vbscript:')):
        raise ValueError('Button link is not allowed.')
    start_value = body.get('start_date', existing['start_date'] if existing else None)
    start = parse_deal_datetime(start_value) if start_value else datetime.utcnow()
    end_value = body.get('end_date', existing.get('end_date') if existing else None)
    end = parse_deal_datetime(end_value)
    if end and end <= start:
        raise ValueError('Expiry must be after the start date.')
    active_value = body.get('is_active', existing['is_active'] if existing else True)
    return title, description, badge, button_text, button_url, image, db_datetime(start), db_datetime(end) if end else None, int(bool(active_value))


@bp.get('/api/deals')
def public_deals():
    db = current_app.get_db()
    now = datetime.utcnow()
    rows = query_all(db, 'SELECT d.*, p.id AS p_id FROM deals d JOIN products p ON p.id = d.product_id')
    deals = []
    for row in rows:
        if deal_status(row, now) == 'active':
            product = query_one(db, 'SELECT * FROM products WHERE id = ?', (row['product_id'],))
            deals.append(serialize_deal(row, product, now))
    return jsonify(deals=deals)


@bp.get('/api/deal-campaigns')
def public_campaigns():
    db = current_app.get_db()
    now = datetime.utcnow()
    rows = query_all(db, 'SELECT * FROM deal_campaigns ORDER BY end_date IS NULL, end_date ASC, created_at DESC')
    return jsonify(campaigns=[serialize_campaign(row, now) for row in rows if campaign_status(row, now) == 'active'])


@bp.get('/api/admin/deal-campaigns')
def list_campaigns():
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    now = datetime.utcnow()
    rows = query_all(db, 'SELECT * FROM deal_campaigns ORDER BY created_at DESC')
    return jsonify(campaigns=[serialize_campaign(row, now) for row in rows])


@bp.post('/api/admin/deal-campaigns')
def create_campaign():
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    try:
        values = validate_campaign_body(request.get_json(silent=True))
        cur = execute(db, 'INSERT INTO deal_campaigns (title, description, badge, button_text, button_url, image, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?,?)', values)
        if hasattr(db, 'commit'):
            db.commit()
        return jsonify(campaign=serialize_campaign(query_one(db, 'SELECT * FROM deal_campaigns WHERE id = ?', (cur.lastrowid,)))), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        current_app.logger.exception('Could not create deal campaign')
        return jsonify(error='Could not create deal container right now.'), 500


@bp.put('/api/admin/deal-campaigns/<int:campaign_id>')
def update_campaign(campaign_id):
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT * FROM deal_campaigns WHERE id = ?', (campaign_id,))
    if not existing:
        return jsonify(error='Deal container not found.'), 404
    try:
        values = validate_campaign_body(request.get_json(silent=True), existing)
        execute(db, 'UPDATE deal_campaigns SET title=?, description=?, badge=?, button_text=?, button_url=?, image=?, start_date=?, end_date=?, is_active=?, updated_at=? WHERE id=?', values + (datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), campaign_id))
        if hasattr(db, 'commit'):
            db.commit()
        return jsonify(campaign=serialize_campaign(query_one(db, 'SELECT * FROM deal_campaigns WHERE id = ?', (campaign_id,))))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        current_app.logger.exception('Could not update deal campaign %s', campaign_id)
        return jsonify(error='Could not update deal container right now.'), 500


@bp.delete('/api/admin/deal-campaigns/<int:campaign_id>')
def delete_campaign(campaign_id):
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    campaign = query_one(db, 'SELECT id, title FROM deal_campaigns WHERE id = ?', (campaign_id,))
    if not campaign:
        return jsonify(error='Deal container not found.'), 404
    execute(db, 'DELETE FROM deal_campaigns WHERE id = ?', (campaign_id,))
    execute(db, 'INSERT INTO admin_notifications (notification_type, entity_id, message) VALUES (?,?,?)',
            ('deal_container_deleted', campaign_id, campaign['title']))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)


@bp.get('/api/deals/<int:deal_id>')
def public_deal(deal_id):
    db = current_app.get_db()
    deal = query_one(db, 'SELECT * FROM deals WHERE id = ?', (deal_id,))
    if not deal or deal_status(deal) != 'active':
        return jsonify(error='Deal not found or no longer active.'), 404
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (deal['product_id'],))
    return jsonify(deal=serialize_deal(deal, product))


@bp.get('/api/admin/deals')
def list_admin_deals():
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    rows = query_all(db, 'SELECT * FROM deals ORDER BY end_date DESC')
    return jsonify(deals=[admin_deal(row) for row in rows])


@bp.post('/api/admin/deals')
def create_deal():
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    try:
        product_id, discount_type, discount_value, start_date, end_date, product = validate_deal_body(db, request.get_json(silent=True) or {})
        if query_one(db, 'SELECT id FROM deals WHERE product_id = ?', (product_id,)):
            return jsonify(error='This product already has a deal. Edit the existing deal instead.'), 409
        cur = execute(db, 'INSERT INTO deals (product_id, discount_type, discount_value, start_date, end_date, is_active) VALUES (?,?,?,?,?,1)',
                      (product_id, discount_type, discount_value, start_date, end_date))
        if hasattr(db, 'commit'):
            db.commit()
        return jsonify(deal=admin_deal(query_one(db, 'SELECT * FROM deals WHERE id = ?', (cur.lastrowid,)))), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        db.rollback() if hasattr(db, 'rollback') else None
        current_app.logger.exception('Could not create deal')
        return jsonify(error='Could not create deal right now.'), 500


@bp.put('/api/admin/deals/<int:deal_id>')
def update_deal(deal_id):
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT * FROM deals WHERE id = ?', (deal_id,))
    if not existing:
        return jsonify(error='Deal not found.'), 404
    try:
        product_id, discount_type, discount_value, start_date, end_date, product = validate_deal_body(db, request.get_json(silent=True) or {}, existing)
        duplicate = query_one(db, 'SELECT id FROM deals WHERE product_id = ? AND id != ?', (product_id, deal_id))
        if duplicate:
            return jsonify(error='This product already has another deal.'), 409
        is_active = int(bool((request.get_json(silent=True) or {}).get('is_active', existing['is_active'])))
        execute(db, 'UPDATE deals SET product_id=?, discount_type=?, discount_value=?, start_date=?, end_date=?, is_active=?, updated_at=? WHERE id=?',
                (product_id, discount_type, discount_value, start_date, end_date, is_active, datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), deal_id))
        if hasattr(db, 'commit'):
            db.commit()
        return jsonify(deal=admin_deal(query_one(db, 'SELECT * FROM deals WHERE id = ?', (deal_id,))))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        current_app.logger.exception('Could not update deal %s', deal_id)
        return jsonify(error='Could not update deal right now.'), 500


@bp.delete('/api/admin/deals/<int:deal_id>')
def delete_deal(deal_id):
    db = current_app.get_db()
    if not require_manager(db, request):
        return jsonify(error='Admin access required.'), 403
    if not query_one(db, 'SELECT id FROM deals WHERE id = ?', (deal_id,)):
        return jsonify(error='Deal not found.'), 404
    execute(db, 'DELETE FROM deals WHERE id = ?', (deal_id,))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)
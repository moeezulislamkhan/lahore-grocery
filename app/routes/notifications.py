from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from app.db import execute, query_one
from app.sessions import get_session_user, role_allowed

bp = Blueprint('notifications', __name__)
STAFF_ROLES = ['admin', 'manager', 'staff', 'employee']


@bp.get('/api/admin/alerts')
def get_admin_alerts():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, STAFF_ROLES):
        return jsonify(error='Staff access required.'), 403

    latest_order = query_one(db, 'SELECT COALESCE(MAX(id), 0) AS id FROM orders')
    out_of_stock = query_one(db, 'SELECT COUNT(*) AS count FROM products WHERE stock <= 0')
    open_support = query_one(db, "SELECT COUNT(*) AS count FROM support_messages WHERE status = 'open'")
    deleted_deal_containers = query_one(db, """SELECT COUNT(*) AS count FROM admin_notifications
        WHERE notification_type = 'deal_container_deleted' AND read_at IS NULL""")
    return jsonify(alerts={
        'latest_order_id': latest_order['id'] if latest_order else 0,
        'out_of_stock_count': out_of_stock['count'] if out_of_stock else 0,
        'open_support_count': open_support['count'] if open_support else 0,
        'deleted_deal_container_count': deleted_deal_containers['count'] if deleted_deal_containers else 0,
    })


@bp.post('/api/admin/alerts/deals/seen')
def mark_deleted_deal_alerts_seen():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, STAFF_ROLES):
        return jsonify(error='Staff access required.'), 403

    read_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    execute(db, """UPDATE admin_notifications SET read_at = ?
        WHERE notification_type = 'deal_container_deleted' AND read_at IS NULL""", (read_at,))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)
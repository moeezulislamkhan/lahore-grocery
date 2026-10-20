# app/routes/analytics.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all
from app.sessions import get_session_user, role_allowed

bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')

@bp.get('/recommendations')
def recommendation_metrics():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin or manager access required.'), 403

    from datetime import datetime, timedelta, timezone

    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S')
    rows = query_all(db, """
        SELECT event_type, COUNT(*) AS event_count
        FROM user_product_events
        WHERE created_at >= ?
        GROUP BY event_type
    """, (since,))
    counts = {row['event_type']: int(row['event_count']) for row in rows}
    customers = query_one(
        db,
        'SELECT COUNT(DISTINCT user_id) AS customer_count FROM user_product_events WHERE created_at >= ?',
        (since,),
    )['customer_count']
    impression_pairs = query_one(db, """
        SELECT COUNT(*) AS pair_count
        FROM (
            SELECT user_id, product_id FROM user_product_events
            WHERE event_type = 'recommendation_view' AND created_at >= ?
            GROUP BY user_id, product_id
        ) AS impression_pairs
    """, (since,))['pair_count']
    converted_pairs = query_one(db, """
        SELECT COUNT(*) AS pair_count
        FROM (
            SELECT e.user_id, e.product_id
            FROM user_product_events e
            WHERE e.event_type = 'recommendation_add' AND e.created_at >= ?
            GROUP BY e.user_id, e.product_id
            HAVING EXISTS (
                SELECT 1 FROM user_product_events impression
                WHERE impression.user_id = e.user_id
                  AND impression.product_id = e.product_id
                  AND impression.event_type = 'recommendation_view'
                  AND impression.created_at >= ?
            )
        ) AS converted_pairs
    """, (since, since))['pair_count']
    top_products = query_all(db, """
        SELECT p.id, p.name, COUNT(*) AS recommendation_views
        FROM user_product_events e JOIN products p ON p.id = e.product_id
        WHERE e.event_type = 'recommendation_view' AND e.created_at >= ?
        GROUP BY p.id, p.name
        ORDER BY recommendation_views DESC, p.name
        LIMIT 5
    """, (since,))
    response = jsonify(
        periodDays=30,
        recommendationImpressions=counts.get('recommendation_view', 0),
        recommendationAdds=counts.get('recommendation_add', 0),
        recommendationAddRate=round(converted_pairs * 100 / impression_pairs, 1) if impression_pairs else 0,
        cartAdds=counts.get('cart_add', 0) + counts.get('recommendation_add', 0),
        engagedCustomers=int(customers),
        topViewedProducts=top_products,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@bp.get('/summary')
def summary():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin or manager access required.'), 403

    revenue = query_one(db, "SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE payment_status IN ('paid','cod_pending')")['v']
    order_count = query_one(db, 'SELECT COUNT(*) AS v FROM orders')['v']
    avg_order = (revenue / order_count) if order_count else 0
    customer_count = query_one(db, 'SELECT COUNT(DISTINCT phone) AS v FROM orders')['v']

    by_category = query_all(db, """
        SELECT p.category AS category, COALESCE(SUM(oi.qty * oi.unit_price),0) AS total
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        GROUP BY p.category
    """)
    by_payment = query_all(db, 'SELECT payment_method AS method, COUNT(*) AS count FROM orders GROUP BY payment_method')
    daily_revenue = query_all(db, """
        SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total
        FROM orders GROUP BY date(created_at) ORDER BY day DESC LIMIT 14
    """)
    daily_revenue = list(reversed(daily_revenue))
    top_products = query_all(db, """
        SELECT product_name AS name, SUM(qty) AS units, SUM(qty*unit_price) AS revenue
        FROM order_items GROUP BY product_name ORDER BY revenue DESC LIMIT 5
    """)

    return jsonify(
        revenue=revenue, orderCount=order_count, avgOrder=avg_order, customerCount=customer_count,
        byCategory=by_category, byPayment=by_payment, dailyRevenue=daily_revenue, topProducts=top_products,
    )

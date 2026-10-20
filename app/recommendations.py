"""Lightweight hybrid product recommendations based on catalog and user activity."""

from datetime import datetime, timedelta, timezone
from math import log1p

from app.db import query_all

SCORING_WEIGHTS = {
    'popularity': 0.20,
    'product_preference': 0.36,
    'category_affinity': 0.24,
    'co_purchase': 0.20,
}
EVENT_WEIGHTS = {
    'view': 0.6,
    'recommendation_view': 0.35,
    'cart_add': 2.5,
    'recommendation_add': 3.0,
}
MAX_CANDIDATES = 500
MAX_RELATED_SEEDS = 20


def _db_timestamp(value):
    return value.strftime('%Y-%m-%d %H:%M:%S')


def _recency_multiplier(value, now):
    if not value:
        return 0.5
    if isinstance(value, datetime):
        stamp = value
    else:
        try:
            stamp = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except ValueError:
            return 0.5
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone(timezone.utc).replace(tzinfo=None)
    age_days = max(0.0, (now - stamp).total_seconds() / 86400)
    return 1 / (1 + age_days / 45)


def _normalized(scores):
    maximum = max(scores.values(), default=0.0)
    if maximum <= 0:
        return {key: 0.0 for key in scores}
    return {key: value / maximum for key, value in scores.items()}


def rank_products(products, popularity, product_preference, category_affinity, co_purchase, personalized):
    """Rank candidates using normalized, explicit signals; input order breaks ties."""
    product_ids = [int(product['id']) for product in products]
    normalized_popularity = _normalized({key: popularity.get(key, 0.0) for key in product_ids})
    if not personalized:
        return sorted(products, key=lambda product: normalized_popularity[int(product['id'])], reverse=True)

    normalized_product = _normalized({key: product_preference.get(key, 0.0) for key in product_ids})
    normalized_category = _normalized({key: category_affinity.get(key, 0.0) for key in product_ids})
    normalized_related = _normalized({key: co_purchase.get(key, 0.0) for key in product_ids})

    def score(product):
        product_id = int(product['id'])
        return (
            SCORING_WEIGHTS['popularity'] * normalized_popularity[product_id]
            + SCORING_WEIGHTS['product_preference'] * normalized_product[product_id]
            + SCORING_WEIGHTS['category_affinity'] * normalized_category[product_id]
            + SCORING_WEIGHTS['co_purchase'] * normalized_related[product_id]
        )

    return sorted(products, key=score, reverse=True)


def _order_filters():
    return "o.payment_status IN ('paid','cod_pending') AND o.order_status NOT IN ('cancelled','returned')"


def get_recommendations(db, user_id=None, limit=8, now=None):
    """Build a small recommendation list with fixed-count SQL queries (no N+1 reads)."""
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    since = _db_timestamp(now - timedelta(days=180))
    popular_since = _db_timestamp(now - timedelta(days=30))
    products = query_all(
        db,
        'SELECT * FROM products WHERE stock > 0 ORDER BY created_at DESC, id DESC LIMIT ?',
        (MAX_CANDIDATES,),
    )
    if not products:
        return [], False

    sales_rows = query_all(db, f"""
        SELECT oi.product_id, SUM(oi.qty) AS units, COUNT(DISTINCT o.id) AS order_count
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id IS NOT NULL AND {_order_filters()}
        GROUP BY oi.product_id
    """)
    view_rows = query_all(db, """
        SELECT product_id, COUNT(*) AS view_count
        FROM user_product_events
        WHERE event_type IN ('view','recommendation_view') AND created_at >= ?
        GROUP BY product_id
    """, (popular_since,))

    popularity = {}
    for row in sales_rows:
        product_id = int(row['product_id'])
        popularity[product_id] = log1p(float(row['units'] or 0)) * 0.8 + log1p(float(row['order_count'] or 0)) * 0.6
    for row in view_rows:
        product_id = int(row['product_id'])
        popularity[product_id] = popularity.get(product_id, 0.0) + log1p(float(row['view_count'] or 0)) * 0.25

    product_preference = {}
    category_affinity = {}
    co_purchase = {}
    personalized = False
    purchased_products = []

    if user_id is not None:
        event_rows = query_all(db, """
            SELECT e.product_id, e.event_type, COUNT(*) AS event_count,
                   MAX(e.created_at) AS last_seen, p.category
            FROM user_product_events e
            JOIN products p ON p.id = e.product_id
            WHERE e.user_id = ? AND e.created_at >= ?
            GROUP BY e.product_id, e.event_type, p.category
        """, (user_id, since))
        purchase_rows = query_all(db, f"""
            SELECT oi.product_id, SUM(oi.qty) AS units, COUNT(DISTINCT o.id) AS order_count,
                   SUM(oi.qty * oi.unit_price) AS spend, MAX(o.created_at) AS last_purchased,
                   p.category
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE o.user_id = ? AND oi.product_id IS NOT NULL AND {_order_filters()}
            GROUP BY oi.product_id, p.category
        """, (user_id,))
        for row in event_rows:
            product_id = int(row['product_id'])
            amount = (
                EVENT_WEIGHTS.get(row['event_type'], 0.0)
                * int(row['event_count'])
                * _recency_multiplier(row['last_seen'], now)
            )
            product_preference[product_id] = product_preference.get(product_id, 0.0) + amount
            if row['category']:
                category_affinity[row['category']] = category_affinity.get(row['category'], 0.0) + amount

        for row in purchase_rows:
            product_id = int(row['product_id'])
            amount = (
                3.5 * float(row['units'] or 0)
                + 1.5 * int(row['order_count'] or 0)
                + 0.15 * log1p(float(row['spend'] or 0) / 1000)
            ) * _recency_multiplier(row['last_purchased'], now)
            product_preference[product_id] = product_preference.get(product_id, 0.0) + amount
            if row['category']:
                category_affinity[row['category']] = category_affinity.get(row['category'], 0.0) + amount
            purchased_products.append(product_id)

        personalized = bool(event_rows or purchase_rows)

        seeds = purchased_products[:MAX_RELATED_SEEDS]
        if seeds:
            placeholders = ','.join('?' for _ in seeds)
            related_rows = query_all(db, f"""
                SELECT related.product_id, COUNT(DISTINCT seed.order_id) AS co_order_count
                FROM order_items seed
                JOIN order_items related ON related.order_id = seed.order_id
                    AND related.product_id IS NOT NULL AND related.product_id <> seed.product_id
                JOIN orders o ON o.id = seed.order_id
                WHERE o.user_id = ? AND seed.product_id IN ({placeholders})
                    AND {_order_filters()}
                GROUP BY related.product_id
            """, (user_id, *seeds))
            co_purchase = {
                int(row['product_id']): float(row['co_order_count'])
                for row in related_rows
            }

    product_affinity = {
        int(product['id']): product_preference.get(int(product['id']), 0.0)
        for product in products
    }
    category_product_affinity = {
        int(product['id']): category_affinity.get(product['category'], 0.0)
        for product in products
    }
    ranked = rank_products(
        products, popularity, product_affinity, category_product_affinity,
        co_purchase, personalized,
    )[:limit]
    return ranked, personalized

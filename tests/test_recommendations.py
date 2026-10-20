from uuid import uuid4

from app import create_app
from app.auth import hash_password
from app.db import execute, query_one
from app.recommendations import rank_products


def _create_customer_and_products(db):
    suffix = uuid4().hex
    email = f'recommendation-{suffix}@example.test'
    user_cursor = execute(
        db,
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ('Recommendation Test', email, hash_password('RecommendationTest123!'), 'user'),
    )
    product_ids = []
    for name, category, stock in (
        (f'Preference Product {suffix}', f'Preference Category {suffix}', 10),
        (f'Related Product {suffix}', f'Related Category {suffix}', 10),
        (f'Unavailable Product {suffix}', f'Unavailable Category {suffix}', 0),
    ):
        cursor = execute(
            db,
            'INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)',
            (name, category, 100, stock),
        )
        product_ids.append(cursor.lastrowid)
    if hasattr(db, 'commit'):
        db.commit()
    return user_cursor.lastrowid, email, product_ids


def _delete_test_data(app, user_id, product_ids, order_ids=()):
    with app.app_context():
        db = app.get_db()
        for order_id in order_ids:
            execute(db, 'DELETE FROM order_items WHERE order_id = ?', (order_id,))
            execute(db, 'DELETE FROM orders WHERE id = ?', (order_id,))
        execute(db, 'DELETE FROM users WHERE id = ?', (user_id,))
        for product_id in product_ids:
            execute(db, 'DELETE FROM products WHERE id = ?', (product_id,))
        if hasattr(db, 'commit'):
            db.commit()


def test_rank_products_uses_preference_and_cold_start_popularity():
    products = [{'id': 1}, {'id': 2}]

    personalized = rank_products(
        products,
        popularity={2: 1},
        product_preference={1: 1},
        category_affinity={1: 1},
        co_purchase={},
        personalized=True,
    )
    cold_start = rank_products(
        products,
        popularity={2: 1},
        product_preference={},
        category_affinity={},
        co_purchase={},
        personalized=False,
    )

    assert [product['id'] for product in personalized] == [1, 2]
    assert [product['id'] for product in cold_start] == [2, 1]


def test_recommendation_api_tracks_private_events_and_uses_cold_start():
    app = create_app()
    with app.app_context():
        user_id, email, product_ids = _create_customer_and_products(app.get_db())
    client = app.test_client()
    order_ids = []
    tokens = []

    try:
        anonymous = client.get('/api/recommendations?limit=24')
        assert anonymous.status_code == 200
        assert anonymous.get_json()['personalized'] is False
        assert all(product['stock'] > 0 for product in anonymous.get_json()['products'])
        assert client.get('/api/analytics/recommendations').status_code == 403
        assert client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[0], 'eventType': 'view'},
        ).status_code == 401

        login = client.post(
            '/api/auth/login',
            json={'email': email, 'password': 'RecommendationTest123!'},
        )
        assert login.status_code == 200
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        tokens.append(login.get_json()['token'])

        invalid = client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[0], 'eventType': 'search'},
            headers=headers,
        )
        assert invalid.status_code == 400
        unavailable = client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[2], 'eventType': 'view'},
            headers=headers,
        )
        assert unavailable.status_code == 404

        tracked = client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[0], 'eventType': 'recommendation_view'},
            headers=headers,
        )
        duplicate = client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[0], 'eventType': 'recommendation_view'},
            headers=headers,
        )
        assert tracked.status_code == 201
        assert duplicate.status_code == 200
        assert duplicate.get_json()['tracked'] is False
        recommendation_add = client.post(
            '/api/recommendations/events',
            json={'productId': product_ids[0], 'eventType': 'recommendation_add'},
            headers=headers,
        )
        assert recommendation_add.status_code == 201

        personalized = client.get('/api/recommendations?limit=24', headers=headers)
        payload = personalized.get_json()
        assert personalized.status_code == 200
        assert payload['personalized'] is True
        assert payload['products'][0]['id'] == product_ids[0]
        assert product_ids[2] not in [product['id'] for product in payload['products']]
        assert client.get('/api/recommendations?limit=0').status_code == 400

        admin_login = client.post(
            '/api/auth/login',
            json={'email': 'shakarganj@gmail.com', 'password': '11223344'},
        )
        assert admin_login.status_code == 200
        tokens.append(admin_login.get_json()['token'])
        analytics = client.get(
            '/api/analytics/recommendations',
            headers={'Authorization': f"Bearer {admin_login.get_json()['token']}"},
        )
        assert analytics.status_code == 200
        assert analytics.headers['Cache-Control'] == 'private, no-store'
        assert 'user_id' not in analytics.get_json()
        assert analytics.get_json()['recommendationImpressions'] >= 1
        assert analytics.get_json()['recommendationAddRate'] > 0

        with app.app_context():
            db = app.get_db()
            purchased_order = execute(
                db,
                """INSERT INTO orders
                   (order_code, user_id, customer_name, phone, address, city, subtotal, total,
                    payment_method, payment_status, order_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    f'RECOMMENDATION-{uuid4().hex[:12]}', user_id, 'Recommendation Test',
                    '03000000000', 'Test address', 'Lahore', 200, 200,
                    'cod', 'cod_pending', 'confirmed',
                ),
            )
            order_id = purchased_order.lastrowid
            order_ids.append(order_id)
            for product_id in product_ids[:2]:
                product = query_one(db, 'SELECT name FROM products WHERE id = ?', (product_id,))
                execute(
                    db,
                    """INSERT INTO order_items
                       (order_id, product_id, product_name, unit_price, qty, line_total)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (order_id, product_id, product['name'], 100, 1, 100),
                )
            if hasattr(db, 'commit'):
                db.commit()

        after_purchase = client.get('/api/recommendations?limit=24', headers=headers).get_json()
        recommended_ids = [product['id'] for product in after_purchase['products']]
        assert after_purchase['personalized'] is True
        assert product_ids[0] in recommended_ids
        assert product_ids[1] in recommended_ids
    finally:
        for token in tokens:
            client.post('/api/auth/logout', headers={'Authorization': f'Bearer {token}'})
        _delete_test_data(app, user_id, product_ids, order_ids)

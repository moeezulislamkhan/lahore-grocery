# app/routes/orders.py
import secrets
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed
from app.payments_jazzcash import build_checkout_form
from app.deal_utils import active_deal_for_product

bp = Blueprint('orders', __name__, url_prefix='/api/orders')

VALID_METHODS = {'jazzcash', 'bank', 'cod'}
VALID_STATUSES = ['processing', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled']


def generate_order_code():
    return 'SG-' + datetime.now().strftime('%y%m%d%H%M%S') + '-' + secrets.token_hex(2).upper()


@bp.post('')
def create_order():
    db = current_app.get_db()
    body = request.get_json(silent=True) or {}
    customer_name, phone, address = body.get('customerName'), body.get('phone'), body.get('address')
    city, delivery_slot = body.get('city'), body.get('deliverySlot')
    items, payment_method = body.get('items'), body.get('paymentMethod')

    if not customer_name or not phone or not address:
        return jsonify(error='customerName, phone and address are required.'), 400
    if city and city.strip().lower() != 'lahore':
        return jsonify(error='We currently deliver only within Lahore.'), 400
    city = 'Lahore'
    if not items or not isinstance(items, list):
        return jsonify(error='Cart is empty.'), 400
    if payment_method not in VALID_METHODS:
        return jsonify(error='Invalid payment method.'), 400

    session_user = get_session_user(db, request)  # None for guest checkout — that's fine

    # Recompute prices server-side — never trust client-sent prices.
    subtotal = 0.0
    resolved_items = []
    for item in items:
        product = query_one(db, 'SELECT * FROM products WHERE id = ?', (item.get('productId'),))
        if not product:
            return jsonify(error=f"Product {item.get('productId')} not found."), 400
        qty = max(1, int(item.get('qty') or 1))
        deal = active_deal_for_product(db, product['id'])
        unit_price = deal['final_price'] if deal else float(product['sale_price'] or product['price'])
        subtotal += unit_price * qty
        resolved_items.append((product, qty))

    delivery_fee = 0.0 if subtotal > 2000 else 150.0
    total = subtotal + delivery_fee
    order_code = generate_order_code()
    payment_status = 'cod_pending' if payment_method == 'cod' else 'pending'

    cur = execute(db, """INSERT INTO orders
        (order_code, user_id, customer_name, phone, address, city, delivery_slot, subtotal, delivery_fee, total, payment_method, payment_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (order_code, session_user['id'] if session_user else None, customer_name, phone, address, city,
         delivery_slot, subtotal, delivery_fee, total, payment_method, payment_status))
    order_id = cur.lastrowid

    for product, qty in resolved_items:
        deal = active_deal_for_product(db, product['id'])
        unit_price = deal['final_price'] if deal else float(product['sale_price'] or product['price'])
        execute(db, 'INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty) VALUES (?,?,?,?,?)',
                (order_id, product['id'], product['name'], unit_price, qty))
        execute(db, 'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', (qty, product['id']))

    if payment_method == 'cod':
        execute(db, "UPDATE orders SET order_status = 'confirmed' WHERE id = ?", (order_id,))
        if hasattr(db, 'commit'):
            db.commit()
        return jsonify(orderCode=order_code, paymentMethod=payment_method, paymentStatus='cod_pending',
                        message='Order confirmed — pay cash on delivery.'), 201

    if payment_method == 'bank':
        if hasattr(db, 'commit'):
            db.commit()
        store_name = query_one(db, "SELECT value FROM settings WHERE setting_key = ?", ('store_name',))
        bank_name = query_one(db, "SELECT value FROM settings WHERE setting_key = ?", ('bank_name',))
        bank_iban = query_one(db, "SELECT value FROM settings WHERE setting_key = ?", ('bank_iban',))
        return jsonify(orderCode=order_code, paymentMethod=payment_method, paymentStatus='pending',
                        bankInstructions={
                            'accountTitle': store_name['value'] if store_name else 'Shakarganj Grocery Store',
                            'bank': bank_name['value'] if bank_name else 'Meezan Bank',
                            'iban': bank_iban['value'] if bank_iban else 'PK00 MEZN 0000 0000 1234 567',
                        }), 201

    # JazzCash — build the Hosted Checkout Page form.
    checkout = build_checkout_form(
        order_code=order_code,
        amount_pkr=total,
        bill_reference=order_code,
        description=f'Shakarganj order {order_code}',
        base_url=request.host_url.rstrip('/'),  # auto-detects whatever host/port this request actually came in on
    )
    execute(db, 'UPDATE orders SET gateway = ?, gateway_txn_ref = ? WHERE id = ?', ('jazzcash', checkout['txn_ref_no'], order_id))
    execute(db, 'INSERT INTO jazzcash_transactions (txn_ref_no, order_id) VALUES (?, ?)', (checkout['txn_ref_no'], order_id))
    if hasattr(db, 'commit'):
        db.commit()

    return jsonify(
        orderCode=order_code,
        paymentMethod=payment_method,
        paymentStatus='pending',
        gatewayLive=checkout['live'],
        amountPkr=round(total, 2),  # human-readable rupees — JazzCash's own pp_Amount field must stay in paisa (their API requirement)
        jazzcash={'actionUrl': checkout['action_url'], 'fields': checkout['fields']},
    ), 201


@bp.get('')
def list_all_orders():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Staff access required.'), 403
    orders = query_all(db, 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')
    return jsonify(orders=orders)


@bp.get('/mine')
def list_my_orders():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not user:
        return jsonify(error='Please sign in to view your orders.'), 401
    orders = query_all(db, 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', (user['id'],))
    return jsonify(orders=orders)


@bp.get('/<code>')
def get_order(code):
    db = current_app.get_db()
    order = query_one(db, 'SELECT * FROM orders WHERE order_code = ?', (code,))
    if not order:
        return jsonify(error='Order not found.'), 404
    items = query_all(db, 'SELECT * FROM order_items WHERE order_id = ?', (order['id'],))
    return jsonify(order=order, items=items)


@bp.patch('/<int:order_id>/status')
def update_order_status(order_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Staff access required.'), 403
    body = request.get_json(silent=True) or {}
    status = body.get('status')
    if status not in VALID_STATUSES:
        return jsonify(error='Invalid status.'), 400
    execute(db, 'UPDATE orders SET order_status = ? WHERE id = ?', (status, order_id))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)

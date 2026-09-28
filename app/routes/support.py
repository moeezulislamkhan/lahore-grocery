# app/routes/support.py
import re
import os
import smtplib
from email.message import EmailMessage

from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed

bp = Blueprint('support', __name__, url_prefix='/api/support')

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

FAQS = [
    {'id': 'delivery-areas', 'q': 'What areas of Lahore do you deliver to?',
     'a': 'We deliver across Lahore. Enter your complete Lahore address at checkout so we can confirm the delivery details.'},
    {'id': 'delivery-time', 'q': 'What are your delivery timings?',
     'a': 'Orders placed before 6 PM are prepared for same-day delivery when a same-day slot is available. Checkout shows the available delivery slot.'},
    {'id': 'place-order', 'q': 'How can I place a grocery order?',
     'a': 'Add products to your cart, open checkout, enter your Lahore delivery details, choose a payment method, and select Place Order.'},
    {'id': 'payment-methods', 'q': 'What payment methods do you accept?',
     'a': 'JazzCash, Bank Transfer and Cash on Delivery are available. JazzCash payments are processed through its secure Hosted Checkout Page.'},
    {'id': 'cod', 'q': 'Is Cash on Delivery available?',
     'a': 'Yes. Choose Cash on Delivery at checkout and pay the rider when your Lahore order arrives.'},
    {'id': 'min-order', 'q': 'Is there a minimum order amount?',
     'a': 'There\u2019s no minimum order amount, but orders above Rs. 2,000 get free delivery. Orders below that have a flat Rs. 150 delivery fee.'},
    {'id': 'track-order', 'q': 'How do I track my order?',
        'a': 'You\u2019ll receive an order code right after checkout. Sign in and check My Orders for its status, or contact support with the code.'},
        {'id': 'out-of-stock', 'q': 'What happens if a product is out of stock?',
        'a': 'The product cannot be added while it is out of stock. Please check back later or choose an available alternative.'},
        {'id': 'cancel-order', 'q': 'Can I cancel my order?',
        'a': 'Contact support with your order code as soon as possible. We can request cancellation while the order has not left our store.'},
    {'id': 'returns', 'q': 'What if an item arrives damaged or wrong?',
        'a': 'Contact support within 24 hours with your order code and a photo. We will review the issue and arrange the appropriate replacement or refund.'},
        {'id': 'refunds', 'q': 'How do refunds work?',
        'a': 'Approved refunds are returned through the original payment method where possible. Support will confirm the next steps after reviewing your request.'},
        {'id': 'freshness', 'q': 'How do you maintain product freshness and quality?',
        'a': 'We source fresh items regularly, check products while packing, and use appropriate handling for grocery orders.'},
        {'id': 'support', 'q': 'How can I contact customer support?',
        'a': 'Open the Help & Support button, choose Ask a question, and send your details. Your support form ID confirms the message was received.'},
    {'id': 'jazzcash-safety', 'q': 'Is paying with JazzCash safe on this site?',
     'a': 'Yes \u2014 you\u2019re redirected to JazzCash\u2019s own secure Hosted Checkout Page to enter your MPIN or card details. We never see or store that information.'},
    {'id': 'change-cancel', 'q': 'Can I change or cancel my order after placing it?',
     'a': 'Yes \u2014 as long as it hasn\u2019t left our store yet. Contact support with your order code as soon as possible and we\u2019ll update or cancel it for you.'},
]


@bp.get('/faqs')
def faqs():
    return jsonify(faqs=FAQS)


@bp.post('/message')
def send_message():
    body = request.get_json(silent=True) or {}
    name, email, topic, message = body.get('name'), body.get('email'), body.get('topic'), body.get('message')
    if not name or not email or not message:
        return jsonify(error='Name, email and message are required.'), 400
    if not EMAIL_RE.match(email):
        return jsonify(error='Please enter a valid email address.'), 400

    db = current_app.get_db()
    cur = execute(db, 'INSERT INTO support_messages (name, email, topic, message) VALUES (?,?,?,?)',
                  (name.strip(), email.strip(), topic, message.strip()))
    from datetime import datetime
    form_id = f"FORM-LHR-{datetime.now().strftime('%Y%m%d')}-{cur.lastrowid:04d}"
    execute(db, 'UPDATE support_messages SET form_id = ? WHERE id = ?', (form_id, cur.lastrowid))
    if hasattr(db, 'commit'):
        db.commit()
    try:
        send_submission_email(form_id, name.strip(), email.strip(), topic, message.strip())
    except Exception:
        return jsonify(error='Your message was saved, but email delivery failed. Please contact support again.', formId=form_id), 502
    return jsonify(success=True, formId=form_id, ticketId='HLP-' + str(cur.lastrowid).zfill(4), message='Thanks — our support team will get back to you within a few hours.'), 201


def send_submission_email(form_id, name, email, topic, message):
    host = os.environ.get('SMTP_HOST')
    recipient = os.environ.get('FORM_RECIPIENT_EMAIL')
    if not host or not recipient:
        return False
    mail = EmailMessage()
    mail['Subject'] = f'Shakarganj support submission {form_id}'
    mail['From'] = os.environ.get('MAIL_FROM', os.environ.get('SMTP_USERNAME', recipient))
    mail['To'] = recipient
    mail.set_content(f'Form ID: {form_id}\nName: {name}\nEmail: {email}\nTopic: {topic or "General"}\n\nMessage:\n{message}')
    port = int(os.environ.get('SMTP_PORT', '587'))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if os.environ.get('SMTP_STARTTLS', 'true').lower() == 'true':
            smtp.starttls()
        username = os.environ.get('SMTP_USERNAME')
        if username:
            smtp.login(username, os.environ.get('SMTP_PASSWORD', ''))
        smtp.send_message(mail)


@bp.get('/messages')
def list_messages():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Staff access required.'), 403
    messages = query_all(db, 'SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 100')
    return jsonify(messages=messages)


@bp.patch('/messages/<int:message_id>/resolve')
def resolve_message(message_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Staff access required.'), 403
    execute(db, "UPDATE support_messages SET status='resolved' WHERE id=?", (message_id,))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)

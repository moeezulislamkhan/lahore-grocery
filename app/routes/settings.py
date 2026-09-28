# app/routes/settings.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed

bp = Blueprint('settings', __name__, url_prefix='/api/settings')


# Publicly readable subset of settings — no login required. This is what the
# storefront footer calls so the Contact Number (and other footer info
# that's controlled through Settings) always matches whatever the admin last
# saved on the Settings page, instead of being hard-coded in the HTML.
@bp.get('/public')
def get_public_settings():
    db = current_app.get_db()
    rows = query_all(db, 'SELECT * FROM settings')
    values = {row['setting_key']: row['value'] for row in rows}
    return jsonify(settings={
        'store_name': values.get('store_name') or 'Shakarganj Grocery Store',
        'support_phone': values.get('support_phone') or '+92 300 1234567',
        'support_email': values.get('support_email') or 'orders@shakarganj.pk',
        'whatsapp_number': values.get('whatsapp_number') or '',
        'bank_iban': values.get('bank_iban') or 'PK00 MEZN 0000 0000 1234 567',
        'bank_name': values.get('bank_name') or 'Meezan Bank',
    })


@bp.get('')
def get_settings():
    """Get all settings (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    settings = query_all(db, 'SELECT * FROM settings WHERE setting_key IN (?, ?, ?)',
                         ('support_phone', 'support_email', 'theme'))
    result = {}
    for setting in settings:
        result[setting['setting_key']] = setting['value']
    return jsonify(settings=result)


@bp.put('')
def update_settings():
    """Update settings (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    body = request.get_json(silent=True) or {}

    allowed_keys = {'support_phone', 'support_email'}
    for key in body:
        if key not in allowed_keys:
            continue
        value = str(body.get(key, '')).strip()
        if not value:
            return jsonify(error=f'{key} is required.'), 400

    # Contact settings persist; the optional theme is intentionally handled
    # in the admin browser session so the primary maroon theme stays intact.
    for key, value in body.items():
        if key not in allowed_keys:
            continue
        existing = query_one(db, 'SELECT setting_key FROM settings WHERE setting_key = ?', (key,))
        if existing:
            execute(db, 'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
                    (value, key))
        else:
            execute(db, 'INSERT INTO settings (setting_key, value) VALUES (?, ?)',
                    (key, value))

    if hasattr(db, 'commit'):
        db.commit()

    return jsonify(success=True)

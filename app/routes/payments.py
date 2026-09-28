# app/routes/payments.py
from flask import Blueprint, request, jsonify, redirect, render_template_string, current_app

from app.db import query_one, execute
from app.payments_jazzcash import verify_response, response_code_to_status, is_live_mode

bp = Blueprint('payments', __name__, url_prefix='/api/payments')


@bp.get('/mode')
def mode():
    return jsonify(live=is_live_mode(), gateway='jazzcash')


# Sandbox stand-in for JazzCash's real Hosted Checkout Page. Only reachable
# when no live JazzCash credentials are configured (see payments_jazzcash.py)
# — receives the exact same pp_* fields a real JazzCash submission would
# carry, displays them, and lets you simulate a successful or failed payment
# so the full checkout flow can be demoed end-to-end with no live account.
MOCK_CHECKOUT_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sandbox Checkout Simulation — Shakarganj</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>
  body{ background:var(--paper); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
  .mock-card{ background:var(--white); border-radius:22px; padding:40px; max-width:440px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.12); text-align:center; }
  .mock-card .badge{ display:inline-block; background:var(--maroon-tint); color:var(--maroon); font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:700; padding:5px 12px; border-radius:999px; margin-bottom:18px; letter-spacing:0.04em; }
  .mock-card h2{ font-size:20px; margin-bottom:6px; }
  .mock-card .sub{ font-size:12.5px; color:var(--ink-soft); margin-bottom:20px; }
  .mock-amount{ font-family:'IBM Plex Mono',monospace; font-size:32px; font-weight:600; color:var(--maroon); margin:14px 0; }
  .mock-row{ display:flex; justify-content:space-between; font-size:12.5px; color:var(--ink-soft); padding:8px 0; border-bottom:1px dashed var(--line); text-align:left; }
  .mock-fields{ text-align:left; background:var(--paper); border-radius:10px; padding:12px 14px; margin-top:16px; font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:var(--ink-soft); max-height:140px; overflow-y:auto; }
  .mock-actions{ display:flex; flex-direction:column; gap:10px; margin-top:22px; }
  .mock-actions .btn.fail{ background:#B3261E; box-shadow:none; }
  .mock-actions .btn.fail:hover{ background:#8f1e17; }
  .mock-note{ font-size:11px; color:var(--ink-soft); margin-top:16px; line-height:1.6; }
</style>
</head>
<body>
  <div class="mock-card">
    <div class="badge">SANDBOX SIMULATION — NOT A REAL PAYMENT</div>
    <h2>Complete your JazzCash payment</h2>
    <div class="sub">This page stands in for JazzCash's real Hosted Checkout Page.</div>
    <div class="mock-amount">Rs. {{ amount_pkr }}</div>
    <div class="mock-row"><span>Order</span><span>{{ order_code }}</span></div>
    <div class="mock-row"><span>Txn Ref (pp_TxnRefNo)</span><span>{{ txn_ref_no }}</span></div>
    <div class="mock-fields">{% for k, v in fields.items() %}{{ k }} = {{ v }}{% if k == 'pp_Amount' %} <span style="color:var(--maroon);">(= Rs. {{ amount_pkr }})</span>{% endif %}<br>{% endfor %}</div>
    <div class="mock-actions">
      <button class="btn" onclick="finish('succeeded')">Simulate successful payment</button>
      <button class="btn fail" onclick="finish('failed')">Simulate failed payment</button>
    </div>
    <p class="mock-note">These are the exact pp_* fields (including pp_SecureHash) that would be POSTed to JazzCash's real sandbox/production endpoint. <b>pp_Amount is intentionally in paisa</b> (JazzCash's own API requirement — 100 paisa = Rs. 1), shown converted to rupees above and next to the field itself. Add real JAZZCASH_MERCHANT_ID / JAZZCASH_PASSWORD / JAZZCASH_INTEGRITY_SALT to .env to send customers here for real instead.</p>
  </div>
<script>
async function finish(outcome) {
  try {
    await fetch('/api/payments/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderCode: {{ order_code|tojson }}, outcome, txnRefNo: {{ txn_ref_no|tojson }} }),
    });
  } catch (e) { /* best-effort in sandbox mode */ }
  location.href = '/order-confirmation.html?order=' + encodeURIComponent({{ order_code|tojson }});
}
</script>
</body>
</html>"""


@bp.post('/mock-checkout')
def mock_checkout():
    fields = request.form.to_dict()
    amount_paisa = int(fields.get('pp_Amount', '0') or '0')
    return render_template_string(
        MOCK_CHECKOUT_HTML,
        fields=fields,
        amount_pkr=f'{amount_paisa / 100:,.0f}',
        order_code=fields.get('ppmpf_1', fields.get('pp_BillReference', '')),
        txn_ref_no=fields.get('pp_TxnRefNo', ''),
    )


# JazzCash redirects the customer's browser back here (as pp_ReturnURL) once
# they've completed — or abandoned — the Hosted Checkout Page. This is a
# real endpoint matching JazzCash's documented callback shape: it arrives as
# a POST with all the pp_ fields, including pp_ResponseCode and
# pp_SecureHash for us to verify before trusting the result.
@bp.route('/jazzcash/return', methods=['GET', 'POST'])
def jazzcash_return():
    fields = request.form.to_dict() if request.method == 'POST' else request.args.to_dict()
    db = current_app.get_db()

    txn_ref_no = fields.get('pp_TxnRefNo', '')
    response_code = fields.get('pp_ResponseCode', '')
    response_message = fields.get('pp_ResponseMessage', '')

    valid_signature = verify_response(fields)
    order_code = None

    if txn_ref_no and valid_signature:
        txn = query_one(db, 'SELECT * FROM jazzcash_transactions WHERE txn_ref_no = ?', (txn_ref_no,))
        execute(db, 'UPDATE jazzcash_transactions SET response_code=?, response_message=?, raw_payload=? WHERE txn_ref_no=?',
                (response_code, response_message, str(fields), txn_ref_no))

        if txn and txn.get('order_id'):
            order = query_one(db, 'SELECT * FROM orders WHERE id = ?', (txn['order_id'],))
            if order:
                order_code = order['order_code']
                new_status = response_code_to_status(response_code)
                if new_status == 'paid':
                    execute(db, "UPDATE orders SET payment_status='paid', order_status='confirmed' WHERE id=?", (order['id'],))
                elif new_status == 'failed':
                    execute(db, "UPDATE orders SET payment_status='failed' WHERE id=?", (order['id'],))
        if hasattr(db, 'commit'):
            db.commit()

    # Send the customer's browser on to the order-confirmation page, which
    # polls /api/orders/<code> to show the final status.
    query = f'order={order_code}' if order_code else 'error=unknown_transaction'
    return redirect(f'/order-confirmation.html?{query}')


# Used ONLY by the local sandbox simulation (mock-checkout.html) when no
# live JazzCash credentials are configured — lets the demo flow "complete" a
# payment through the exact same status-update code path a real callback
# would use.
@bp.post('/simulate')
def simulate():
    body = request.get_json(silent=True) or {}
    order_code = body.get('orderCode')
    outcome = body.get('outcome')  # 'succeeded' | 'failed'

    db = current_app.get_db()
    order = query_one(db, 'SELECT * FROM orders WHERE order_code = ?', (order_code,))
    if not order:
        return jsonify(error='Order not found.'), 404

    if outcome == 'succeeded':
        execute(db, "UPDATE orders SET payment_status='paid', order_status='confirmed' WHERE id=?", (order['id'],))
    else:
        execute(db, "UPDATE orders SET payment_status='failed' WHERE id=?", (order['id'],))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)

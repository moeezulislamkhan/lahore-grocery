# app.py — run with: python app.py
import os
from app import create_app

# Load .env (python-dotenv is already available; falls back silently if not)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    live = bool(os.environ.get('JAZZCASH_MERCHANT_ID') and os.environ.get('JAZZCASH_PASSWORD') and os.environ.get('JAZZCASH_INTEGRITY_SALT'))
    db_engine = os.environ.get('DB_ENGINE', 'sqlite')
    print(f"""
  Shakarganj Grocery — Python (Flask) backend
  --------------------------------------------
  Database:      {db_engine.upper()}
  JazzCash mode: {'LIVE' if live else 'SANDBOX SIMULATION (no JazzCash credentials set)'}
  Listening on:  http://0.0.0.0:{port}  (open http://localhost:{port}/ in your browser)
  Admin panel:   http://localhost:{port}/admin.html
""")
    # host='0.0.0.0' — reachable on any local interface/port mapping, no
    # binding restriction to just 127.0.0.1.
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG', '0') == '1')

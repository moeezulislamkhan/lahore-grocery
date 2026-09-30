// public/js/category.js — Category browsing page.
// Shares the same cart (localStorage key 'sg_cart') and checkout flow as the
// homepage — items added here show up in the same cart on index.html and
// vice versa, since both pages are on the same origin.

const CATEGORY_ICONS = {
  'Fruits & Vegetables': '🥕', 'Dairy & Eggs': '🥛', 'Bakery': '🍞',
  'Rice, Atta & Pulses': '🍚', 'Beverages': '🧃', 'Household': '🧴', 'Meat & Poultry': '🍗',
};
function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const params = new URLSearchParams(location.search);
const currentCategory = params.get('name') || 'All';
const currentCollectionSlug = params.get('collection');

let PRODUCTS = []; // only the products for currentCategory — used by cartLines() etc.
let ALL_CATEGORY_NAMES = [];

async function loadCategoryPage() {
  if (currentCollectionSlug) {
    const pickerSection = document.getElementById('categoryPickerSection');
    if (pickerSection) pickerSection.hidden = true;
  }
  document.getElementById('categoryTitle').textContent = currentCategory === 'All' ? 'All Products' : currentCategory;
  document.getElementById('categoryBreadcrumb').innerHTML = `<a href="index.html" style="color:inherit;">Shop</a> &rsaquo; ${currentCategory === 'All' ? 'All Products' : currentCategory}`;

  try {
    // The category picker row (and nav/footer) always reflects whatever
    // categories actually exist right now — driven by the same /api/products
    // data an Admin manages in the Admin Panel, so adding/renaming a
    // category there shows up here automatically.
    const { categories } = await API.get('/api/products/categories');
    ALL_CATEGORY_NAMES = categories.map(c => c.category);
    renderCategoryPicker(categories);
    renderTopNav();
    renderFooterShopList();
  } catch (err) {
    document.getElementById('categoryPicker').innerHTML = '';
  }

  try {
    if (currentCollectionSlug) {
      const { collection } = await API.get(`/api/collections/${encodeURIComponent(currentCollectionSlug)}`);
      PRODUCTS = collection.products || [];
      document.title = `${collection.name} — Shakarganj Grocery`;
      document.getElementById('categoryTitle').textContent = collection.title;
      const breadcrumb = document.getElementById('categoryBreadcrumb');
      const shopLink = document.createElement('a');
      shopLink.href = 'index.html';
      shopLink.style.color = 'inherit';
      shopLink.textContent = 'Shop';
      breadcrumb.replaceChildren(shopLink, document.createTextNode(` › ${collection.name}`));
    } else {
      const url = currentCategory === 'All' ? '/api/products' : `/api/products?category=${encodeURIComponent(currentCategory)}`;
      const { products } = await API.get(url);
      PRODUCTS = currentCategory === 'All'
        ? products
        : products.filter(product => product.category === currentCategory);
    }
    document.getElementById('categoryCount').textContent = `${PRODUCTS.length} product${PRODUCTS.length === 1 ? '' : 's'}`;
    renderCategoryProducts();
    renderCart(); // cart may reference products not in this category — cartLines() below handles that
  } catch (err) {
    document.getElementById('categoryProductGrid').innerHTML = `<p class="empty-note">Could not load products. Is the server running?</p>`;
  }
}

function renderCategoryPicker(categories) {
  const allCard = `<a class="cat-card${currentCategory === 'All' ? ' active-cat' : ''}" href="category.html?name=All"><div class="emoji">🛒</div><div class="lbl">All Products</div></a>`;
  const cards = categories.map(c => `
    <a class="cat-card${c.category === currentCategory ? ' active-cat' : ''}" href="category.html?name=${encodeURIComponent(c.category)}">
      <div class="emoji">${CATEGORY_ICONS[c.category] || '🛒'}</div>
      <div class="lbl">${c.category}</div>
    </a>
  `).join('');
  document.getElementById('categoryPicker').innerHTML = allCard + cards;
}

function renderTopNav() {
  const navInner = document.getElementById('catNavInner');
  if (!navInner) return;
  navInner.innerHTML = `<a href="index.html">All Categories</a>` +
    ALL_CATEGORY_NAMES.map(c => `<a href="category.html?name=${encodeURIComponent(c)}" class="${c === currentCategory ? 'active' : ''}">${c}</a>`).join('');
}

function renderFooterShopList() {
  const footerShop = document.getElementById('footerShopList');
  if (!footerShop) return;
  footerShop.innerHTML = ALL_CATEGORY_NAMES.slice(0, 6).map(c => `<li><a href="category.html?name=${encodeURIComponent(c)}" style="color:inherit;">${c}</a></li>`).join('');
}

function renderCategoryProducts() {
  const grid = document.getElementById('categoryProductGrid');
  if (PRODUCTS.length === 0) {
    grid.innerHTML = `<p class="empty-note">No products available in this category.</p>`;
    return;
  }
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="p-card">
      ${p.deal ? '<div class="tag sale">DEAL</div>' : (p.tag ? `<div class="tag ${p.tag === 'Sale' ? 'sale' : ''}">${p.tag}</div>` : (p.has_sale_price ? '<div class="tag sale">SALE</div>' : ''))}
      <div class="img-wrap"><img src="${p.image}" alt="${p.name}"></div>
      <div class="body">
        <div class="cat-lbl">${p.category}</div>
        <div class="p-title">${p.name}</div>
        <div class="row">
          <div class="price">${p.deal || p.has_sale_price ? `<span class="old">${fmt(p.price)}</span>${fmt(p.effective_price)}` : `${p.old_price ? `<span class="old">${fmt(p.old_price)}</span>` : ''}${fmt(p.price)}`}${p.unit ? `/${escapeHtml(p.unit.trim().replace(/^\/+/, ''))}` : ''}</div>
          <button class="add-btn" onclick="addToCart(${p.id})" ${p.stock === 0 ? 'disabled style="opacity:.35;cursor:not-allowed;"' : ''}>+</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('categorySearchInput');
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const grid = document.getElementById('categoryProductGrid');
      const filtered = q ? PRODUCTS.filter(p => p.name.toLowerCase().includes(q)) : PRODUCTS;
      if (filtered.length === 0) {
        grid.innerHTML = `<p class="empty-note">No products match "${input.value}".</p>`;
      } else {
        const saved = PRODUCTS; PRODUCTS = filtered; renderCategoryProducts(); PRODUCTS = saved;
      }
    });
  }
});

/* ============ CART (shared with the rest of the site via localStorage) ============ */
let CART = JSON.parse(localStorage.getItem('sg_cart') || '{}');
function saveCart() { localStorage.setItem('sg_cart', JSON.stringify(CART)); }

function addToCart(id) {
  CART[id] = (CART[id] || 0) + 1;
  saveCart(); renderCart(); toggleCart(true);
}
function changeQty(id, delta) {
  CART[id] = (CART[id] || 0) + delta;
  if (CART[id] <= 0) delete CART[id];
  saveCart(); renderCart();
}
function removeFromCart(id) { delete CART[id]; saveCart(); renderCart(); }

// Cart items can include products from OTHER categories (added earlier on
// this page or on the homepage) — resolved lazily from a full product fetch
// and cached, so the cart always displays correctly regardless of which
// category page you're currently viewing.
const PRODUCT_CACHE = {};
function cartLines() {
  return Object.entries(CART).map(([id, qty]) => {
    const p = PRODUCTS.find(x => x.id == id) || PRODUCT_CACHE[id];
    return { p, qty, id };
  });
}

async function ensureCartProductsResolved() {
  const missing = Object.keys(CART).filter(id => !PRODUCTS.find(p => p.id == id) && !PRODUCT_CACHE[id]);
  if (missing.length === 0) return false;
  try {
    const { products } = await API.get('/api/products');
    products.forEach(p => { PRODUCT_CACHE[p.id] = p; });
    return true;
  } catch { return false; }
}

async function renderCart() {
  await ensureCartProductsResolved();
  const lines = cartLines().filter(l => l.p);
  const wrap = document.getElementById('cartItemsWrap');
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const badge = document.getElementById('cartBadge');
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count;

  if (lines.length === 0) {
    wrap.innerHTML = `<div class="cart-empty">Your cart is empty.<br>Add some fresh groceries!</div>`;
    document.getElementById('cartFoot').style.display = 'none';
    return;
  }
  document.getElementById('cartFoot').style.display = 'block';
  wrap.innerHTML = lines.map(l => `
    <div class="cart-item">
      <img src="${l.p.image}" alt="">
      <div class="info">
        <div class="t">${l.p.name}</div>
        <div class="p">${fmt(l.p.effective_price || l.p.price)}</div>
        <div class="qty-ctrl">
          <button onclick="changeQty(${l.p.id},-1)">−</button>
          <span>${l.qty}</span>
          <button onclick="changeQty(${l.p.id},1)">+</button>
        </div>
      </div>
      <div class="remove-x" onclick="removeFromCart(${l.p.id})">✕</div>
    </div>
  `).join('');

  const subtotal = lines.reduce((s, l) => s + (l.p.effective_price || l.p.price) * l.qty, 0);
  const delivery = subtotal > 2000 ? 0 : 150;
  document.getElementById('cartSubtotal').textContent = fmt(subtotal);
  document.getElementById('cartDelivery').textContent = delivery === 0 ? 'Free' : fmt(delivery);
  document.getElementById('cartTotal').textContent = fmt(subtotal + delivery);
}

function toggleCart(open) {
  document.getElementById('cartDrawer').classList.toggle('open', open);
  document.getElementById('overlay').classList.toggle('open', open);
}

/* ============ CHECKOUT ============ */
let selectedPay = 'jazzcash';
const PAY_LABELS = { jazzcash: 'JazzCash', bank: 'Bank Transfer', cod: 'Cash on Delivery' };
function selectPay(p) {
  selectedPay = p;
  document.querySelectorAll('.pay-opt').forEach(el => el.classList.toggle('selected', el.dataset.pay === p));
  const btn = document.getElementById('placeOrderBtn');
  btn.textContent = p === 'cod' ? 'Place Order — Cash on Delivery' : `Place Order — Pay via ${PAY_LABELS[p]}`;
  document.getElementById('payNote').textContent = p === 'cod'
    ? '🚪 Your order is confirmed instantly — pay cash when it arrives at your door.'
    : p === 'bank'
      ? '🏦 Your order is confirmed once we verify your bank transfer.'
      : '🔒 You\u2019ll be redirected to JazzCash\u2019s secure checkout page to complete payment.';
}

async function openCheckout() {
  await ensureCartProductsResolved();
  const lines = cartLines().filter(l => l.p);
  if (lines.length === 0) return;
  document.getElementById('checkoutItemsList').innerHTML = lines.map(l => `
    <div class="totals-row"><span>${l.qty} × ${l.p.name}</span><span>${fmt((l.p.effective_price || l.p.price) * l.qty)}</span></div>
  `).join('');
  const subtotal = lines.reduce((s, l) => s + (l.p.effective_price || l.p.price) * l.qty, 0);
  const delivery = subtotal > 2000 ? 0 : 150;
  document.getElementById('coSubtotal').textContent = fmt(subtotal);
  document.getElementById('coDelivery').textContent = delivery === 0 ? 'Free' : fmt(delivery);
  document.getElementById('coTotal').textContent = fmt(subtotal + delivery);
  document.getElementById('checkoutModal').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  selectPay(selectedPay);
}
function closeCheckout() {
  document.getElementById('checkoutModal').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

function submitJazzCashForm(actionUrl, fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  Object.entries(fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const address = document.getElementById('coAddress').value.trim();
  const city = document.getElementById('coCity').value;
  const slot = document.getElementById('coSlot').value;

  if (!name || !phone || !address) {
    showMessage('Please fill in your name, phone and delivery address.');
    return;
  }
  const lines = cartLines().filter(l => l.p);
  if (lines.length === 0) return;

  const btn = document.getElementById('placeOrderBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Placing order…';

  try {
    const res = await API.post('/api/orders', {
      customerName: name, phone, address, city, deliverySlot: slot,
      items: lines.map(l => ({ productId: l.p.id, qty: l.qty })),
      paymentMethod: selectedPay,
    });

    if (res.jazzcash) {
      CART = {}; saveCart();
      submitJazzCashForm(res.jazzcash.actionUrl, res.jazzcash.fields);
      return;
    }

    CART = {}; saveCart(); renderCart();
    closeCheckout(); toggleCart(false);
    const msg = res.paymentMethod === 'cod'
      ? `Order ${res.orderCode} confirmed! Pay cash when it arrives.`
      : `Order ${res.orderCode} created. Transfer to ${res.bankInstructions.bank} — ${res.bankInstructions.iban} (${res.bankInstructions.accountTitle}), and we'll confirm once received.`;
    showMessage(msg, 'Order placed');
  } catch (err) {
    showMessage(err.message || 'Could not place your order — please try again.', 'Order not placed');
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

/* ============ ACCOUNT LINK (header) ============ */
function updateAccountLink() {
  const link = document.getElementById('accountLink');
  const label = document.getElementById('accountLabel');
  if (!link || !label) return;
  const user = API.user();
  if (user && API.token()) {
    if (['admin', 'manager', 'staff', 'employee'].includes(user.role)) {
      link.href = 'admin.html';
    } else {
      link.href = 'user-dashboard.html';
    }
  } else {
    link.href = 'login.html';
  }
  label.textContent = 'Settings';
}

/* ============ FOOTER SETTINGS (live from Admin → Settings) ============ */
async function loadFooterSettings() {
  try {
    const { settings } = await API.get('/api/settings/public');
    const phoneEl = document.getElementById('footerPhone');
    const emailEl = document.querySelector('[data-setting="email"]');
    const nameEl = document.getElementById('footerStoreName');
    const copyEl = document.getElementById('footerCopyrightName');
    const bankEl = document.getElementById('checkoutBankDetails');
    if (phoneEl && settings.support_phone) phoneEl.textContent = settings.support_phone;
    if (emailEl && settings.support_email) {
      emailEl.textContent = settings.support_email;
      emailEl.href = `mailto:${settings.support_email}`;
    }
    if (nameEl && settings.store_name) nameEl.textContent = settings.store_name;
    if (copyEl && settings.store_name) copyEl.textContent = settings.store_name;
    if (bankEl) bankEl.textContent = `Account title: ${settings.store_name || 'Shakarganj Grocery Store'}. Bank: ${settings.bank_name || 'Meezan Bank'}. IBAN: ${settings.bank_iban || 'PK00 MEZN 0000 0000 1234 567'}.`;
  } catch (err) { /* footer already shows sensible defaults from the HTML */ }
}

/* ============ INIT ============ */
loadCategoryPage();
updateAccountLink();
loadFooterSettings();
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initSupportWidget === 'function') initSupportWidget();
});

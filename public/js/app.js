// public/js/app.js — Shakarganj storefront logic

/* ============ SPLASH SEQUENCE ============ */
// The dot's expansion origin is calculated from the live position of the "@"
// glyph — never hard-coded to 50%/50% — so it stays correct on any screen
// size and after any responsive reflow.
const splash = document.getElementById('splash');
const splashDot = document.getElementById('splashDot');
const atSymbol = document.getElementById('atSymbol');
let splashDone = false;
let splashExpanded = false;
let splashStarted = false;

function positionDotOnAt() {
  if (!atSymbol || !splashDot || splashExpanded) return;
  const rect = atSymbol.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  splashDot.style.left = cx + 'px';
  splashDot.style.top = cy + 'px';

  // Radius needed for the scaled dot to cover the farthest corner of the
  // viewport from this exact point, so the circle always fully fills the
  // screen regardless of where the "@" sits or how the screen is shaped.
  const w = window.innerWidth, h = window.innerHeight;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  let maxDist = 0;
  for (const [x, y] of corners) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > maxDist) maxDist = d;
  }
  const neededRadius = maxDist + 24; // small buffer so no edge pixel is left uncovered
  const dotRadius = splashDot.offsetWidth / 2;
  splash.style.setProperty('--dot-scale', neededRadius / dotRadius);
}

function runSplash() {
  if (splashStarted || splashDone || !splash || !splashDot) return;
  splashStarted = true;
  positionDotOnAt();
  window.addEventListener('resize', positionDotOnAt);

  // Stage 1 — "@Shakarganj" wordmark holds for 1.2s
  setTimeout(() => {
    if (splashDone) return;
    positionDotOnAt(); // final recompute right before the trigger, in case of late layout shifts
    splashExpanded = true;
    let transitionFinished = false;
    let transitionFallback;
    const finishExpansion = () => {
      if (transitionFinished || splashDone) return;
      transitionFinished = true;
      clearTimeout(transitionFallback);
      splashDot.removeEventListener('transitionend', onTransitionEnd);
      splash.classList.add('filled');
      requestAnimationFrame(() => splash.classList.add('show-logo'));
    };
    const onTransitionEnd = event => {
      if (event.target === splashDot && event.propertyName === 'transform') finishExpansion();
    };
    splashDot.addEventListener('transitionend', onTransitionEnd);
    splash.classList.add('expanding');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    transitionFallback = setTimeout(finishExpansion, reducedMotion ? 100 : 2600);
  }, 1200);
}

function startSplash() {
  if (!splashDone) runSplash();
}

// Wait for web fonts to finish loading before measuring/positioning the dot —
// prevents any late font-swap layout shift from moving the "@" after we've
// already anchored the animation origin to it.
//
// The splash is only ever meant to be a "first entry into the site" moment —
// sessionStorage (cleared when the tab/browser closes, but kept across page
// navigations and Back/Forward within the same tab) is exactly the right
// tool to remember "already saw the intro this session" without needing any
// bigger routing/state rework.
const INTRO_SEEN_KEY = 'sg_intro_seen';
if (sessionStorage.getItem(INTRO_SEEN_KEY)) {
  splashDone = true;
  splash.style.display = 'none';
  document.getElementById('app').classList.add('ready');
} else if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(startSplash).catch(startSplash);
  setTimeout(startSplash, 1500);
} else {
  startSplash();
}
/* ============ PRODUCT CATALOG (from API) ============ */
const CATEGORY_ICONS = {
  'Fruits & Vegetables': '🥕', 'Dairy & Eggs': '🥛', 'Bakery': '🍞',
  'Rice, Atta & Pulses': '🍚', 'Beverages': '🧃', 'Household': '🧴', 'Meat & Poultry': '🍗',
};
let PRODUCTS = [];
let ALL_PRODUCTS = [];
let searchRequestId = 0;
function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }

async function loadProducts() {
  try {
    const { products } = await API.get('/api/products');
    PRODUCTS = products;
    ALL_PRODUCTS = products;
    renderCategories();
    renderProducts();
    // Cart items are stored by product id in localStorage, but rendering
    // them needs each product's name/price/image from PRODUCTS — which
    // wasn't populated yet if the page's initial renderCart() ran before
    // this fetch resolved. Re-render now that PRODUCTS is actually filled,
    // so items added on another page (or in a previous visit) show up
    // immediately instead of the cart badge silently reading as empty.
    renderCart();
    loadCampaignBanner();
  } catch (err) {
    document.getElementById('productGrid').innerHTML = `<p class="empty-note">Could not load products. Is the server running?</p>`;
  }
}

async function searchProducts(value) {
  const query = value.trim();
  const requestId = ++searchRequestId;
  const grid = document.getElementById('productGrid');

  if (!query) {
    PRODUCTS = ALL_PRODUCTS;
    renderCategories();
    renderProducts();
    return;
  }

  try {
    const { products } = await API.get(`/api/products?q=${encodeURIComponent(query)}`);
    if (requestId !== searchRequestId) return;
    PRODUCTS = products;
    renderCategories();
    renderProducts(true);
  } catch (err) {
    if (requestId !== searchRequestId) return;
    grid.innerHTML = '<p class="empty-note">Search is temporarily unavailable.</p>';
  }
}

function renderCategories() {
  const cats = [...new Set(PRODUCTS.map(p => p.category))];
  const cards = cats.map(c => {
    const icon = CATEGORY_ICONS[c] || '🛒';
    return '<a class="cat-card" href="category.html?name=' + encodeURIComponent(c) + '"><div class="emoji">' + icon + '</div><div class="lbl">' + c + '</div></a>';
  }).join('');
  document.getElementById('catGrid').innerHTML = cards;

  const navInner = document.getElementById('catNavInner');
  if (navInner) {
    const links = ['<a href="index.html" class="active">All Categories</a>'];
    cats.forEach(c => links.push('<a href="category.html?name=' + encodeURIComponent(c) + '">' + c + '</a>'));
    navInner.innerHTML = links.join('');
  }

  const footerShop = document.getElementById('footerShopList');
  if (footerShop) {
    const items = cats.slice(0, 6).map(c => '<li><a href="category.html?name=' + encodeURIComponent(c) + '" style="color:inherit;">' + c + '</a></li>');
    footerShop.innerHTML = items.join('');
  }
}

function productPriceHtml(p) {
  const unitSuffix = p.unit ? '/' + escapeHtml(p.unit.trim().replace(/^\/+/, '')) : '';
  if (p.deal || p.has_sale_price) {
    return '<span class="old">' + fmt(p.price) + '</span>' + fmt(p.effective_price) + unitSuffix;
  }
  const oldPrice = p.old_price ? '<span class="old">' + fmt(p.old_price) + '</span>' : '';
  return oldPrice + fmt(p.price) + unitSuffix;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function productCardHtml(p) {
  const saleTag = p.deal ? '<div class="tag sale">DEAL</div>' : (p.tag ? '<div class="tag' + (p.tag === 'Sale' ? ' sale' : '') + '">' + p.tag + '</div>' : (p.has_sale_price ? '<div class="tag sale">SALE</div>' : ''));
  const disabled = p.stock === 0 ? 'disabled style="opacity:.35;cursor:not-allowed;"' : '';
  return '<div class="p-card">' + saleTag + '<div class="img-wrap"><img src="' + p.image + '" alt="' + p.name + '"></div><div class="body"><div class="cat-lbl">' + p.category + '</div><div class="p-title">' + p.name + '</div><div class="row"><div class="price">' + productPriceHtml(p) + '</div><button class="add-btn" onclick="addToCart(' + p.id + ')" ' + disabled + '>+</button></div></div></div>';
}

function renderProducts(showAll = false) {
  const grid = document.getElementById('productGrid');
  const products = showAll ? PRODUCTS : PRODUCTS.slice(0, 8);
  if (products.length === 0) {
    grid.innerHTML = '<p class="empty-note">No results found.</p>';
    return;
  }
  grid.innerHTML = products.map(productCardHtml).join('');
}

const productSearchInput = document.getElementById('productSearchInput');
if (productSearchInput) productSearchInput.addEventListener('input', event => searchProducts(event.target.value));

async function loadCampaignBanner() {
  const banner = document.getElementById('campaignBanner');
  if (!banner) return;
  try {
    const { campaigns } = await API.get('/api/deal-campaigns');
    if (!campaigns.length) { banner.style.display = 'none'; return; }
    const items = campaigns.map(campaign => {
      const imageStyles = campaign.image ? ' style="background-image:linear-gradient(90deg, rgba(98,0,20,.96), rgba(98,0,20,.78)), url(\'' + campaign.image + '\')"' : '';
      return '<div class="campaign-banner-item"' + imageStyles + '><div><div class="eyebrow campaign-banner-badge">' + (campaign.badge || 'Special Offer') + '</div><h3>' + campaign.title + '</h3><p>' + campaign.description + '</p></div><a class="btn" href="' + (campaign.button_url || 'index.html') + '">' + (campaign.button_text || 'Shop Now') + '</a></div>';
    });
    banner.innerHTML = items.join('');
  } catch (err) {
    /* retain the existing banner fallback copy */
  }
}

/* ============ CART (persisted in localStorage — a real browser storage use case, not a Claude.ai artifact) ============ */
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

function cartLines() {
  return Object.entries(CART).map(([id, qty]) => {
    const p = PRODUCTS.find(x => x.id == id);
    return { p, qty };
  }).filter(l => l.p);
}

function renderCart() {
  const lines = cartLines();
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

function openCheckout() {
  const lines = cartLines();
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

// Builds a real HTML form from JazzCash's pp_* fields and submits it with
// method="post" — exactly how JazzCash's Hosted Checkout Page integration
// works. The browser navigates away to actionUrl (JazzCash's real servers
// once live credentials are configured, or our own sandbox simulation page
// until then) carrying the same fields either way.
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
    alert('Please fill in your name, phone and delivery address.');
    return;
  }
  const lines = cartLines();
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
      // Cart is about to be paid for — clear it locally before leaving the
      // page, then hand off to JazzCash's Hosted Checkout Page.
      CART = {}; saveCart();
      submitJazzCashForm(res.jazzcash.actionUrl, res.jazzcash.fields);
      return;
    }

    // COD or Bank Transfer — order is already recorded, show confirmation inline
    CART = {}; saveCart(); renderCart();
    closeCheckout(); toggleCart(false);
    const msg = res.paymentMethod === 'cod'
      ? `Order ${res.orderCode} confirmed! Pay cash when it arrives.`
      : `Order ${res.orderCode} created. Transfer to ${res.bankInstructions.bank} — ${res.bankInstructions.iban} (${res.bankInstructions.accountTitle}), and we'll confirm once received.`;
    alert(msg);
  } catch (err) {
    alert(err.message || 'Could not place your order — please try again.');
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

/* ============ ACCOUNT LINK (header) ============ */
// Route the Settings shortcut to the signed-in user's panel.
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
  } catch (err) {
    // Footer already shows sensible hard-coded defaults in the HTML — if this
    // call fails for any reason, the page still looks correct, just not live.
  }
}

/* ============ INIT ============ */
loadProducts();
renderCart();
updateAccountLink();
loadFooterSettings();
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initSupportWidget === 'function') initSupportWidget();
});

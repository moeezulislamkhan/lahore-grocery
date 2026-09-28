// public/js/admin.js — Shakarganj admin dashboard logic

const ROLE_INFO = {
  admin: { label: 'Administrator', desc: 'Full access to all modules' },
  manager: { label: 'Manager', desc: 'Products, orders & analytics' },
  staff: { label: 'Staff', desc: 'Products & orders only' },
  employee: { label: 'Employee', desc: 'Products, orders & store content' },
};

function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ AUTH ============ */
// Server-side authorization (checked on every API call) is what actually
// protects admin data. This guard just sends an unauthenticated or
// wrong-role visitor straight to the unified login page instead of showing
// them an empty dashboard full of 403s. There is no login form on this page
// at all — sign-in only happens through login.html.
(function guard() {
  try {
    const user = API.user();
    if (!user || !API.token() || !['admin', 'manager', 'staff', 'employee'].includes(user.role)) {
      location.href = 'login.html';
      return;
    }
    enterDashboard(user);
  } catch (err) {
    // Never let a single unexpected error (a bad CDN load, a stale/odd
    // localStorage value, etc.) silently break every future nav click.
    console.error('[admin] guard/enterDashboard failed:', err);
    showToast('Something went wrong loading the dashboard — check the browser console.');
  }
})();

function logout() {
  API.logout().then(() => { location.href = 'login.html'; });
}

function enterDashboard(user) {
  const info = ROLE_INFO[user.role];
  // The Deals markup is kept in one place and moved into the dashboard content
  // area at runtime so it works with the existing sidebar layout on all sizes.
  const dealsPage = document.getElementById('page-deals');
  const adminMain = document.querySelector('.admin-main');
  if (dealsPage && adminMain && dealsPage.parentElement !== adminMain) adminMain.appendChild(dealsPage);
  document.getElementById('sidebarRoleName').textContent = info.label;
  document.getElementById('sidebarRoleDesc').textContent = info.desc;
  document.querySelectorAll('#adminNav a').forEach(a => {
    const req = a.dataset.req;
    if (req) a.classList.toggle('locked', !req.split(',').includes(user.role));
  });
  setupMobilePanelNav();
  loadGatewayMode();
  showAdminPage('overview');
  // Each of these manages its own try/catch internally and is independent —
  // if one fails (e.g. Chart.js didn't load from the CDN), the others and
  // all page navigation still work fine.
  loadOverview();
  loadProducts();
  loadDeals();
  loadCampaigns();
  loadCollectionsAdmin();
  loadPromoMessagesAdmin();
  loadOrders();
  loadSupport();
  loadSettings();
  loadMembers();
}

/* ============ NAVIGATION ============ */
function showAdminPage(page) {
  try {
    const currentUser = API.user();
    const link = document.querySelector(`#adminNav a[data-page="${page}"]`);
    const req = link ? link.dataset.req : null;
    const allowed = !req || (currentUser && req.split(',').includes(currentUser.role));
    document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#adminNav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('#mobileAdminNav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    if (!allowed) { document.getElementById('page-denied').classList.add('active'); return; }
    document.getElementById('page-' + page).classList.add('active');
    if (link) link.classList.add('active');
    if (page === 'orders' && typeof markAdminOrdersSeen === 'function') markAdminOrdersSeen();
    if (page === 'deals' && typeof markAdminDealsSeen === 'function') markAdminDealsSeen();
    if (page === 'analytics') loadAnalytics();
    updateAdminBackButton(page);
  } catch (err) {
    console.error('[admin] showAdminPage failed for', page, err);
  }
}

// One shared Back button (see admin.html, right above the page content) that
// adapts to whichever section is currently open — matches the requested
// navigation rule: any sub-page → Overview, and Overview → the public site's
// Home page. No per-page duplicate nav bars needed.
function updateAdminBackButton(page) {
  const btn = document.getElementById('adminBackBtn');
  if (!btn) return;
  if (page === 'overview') {
    btn.textContent = '← Back to Home';
    btn.onclick = () => { window.location.href = 'index.html'; };
  } else {
    btn.textContent = '← Back to Overview';
    btn.onclick = () => showAdminPage('overview');
  }
}

function setupMobilePanelNav() {
  const source = document.getElementById('adminNav');
  const menu = document.getElementById('mobileAdminNav');
  const toggle = document.getElementById('mobileAdminNavToggle');
  if (!source || !menu || !toggle) return;

  menu.replaceChildren(...Array.from(source.children, link => link.cloneNode(true)));
  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'mobile-panel-logout';
  logoutButton.textContent = 'Sign out';
  logoutButton.addEventListener('click', logout);
  menu.appendChild(logoutButton);

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open admin navigation');
  };
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    toggle.setAttribute('aria-label', menu.hidden ? 'Open admin navigation' : 'Close admin navigation');
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
}

/* ============ GATEWAY MODE ============ */
async function loadGatewayMode() {
  try {
    const { live } = await API.get('/api/payments/mode');
    const pill = document.getElementById('gwPill');
    pill.textContent = live ? 'JazzCash: LIVE' : 'JazzCash: SANDBOX';
    pill.className = 'gw-pill ' + (live ? 'live' : 'sandbox');
  } catch { /* ignore */ }
}

/* ============ OVERVIEW ============ */
let overviewChart = null;
async function loadOverview() {
  try {
    const s = await API.get('/api/analytics/summary');
    const cards = document.querySelectorAll('#kpiGrid .kpi-card .val');
    cards[0].textContent = fmt(s.revenue);
    cards[1].textContent = s.orderCount;
    cards[2].textContent = fmt(s.avgOrder);
    cards[3].textContent = s.customerCount;

    // Chart.js loads from a CDN — kept in its own try/catch so a blocked or
    // failed CDN load (e.g. no internet on this network) never prevents the
    // KPI cards or the rest of the dashboard from showing.
    try {
      const ctx = document.getElementById('overviewChart');
      const labels = s.dailyRevenue.map(d => d.day.slice(5));
      const data = s.dailyRevenue.map(d => d.total);
      if (overviewChart) overviewChart.destroy();
      overviewChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ data, borderColor: '#620014', backgroundColor: 'rgba(98,0,20,0.08)', fill: true, tension: .4, pointRadius: 0, borderWidth: 2.5 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { grid: { display: false }, ticks: { color: '#7A5C61', font: { size: 10 } } } } },
      });
    } catch (chartErr) {
      console.error('[admin] Chart.js unavailable — is the CDN reachable?', chartErr);
    }

    document.getElementById('topProductsList').innerHTML = s.topProducts.length
      ? s.topProducts.map(p => `<div class="top-prod-row"><div class="name">${p.name}</div><div class="amt">${fmt(p.revenue)}</div></div>`).join('')
      : '<p class="empty-note">No sales yet.</p>';
  } catch (err) {
    // KPI cards hidden from staff role — expected 403, show placeholders instead
    document.querySelectorAll('#kpiGrid .kpi-card .val').forEach(el => el.textContent = '—');
  }
}

/* ============ PRODUCTS ============ */
let ALL_PRODUCTS = [];
async function loadProducts() {
  try {
    const { products } = await API.get('/api/products');
    ALL_PRODUCTS = products;
    renderAdminProducts();
  } catch (err) { showToast(err.message); }
}
function renderAdminProducts(filter = '') {
  const list = ALL_PRODUCTS.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  document.getElementById('prodCount').textContent = list.length + ' products';
  document.getElementById('adminProductsTbody').innerHTML = list.map(p => {
    const status = p.stock === 0 ? '<span class="pill out">Out of stock</span>' : p.stock < 15 ? '<span class="pill low">Low stock</span>' : '<span class="pill instock">In stock</span>';
    const unitSuffix = p.unit ? '/' + escapeHtml(p.unit.trim().replace(/^\/+/, '')) : '';
    return `<tr>
      <td><img src="${p.image}"></td>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${p.sale_price && p.sale_price < p.price ? `<span class="old">${fmt(p.price)}</span>${fmt(p.sale_price)}` : fmt(p.price)}${unitSuffix}</td>
      <td>${p.stock}</td>
      <td>${status}</td>
      <td class="row-actions"><button class="edt" onclick="openEditProduct(${p.id})">Edit</button><button class="del" onclick="deleteProduct(${p.id})">Delete</button></td>
    </tr>`;
  }).join('');
}
function filterAdminProducts(v) { renderAdminProducts(v); }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

/* ============ COLLECTIONS ============ */
let PINK_SALT_COLLECTION = null;
async function loadCollectionsAdmin() {
  try {
    const data = await API.get('/api/admin/collections');
    PINK_SALT_COLLECTION = (data.collections || []).find(collection => collection.slug === 'pink-salt');
    if (!PINK_SALT_COLLECTION) {
      document.getElementById('collectionTitle').value = '';
      document.getElementById('collectionProductsTbody').innerHTML = '<tr><td colspan="4" class="empty-note">Pink Salt Collection is unavailable.</td></tr>';
      return;
    }
    document.getElementById('collectionTitle').value = PINK_SALT_COLLECTION.title;
    document.getElementById('collectionProductsTbody').innerHTML = PINK_SALT_COLLECTION.products.map(product => `<tr><td>${product.name}</td><td>${product.category}</td><td>${fmt(product.effective_price || product.price)}</td><td class="row-actions"><button class="del" onclick="removeCollectionProduct(${product.id})">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty-note">No products added to Pink Salt Collection yet.</td></tr>';
  } catch (error) { console.error('[admin] Could not load collections:', error); }
}
async function saveCollectionTitle() {
  if (!PINK_SALT_COLLECTION) return;
  const title = document.getElementById('collectionTitle').value.trim();
  if (!title) { showToast('Container title is required.'); return; }
  try {
    await API.put(`/api/admin/collections/${PINK_SALT_COLLECTION.id}`, { title });
    showToast('Container title saved.');
    await loadCollectionsAdmin();
  } catch (error) { showToast(error.message); }
}
async function setCollectionProduct(id, add) {
  if (!PINK_SALT_COLLECTION) return;
  const productIds = new Set(PINK_SALT_COLLECTION.product_ids);
  if (add) productIds.add(id); else productIds.delete(id);
  try {
    await API.put(`/api/admin/collections/${PINK_SALT_COLLECTION.id}/products`, { product_ids: [...productIds] });
    showToast(add ? 'Product added to Pink Salt Collection.' : 'Product removed from Pink Salt Collection.');
    await loadCollectionsAdmin();
  }
  catch (error) { showToast(error.message); }
}
async function createCollectionProduct() {
  if (!PINK_SALT_COLLECTION) { showToast('Pink Salt Collection is unavailable.'); return; }
  const name = document.getElementById('collectionNewProductName').value.trim();
  const price = Number(document.getElementById('collectionNewProductPrice').value);
  const salePriceValue = document.getElementById('collectionNewProductSalePrice').value.trim();
  const salePrice = salePriceValue ? Number(salePriceValue) : null;
  const tag = document.getElementById('collectionNewProductTag').value.trim() || 'Pink Salt';
  const stock = Number.parseInt(document.getElementById('collectionNewProductStock').value, 10) || 0;
  const image = document.getElementById('collectionNewProductImage').value.trim() || 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=300&q=80';
  if (!name || !Number.isFinite(price) || price <= 0) {
    showToast('Enter a product name and a valid price.');
    return;
  }
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= price)) {
    showToast('Sale price must be greater than zero and less than the regular price.');
    return;
  }
  try {
    const { product } = await API.post('/api/products', {
      name,
      category: 'Pink Salt',
      price,
      salePrice,
      tag,
      stock,
      image,
    });
    await setCollectionProduct(product.id, true);
    ['collectionNewProductName', 'collectionNewProductPrice', 'collectionNewProductSalePrice', 'collectionNewProductTag', 'collectionNewProductImage'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('collectionNewProductStock').value = '0';
    await loadProducts();
  } catch (error) { showToast(error.message); }
}
async function removeCollectionProduct(productId) { await setCollectionProduct(productId, false); }

/* ============ PROMOTIONAL MESSAGES ============ */
let ADMIN_PROMO_MESSAGES = [];
async function loadPromoMessagesAdmin() {
  try {
    const { messages } = await API.get('/api/admin/promo-messages');
    ADMIN_PROMO_MESSAGES = messages || [];
    document.getElementById('promoMessagesTbody').innerHTML = ADMIN_PROMO_MESSAGES.map(item => `<tr><td>${item.message}</td><td>${item.is_active ? 'Active' : 'Hidden'}</td><td class="row-actions"><button onclick="editPromoMessage(${item.id})">Edit</button><button class="del" onclick="deletePromoMessage(${item.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty-note">No promotional messages yet.</td></tr>';
  } catch (error) { console.error('[admin] Could not load promotional messages:', error); }
}
async function addPromoMessage() {
  const input = document.getElementById('newPromoMessage');
  const message = input.value.trim();
  if (!message) return;
  try { await API.post('/api/admin/promo-messages', { message }); input.value = ''; await loadPromoMessagesAdmin(); showToast('Promotional message added.'); }
  catch (error) { showToast(error.message); }
}
async function editPromoMessage(id) {
  const item = ADMIN_PROMO_MESSAGES.find(message => message.id === id);
  if (!item) return;
  const message = window.prompt('Edit promotional message', item.message);
  if (message === null || !message.trim()) return;
  try { await API.put(`/api/admin/promo-messages/${id}`, { ...item, message: message.trim() }); await loadPromoMessagesAdmin(); showToast('Promotional message updated.'); }
  catch (error) { showToast(error.message); }
}
async function togglePromoMessage(id) {
  const item = ADMIN_PROMO_MESSAGES.find(message => message.id === id);
  if (!item) return;
  try { await API.put(`/api/admin/promo-messages/${id}`, { ...item, is_active: !item.is_active }); await loadPromoMessagesAdmin(); }
  catch (error) { showToast(error.message); }
}
async function deletePromoMessage(id) {
  if (!window.confirm('Delete this promotional message?')) return;
  try { await API.delete(`/api/admin/promo-messages/${id}`); await loadPromoMessagesAdmin(); }
  catch (error) { showToast(error.message); }
}

/* ============ DEALS ============ */
let ALL_DEALS = [];
let CURRENT_EDIT_DEAL_ID = null;
async function loadDeals() {
  try {
    const { deals } = await API.get('/api/admin/deals');
    ALL_DEALS = deals || [];
    renderAdminDeals();
  } catch (err) { showToast(err.message); }
}

let ALL_CAMPAIGNS = [];
let CURRENT_EDIT_CAMPAIGN_ID = null;
function campaignDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
async function loadCampaigns() {
  try { const { campaigns } = await API.get('/api/admin/deal-campaigns'); ALL_CAMPAIGNS = campaigns || []; renderAdminCampaigns(); } catch (err) { console.error('[admin] Could not load deal containers:', err); showToast(err.message || 'Could not load deal containers.'); }
}
function renderAdminCampaigns() {
  const filter = document.getElementById('campaignStatusFilter')?.value || 'all';
  const list = ALL_CAMPAIGNS.filter(c => filter === 'all' || c.status === filter);
  document.getElementById('campaignCount').textContent = list.length + ' containers';
  document.getElementById('adminCampaignsTbody').innerHTML = list.map(c => `<tr><td><strong>${c.title}</strong></td><td style="max-width:280px;">${c.description}</td><td style="font-size:11px;">${campaignDate(c.end_date)}</td><td><span class="pill ${c.status === 'active' ? 'active' : c.status === 'expired' ? 'out' : 'pending'}">${c.status}</span></td><td class="row-actions"><button onclick="openCampaignForm(${c.id})">Edit</button>${c.status === 'disabled' ? `<button onclick="setCampaignVisibility(${c.id}, true)">Show</button>` : `<button onclick="setCampaignVisibility(${c.id}, false)">Hide</button>`}<button class="del" onclick="deleteCampaign(${c.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-note">No deal containers published yet.</td></tr>';
}
function openCampaignForm(id = null) {
  CURRENT_EDIT_CAMPAIGN_ID = id;
  const c = id ? ALL_CAMPAIGNS.find(item => item.id === id) : null;
  document.getElementById('campaignFormTitle').textContent = c ? 'Edit deal container' : 'Add deal container';
  document.getElementById('campaignTitle').value = c?.title || '';
  document.getElementById('campaignDescription').value = c?.description || '';
  document.getElementById('campaignEnd').value = c?.end_date ? String(c.end_date).replace(' ', 'T').slice(0, 16) : '';
  document.getElementById('campaignFormPanel').style.display = 'block';
  document.getElementById('campaignFormPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeCampaignForm() { document.getElementById('campaignFormPanel').style.display = 'none'; CURRENT_EDIT_CAMPAIGN_ID = null; }
async function saveCampaign() {
  const body = { title: document.getElementById('campaignTitle').value.trim(), description: document.getElementById('campaignDescription').value.trim(), end_date: document.getElementById('campaignEnd').value, is_active: true };
  try { if (CURRENT_EDIT_CAMPAIGN_ID) await API.put(`/api/admin/deal-campaigns/${CURRENT_EDIT_CAMPAIGN_ID}`, body); else await API.post('/api/admin/deal-campaigns', body); showToast('Deal container saved.'); closeCampaignForm(); loadCampaigns(); } catch (err) { showToast(err.status === 405 ? 'Server is using an older version. Restart Flask, then try again.' : err.message); }
}
async function setCampaignVisibility(id, visible) {
  const campaign = ALL_CAMPAIGNS.find(item => item.id === id);
  if (!campaign) return;
  const body = { title: campaign.title, description: campaign.description, end_date: campaign.end_date, is_active: visible };
  try { await API.put(`/api/admin/deal-campaigns/${id}`, body); showToast(visible ? 'Container shown.' : 'Container hidden.'); loadCampaigns(); } catch (err) { showToast(err.message); }
}
async function deleteCampaign(id) { if (!window.confirm('Delete this deal container?')) return; try { await API.delete(`/api/admin/deal-campaigns/${id}`); showToast('Deal container deleted.'); loadCampaigns(); } catch (err) { showToast(err.message); } }
function renderAdminDeals() {
  const filter = document.getElementById('dealStatusFilter')?.value || 'all';
  const list = ALL_DEALS.filter(d => filter === 'all' || d.status === filter);
  document.getElementById('dealCount').textContent = list.length + ' deals';
  document.getElementById('adminDealsTbody').innerHTML = list.map(d => `<tr>
    <td><strong>${d.product.name}</strong><br><span style="color:var(--ink-soft);font-size:11px;">${d.product.category}</span></td>
    <td>${d.discount_label}</td>
    <td><span class="old">${fmt(d.original_price)}</span> <strong>${fmt(d.final_price)}</strong></td>
    <td style="font-size:11px;">${new Date(d.start_date.replace(' ', 'T') + 'Z').toLocaleString()}<br>to ${new Date(d.end_date.replace(' ', 'T') + 'Z').toLocaleString()}</td>
    <td><span class="pill ${d.status === 'active' ? 'active' : d.status === 'expired' ? 'out' : 'pending'}">${d.status}</span></td>
    <td class="row-actions"><button onclick="openDealForm(${d.id})">Edit</button><button class="del" onclick="deleteDeal(${d.id})">Delete</button></td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-note">No deals match this status.</td></tr>';
}

function openDealForm(dealId = null) {
  CURRENT_EDIT_DEAL_ID = dealId;
  const deal = dealId ? ALL_DEALS.find(d => d.id === dealId) : null;
  const productSelect = document.getElementById('dealProduct');
  const assigned = new Set(ALL_DEALS.filter(d => d.id !== dealId).map(d => d.product_id));
  productSelect.innerHTML = ALL_PRODUCTS.filter(p => !assigned.has(p.id) || (deal && p.id === deal.product_id)).map(p => `<option value="${p.id}">${p.name} — ${fmt(p.price)}</option>`).join('');
  if (deal) {
    document.getElementById('dealFormTitle').textContent = 'Edit deal';
    productSelect.value = deal.product_id;
    document.getElementById('dealType').value = deal.discount_type;
    document.getElementById('dealValue').value = deal.discount_value;
    document.getElementById('dealStart').value = deal.start_date.replace(' ', 'T').slice(0, 16);
    document.getElementById('dealEnd').value = deal.end_date.replace(' ', 'T').slice(0, 16);
    document.getElementById('dealEnabled').value = deal.is_active ? '1' : '0';
  } else {
    document.getElementById('dealFormTitle').textContent = 'Add deal';
    document.getElementById('dealValue').value = '';
    document.getElementById('dealStart').value = new Date().toISOString().slice(0, 16);
    document.getElementById('dealEnd').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
    document.getElementById('dealEnabled').value = '1';
  }
  document.getElementById('dealFormPanel').style.display = 'block';
  document.getElementById('dealFormPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeDealForm() { document.getElementById('dealFormPanel').style.display = 'none'; CURRENT_EDIT_DEAL_ID = null; }
async function saveDeal() {
  const body = { product_id: Number(document.getElementById('dealProduct').value), discount_type: document.getElementById('dealType').value, discount_value: Number(document.getElementById('dealValue').value), start_date: document.getElementById('dealStart').value, end_date: document.getElementById('dealEnd').value, is_active: document.getElementById('dealEnabled').value === '1' };
  try {
    if (CURRENT_EDIT_DEAL_ID) await API.put(`/api/admin/deals/${CURRENT_EDIT_DEAL_ID}`, body);
    else await API.post('/api/admin/deals', body);
    showToast('Deal saved.'); closeDealForm(); loadDeals();
  } catch (err) { showToast(err.message); }
}
async function deleteDeal(dealId) {
  if (!window.confirm('Remove this deal? The original product will remain.')) return;
  try { await API.delete(`/api/admin/deals/${dealId}`); showToast('Deal removed.'); loadDeals(); } catch (err) { showToast(err.message); }
}
function openAddProduct() { document.getElementById('addProductPanel').style.display = 'block'; document.getElementById('addProductPanel').scrollIntoView({ behavior: 'smooth' }); }
function closeAddProduct() { document.getElementById('addProductPanel').style.display = 'none'; }

async function addProduct() {
  const name = document.getElementById('npName').value.trim();
  const unit = document.getElementById('npUnit').value.trim();
  const category = document.getElementById('npCat').value;
  const price = parseFloat(document.getElementById('npPrice').value) || 0;
  const salePriceValue = document.getElementById('npSalePrice').value.trim();
  const salePrice = salePriceValue ? parseFloat(salePriceValue) : null;
  const tag = document.getElementById('npTag').value.trim();
  const stock = parseInt(document.getElementById('npStock').value) || 0;
  const image = document.getElementById('npImg').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80';
  if (!name || !price) { showToast('Please enter at least a product name and price.'); return; }
  try {
    await API.post('/api/products', { name, unit, category, price, salePrice, tag, stock, image });
    showToast('Product added.');
    closeAddProduct();
    document.getElementById('npName').value = ''; document.getElementById('npUnit').value = ''; document.getElementById('npPrice').value = ''; document.getElementById('npSalePrice').value = ''; document.getElementById('npTag').value = ''; document.getElementById('npStock').value = ''; document.getElementById('npImg').value = '';
    loadProducts();
  } catch (err) { showToast(err.message); }
}
async function deleteProduct(id) {
  try {
    await API.delete(`/api/products/${id}`);
    showToast('Product deleted.');
    loadProducts();
  } catch (err) { showToast(err.message); }
}

/* ============ ORDERS ============ */
const ORDER_STATUSES = ['processing', 'confirmed', 'out_for_delivery', 'delivered', 'returned'];
let CURRENT_ORDER_DETAIL = null;
let ALL_ORDER_HISTORY = null;

function statusLabel(value) {
  return (value || 'processing').replace(/_/g, ' ');
}

function renderStatusPill(value, className = 'pill') {
  const safe = String(value || 'pending').replace(/_/g, ' ');
  return `<span class="${className} ${value || 'pending'}">${safe}</span>`;
}

async function loadOrders() {
  try {
    const { orders } = await API.get('/api/orders');
    const header = `<thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th><th>Total</th><th>Payment</th><th>Payment status</th><th>Order status</th><th>Actions</th></tr></thead>`;
    const rowsHtml = orders.map(o => `
      <tr>
        <td><button class="link-btn" onclick="openOrderDetail(${o.id})">${o.order_code}</button></td>
        <td>${o.customer_name}</td>
        <td>${o.phone || 'Not Provided'}</td>
        <td>${Array.isArray(o.items_count) ? o.items_count : (o.items_count || 0)}</td>
        <td>${fmt(o.total)}</td>
        <td>${o.payment_method}</td>
        <td>${renderStatusPill(o.payment_status)}</td>
        <td class="row-actions">
          ${o.order_status === 'cancelled' ? renderStatusPill(o.order_status) : `<select onchange="updateOrderStatus(${o.id}, this.value)">${ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.order_status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select>`}
        </td>
        <td class="row-actions">
          <button onclick="openOrderDetail(${o.id})">View</button>
          <button onclick="printOrderReceipt(${o.id})">Print</button>
          <button onclick="downloadOrderReceipt(${o.id})">PDF</button>
        </td>
      </tr>`).join('');
    document.getElementById('ordersTable').innerHTML = header + '<tbody>' + (rowsHtml || '<tr><td colspan="9" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
    document.getElementById('recentOrdersTable').innerHTML = header + '<tbody>' + (orders.slice(0, 5).map(o => `
      <tr>
        <td><button class="link-btn" onclick="openOrderDetail(${o.id})">${o.order_code}</button></td><td>${o.customer_name}</td><td>${o.phone || 'Not Provided'}</td><td>${o.items_count || 0}</td><td>${fmt(o.total)}</td><td>${o.payment_method}</td><td>${renderStatusPill(o.payment_status)}</td><td>${renderStatusPill(o.order_status, 'pill')}</td><td class="row-actions"><button onclick="openOrderDetail(${o.id})">View</button></td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
  } catch (err) { showToast(err.message); }
}

async function toggleOrderHistory() {
  const panel = document.getElementById('orderHistoryPanel');
  const button = document.getElementById('orderHistoryToggle');
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', String(!panel.hidden));
  button.textContent = panel.hidden ? 'View Order History' : 'Hide Order History';
  if (!panel.hidden && ALL_ORDER_HISTORY === null) await loadOrderHistory();
}

async function loadOrderHistory() {
  const tbody = document.getElementById('orderHistoryTable');
  try {
    const { orders, order_count: count } = await API.get('/api/orders/history');
    ALL_ORDER_HISTORY = orders || [];
    document.getElementById('orderHistoryCount').textContent = `${count || 0} orders`;
    const header = '<thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Contact</th><th>Products</th><th>Total</th><th>Payment</th><th>Payment status</th><th>Order status</th></tr></thead>';
    const rows = ALL_ORDER_HISTORY.map(order => {
      const products = order.items.map(item => `${escapeHtml(item.product_name_snapshot || item.product_name || 'Product')} × ${item.qty || 0}`).join('<br>') || 'No items';
      return `<tr>
        <td><button class="link-btn" onclick="openOrderDetail(${order.id})">${escapeHtml(order.order_code)}</button></td>
        <td>${escapeHtml(order.created_at || '—')}</td>
        <td>${escapeHtml(order.customer_name || 'Not Provided')}</td>
        <td>${escapeHtml(order.customer_email || 'Not Provided')}<br>${escapeHtml(order.customer_phone || 'Not Provided')}</td>
        <td>${products}</td>
        <td>${fmt(order.total || 0)}</td>
        <td>${escapeHtml(order.payment_method || '—')}</td>
        <td>${renderStatusPill(order.payment_status)}</td>
        <td>${renderStatusPill(order.order_status)}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = header + `<tbody>${rows || '<tr><td colspan="9" class="empty-note">No order history yet.</td></tr>'}</tbody>`;
  } catch (err) {
    ALL_ORDER_HISTORY = null;
    showToast(err.message || 'Could not load order history.');
  }
}

async function downloadOrderHistory() {
  try {
    const response = await fetch('/api/orders/history.xlsx', {
      headers: { Authorization: `Bearer ${API.token()}` },
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { message = (await response.json()).error || message; } catch { /* no JSON error body */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shakarganj_order_history_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Order history Excel downloaded.');
  } catch (err) {
    showToast(err.message || 'Could not download order history.');
  }
}

async function openOrderDetail(orderId) {
  try {
    const payload = await API.get(`/api/orders/${orderId}/detail`);
    CURRENT_ORDER_DETAIL = payload;
    renderOrderDetailModal(payload);
    const modal = document.getElementById('orderDetailModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
  } catch (err) { showToast(err.message); }
}

function closeOrderDetailModal() {
  const modal = document.getElementById('orderDetailModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function renderOrderDetailModal(payload) {
  const order = payload.order || {};
  const items = payload.items || [];
  const subtotal = Number(order.subtotal || 0);
  const deliveryFee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount || 0);
  const total = Number(order.total || 0);

  const productRows = items.map(item => {
    const price = Number(item.unit_price || 0);
    const qty = Number(item.qty || 0);
    const image = item.product_image_snapshot || item.product_image || '';
    return `
      <tr>
        <td><img src="${image || 'assets/trolley.png'}" alt="${(item.product_name || item.product_name_snapshot || 'Product').replace(/"/g, '&quot;')}" /></td>
        <td>
          <strong>${item.product_name || item.product_name_snapshot || 'Product'}</strong><br>
          <span style="color:var(--ink-soft); font-size:11px;">ID: ${item.product_id || '—'}${item.variant_snapshot ? ` · ${item.variant_snapshot}` : ''}</span>
        </td>
        <td>${item.variant_snapshot || '—'}</td>
        <td>${qty}</td>
        <td>${fmt(price)}</td>
        <td>${fmt(Number(item.discount || 0))}</td>
        <td>${fmt(Number(item.line_total || price * qty))}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-note">No products were recorded for this order.</td></tr>';

  document.getElementById('orderDetailTitle').textContent = `Order ${order.order_code || ''}`;
  document.getElementById('orderDetailContent').innerHTML = `
    <div class="order-section">
      <h3>Order Overview</h3>
      <div class="order-grid">
        <div class="field"><label>Order ID</label><span>${order.order_code || '—'}</span></div>
        <div class="field"><label>Order Date</label><span>${order.created_at ? new Date(order.created_at).toLocaleString() : '—'}</span></div>
        <div class="field"><label>Current Status</label><span>${renderStatusPill(order.order_status)}</span></div>
        <div class="field"><label>Payment Method</label><span>${order.payment_method || '—'}</span></div>
        <div class="field"><label>Payment Status</label><span>${renderStatusPill(order.payment_status)}</span></div>
        <div class="field"><label>Reference</label><span>${order.gateway_txn_ref || 'Not Provided'}</span></div>
      </div>
    </div>
    <div class="order-section">
      <h3>Customer Details</h3>
      <div class="order-grid">
        <div class="field"><label>Full Name</label><span>${order.customer_name || 'Not Provided'}</span></div>
        <div class="field"><label>Email</label><span>${order.customer_email || 'Not Provided'}</span></div>
        <div class="field"><label>Phone</label><span>${order.customer_phone || order.phone || 'Not Provided'}</span></div>
        <div class="field"><label>Customer ID</label><span>${order.user_id || 'Not Provided'}</span></div>
        <div class="field"><label>Delivery Address</label><span>${order.address || 'Not Provided'}</span></div>
        <div class="field"><label>City</label><span>${order.city || 'Not Provided'}</span></div>
        <div class="field"><label>Postal Code</label><span>${order.postal_code || 'Not Provided'}</span></div>
        <div class="field"><label>Delivery Instructions</label><span>${order.delivery_instructions || 'Not Provided'}</span></div>
      </div>
    </div>
    <div class="order-section">
      <h3>Ordered Products</h3>
      <table class="order-items-table">
        <thead><tr><th>Image</th><th>Product</th><th>Variant</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Total</th></tr></thead>
        <tbody>${productRows}</tbody>
      </table>
    </div>
    <div class="order-section">
      <h3>Payment Summary</h3>
      <div class="order-summary-grid">
        <div class="order-summary-box">
          <div class="line"><span>Subtotal</span><strong>${fmt(subtotal)}</strong></div>
          <div class="line"><span>Delivery Charges</span><strong>${fmt(deliveryFee)}</strong></div>
          <div class="line"><span>Discount</span><strong>${fmt(discount)}</strong></div>
          <div class="line total"><span>Grand Total</span><strong>${fmt(total)}</strong></div>
        </div>
        <div class="order-summary-box">
          <div class="line"><span>Payment Method</span><strong>${order.payment_method || '—'}</strong></div>
          <div class="line"><span>Payment Status</span><strong>${statusLabel(order.payment_status)}</strong></div>
          <div class="line"><span>Transaction</span><strong>${order.gateway_txn_ref || 'Not Provided'}</strong></div>
          <div class="line"><span>Order Status</span><strong>${statusLabel(order.order_status)}</strong></div>
        </div>
      </div>
    </div>
    <div class="order-section">
      <h3>Admin Actions</h3>
      <div class="order-actions-inline">
        ${order.order_status === 'cancelled' ? renderStatusPill(order.order_status) : `<select id="inlineOrderStatusSelect">${ORDER_STATUSES.map(s => `<option value="${s}" ${s === order.order_status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select><button class="btn small" type="button" onclick="saveInlineOrderStatus(${order.id})">Update Status</button>`}
        <button class="btn small ghost" type="button" onclick="printCurrentOrderReceipt()">Print Receipt</button>
        <button class="btn small ghost" type="button" onclick="downloadCurrentOrderReceipt()">Download PDF</button>
      </div>
    </div>
  `;
}

async function saveInlineOrderStatus(orderId) {
  const select = document.getElementById('inlineOrderStatusSelect');
  const status = select ? select.value : null;
  if (!status) return;
  try {
    await API.patch(`/api/orders/${orderId}/status`, { status });
    showToast('Order status updated.');
    await loadOrders();
    await openOrderDetail(orderId);
  } catch (err) { showToast(err.message); }
}

async function updateOrderStatus(id, status) {
  try {
    await API.patch(`/api/orders/${id}/status`, { status });
    showToast('Order status updated.');
    loadOrders();
  } catch (err) { showToast(err.message); }
}

async function printOrderReceipt(orderId) {
  try {
    const payload = await API.get(`/api/orders/${orderId}/receipt`);
    printReceiptHtml(payload);
  } catch (err) { showToast(err.message); }
}

async function printCurrentOrderReceipt() {
  if (!CURRENT_ORDER_DETAIL) return;
  const payload = CURRENT_ORDER_DETAIL;
  printReceiptHtml(payload);
}

function printReceiptHtml(payload) {
  const order = payload.order || {};
  const items = payload.items || [];
  const subtotal = Number(order.subtotal || 0);
  const deliveryFee = Number(order.delivery_fee || 0);
  const total = Number(order.total || 0);
  const netHtml = `
    <html>
      <head><title>Receipt ${order.order_code}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #1f1f1f; margin: 0; padding: 24px; }
        .receipt { max-width: 700px; margin: 0 auto; }
        h1 { font-size: 26px; margin: 0; }
        .meta { margin-top: 12px; color: #666; font-size: 12px; line-height: 1.7; }
        table { width: 100%; border-collapse: collapse; margin-top: 18px; }
        th, td { border-bottom: 1px solid #d9d9d9; padding: 8px 6px; text-align: left; font-size: 12px; }
        .totals { margin-top: 16px; border-top: 2px solid #111; padding-top: 12px; }
        .totals-row { display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; }
        .totals-row.grand { font-weight:700; font-size:16px; }
        .footer { margin-top: 28px; font-size: 13px; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="receipt">
          <h1>Shakarganj Grocery</h1>
          <div class="meta">
            <div>Order ID: ${order.order_code || '—'}</div>
            <div>Date: ${order.created_at ? new Date(order.created_at).toLocaleString() : '—'}</div>
            <div>Customer: ${order.customer_name || 'Not Provided'}</div>
            <div>Phone: ${order.customer_phone || order.phone || 'Not Provided'}</div>
            <div>Email: ${order.customer_email || 'Not Provided'}</div>
            <div>Address: ${order.address || 'Not Provided'}</div>
          </div>
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>
              ${(items || []).map(item => `<tr><td>${item.product_name || item.product_name_snapshot || 'Product'}</td><td>${item.qty || 0}</td><td>${fmt(Number(item.unit_price || 0))}</td><td>${fmt(Number(item.line_total || (Number(item.unit_price || 0) * Number(item.qty || 0))))}</td></tr>`).join('') || '<tr><td colspan="4">No items recorded.</td></tr>'}
            </tbody>
          </table>
          <div class="totals">
            <div class="totals-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
            <div class="totals-row"><span>Delivery Charges</span><span>${fmt(deliveryFee)}</span></div>
            <div class="totals-row"><span>Discount</span><span>${fmt(Number(order.discount || 0))}</span></div>
            <div class="totals-row grand"><span>Grand Total</span><span>${fmt(total)}</span></div>
          </div>
          <div class="meta" style="margin-top:18px;">
            <div>Payment Method: ${order.payment_method || '—'}</div>
            <div>Payment Status: ${statusLabel(order.payment_status)}</div>
            <div>Order Status: ${statusLabel(order.order_status)}</div>
            <div>Transaction: ${order.gateway_txn_ref || 'Not Provided'}</div>
          </div>
          <div class="footer">Thank you for shopping with us!</div>
        </div>
      </body>
    </html>`;
  const win = window.open('', '_blank', 'width=900,height=800');
  win.document.write(netHtml);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

async function downloadOrderReceipt(orderId) {
  try {
    const payload = await API.get(`/api/orders/${orderId}/receipt`);
    generatePdfReceipt(payload);
  } catch (err) { showToast(err.message); }
}

async function downloadCurrentOrderReceipt() {
  if (!CURRENT_ORDER_DETAIL) return;
  generatePdfReceipt(CURRENT_ORDER_DETAIL);
}

function generatePdfReceipt(payload) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    showToast('PDF library unavailable. Use Print Receipt instead.');
    return;
  }
  const order = payload.order || {};
  const items = payload.items || [];
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(20); doc.text('Shakarganj Grocery', margin, 52);
  doc.setFontSize(10); doc.text(`Order ID: ${order.order_code || '—'}`, margin, 80); doc.text(`Date: ${order.created_at ? new Date(order.created_at).toLocaleString() : '—'}`, margin + 220, 80);
  doc.text(`Customer: ${order.customer_name || 'Not Provided'}`, margin, 100); doc.text(`Phone: ${order.customer_phone || order.phone || 'Not Provided'}`, margin + 220, 100);
  doc.text(`Email: ${order.customer_email || 'Not Provided'}`, margin, 120); doc.text(`Address: ${order.address || 'Not Provided'}`, margin + 220, 120);
  doc.setDrawColor(207, 207, 207); doc.line(margin, 140, pageWidth - margin, 140);
  let y = 165;
  doc.setFontSize(11); doc.text('Product', margin, y); doc.text('Qty', 300, y); doc.text('Unit Price', 370, y); doc.text('Total', 470, y);
  y += 14;
  (items || []).forEach(item => {
    const line = `${item.product_name || item.product_name_snapshot || 'Product'} (${item.variant_snapshot || 'Standard'})`;
    doc.setFontSize(10); const split = doc.splitTextToSize(line, 200); doc.text(split, margin, y); doc.text(String(item.qty || 0), 300, y); doc.text(fmt(Number(item.unit_price || 0)).replace('Rs. ', ''), 370, y); doc.text(fmt(Number(item.line_total || Number(item.unit_price || 0) * Number(item.qty || 0))).replace('Rs. ', ''), 470, y);
    y += 18 + ((split.length - 1) * 10);
    if (y > 720) { doc.addPage(); y = 40; }
  });
  doc.setDrawColor(207, 207, 207); doc.line(margin, y + 8, pageWidth - margin, y + 8); y += 22;
  doc.setFontSize(10); doc.text(`Subtotal: ${fmt(Number(order.subtotal || 0))}`, margin + 300, y); y += 16; doc.text(`Delivery: ${fmt(Number(order.delivery_fee || 0))}`, margin + 300, y); y += 16; doc.text(`Discount: ${fmt(Number(order.discount || 0))}`, margin + 300, y); y += 20; doc.setFontSize(12); doc.text(`Grand Total: ${fmt(Number(order.total || 0))}`, margin + 300, y);
  y += 28; doc.setFontSize(10); doc.text(`Payment Method: ${order.payment_method || '—'}`, margin, y); y += 14; doc.text(`Payment Status: ${statusLabel(order.payment_status)}`, margin, y); y += 14; doc.text(`Order Status: ${statusLabel(order.order_status)}`, margin, y); y += 14; doc.text(`Transaction: ${order.gateway_txn_ref || 'Not Provided'}`, margin, y);
  doc.setFontSize(11); doc.text('Thank you for shopping with us!', margin, 790, { align: 'center' });
  const filename = `Receipt_${order.order_code || 'order'}.pdf`;
  doc.save(filename);
}

/* ============ ANALYTICS ============ */
let catChart = null, payChart = null;
async function loadAnalytics() {
  try {
    const s = await API.get('/api/analytics/summary');
    if (catChart) catChart.destroy();
    if (payChart) payChart.destroy();
    catChart = new Chart(document.getElementById('catChart'), {
      type: 'bar',
      data: { labels: s.byCategory.map(c => c.category), datasets: [{ data: s.byCategory.map(c => c.total), backgroundColor: '#620014', borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#ECE3E0' } }, x: { grid: { display: false } } } },
    });
    payChart = new Chart(document.getElementById('payChart'), {
      type: 'doughnut',
      data: {
        labels: s.byPayment.map(p => p.method),
        datasets: [{ data: s.byPayment.map(p => p.count), backgroundColor: ['#DA1C5C', '#28A745', '#620014', '#3B3B3B', '#D98A2B'] }],
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
    });
  } catch (err) { showToast(err.message); }
}

/* ============ SUPPORT INBOX ============ */
async function loadSupport() {
  try {
    const { messages } = await API.get('/api/support/messages');
    const header = `<thead><tr><th>From</th><th>Topic</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead>`;
    const rows = messages.map(m => `
      <tr>
        <td>${m.name}<br><span style="color:var(--ink-soft); font-size:11px;">${m.email}</span></td>
        <td>${m.topic || 'General'}</td>
        <td style="max-width:280px;">${m.message}</td>
        <td><span class="pill ${m.status}">${m.status}</span></td>
        <td class="row-actions">${m.status === 'open' ? `<button onclick="resolveSupport(${m.id})">Mark resolved</button>` : ''}</td>
      </tr>`).join('');
    document.getElementById('supportTable').innerHTML = header + '<tbody>' + (rows || '<tr><td colspan="5" class="empty-note">No messages yet.</td></tr>') + '</tbody>';
  } catch (err) { showToast(err.message); }
}
async function resolveSupport(id) {
  try {
    await API.patch(`/api/support/messages/${id}/resolve`);
    showToast('Marked as resolved.');
    loadSupport();
  } catch (err) { showToast(err.message); }
}

/* ============ PRODUCT EDITING ============ */
let CURRENT_EDIT_PRODUCT_ID = null;
function openEditProduct(productId) {
  const product = ALL_PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  CURRENT_EDIT_PRODUCT_ID = productId;
  document.getElementById('epName').value = product.name;
  document.getElementById('epUnit').value = product.unit || '';
  document.getElementById('epCat').value = product.category;
  document.getElementById('epPrice').value = product.price;
  document.getElementById('epSalePrice').value = product.sale_price || '';
  document.getElementById('epTag').value = product.tag || '';
  document.getElementById('epStock').value = product.stock;
  document.getElementById('epImg').value = product.image || '';
  document.getElementById('editProductPanel').style.display = 'block';
  document.getElementById('editProductPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeEditProduct() {
  document.getElementById('editProductPanel').style.display = 'none';
  CURRENT_EDIT_PRODUCT_ID = null;
}
async function saveEditProduct() {
  if (!CURRENT_EDIT_PRODUCT_ID) return;
  const name = document.getElementById('epName').value.trim();
  const unit = document.getElementById('epUnit').value.trim();
  const category = document.getElementById('epCat').value;
  const price = parseFloat(document.getElementById('epPrice').value) || 0;
  const salePriceValue = document.getElementById('epSalePrice').value.trim();
  const salePrice = salePriceValue ? parseFloat(salePriceValue) : null;
  const tag = document.getElementById('epTag').value.trim();
  const stock = parseInt(document.getElementById('epStock').value) || 0;
  const image = document.getElementById('epImg').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80';
  if (!name || !price) { showToast('Please enter at least a product name and price.'); return; }
  try {
    await API.put(`/api/products/${CURRENT_EDIT_PRODUCT_ID}`, { name, unit, category, price, salePrice, tag, stock, image });
    showToast('Product updated.');
    closeEditProduct();
    loadProducts();
  } catch (err) { showToast(err.message); }
}

/* ============ SETTINGS ============ */
async function loadSettings() {
  try {
    const { settings } = await API.get('/api/settings');
    if (settings) {
      document.getElementById('setPhone').value = settings.support_phone || '+92 300 1234567';
      document.getElementById('setEmail').value = settings.support_email || 'orders@shakarganj.pk';
    }
    document.getElementById('setTheme').value = sessionStorage.getItem('sg_theme') || 'maroon';
  } catch (err) {
    // If no settings exist yet, that's fine — use defaults
  }
}
async function saveSettings() {
  try {
    const settingsData = {
      support_phone: document.getElementById('setPhone').value || '+92 300 1234567',
      support_email: document.getElementById('setEmail').value.trim() || 'orders@shakarganj.pk'
    };
    await API.put('/api/settings', settingsData);
    sessionStorage.setItem('sg_theme', document.getElementById('setTheme').value);
    applyTemporaryTheme(document.getElementById('setTheme').value);
    showToast('Settings saved successfully.');
  } catch (err) { showToast(err.message); }
}

/* ============ MEMBERS/EMPLOYEES ============ */
let ALL_MEMBERS = [];
async function loadMembers() {
  try {
    const { members } = await API.get('/api/employees');
    ALL_MEMBERS = members || [];
    renderMembers();
  } catch (err) { 
    ALL_MEMBERS = [];
    renderMembers();
  }
}
function renderMembers(filter = '') {
  const list = ALL_MEMBERS.filter(m => 
    m.name.toLowerCase().includes(filter.toLowerCase()) || 
    m.email.toLowerCase().includes(filter.toLowerCase())
  );
  document.getElementById('memberCount').textContent = list.length + ' members';
  document.getElementById('membersTbody').innerHTML = list.map(m => {
    const created = new Date(m.created_at).toLocaleDateString();
    return `<tr>
      <td>${m.name}</td>
      <td>${m.email}</td>
      <td>${m.role}</td>
      <td>${created}</td>
      <td class="row-actions"><button class="del" onclick="deleteMember(${m.id})">Remove</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-note">No members yet. Create one with the button above.</td></tr>';
}
function filterMembers(v) { renderMembers(v); }
function openAddMember() { document.getElementById('addMemberPanel').style.display = 'block'; document.getElementById('addMemberPanel').scrollIntoView({ behavior: 'smooth' }); }
function closeAddMember() { document.getElementById('addMemberPanel').style.display = 'none'; }
async function addMember() {
  const name = document.getElementById('nmName').value.trim();
  const email = document.getElementById('nmEmail').value.trim().toLowerCase();
  const password = document.getElementById('nmPassword').value;
  if (!name || !email || !password) { showToast('Please fill in all fields.'); return; }
  if (password.length < 8) { showToast('Password must be at least 8 characters.'); return; }
  try {
    await API.post('/api/employees', { name, email, password });
    showToast('Member created successfully. They can now log in.');
    closeAddMember();
    document.getElementById('nmName').value = '';
    document.getElementById('nmEmail').value = '';
    document.getElementById('nmPassword').value = '';
    loadMembers();
  } catch (err) { showToast(err.message); }
}
async function deleteMember(id) {
  if (!confirm('Remove this member? They will no longer be able to log in.')) return;
  try {
    await API.delete(`/api/employees/${id}`);
    showToast('Member removed.');
    loadMembers();
  } catch (err) { showToast(err.message); }
}

// public/js/user.js — User Panel logic.
//
// Server-side authorization is what actually protects the data (every API
// call below is checked against the session on the backend). This
// client-side guard just gives an unauthenticated or wrong-role visitor an
// immediate redirect instead of a page full of failed requests.
(function guard() {
  const user = API.user();
  if (!user || !API.token()) {
    location.href = 'login.html';
    return;
  }
  if (user.role !== 'user') {
    // An admin/manager/staff account landing here — send them to the panel
    // that's actually theirs instead of a User Panel with nothing in it.
    location.href = 'admin.html';
  }
})();

function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]); }

function logout() {
  API.logout().then(() => { location.href = 'login.html'; });
}

let userToastTimer;
function showUserToast(message) {
  showMessage(message);
}

async function cancelOrder(orderId) {
  if (!await confirmAction('Cancel this order?', 'Cancel order')) return;
  try {
    await API.patch(`/api/orders/${orderId}/cancel`, {});
    showUserToast('Order cancelled.');
    await loadAccount();
  } catch (err) {
    showUserToast(err.message);
  }
}

async function showOrderDetails(orderCode) {
  try {
    const payload = await API.get(`/api/orders/${encodeURIComponent(orderCode)}`);
    const order = payload.order || {};
    const items = payload.items || [];
    const itemRows = items.map(item => {
      const price = Number(item.unit_price || 0);
      const quantity = Number(item.qty || 0);
      const name = item.product_name || item.product_name_snapshot || 'Product';
      const image = item.product_image_snapshot || item.product_image || '';
      return `
        <tr>
          <td><img src="${escapeHtml(image || 'assets/trolley.png')}" alt="${escapeHtml(name)}"></td>
          <td><strong>${escapeHtml(name)}</strong>${item.variant_snapshot ? `<br><span>${escapeHtml(item.variant_snapshot)}</span>` : ''}</td>
          <td>${quantity}</td>
          <td>${fmt(price)}</td>
          <td>${fmt(Number(item.line_total || price * quantity))}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="empty-note">No products were recorded for this order.</td></tr>';
    const status = value => {
      const label = String(value || 'Not provided').replace(/_/g, ' ');
      const className = String(value || '').replace(/[^a-z0-9_-]/gi, '');
      return `<span class="status-badge ${className}">${escapeHtml(label)}</span>`;
    };
    const detailField = (label, value) => `<div class="field"><label>${label}</label><span>${escapeHtml(value || 'Not provided')}</span></div>`;

    document.getElementById('userOrderDetailTitle').textContent = `Order ${order.order_code || ''}`;
    document.getElementById('userOrderDetailContent').innerHTML = `
      <div class="order-section">
        <h3>Order Overview</h3>
        <div class="order-grid">
          ${detailField('Order Date', order.created_at ? new Date(order.created_at).toLocaleString() : 'Not provided')}
          <div class="field"><label>Order Status</label><span>${status(order.order_status)}</span></div>
          <div class="field"><label>Payment Status</label><span>${status(order.payment_status)}</span></div>
          ${detailField('Payment Method', order.payment_method_display || order.payment_method)}
        </div>
      </div>
      <div class="order-section">
        <h3>Delivery Details</h3>
        <div class="order-grid">
          ${detailField('Name', order.customer_name)}
          ${detailField('Phone', order.customer_phone || order.phone)}
          ${detailField('Address', order.delivery_address || order.address)}
          ${detailField('City', order.city)}
          ${detailField('Postal Code', order.postal_code)}
          ${detailField('Delivery Instructions', order.delivery_instructions)}
        </div>
      </div>
      <div class="order-section">
        <h3>Items</h3>
        <table class="order-items-table">
          <thead><tr><th>Image</th><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>
      <div class="order-section">
        <h3>Payment Summary</h3>
        <div class="order-summary-box">
          <div class="line"><span>Subtotal</span><strong>${fmt(Number(order.subtotal || 0))}</strong></div>
          <div class="line"><span>Delivery Charges</span><strong>${fmt(Number(order.delivery_fee || 0))}</strong></div>
          <div class="line"><span>Discount</span><strong>${fmt(Number(order.discount || 0))}</strong></div>
          <div class="line total"><span>Grand Total</span><strong>${fmt(Number(order.total || 0))}</strong></div>
        </div>
      </div>`;

    const modal = document.getElementById('userOrderDetailModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  } catch (err) {
    showUserToast(err.message || 'Could not load order details.');
  }
}

function closeUserOrderDetail() {
  const modal = document.getElementById('userOrderDetailModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function showUserPage(page) {
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#userNav a').forEach(a => a.classList.remove('active'));
  document.querySelectorAll('#mobileUserNav a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const link = document.querySelector(`#userNav a[data-page="${page}"]`);
  if (link) link.classList.add('active');
  const mobileLink = document.querySelector(`#mobileUserNav a[data-page="${page}"]`);
  if (mobileLink) mobileLink.classList.add('active');
}

function setupMobilePanelNav() {
  const source = document.getElementById('userNav');
  const menu = document.getElementById('mobileUserNav');
  const toggle = document.getElementById('mobileUserNavToggle');
  if (!source || !menu || !toggle) return;

  menu.replaceChildren(...Array.from(source.children, link => link.cloneNode(true)));
  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'mobile-panel-logout';
  logoutButton.textContent = 'Sign out';
  logoutButton.addEventListener('click', logout);
  menu.appendChild(logoutButton);
  menu.querySelector('[data-page="overview"]')?.classList.add('active');

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open account navigation');
  };
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    toggle.setAttribute('aria-label', menu.hidden ? 'Open account navigation' : 'Close account navigation');
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

async function loadAccount() {
  const user = API.user();
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('greeting').textContent = `Welcome back, ${user.name.split(' ')[0]}`;
  document.getElementById('profileName').value = user.name;
  document.getElementById('profileEmail').value = user.email;

  try {
    const { orders } = await API.get('/api/orders/mine');
    document.getElementById('kpiOrderCount').textContent = orders.length;
    const totalSpent = orders.reduce((s, o) => s + (o.payment_status === 'paid' || o.payment_status === 'cod_pending' ? o.total : 0), 0);
    document.getElementById('kpiTotalSpent').textContent = fmt(totalSpent);
    document.getElementById('kpiLastOrder').textContent = orders.length ? orders[0].order_code : 'No orders yet';

    const header = `<thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th><th>Details</th><th>Action</th></tr></thead>`;
    const canAttemptCancellation = order => !['delivered', 'returned', 'cancelled'].includes(order.order_status);
    const rowHtml = (o) => `
      <tr>
        <td>${escapeHtml(o.order_code)}</td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td>${fmt(o.total)}</td>
        <td>${escapeHtml(o.payment_method)}</td>
        <td><span class="pill ${escapeHtml(o.order_status)}">${escapeHtml(o.order_status.replace(/_/g, ' '))}</span></td>
        <td class="row-actions"><button type="button" onclick="showOrderDetails(this.dataset.orderCode)" data-order-code="${escapeHtml(o.order_code)}">Details</button></td>
        <td class="row-actions">${canAttemptCancellation(o) ? `<button class="del" onclick="cancelOrder(${o.id})">Cancel order</button>` : '—'}</td>
      </tr>`;
    const rows = orders.map(rowHtml).join('') || '<tr><td colspan="7" class="empty-note">No orders yet — go find something fresh!</td></tr>';
    document.getElementById('allOrdersTable').innerHTML = header + '<tbody>' + rows + '</tbody>';
    document.getElementById('recentOrdersTable').innerHTML = header + '<tbody>' + (orders.slice(0, 5).map(rowHtml).join('') || '<tr><td colspan="7" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
  } catch (err) {
    document.getElementById('allOrdersTable').innerHTML = `<tr><td class="empty-note">${escapeHtml(err.message)}</td></tr>`;
  }
}

setupMobilePanelNav();
document.getElementById('userOrderDetailModal').addEventListener('click', event => {
  if (event.target.id === 'userOrderDetailModal') closeUserOrderDetail();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeUserOrderDetail();
});
loadAccount();

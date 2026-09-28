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

function logout() {
  API.logout().then(() => { location.href = 'login.html'; });
}

let userToastTimer;
function showUserToast(message) {
  const toast = document.getElementById('userToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(userToastTimer);
  userToastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

async function cancelOrder(orderId) {
  if (!window.confirm('Cancel this order?')) return;
  try {
    await API.patch(`/api/orders/${orderId}/cancel`, {});
    showUserToast('Order cancelled.');
    await loadAccount();
  } catch (err) {
    showUserToast(err.message);
  }
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

    const header = `<thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>`;
    const canAttemptCancellation = order => !['delivered', 'returned', 'cancelled'].includes(order.order_status);
    const rowHtml = (o) => `
      <tr>
        <td>${o.order_code}</td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td>${fmt(o.total)}</td>
        <td>${o.payment_method}</td>
        <td><span class="pill ${o.order_status}">${o.order_status.replace(/_/g, ' ')}</span></td>
        <td class="row-actions">${canAttemptCancellation(o) ? `<button class="del" onclick="cancelOrder(${o.id})">Cancel order</button>` : '—'}</td>
      </tr>`;
    const rows = orders.map(rowHtml).join('') || '<tr><td colspan="6" class="empty-note">No orders yet — go find something fresh!</td></tr>';
    document.getElementById('allOrdersTable').innerHTML = header + '<tbody>' + rows + '</tbody>';
    document.getElementById('recentOrdersTable').innerHTML = header + '<tbody>' + (orders.slice(0, 5).map(rowHtml).join('') || '<tr><td colspan="6" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
  } catch (err) {
    document.getElementById('allOrdersTable').innerHTML = `<tr><td class="empty-note">${err.message}</td></tr>`;
  }
}

setupMobilePanelNav();
loadAccount();

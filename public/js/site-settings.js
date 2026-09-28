// Shared public contact settings and temporary theme preview.
const TEMPORARY_THEMES = {
  maroon: { primary: '#620014', dark: '#4a000f', tint: '#F1DDE1', footer: '#2A1014' },
  teal: { primary: '#0F766E', dark: '#115E59', tint: '#D7F1EE', footer: '#123B38' },
  blue: { primary: '#1D4ED8', dark: '#1E3A8A', tint: '#DBEAFE', footer: '#172B53' },
  green: { primary: '#166534', dark: '#14532D', tint: '#DCFCE7', footer: '#183B25' },
};

function applyTemporaryTheme(themeName) {
  const theme = TEMPORARY_THEMES[themeName] || TEMPORARY_THEMES.maroon;
  const root = document.documentElement;
  root.style.setProperty('--maroon', theme.primary);
  root.style.setProperty('--maroon-dark', theme.dark);
  root.style.setProperty('--maroon-tint', theme.tint);
  root.style.setProperty('--footer-bg', theme.footer);
}

applyTemporaryTheme(sessionStorage.getItem('sg_theme') || 'maroon');

async function loadPublicSiteSettings() {
  try {
    const { settings } = await API.get(`/api/settings/public?ts=${Date.now()}`);
    document.querySelectorAll('[data-setting="phone"]').forEach(element => {
      element.textContent = settings.support_phone || '+92 300 1234567';
    });
    document.querySelectorAll('[data-setting="email"]').forEach(element => {
      element.textContent = settings.support_email || 'orders@shakarganj.pk';
      if (element.tagName === 'A') element.href = `mailto:${settings.support_email || 'orders@shakarganj.pk'}`;
    });
    document.querySelectorAll('li').forEach(element => {
      if (element.textContent.trim() === 'orders@shakarganj.pk') element.textContent = settings.support_email || 'orders@shakarganj.pk';
      if (element.textContent.trim() === '+92 300 1234567') element.textContent = settings.support_phone || '+92 300 1234567';
    });
  } catch (err) {
    // Static HTML defaults remain visible if the public settings request fails.
  }
}

const ADMIN_ORDER_ALERT_KEY = 'sg_admin_last_seen_order_id';
const ADMIN_ORDER_ALERT_ROLES = ['admin', 'manager', 'staff', 'employee'];
let latestAdminOrderId = 0;
let adminAlertVisible = false;
let adminAlertRequest = 0;

function renderAdminAlerts(alerts) {
  const categories = {
    orders: Boolean(alerts.orders),
    products: Number(alerts.out_of_stock_count) > 0,
    support: Number(alerts.open_support_count) > 0,
    deals: Number(alerts.deleted_deal_container_count) > 0,
  };
  const hasAlerts = Object.values(categories).some(Boolean);
  const newlyAlerted = hasAlerts && !adminAlertVisible;
  adminAlertVisible = hasAlerts;
  document.querySelectorAll('[data-admin-alert]').forEach(dot => {
    dot.hidden = !categories[dot.dataset.adminAlert];
  });
  document.querySelectorAll('.mobile-alert-indicator').forEach(dot => {
    dot.hidden = !hasAlerts;
  });
  const accountLink = document.getElementById('accountLink');
  if (accountLink) {
    accountLink.classList.toggle('has-admin-alert', hasAlerts);
    accountLink.setAttribute('aria-label', hasAlerts ? 'Settings, new admin alerts' : 'Settings');
  }
  if (newlyAlerted && document.querySelector('[data-admin-alert]') && typeof showToast === 'function') {
    showToast('New admin alert received.');
  }
}

async function refreshAdminAlerts(markOrdersAsSeen = false) {
  const user = API.user();
  if (!user || !API.token() || !ADMIN_ORDER_ALERT_ROLES.includes(user.role)) {
    renderAdminAlerts({});
    return;
  }

  const requestId = ++adminAlertRequest;
  try {
    const { alerts } = await API.get('/api/admin/alerts');
    if (requestId !== adminAlertRequest) return;
    latestAdminOrderId = Number(alerts.latest_order_id) || 0;
    const lastSeen = localStorage.getItem(ADMIN_ORDER_ALERT_KEY);
    let hasUnreadOrders = latestAdminOrderId > (Number(lastSeen) || 0);
    if (lastSeen === null) {
      localStorage.setItem(ADMIN_ORDER_ALERT_KEY, String(latestAdminOrderId));
      hasUnreadOrders = false;
    } else if (markOrdersAsSeen) {
      localStorage.setItem(ADMIN_ORDER_ALERT_KEY, String(latestAdminOrderId));
      hasUnreadOrders = false;
    }
    renderAdminAlerts({ ...alerts, orders: hasUnreadOrders });
  } catch (error) {
    // Keep the current indicator state if a poll briefly fails.
  }
}

function markAdminOrdersSeen() {
  refreshAdminAlerts(true);
}

async function markAdminDealsSeen() {
  try {
    await API.post('/api/admin/alerts/deals/seen', {});
    await refreshAdminAlerts();
  } catch (error) {
    // Keep the deletion alert visible if marking it read fails.
  }
}

function startAdminOrderAlertPolling() {
  const user = API.user();
  if (!user || !ADMIN_ORDER_ALERT_ROLES.includes(user.role)) return;
  refreshAdminAlerts();
  if (!window.adminOrderAlertTimer) {
    window.adminOrderAlertTimer = setInterval(refreshAdminAlerts, 15000);
  }
}

if (document.getElementById('accountLink') || document.querySelector('[data-admin-alert]')) {
  startAdminOrderAlertPolling();
}

loadPublicSiteSettings();

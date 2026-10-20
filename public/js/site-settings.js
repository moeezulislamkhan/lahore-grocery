// Shared public contact settings and temporary theme preview.
const TEMPORARY_THEMES = {
  maroon: {
    primary: '#620014', dark: '#4a000f', tint: '#F1DDE1', footer: '#2A1014',
    primaryBorder: 'rgba(98, 0, 20, 0.4)',
    heroGlow: 'rgba(142, 16, 47, 0.58)', heroGlowSoft: 'rgba(142, 16, 47, 0.22)',
    heroHighlight: 'rgba(196, 32, 77, 0.24)', heroAccent: '#f1bd79',
    heroStart: '#520013', heroMiddle: '#41000f', heroEnd: '#31000b',
  },
  teal: {
    primary: '#0F766E', dark: '#115E59', tint: '#D7F1EE', footer: '#123B38',
    primaryBorder: 'rgba(15, 118, 110, 0.4)',
    heroGlow: 'rgba(20, 184, 166, 0.48)', heroGlowSoft: 'rgba(20, 184, 166, 0.18)',
    heroHighlight: 'rgba(45, 212, 191, 0.2)', heroAccent: '#99f6e4',
    heroStart: '#0b4b46', heroMiddle: '#083c38', heroEnd: '#062f2c',
  },
  blue: {
    primary: '#1D4ED8', dark: '#1E3A8A', tint: '#DBEAFE', footer: '#172B53',
    primaryBorder: 'rgba(29, 78, 216, 0.4)',
    heroGlow: 'rgba(59, 130, 246, 0.5)', heroGlowSoft: 'rgba(59, 130, 246, 0.18)',
    heroHighlight: 'rgba(96, 165, 250, 0.22)', heroAccent: '#bfdbfe',
    heroStart: '#183b98', heroMiddle: '#132f73', heroEnd: '#102652',
  },
  green: {
    primary: '#166534', dark: '#14532D', tint: '#DCFCE7', footer: '#183B25',
    primaryBorder: 'rgba(22, 101, 52, 0.4)',
    heroGlow: 'rgba(34, 160, 83, 0.48)', heroGlowSoft: 'rgba(34, 160, 83, 0.18)',
    heroHighlight: 'rgba(74, 222, 128, 0.2)', heroAccent: '#bbf7d0',
    heroStart: '#124d2a', heroMiddle: '#103d23', heroEnd: '#0a2d19',
  },
};

function applyTemporaryTheme(themeName) {
  const theme = TEMPORARY_THEMES[themeName] || TEMPORARY_THEMES.maroon;
  const root = document.documentElement;
  root.style.setProperty('--maroon', theme.primary);
  root.style.setProperty('--maroon-dark', theme.dark);
  root.style.setProperty('--maroon-tint', theme.tint);
  root.style.setProperty('--maroon-border', theme.primaryBorder);
  root.style.setProperty('--footer-bg', theme.footer);
  root.style.setProperty('--hero-glow', theme.heroGlow);
  root.style.setProperty('--hero-glow-soft', theme.heroGlowSoft);
  root.style.setProperty('--hero-highlight', theme.heroHighlight);
  root.style.setProperty('--hero-accent', theme.heroAccent);
  root.style.setProperty('--hero-start', theme.heroStart);
  root.style.setProperty('--hero-middle', theme.heroMiddle);
  root.style.setProperty('--hero-end', theme.heroEnd);
}

const storedTheme = localStorage.getItem('sg_theme') || sessionStorage.getItem('sg_theme') || 'maroon';
applyTemporaryTheme(storedTheme);
window.addEventListener('storage', event => {
  if (event.key === 'sg_theme') applyTemporaryTheme(event.newValue || 'maroon');
});

const observedProductInteractions = new Set();
const productImpressionObservers = new WeakMap();

window.trackProductInteraction = async function(productId, eventType) {
  const user = API.user();
  if (!API.token() || !user || user.role !== 'user') return;
  try {
    await API.post('/api/recommendations/events', { productId, eventType });
  } catch (error) {
    console.warn('[personalization] Product interaction could not be recorded.', error);
  }
};

window.observeProductImpressions = function(container) {
  const user = API.user();
  if (!container || !window.IntersectionObserver || !API.token() || !user || user.role !== 'user') return;

  const previousObserver = productImpressionObservers.get(container);
  if (previousObserver) previousObserver.disconnect();

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const productId = Number(entry.target.dataset.productId);
      const eventType = entry.target.dataset.eventType || 'view';
      const key = `${eventType}:${productId}`;
      observer.unobserve(entry.target);
      if (!productId || observedProductInteractions.has(key)) return;
      observedProductInteractions.add(key);
      window.trackProductInteraction(productId, eventType);
    });
  }, { threshold: 0.25 });

  productImpressionObservers.set(container, observer);
  container.querySelectorAll('[data-product-id]').forEach(card => observer.observe(card));
};

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

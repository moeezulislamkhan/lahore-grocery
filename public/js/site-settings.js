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

loadPublicSiteSettings();

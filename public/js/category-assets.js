const CATEGORY_IMAGES = {
  'All Products': 'assets/grocery_category_assets/all-products.png',
  'Bakery': 'assets/grocery_category_assets/bakery.png',
  'Beverages': 'assets/grocery_category_assets/beverages.png',
  'Dairy & Eggs': 'assets/grocery_category_assets/dairy-eggs.png',
  'Fruits & Vegetables': 'assets/grocery_category_assets/fruits-vegetables.png',
  'Household': 'assets/grocery_category_assets/household.png',
  'Pink Salt': 'assets/grocery_category_assets/pink-salt.png',
  'Rice, Atta & Pulses': 'assets/grocery_category_assets/rice-atta-pulses.png',
};

const CATEGORY_FALLBACK_ICONS = { 'Meat & Poultry': '🍗' };
function categoryProductImageErrorHandler(category) {
  const fallback = CATEGORY_IMAGES[category];
  return fallback ? ` onerror="this.onerror=null;this.src='${fallback}'"` : '';
}

function setCategoryProductImageFallback(image, category) {
  const fallback = CATEGORY_IMAGES[category];
  if (fallback) {
    image.addEventListener('error', () => {
      image.src = fallback;
    }, { once: true });
  }
}

const CATEGORY_CARD_CLASSES = {
  'All Products': ' cat-card--all-products',
  'Bakery': ' cat-card--bakery',
  'Beverages': ' cat-card--beverages',
  'Dairy & Eggs': ' cat-card--dairy-eggs',
  'Fruits & Vegetables': ' cat-card--fruits-vegetables',
  'Household': ' cat-card--household',
  'Pink Salt': ' cat-card--pink-salt',
  'Rice, Atta & Pulses': ' cat-card--rice-atta-pulses',
};

function categoryCardClass(category) {
  return CATEGORY_CARD_CLASSES[category] || '';
}

function categoryCardContent(category, label = category) {
  const image = CATEGORY_IMAGES[category];
  const fallbackIcon = CATEGORY_FALLBACK_ICONS[category] || '';
  const artwork = image
    ? `<img src="${image}" alt="" loading="lazy" decoding="async">`
    : fallbackIcon ? `<span class="cat-fallback-icon" aria-hidden="true">${fallbackIcon}</span>` : '';
  const safeLabel = String(label).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  return `<div class="cat-art" aria-hidden="true">${artwork}</div><div class="lbl">${safeLabel}</div>`;
}
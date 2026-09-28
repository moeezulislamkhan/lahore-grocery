const HERO_ROTATION_KEY_PREFIX = 'sg_collection_rotation_start_';
let FEATURED_COLLECTION = null;
let HERO_ROTATION_TIMER = null;
let PROMO_TICKER_RESIZE_OBSERVER = null;

function renderFeaturedCollectionProducts() {
  const hero = document.getElementById('featuredCollectionHero');
  if (!hero || !FEATURED_COLLECTION) return;
  const products = FEATURED_COLLECTION.products || [];
  const interval = Math.max(1, Number(FEATURED_COLLECTION.rotation_interval_minutes) || 30) * 60 * 1000;
  const key = HERO_ROTATION_KEY_PREFIX + FEATURED_COLLECTION.slug;
  let anchor = Number(localStorage.getItem(key));
  if (!anchor) {
    anchor = Date.now();
    localStorage.setItem(key, String(anchor));
  }
  const groupCount = Math.max(1, Math.ceil(products.length / 3));
  const group = Math.floor((Date.now() - anchor) / interval) % groupCount;
  const start = group * 3;
  const visibleProducts = products.length
    ? Array.from({ length: Math.min(3, products.length) }, (_, slot) => products[(start + slot) % products.length])
    : [];

  if (!visibleProducts.length) return;
  hero.classList.add('is-updating');
  hero.querySelectorAll('.collection-product-card').forEach(card => card.remove());
  visibleProducts.forEach((product, index) => {
    const card = document.createElement('a');
    card.className = `card collection-product-card${index === 0 ? ' tall' : ''}`;
    card.href = `category.html?collection=${encodeURIComponent(FEATURED_COLLECTION.slug)}`;
    const image = document.createElement('img');
    image.src = product.image || '';
    image.alt = product.name;
    const name = document.createElement('div');
    name.className = 'p-name';
    name.textContent = product.name;
    const price = document.createElement('div');
    price.className = 'p-price';
    price.textContent = `Rs. ${Math.round(Number(product.effective_price || product.sale_price || product.price)).toLocaleString()}`;
    card.append(image, name, price);
    hero.insertBefore(card, document.getElementById('featuredCollectionButton'));
  });
  hero.classList.remove('is-updating');

  if (HERO_ROTATION_TIMER) clearTimeout(HERO_ROTATION_TIMER);
  const nextRotation = interval - ((Date.now() - anchor) % interval);
  HERO_ROTATION_TIMER = setTimeout(renderFeaturedCollectionProducts, nextRotation + 50);
}

async function loadFeaturedCollection() {
  const hero = document.getElementById('featuredCollectionHero');
  if (!hero) return;
  try {
    const { collection } = await API.get('/api/collections/featured');
    if (!collection) return;
    FEATURED_COLLECTION = collection;
    document.getElementById('featuredCollectionTitle').textContent = collection.title;
    const button = document.getElementById('featuredCollectionButton');
    button.textContent = collection.button_text;
    button.href = `category.html?collection=${encodeURIComponent(collection.slug)}`;
    renderFeaturedCollectionProducts();
  } catch (error) {
    console.error('[collections] Could not load featured collection:', error);
  }
}

async function loadPromoTicker() {
  const track = document.getElementById('promoTickerTrack');
  if (!track) return;
  try {
    const { messages } = await API.get('/api/promo-messages');
    if (!messages.length) {
      track.closest('.promo-ticker').hidden = true;
      return;
    }
    renderPromoTicker(messages);
    const ticker = track.parentElement;
    if ('ResizeObserver' in window) {
      let lastWidth = 0;
      PROMO_TICKER_RESIZE_OBSERVER?.disconnect();
      PROMO_TICKER_RESIZE_OBSERVER = new ResizeObserver(entries => {
        const nextWidth = entries[0]?.contentRect.width || 0;
        if (nextWidth > 0 && Math.abs(nextWidth - lastWidth) > 0.5) {
          lastWidth = nextWidth;
          renderPromoTicker(messages);
        }
      });
      PROMO_TICKER_RESIZE_OBSERVER.observe(ticker);
    } else {
      let resizeFrame = 0;
      window.addEventListener('resize', () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => renderPromoTicker(messages));
      }, { passive: true });
      const app = document.getElementById('app');
      if (app) {
        new MutationObserver(() => {
          if (ticker.clientWidth > 0) renderPromoTicker(messages);
        }).observe(app, { attributes: true, attributeFilter: ['class'] });
      }
    }
  } catch (error) {
    console.error('[collections] Could not load promotional messages:', error);
  }
}

function renderPromoTicker(messages) {
  const track = document.getElementById('promoTickerTrack');
  if (!track || !messages.length) return;
  const width = track.parentElement.clientWidth;
  if (width <= 0) return;
  track.replaceChildren();

  const createGroup = isDuplicate => {
    const group = document.createElement('div');
    group.className = 'promo-ticker-group';
    if (isDuplicate) group.setAttribute('aria-hidden', 'true');
    const appendMessage = item => {
      const block = document.createElement('span');
      block.textContent = item.message;
      block.style.flexBasis = 'auto';
      block.style.maxWidth = `${width}px`;
      group.appendChild(block);
      return block;
    };

    messages.forEach(appendMessage);
    return group;
  };

  const firstGroup = createGroup(false);
  track.appendChild(firstGroup);
  const sequenceWidth = firstGroup.getBoundingClientRect().width;
  const groupGap = parseFloat(getComputedStyle(firstGroup).columnGap || getComputedStyle(firstGroup).gap) || 0;
  const repeatsNeeded = sequenceWidth > 0 ? Math.ceil((width + groupGap) / (sequenceWidth + groupGap)) : 1;
  const repeatCount = Math.min(100, Math.max(1, repeatsNeeded));
  const originalBlocks = [...firstGroup.children];
  for (let repeat = 1; repeat < repeatCount; repeat++) {
    originalBlocks.forEach(block => firstGroup.appendChild(block.cloneNode(true)));
  }
  const secondGroup = firstGroup.cloneNode(true);
  secondGroup.setAttribute('aria-hidden', 'true');
  track.appendChild(secondGroup);
  const groups = [firstGroup, secondGroup];

  const trackGap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
  const loopDistance = groups[0].getBoundingClientRect().width + trackGap;
  track.style.setProperty('--promo-loop-distance', `${loopDistance}px`);
  track.style.setProperty('--promo-duration', `${Math.max(8, loopDistance / 45)}s`);
}

loadFeaturedCollection();
loadPromoTicker();
/**
 * @file UI module for miniMerch
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} CardState
 * @property {string} selectedSize - Selected size ID
 * @property {number} selectedQuantity - Selected quantity
 */

/** @type {Object<number, CardState>} */
const cardState = {};

/** @type {string} */
let currentView = 'shop';

/** @type {Object|null} */
let selectedMessage = null;

/** @type {number} */
let currentProductIndex = 0;

/** @type {boolean} */
let _carouselMode = false;

/** @type {boolean} */
let _carouselListenersAdded = false;

/** @type {boolean} */
let _modalListenersReady = false;

// matchMedia query — carousel mode below this width
const CAROUSEL_MQ = window.matchMedia('(max-width: 599px)');

/**
 * Get card state for a product
 * @param {number} idx - Product index
 * @returns {CardState} Card state
 */
function getCardState(idx) {
    if (!cardState[idx]) {
        cardState[idx] = { selectedSize: 'eighth', selectedQuantity: 1 };
    }
    return cardState[idx];
}

/**
 * Get all card states
 * @returns {Object<number, CardState>} All card states
 */
function getAllCardStates() {
    return cardState;
}

/**
 * Get current view
 * @returns {string} Current view
 */
function getCurrentView() {
    return currentView;
}

/**
 * Set current view
 * @param {string} view - New view
 */
function setCurrentView(view) {
    currentView = view;
}

/**
 * Get selected message
 * @returns {Object|null} Selected message
 */
function getSelectedMessage() {
    return selectedMessage;
}

/**
 * Set selected message
 * @param {Object|null} msg - Message
 */
function setSelectedMessage(msg) {
    selectedMessage = msg;
}

/**
 * Get current product index
 * @returns {number} Product index
 */
function getCurrentProductIndex() {
    return currentProductIndex;
}

/**
 * Set current product index
 * @param {number} idx - Index
 */
function setCurrentProductIndex(idx) {
    currentProductIndex = idx;
}

/**
 * Check if in carousel mode
 * @returns {boolean} True if carousel mode
 */
function isCarouselMode() {
    return CAROUSEL_MQ.matches;
}

/**
 * Check if carousel listeners are added
 * @returns {boolean} True if added
 */
function areCarouselListenersAdded() {
    return _carouselListenersAdded;
}

/**
 * Mark carousel listeners as added
 */
function markCarouselListenersAdded() {
    _carouselListenersAdded = true;
}

/**
 * Check if modal listeners are ready
 * @returns {boolean} True if ready
 */
function areModalListenersReady() {
    return _modalListenersReady;
}

/**
 * Mark modal listeners as ready
 */
function markModalListenersReady() {
    _modalListenersReady = true;
}

/**
 * Apply layout mode (grid or carousel)
 */
function applyLayoutMode() {
    _carouselMode = isCarouselMode();
    const total = PRODUCTS.length;
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dotsEl  = document.getElementById('carousel-dots');

    if (!_carouselMode || total <= 1) {
        // Grid mode — show all cards, hide carousel chrome
        document.querySelectorAll('.product-card').forEach(c => c.classList.remove('carousel-hidden'));
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (dotsEl)  dotsEl.style.display  = 'none';
    } else {
        // Carousel mode — show only active card
        document.querySelectorAll('.product-card').forEach((c, i) => {
            c.classList.toggle('carousel-hidden', i !== currentProductIndex);
        });
        if (prevBtn) prevBtn.style.display = '';
        if (nextBtn) nextBtn.style.display = '';
        if (dotsEl)  dotsEl.style.display  = '';
        renderCarouselDots();
    }
}

/**
 * Render carousel dots
 */
function renderCarouselDots() {
    const dotsEl = document.getElementById('carousel-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = PRODUCTS.map((_, i) =>
        `<button class="carousel-dot${i === currentProductIndex ? ' active' : ''}" data-index="${i}" aria-label="Product ${i + 1}"></button>`
    ).join('');
    dotsEl.querySelectorAll('.carousel-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const target = parseInt(dot.dataset.index);
            navigateProduct(target - currentProductIndex);
        });
    });
}

/**
 * Navigate products
 * @param {number} direction - Direction (+1 or -1)
 */
function navigateProduct(direction) {
    const total = PRODUCTS.length;
    currentProductIndex = (currentProductIndex + direction + total) % total;
    // eslint-disable-next-line no-global-assign
    PRODUCT = PRODUCTS[currentProductIndex];

    if (_carouselMode) {
        document.querySelectorAll('.product-card').forEach((c, i) => {
            c.classList.toggle('carousel-hidden', i !== currentProductIndex);
        });
        renderCarouselDots();
    }
}

/**
 * Update cart badge
 */
function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const totalQty = getCartTotalQuantity();
    badge.textContent = totalQty;
    badge.classList.toggle('hidden', totalQty === 0);
}

/**
 * Show payment status
 * @param {string} message - Status message
 * @param {string} type - Status type (success, error, pending)
 */
function showPaymentStatus(message, type) {
    const statusEl = document.getElementById('payment-status');
    if (!statusEl) return;
    statusEl.classList.remove('hidden', 'success', 'error', 'pending');
    statusEl.classList.add(type);
    const msgEl = statusEl.querySelector('.status-message');
    if (msgEl) msgEl.textContent = message;
}

/**
 * Hide payment status
 */
function hidePaymentStatus() {
    const statusEl = document.getElementById('payment-status');
    if (statusEl) statusEl.classList.add('hidden');
}

/**
 * Close modal
 */
function closeModal() {
    document.getElementById('modal')?.classList.add('hidden');
    hidePaymentStatus();
}

/**
 * Update address field visibility based on shipping type
 * @param {string} selectedShipping - Selected shipping method
 */
function updateAddressField(selectedShipping) {
    const postalSection = document.getElementById('postal-address-section');
    const emailSection = document.getElementById('email-address-section');

    if (selectedShipping === 'digital') {
        if (postalSection) postalSection.classList.add('hidden');
        if (emailSection) emailSection.classList.remove('hidden');
    } else {
        if (postalSection) postalSection.classList.remove('hidden');
        if (emailSection) emailSection.classList.remove('hidden');
    }
}

/**
 * Render shop view
 */
function renderShop() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    mainContent.innerHTML = `<div class="product-grid">${PRODUCTS.map((_, i) => renderCardHTML(i)).join('')}</div>`;
    _modalListenersReady = false;
}

/**
 * Render card HTML
 * @param {number} i - Product index
 * @returns {string} HTML string
 */
function renderCardHTML(i) {
    return `
        <div class="product-card" data-index="${i}">
            <div class="product-image-container">
                <img id="product-image-${i}" src="item.jpg" alt="Product" class="product-image">
            </div>

            <div class="product-info">
                <h2 id="product-name-${i}" class="product-name">Loading...</h2>
                <p id="product-description-${i}" class="product-description">Loading...</p>

                <div class="price-display">
                    <div class="price-usd">
                        <span class="price-label">Price (MXUSDT)</span>
                        <span id="price-usd-value-${i}" class="price-value">$0.00</span>
                    </div>
                    <div class="price-crypto">
                        <span class="price-label">in Minima</span>
                        <span id="price-minima-${i}" class="price-value crypto">-- Minima</span>
                    </div>
                </div>
            </div>

            <div class="size-selector" id="size-selector-${i}">
                <h3>Choose Your Size</h3>
                <div class="size-options">
                    <button class="size-btn" data-size="full"><span class="size-name">Full</span><span class="size-weight">28g</span><span class="size-percent">100%</span></button>
                    <button class="size-btn" data-size="half"><span class="size-name">Half</span><span class="size-weight">14g</span><span class="size-percent">50%</span></button>
                    <button class="size-btn" data-size="quarter"><span class="size-name">Quarter</span><span class="size-weight">7g</span><span class="size-percent">25%</span></button>
                    <button class="size-btn active" data-size="eighth"><span class="size-name">Eighth</span><span class="size-weight">3.5g</span><span class="size-percent">12.5%</span></button>
                </div>
            </div>

            <div class="quantity-selector hidden" id="quantity-selector-${i}">
                <h3>Choose Quantity</h3>
                <div class="quantity-input">
                    <button class="qty-btn qty-minus" id="qty-minus-${i}">−</button>
                    <input type="number" id="quantity-input-${i}" value="1" min="1" max="10">
                    <button class="qty-btn qty-plus" id="qty-plus-${i}">+</button>
                </div>
                <p class="quantity-label"><span id="quantity-display-${i}">1</span> unit(s)</p>
            </div>

            <button id="buy-btn-${i}" class="buy-button">
                <span class="btn-text">+ Add to Cart</span>
                <span id="btn-price-${i}" class="btn-price">$0.00</span>
            </button>
        </div>
    `;
}

/**
 * Format relative time
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted time
 */
function formatTime(timestamp) {
    return formatRelativeTime(timestamp);
}

/**
 * Get shipping label
 * @param {string} shipping - Shipping code
 * @returns {string} Display label
 */
function getShippingLabel(shipping) {
    const labels = {
        'uk': '🇬🇧 UK Domestic ($5)',
        'intl': '🌏 International ($20)',
        'digital': '📧 Electronic Delivery (Free)'
    };
    return t(shipping) || labels[shipping] || shipping;
}

// Copy icons for clipboard
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * Wire copy button
 * @param {string} btnId - Button ID
 * @param {string} text - Text to copy
 */
function wireCopyBtn(btnId, text) {
    const btn = document.getElementById(btnId);
    if (!btn || !text || text === 'Pending...' || text === '-') return;
    btn.innerHTML = COPY_ICON;
    btn.style.display = 'inline-flex';
    btn.onclick = () => {
        const doFlash = () => {
            btn.innerHTML = CHECK_ICON;
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = COPY_ICON;
                btn.classList.remove('copied');
            }, 2000);
        };
        navigator.clipboard.writeText(text).then(doFlash).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            doFlash();
        });
    };
}

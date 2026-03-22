/**
 * @file Cart module for miniMerch
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} CartItem
 * @property {string} productName - Product name
 * @property {number} productIndex - Index in PRODUCTS array
 * @property {string} sizeId - Size identifier
 * @property {string} sizeLabel - Display label for size
 * @property {number} quantity - Quantity
 * @property {number} unitPrice - Price per unit
 * @property {number} lineTotal - Total for this line
 * @property {string} mode - 'weight' or 'units'
 * @property {string} image - Image URL
 */

/** @type {Array<CartItem>} */
let cart = [];

/** @type {string} */
let selectedShipping = 'uk';

/** @type {number} */
let shippingFee = 5;

const SHIPPING_RATES = {
    uk: 5,
    intl: 20,
    digital: 0
};

/**
 * Get the current cart
 * @returns {Array<CartItem>} Current cart items
 */
function getCart() {
    return cart;
}

/**
 * Set the cart (used for clearing)
 * @param {Array<CartItem>} newCart - New cart contents
 */
function setCart(newCart) {
    cart = newCart;
}

/**
 * Calculate subtotal of cart items
 * @returns {number} Subtotal in USD
 */
function cartItemsSubtotal() {
    return cart.reduce((sum, item) => sum + item.lineTotal, 0);
}

/**
 * Check if cart has physical items
 * @returns {boolean} True if has physical items
 */
function cartHasPhysicalItem() {
    return true; // All products are physical unless specified otherwise
}

/**
 * Get current shipping fee
 * @returns {number} Shipping fee in USD
 */
function cartShippingFee() {
    if (selectedShipping === 'digital') return 0;
    if (selectedShipping === 'uk') return SHIPPING_RATES.uk;
    if (selectedShipping === 'intl') return SHIPPING_RATES.intl;
    return 0;
}

/**
 * Get shipping rate for a method
 * @param {string} method - Shipping method
 * @returns {number} Shipping rate
 */
function getShippingRate(method) {
    return SHIPPING_RATES[method] || 0;
}

/**
 * Calculate grand total
 * @returns {number} Grand total in USD
 */
function cartGrandTotal() {
    return cartItemsSubtotal() + cartShippingFee();
}

/**
 * Get selected shipping method
 * @returns {string} Shipping method
 */
function getSelectedShipping() {
    return selectedShipping;
}

/**
 * Set selected shipping method
 * @param {string} method - Shipping method
 */
function setSelectedShipping(method) {
    selectedShipping = method;
    shippingFee = SHIPPING_RATES[method] || 0;
}

/**
 * Get current shipping fee
 * @returns {number} Shipping fee
 */
function getShippingFee() {
    return shippingFee;
}

/**
 * Update shipping fee
 * @param {number} fee - New fee
 */
function setShippingFee(fee) {
    shippingFee = fee;
}

/**
 * Add an item to the cart
 * @param {number} productIndex - Index of product in PRODUCTS array
 * @param {Object} state - Card state with selectedSize and selectedQuantity
 * @param {Array<Object>} PRODUCTS - Products array
 */
function addToCartByIndex(productIndex, state, PRODUCTS) {
    const p = PRODUCTS[productIndex];
    let sizeId, sizeLabel, unitPrice;

    if (p.mode === 'units') {
        sizeId = 'units_' + state.selectedQuantity;
        sizeLabel = `${state.selectedQuantity} unit${state.selectedQuantity > 1 ? 's' : ''}`;
        unitPrice = p.pricePerUnit;
    } else {
        sizeId = state.selectedSize;
        const size = p.sizes.find(s => s.id === sizeId);
        sizeLabel = `${size.name} (${size.weight}g)`;
        unitPrice = p.pricePerGram * size.weight;
    }

    // Increment quantity if same product+size already in cart
    const existing = cart.find(item => item.productName === p.name && item.sizeId === sizeId);
    if (existing) {
        existing.quantity += (p.mode === 'units' ? state.selectedQuantity : 1);
        existing.lineTotal = existing.unitPrice * existing.quantity;
    } else {
        cart.push({
            productName: p.name,
            productIndex: productIndex,
            sizeId,
            sizeLabel,
            quantity: p.mode === 'units' ? state.selectedQuantity : 1,
            unitPrice,
            lineTotal: unitPrice * (p.mode === 'units' ? state.selectedQuantity : 1),
            mode: p.mode,
            image: p.image
        });
    }
}

/**
 * Remove item from cart
 * @param {number} index - Cart index to remove
 */
function removeFromCart(index) {
    cart.splice(index, 1);
}

/**
 * Clear the entire cart
 */
function clearCart() {
    cart = [];
}

/**
 * Get total quantity in cart
 * @returns {number} Total quantity
 */
function getCartTotalQuantity() {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Get item count (number of unique items)
 * @returns {number} Number of unique items
 */
function getCartItemCount() {
    return cart.length;
}

/**
 * Format cart for order payload
 * @returns {Array<Object>} Cart items formatted for order
 */
function formatCartForOrder() {
    return cart.map(item => ({
        product: item.productName,
        size: item.sizeLabel,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2)
    }));
}

/**
 * Get human-readable product summary
 * @returns {string} Product summary string
 */
function getProductSummary() {
    return cart.map(item =>
        item.quantity > 1 ? `${item.productName} x${item.quantity}` : item.productName
    ).join(', ');
}

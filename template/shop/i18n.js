/**
 * @file Internationalization (i18n) module for miniMerch
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} TranslationStrings
 * @property {Object} en - English translations
 * @property {Object} es - Spanish translations
 * @property {Object} fr - French translations
 */

/**
 * @typedef {Object} I18nConfig
 * @property {string} currentLocale - Currently selected locale
 * @property {Object} translations - Translation dictionary
 */

/** @type {I18nConfig} */
const i18nConfig = {
    currentLocale: 'en',
    translations: {
        en: {
            // Navigation
            shop: 'Shop',
            mailbox: 'Mailbox',
            cart: 'Cart',
            inbox: 'Inbox',
            sent: 'Sent',
            all: 'All',

            // Products
            chooseYourSize: 'Choose Your Size',
            chooseQuantity: 'Choose Quantity',
            addToCart: 'Add to Cart',
            priceInMXUSDT: 'Price (MXUSDT)',
            inMinima: 'in Minima',

            // Checkout
            checkout: 'Checkout',
            payWith: 'Pay With',
            shipping: 'Shipping',
            payNow: 'Pay Now',
            orderConfirmed: 'Order Confirmed',
            thanksForOrder: 'Thanks for your order',
            orderReference: 'Order Reference',
            transactionId: 'Transaction ID',
            keepForRecords: 'Keep this for your records',
            quoteForSupport: 'Quote this reference for support',
            postalAddress: 'Postal Address',
            emailAddress: 'Email Address',
            deliveryNote: 'Your postal address has been recorded.',

            // Shipping options
            ukDomestic: 'UK Domestic',
            international: 'International',
            electronicDelivery: 'Electronic Delivery',
            free: 'Free',

            // Payment methods
            usdt: 'USDT',
            minima: 'Minima',

            // Order status
            pending: 'Pending',
            paid: 'Paid',
            confirmed: 'Confirmed',
            shipped: 'Shipped',
            delivered: 'Delivered',

            // Actions
            markAsRead: 'Mark as Read',
            replyToBuyer: 'Reply to Buyer',
            replyToVendor: 'Reply to Vendor',
            sendReply: 'Send Reply',
            back: 'Back',
            close: 'Close',
            clearCart: 'Clear Cart',

            // Messages
            noOrders: 'No orders yet',
            noSentMessages: 'No sent replies',
            checkForOrders: 'Check for Orders',
            emptyCart: 'Your cart is empty',
            itemAdded: 'Added',

            // Errors
            enterPostalAddress: 'Please enter a complete postal address',
            enterEmail: 'Please enter a valid email address',
            encryptionFailed: 'Failed to encrypt order',
            paymentFailed: 'Payment failed',

            // Footer
            poweredBy: 'Powered by',
            bridgeUsdt: 'Bridge USDT to Minima',
        },
        es: {
            // Navigation
            shop: 'Tienda',
            mailbox: 'Buzón',
            cart: 'Carrito',
            inbox: 'Entrada',
            sent: 'Enviado',
            all: 'Todos',

            // Products
            chooseYourSize: 'Elige tu Tamaño',
            chooseQuantity: 'Elige Cantidad',
            addToCart: 'Añadir al Carrito',
            priceInMXUSDT: 'Precio (MXUSDT)',
            inMinima: 'en Minima',

            // Checkout
            checkout: 'Pagar',
            payWith: 'Pagar con',
            shipping: 'Envío',
            payNow: 'Pagar Ahora',
            orderConfirmed: 'Pedido Confirmado',
            thanksForOrder: '¡Gracias por tu pedido!',
            orderReference: 'Referencia del Pedido',
            transactionId: 'ID de Transacción',
            keepForRecords: 'Guarda esto para tus registros',
            quoteForSupport: 'Cita esta referencia para soporte',
            postalAddress: 'Dirección Postal',
            emailAddress: 'Correo Electrónico',
            deliveryNote: 'Tu dirección postal ha sido registrada.',

            // Shipping options
            ukDomestic: 'Reino Unido Nacional',
            international: 'Internacional',
            electronicDelivery: 'Entrega Electrónica',
            free: 'Gratis',

            // Payment methods
            usdt: 'USDT',
            minima: 'Minima',

            // Order status
            pending: 'Pendiente',
            paid: 'Pagado',
            confirmed: 'Confirmado',
            shipped: 'Enviado',
            delivered: 'Entregado',

            // Actions
            markAsRead: 'Marcar como Leído',
            replyToBuyer: 'Responder al Comprador',
            replyToVendor: 'Responder al Vendedor',
            sendReply: 'Enviar Respuesta',
            back: 'Atrás',
            close: 'Cerrar',
            clearCart: 'Vaciar Carrito',

            // Messages
            noOrders: 'No hay pedidos todavía',
            noSentMessages: 'No hay mensajes enviados',
            checkForOrders: 'Buscar Pedidos',
            emptyCart: 'Tu carrito está vacío',
            itemAdded: 'Añadido',

            // Errors
            enterPostalAddress: 'Por favor ingresa una dirección postal completa',
            enterEmail: 'Por favor ingresa un correo electrónico válido',
            encryptionFailed: 'Error al encriptar el pedido',
            paymentFailed: 'Error en el pago',

            // Footer
            poweredBy: 'Impulsado por',
            bridgeUsdt: 'Puente USDT a Minima',
        },
        fr: {
            // Navigation
            shop: 'Boutique',
            mailbox: 'Boîte',
            cart: 'Panier',
            inbox: 'Boîte de Réception',
            sent: 'Envoyé',
            all: 'Tous',

            // Products
            chooseYourSize: 'Choisissez votre Taille',
            chooseQuantity: 'Choisissez la Quantité',
            addToCart: 'Ajouter au Panier',
            priceInMXUSDT: 'Prix (MXUSDT)',
            inMinima: 'en Minima',

            // Checkout
            checkout: 'Payer',
            payWith: 'Payer avec',
            shipping: 'Livraison',
            payNow: 'Payer Maintenant',
            orderConfirmed: 'Commande Confirmée',
            thanksForOrder: 'Merci pour votre commande !',
            orderReference: 'Référence de Commande',
            transactionId: 'ID de Transaction',
            keepForRecords: 'Conservez ceci pour vos archives',
            quoteForSupport: 'Citez cette référence pour le support',
            postalAddress: 'Adresse Postale',
            emailAddress: 'Adresse Email',
            deliveryNote: 'Votre adresse postale a été enregistrée.',

            // Shipping options
            ukDomestic: 'Royaume-Uni National',
            international: 'International',
            electronicDelivery: 'Livraison Électronique',
            free: 'Gratuit',

            // Payment methods
            usdt: 'USDT',
            minima: 'Minima',

            // Order status
            pending: 'En Attente',
            paid: 'Payé',
            confirmed: 'Confirmé',
            shipped: 'Expédié',
            delivered: 'Livré',

            // Actions
            markAsRead: 'Marquer comme Lu',
            replyToBuyer: 'Répondre à l\'Acheteur',
            replyToVendor: 'Répondre au Vendeur',
            sendReply: 'Envoyer la Réponse',
            back: 'Retour',
            close: 'Fermer',
            clearCart: 'Vider le Panier',

            // Messages
            noOrders: 'Aucune commande encore',
            noSentMessages: 'Aucun message envoyé',
            checkForOrders: 'Vérifier les Commandes',
            emptyCart: 'Votre panier est vide',
            itemAdded: 'Ajouté',

            // Errors
            enterPostalAddress: 'Veuillez entrer une adresse postale complète',
            enterEmail: 'Veuillez entrer une adresse email valide',
            encryptionFailed: 'Échec du chiffrement de la commande',
            paymentFailed: 'Échec du paiement',

            // Footer
            poweredBy: 'Propulsé par',
            bridgeUsdt: 'Pont USDT vers Minima',
        }
    }
};

/**
 * Set the current locale
 * @param {string} locale - Locale code (en, es, fr)
 * @returns {boolean} True if locale was set successfully
 */
function setLocale(locale) {
    if (i18nConfig.translations[locale]) {
        i18nConfig.currentLocale = locale;
        // Save preference
        try {
            localStorage.setItem('minimerch_locale', locale);
        } catch (e) {
            console.warn('Could not save locale preference');
        }
        return true;
    }
    console.warn('Locale not available:', locale);
    return false;
}

/**
 * Get the current locale
 * @returns {string} Current locale code
 */
function getLocale() {
    return i18nConfig.currentLocale;
}

/**
 * Get available locales
 * @returns {Array<{code: string, name: string}>} Available locales
 */
function getAvailableLocales() {
    return [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' }
    ];
}

/**
 * Load saved locale preference
 */
function loadSavedLocale() {
    try {
        const saved = localStorage.getItem('minimerch_locale');
        if (saved && i18nConfig.translations[saved]) {
            i18nConfig.currentLocale = saved;
        }
    } catch (e) {
        console.warn('Could not load locale preference');
    }
}

/**
 * Translate a key
 * @param {string} key - Translation key
 * @param {Object} [params] - Parameters for interpolation
 * @returns {string} Translated string
 */
function t(key, params = {}) {
    const locale = i18nConfig.currentLocale;
    const translations = i18nConfig.translations[locale];

    if (!translations) {
        return key;
    }

    let text = translations[key];

    if (!text) {
        // Fallback to English
        text = i18nConfig.translations.en[key] || key;
    }

    // Replace parameters
    Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`{{${param}}}`, 'g'), params[param]);
    });

    return text;
}

/**
 * Translate a key with a default fallback
 * @param {string} key - Translation key
 * @param {string} defaultValue - Default value if key not found
 * @param {Object} [params] - Parameters for interpolation
 * @returns {string} Translated string
 */
function tDefault(key, defaultValue, params = {}) {
    const result = t(key, params);
    return result === key ? defaultValue : result;
}

/**
 * Format currency amount
 * @param {number} amount - Amount
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency
 */
function formatCurrency(amount, currency = 'USD') {
    const locale = i18nConfig.currentLocale;
    const formatters = {
        en: new Intl.NumberFormat('en-US', { style: 'currency', currency }),
        es: new Intl.NumberFormat('es-ES', { style: 'currency', currency }),
        fr: new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    };
    const formatter = formatters[locale] || formatters.en;
    return formatter.format(amount);
}

/**
 * Format date
 * @param {Date|number} date - Date object or timestamp
 * @param {Object} [options] - Formatting options
 * @returns {string} Formatted date
 */
function formatDate(date, options = {}) {
    const locale = i18nConfig.currentLocale;
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString(locale === 'en' ? 'en-US' : locale + '-' + locale.toUpperCase(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...options
    });
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Relative time string
 */
function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const locale = i18nConfig.currentLocale;

    // Less than a minute
    if (diff < 60000) {
        return locale === 'es' ? 'Ahora mismo' : locale === 'fr' ? 'À l\'instant' : 'Just now';
    }

    // Less than an hour
    if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return locale === 'es' ? `${mins}m atrás` : locale === 'fr' ? `Il y a ${mins}m` : `${mins}m ago`;
    }

    // Less than a day
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return locale === 'es' ? `${hours}h atrás` : locale === 'fr' ? `Il y a ${hours}h` : `${hours}h ago`;
    }

    // Less than a week
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return locale === 'es' ? `${days}d atrás` : locale === 'fr' ? `Il y a ${days}j` : `${days}d ago`;
    }

    // Default to date
    return formatDate(timestamp);
}

// Load saved locale on module load
loadSavedLocale();

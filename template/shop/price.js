/**
 * @file Price module with caching for miniMerch
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} PriceCache
 * @property {number} price - Cached price
 * @property {number} timestamp - When price was fetched
 * @property {number} ttl - Time to live in milliseconds
 */

const DEFAULT_MINIMA_PRICE = 0.0052; // updated Mar 2026
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** @type {PriceCache|null} */
let priceCache = null;

/**
 * Check if cache is valid
 * @returns {boolean} True if cache is valid
 */
function isCacheValid() {
    if (!priceCache) return false;
    const now = Date.now();
    return (now - priceCache.timestamp) < priceCache.ttl;
}

/**
 * Get cached price if valid
 * @returns {number|null} Cached price or null
 */
function getCachedPrice() {
    if (isCacheValid()) {
        return priceCache.price;
    }
    return null;
}

/**
 * Set cached price
 * @param {number} price - Price to cache
 * @param {number} [ttl] - Optional custom TTL in ms
 */
function setCachedPrice(price, ttl = CACHE_TTL_MS) {
    priceCache = {
        price,
        timestamp: Date.now(),
        ttl
    };
}

/**
 * Clear the price cache
 */
function clearCache() {
    priceCache = null;
}

/**
 * Fetch price from CoinGecko
 * @returns {Promise<number|null>} Price or null
 */
async function fetchCoinGeckoPrice() {
    return new Promise((resolve) => {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=minima&vs_currencies=usd';

        if (typeof MDS !== 'undefined') {
            MDS.net.GET(url, (response) => {
                if (response.status && response.response) {
                    try {
                        const data = JSON.parse(response.response);
                        if (data.minima && data.minima.usd) {
                            resolve(data.minima.usd);
                            return;
                        }
                    } catch (e) {
                        console.error('CoinGecko parse error:', e);
                    }
                }
                resolve(null);
            });
            setTimeout(() => resolve(null), 10000);
        } else {
            fetch(url)
                .then(r => r.json())
                .then(data => resolve(data.minima?.usd || null))
                .catch(() => resolve(null));
        }
    });
}

/**
 * Fetch price from CoinMarketCap
 * @returns {Promise<number|null>} Price or null
 */
async function fetchCoinMarketCapPrice() {
    return new Promise((resolve) => {
        const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=minima&convert=USD';
        const apiKey = decodeObfuscated(OBFUSCATED_CMC_KEY, CMC_KEY_SALT);

        if (typeof MDS !== 'undefined' && apiKey) {
            MDS.net.GETAUTH(url, 'X-CMC_PRO_API_KEY: ' + apiKey, (response) => {
                if (response.status && response.response) {
                    try {
                        const data = JSON.parse(response.response);
                        if (data.data && data.data.MINIMA && data.data.MINIMA.quote && data.data.MINIMA.quote.USD) {
                            resolve(data.data.MINIMA.quote.USD.price);
                            return;
                        }
                    } catch (e) {
                        console.error('CMC parse error:', e);
                    }
                }
                resolve(null);
            });
            setTimeout(() => resolve(null), 10000);
        } else {
            resolve(null);
        }
    });
}

/**
 * Load last price from database
 * @returns {Promise<number>} Price from database or default
 */
async function loadLastPrice() {
    try {
        const saved = await loadSetting('minima_last_price');
        if (saved) {
            const price = parseFloat(saved);
            if (price > 0) return price;
        }
    } catch (e) {
        console.error('loadLastPrice error:', e);
    }
    return DEFAULT_MINIMA_PRICE;
}

/**
 * Save last price to database
 * @param {number} price - Price to save
 */
async function saveLastPrice(price) {
    try {
        await saveSetting('minima_last_price', price.toString());
    } catch (e) {
        console.error('saveLastPrice error:', e);
    }
}

/**
 * Fetch Minima price with caching
 * Priority: Cache > CoinGecko > CoinMarketCap > Database > Default
 * @param {boolean} [forceRefresh] - Force refresh even if cache is valid
 * @returns {Promise<number>} Price in USD
 */
async function fetchMXPrice(forceRefresh = false) {
    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
        const cached = getCachedPrice();
        if (cached) {
            console.log('Using cached price:', cached);
            return cached;
        }
    }

    // Try CoinGecko first
    let price = await fetchCoinGeckoPrice();
    if (price && price > 0) {
        setCachedPrice(price);
        await saveLastPrice(price);
        return price;
    }

    // Try CoinMarketCap as fallback
    price = await fetchCoinMarketCapPrice();
    if (price && price > 0) {
        setCachedPrice(price);
        await saveLastPrice(price);
        return price;
    }

    // Try database as fallback
    price = await loadLastPrice();
    if (price && price > 0) {
        setCachedPrice(price); // Cache the old price temporarily
        return price;
    }

    // Final fallback to default
    return DEFAULT_MINIMA_PRICE;
}

/**
 * Get cache info for display
 * @returns {Object|null} Cache info
 */
function getCacheInfo() {
    if (!priceCache) return null;
    return {
        price: priceCache.price,
        age: Date.now() - priceCache.timestamp,
        ttl: priceCache.ttl,
        valid: isCacheValid()
    };
}

/**
 * Calculate Minima amount from USD
 * @param {number} usdAmount - Amount in USD
 * @param {number} minimaPrice - Minima price in USD
 * @param {number} [slippagePercent] - Slippage percentage
 * @returns {number} Amount in Minima
 */
function calculateMinimaAmount(usdAmount, minimaPrice, slippagePercent = 0) {
    const baseAmount = usdAmount / minimaPrice;
    if (slippagePercent > 0) {
        return baseAmount * (1 + slippagePercent / 100);
    }
    return baseAmount;
}

/**
 * Calculate USD amount from Minima
 * @param {number} minimaAmount - Amount in Minima
 * @param {number} minimaPrice - Minima price in USD
 * @returns {number} Amount in USD
 */
function calculateUsdAmount(minimaAmount, minimaPrice) {
    return minimaAmount * minimaPrice;
}

/**
 * Format price for display
 * @param {number} price - Price value
 * @param {number} [decimals] - Number of decimal places
 * @returns {string} Formatted price
 */
function formatPrice(price, decimals = 4) {
    return price.toFixed(decimals);
}

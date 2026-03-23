/**
 * @file Messaging module for miniMerch - handles encryption/decryption
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} EncryptedResult
 * @property {string} encrypted - Encrypted data
 * @property {string} senderPublicKey - Sender's Maxima public key
 */

/**
 * @typedef {Object} DecryptedMessage
 * @property {string} type - Message type
 * @property {string} randomid - Unique ID
 * @property {string} ref - Order reference
 * @property {string} [product] - Product name
 * @property {string} [size] - Size/quantity
 * @property {string} [amount] - Payment amount
 * @property {string} [currency] - Currency
 * @property {string} [delivery] - Delivery info
 * @property {string} [shipping] - Shipping method
 * @property {number} timestamp - Timestamp
 * @property {string} [buyerPublicKey] - Buyer's public key
 * @property {string} [vendorPublicKey] - Vendor's public key
 * @property {string} [_senderPublicKey] - Sender's public key from decryption
 * @property {string} [message] - Message content
 * @property {Array} [cartItems] - Cart items
 * @property {number} [itemCount] - Item count
 */

// ChainMail-style protocol: Fixed address for ALL messages, encryption-based privacy
// MINIMERCH_ADDRESS is declared in app.js which loads before this file
// const MINIMERCH_ADDRESS = '0x4D494E494D45524348'; // hex for "MINIMERCH"

// TOKEN_IDS is declared in app.js which loads before this file
// const TOKEN_IDS = {
//     USDT: '0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90',
//     MINIMA: '0x00'
// };

/**
 * Convert text to hex
 * @param {string} text - Text to convert
 * @returns {string} Hex string
 */
function textToHex(text) {
    let hex = '';
    for (let i = 0; i < text.length; i++) {
        hex += text.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * Convert hex to text
 * @param {string} hex - Hex string
 * @returns {string} Text
 */
function hexToText(hex) {
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return text;
}

/**
 * Get data from state port 99
 * @param {Object|Array} state - Coin state
 * @returns {string|null} State data
 */
function getState99Data(state) {
    if (!state) return null;
    if (Array.isArray(state)) {
        for (const entry of state) {
            if (entry && entry.port === 99 && entry.data) return entry.data;
        }
        return null;
    }
    if (typeof state === 'object') {
        if (state[99]) return state[99];
    }
    return null;
}

/**
 * Encrypt a message
 * @param {string} publicKey - Recipient's Maxima public key
 * @param {Object} data - Data to encrypt
 * @returns {Promise<EncryptedResult|null>} Encrypted result or null
 */
async function encryptMessage(publicKey, data) {
    return new Promise((resolve) => {
        const jsonStr = JSON.stringify(data);
        const hexData = textToHex(jsonStr);

        MDS.cmd('maxmessage action:encrypt publickey:' + publicKey + ' data:' + hexData, (response) => {
            if (!response || !response.status) {
                resolve(null);
                return;
            }

            const message = response.response?.message || {};
            const encrypted = response.response?.data || message.data;

            if (!encrypted) {
                resolve(null);
                return;
            }

            resolve({
                encrypted,
                senderPublicKey: message.mxpublickey || response.response?.mxpublickey || ''
            });
        });
    });
}

/**
 * Try to decrypt a message (ChainMail pattern: if successful, it was for us)
 * @param {string} stateData - Encrypted state data
 * @returns {Promise<DecryptedMessage|null>} Decrypted message or null
 */
function tryDecryptMessage(stateData) {
    return new Promise((resolve) => {
        let cleanData = stateData;
        if (cleanData && cleanData.startsWith('0x')) cleanData = cleanData.substring(2);

        MDS.cmd('maxmessage action:decrypt data:' + cleanData, (response) => {
            if (!response || !response.status) {
                resolve(null);
                return;
            }

            // Check if decryption was valid (ChainMail pattern)
            let valid = response.response && response.response.message && response.response.message.valid;
            if (!valid) {
                resolve(null);
                return;
            }

            try {
                let hexData = response.response.message.data;
                if (!hexData) {
                    resolve(null);
                    return;
                }
                if (hexData.startsWith('0x')) hexData = hexData.substring(2);
                let jsonStr = hexToText(hexData);
                let decrypted = JSON.parse(jsonStr);

                // Attach sender's public key from decryption response
                decrypted._senderPublicKey = response.response.message.mxpublickey || null;

                resolve(decrypted);
            } catch (e) {
                console.error('Decrypt parse error:', e);
                resolve(null);
            }
        });
    });
}

/**
 * Get the user's Maxima public key
 * @returns {Promise<string|null>} Public key or null
 */
function getMyPublicKey() {
    return new Promise((resolve) => {
        MDS.cmd('maxima action:info', (response) => {
            if (response.status && response.response && response.response.publickey) {
                resolve(response.response.publickey);
                return;
            }
            resolve(null);
        });
    });
}

/**
 * Generate an order reference
 * @param {string} productName - Product name
 * @returns {string} Order reference
 */
function generateOrderReference(productName) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const words = productName.split(/\s+/);
    const prefix = words.map(w => w.charAt(0).toUpperCase()).slice(0, 3).join('');
    let suffix = '';
    for (let i = 0; i < 8; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}-${suffix}`;
}

/**
 * Decode obfuscated string
 * @param {string} str - Obfuscated string
 * @param {string} salt - Salt for decoding
 * @returns {string} Decoded string
 */
function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const obfuscated = decoded.substring(0, decoded.length - salt.length);
    return obfuscated.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

/**
 * Get the decoded vendor public key from config
 * @returns {string|null} Vendor public key
 */
function getDecodedPublicKey() {
    const key = VENDOR_CONFIG.vendorPublicKey;
    if (key && key.startsWith && key.startsWith('Mx')) {
        return key;
    }
    return null;
}

/**
 * Scan for replies at the MINIMERCH_ADDRESS
 * @param {Function} processReplyCallback - Callback to process each reply
 * @returns {Promise<void>}
 */
async function scanForReplies(processReplyCallback) {
    return new Promise((resolve) => {
        MDS.cmd('coins address:' + MINIMERCH_ADDRESS, async (response) => {
            if (!response || !response.status || !response.response) {
                resolve();
                return;
            }

            let coins = response.response;
            if (typeof coins === 'string') {
                try { coins = JSON.parse(coins); } catch (e) { resolve(); return; }
            }
            if (!Array.isArray(coins)) {
                resolve();
                return;
            }

            console.log('Shop: scanning', coins.length, 'coins at MINIMERCH_ADDRESS');

            for (const coin of coins) {
                const state99 = getState99Data(coin.state);
                if (!state99) continue;

                await processReplyCallback(coin);
            }

            resolve();
        });
    });
}

/**
 * Extract TXID from response
 * @param {Object} response - MDS response
 * @returns {string|null} Transaction ID
 */
function extractTxid(response) {
    return response?.response?.txpowid
        || response?.response?.txnid
        || response?.response?.body?.txpowid
        || null;
}

/**
 * Get the MINIMERCH_ADDRESS
 * @returns {string} Fixed Minima address
 */
function getMinimerchAddress() {
    return MINIMERCH_ADDRESS;
}

/**
 * Get token IDs
 * @returns {Object} Token IDs object
 */
function getTokenIds() {
    return TOKEN_IDS;
}

/**
 * Create send command for encrypted message
 * @param {string} encryptedData - Encrypted data
 * @param {string} [amount] - Amount to send
 * @param {string} [tokenid] - Token ID
 * @returns {string} MDS command
 */
function createEncryptedSendCommand(encryptedData, amount = '0.0001', tokenid = TOKEN_IDS.MINIMA) {
    const state = {};
    state[99] = encryptedData;
    return 'send address:' + MINIMERCH_ADDRESS + ' amount:' + amount + ' tokenid:' + tokenid + ' state:' + JSON.stringify(state);
}

/**
 * Create direct payment command
 * @param {string} address - Recipient address
 * @param {number} amount - Amount
 * @param {string} tokenid - Token ID
 * @returns {string} MDS command
 */
function createPaymentCommand(address, amount, tokenid) {
    return `send address:${address} amount:${amount.toFixed(8)} tokenid:${tokenid}`;
}

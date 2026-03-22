// ChainMail-style protocol: Fixed address for ALL messages, encryption-based privacy
const MINIMERCH_ADDRESS = '0x4D494E494D45524348'; // hex for "MINIMERCH"

const TOKEN_IDS = {
    USDT: '0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90',
    MINIMA: '0x00'
};

const DEFAULT_MINIMA_PRICE = 0.004;

const SHIPPING_RATES = {
    uk: 5,
    intl: 20,
    digital: 0
};

// CRITICAL: These are replaced by the generator at build time - DO NOT MODIFY
const OBFUSCATED_CMC_KEY = '';
const CMC_KEY_SALT = '';

let dbReady = false;
let selectedSize = 'eighth';
let selectedQuantity = 1;
let selectedPaymentMethod = 'USDT';
let selectedShipping = 'uk';
let shippingFee = 5;
let mxToUsdRate = 0;
let vendorAddress = null;
let vendorPublicKey = null;
let lastOrderReference = null;
let buyerPublicKey = null;
let currentMessages = [];
let pendingOrderData = null; // Track pending order for when confirmed
let pendingPaymentData = null; // Track pending payment for when confirmed
let pendingOrderUid = null; // UID of pending order command
let pendingPaymentUid = null; // UID of pending payment command
let pendingReplyData = null; // Track pending reply for when confirmed
let pendingReplyUid = null; // UID of pending reply command

// ── Cart state ──────────────────────────────────────────────────────────────
// Each item: { productName, productIndex, sizeId, sizeLabel, quantity, unitPrice, lineTotal, mode, image }
let cart = [];

function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function generateRandomId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const obfuscated = decoded.substring(0, decoded.length - salt.length);
    return obfuscated.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

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

function getDecodedPublicKey() {
    const key = VENDOR_CONFIG.vendorPublicKey;
    if (key && key.startsWith && key.startsWith('Mx')) {
        return key;
    }
    return null;
}

function textToHex(text) {
    let hex = '';
    for (let i = 0; i < text.length; i++) {
        hex += text.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
}

function hexToText(hex) {
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return text;
}

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

// ============ DATABASE FUNCTIONS (SQL only, no MDS.file) ============

// Wrap MDS.sql in a Promise
function sqlAsync(command) {
    return new Promise((resolve) => {
        MDS.sql(command, (result) => {
            resolve(result);
        });
    });
}

async function initDB() {
    if (dbReady) return;
    try {
        // Create tables with all columns
        const createResult = await sqlAsync(
            `CREATE TABLE IF NOT EXISTS messages (` +
            `id INTEGER PRIMARY KEY AUTO_INCREMENT,` +
            `randomid VARCHAR(255) UNIQUE,` +
            `ref VARCHAR(255), type VARCHAR(50), product VARCHAR(500), size VARCHAR(100),` +
            `amount VARCHAR(50), currency VARCHAR(50), delivery VARCHAR(500), shipping VARCHAR(50),` +
            `message TEXT, timestamp BIGINT, coinid VARCHAR(255),` +
            `"read" INTEGER DEFAULT 0, direction VARCHAR(50) DEFAULT 'sent',` +
            `buyerPublicKey TEXT, vendorPublicKey TEXT, vendorAddress VARCHAR(255),` +
            `subject VARCHAR(500), originalOrder TEXT)`
        );
        console.log('CREATE messages table result:', JSON.stringify(createResult));
        
        const createSettingsResult = await sqlAsync(
            `CREATE TABLE IF NOT EXISTS settings ("key" VARCHAR(255) PRIMARY KEY, "value" TEXT)`
        );
        console.log('CREATE settings table result:', JSON.stringify(createSettingsResult));
        
        // Migration: Add columns if they don't exist (for existing installs)
        // These may fail if columns already exist, that's OK
        await sqlAsync(`ALTER TABLE messages ADD COLUMN subject TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN originalOrder TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN direction TEXT DEFAULT 'sent'`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN vendorPublicKey TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN vendorAddress TEXT`);
        
        // Verify table exists
        const verifyResult = await sqlAsync(`SELECT COUNT(*) as cnt FROM messages`);
        console.log('Verify messages table:', JSON.stringify(verifyResult));
        
        if (verifyResult && verifyResult.status) {
            dbReady = true;
            console.log('Shop DB initialized successfully');
        } else {
            console.error('Shop DB verification failed:', verifyResult?.error);
        }
    } catch (err) {
        console.error('Shop DB init error:', err);
    }
}

async function saveSetting(key, value) {
    try {
        await sqlAsync(`MERGE INTO settings ("key", "value") KEY ("key") VALUES (${escapeSQL(key)}, ${escapeSQL(value)})`);
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

async function loadSetting(key) {
    try {
        const resp = await sqlAsync(`SELECT "value" FROM settings WHERE "key" = ${escapeSQL(key)}`);
        if (resp && resp.status && resp.rows && resp.rows.length > 0) {
            // H2 returns column names in UPPERCASE
            return resp.rows[0].VALUE || resp.rows[0].value;
        }
    } catch (err) {
        console.error('loadSetting error:', err);
    }
    return null;
}

async function saveMessageToDb(message) {
    try {
        // Generate randomid if not present
        if (!message.randomid) {
            message.randomid = generateRandomId();
        }
        
        // Check if already exists
        const existsResp = await sqlAsync(`SELECT id FROM messages WHERE randomid = ${escapeSQL(message.randomid)}`);
        if (existsResp && existsResp.status && existsResp.rows && existsResp.rows.length > 0) {
            console.log('saveMessageToDb: message already exists, randomid:', message.randomid);
            return true; // Already saved
        }
        
        const sql = `INSERT INTO messages ` +
            `(randomid, ref, type, product, size, amount, currency, delivery, shipping, message, ` +
            `timestamp, coinid, "read", direction, buyerPublicKey, vendorPublicKey, vendorAddress, ` +
            `subject, originalOrder) ` +
            `VALUES (` +
            `${escapeSQL(message.randomid)}, ` +
            `${escapeSQL(message.ref || '')}, ${escapeSQL(message.type || 'ORDER')}, ` +
            `${escapeSQL(message.product || '')}, ${escapeSQL(message.size || '')}, ` +
            `${escapeSQL(message.amount || '')}, ${escapeSQL(message.currency || '')}, ` +
            `${escapeSQL(message.delivery || '')}, ${escapeSQL(message.shipping || '')}, ` +
            `${escapeSQL(message.message || '')}, ${message.timestamp || Date.now()}, ` +
            `${escapeSQL(message.coinid || '')}, ${message.read ? 1 : 0}, ` +
            `${escapeSQL(message.direction || 'sent')}, ` +
            `${escapeSQL(message.buyerPublicKey || '')}, ` +
            `${escapeSQL(message.vendorPublicKey || '')}, ${escapeSQL(message.vendorAddress || '')}, ` +
            `${escapeSQL(message.subject || '')}, ${escapeSQL(message.originalOrder || '')})`;
        
        console.log('saveMessageToDb SQL:', sql.substring(0, 200) + '...');
        
        const result = await sqlAsync(sql);
        
        if (result && result.status) {
            console.log('saveMessageToDb SUCCESS: randomid:', message.randomid, 'direction:', message.direction);
            return true;
        } else {
            console.error('saveMessageToDb FAILED:', result?.error || JSON.stringify(result), 'randomid:', message.randomid);
            return false;
        }
    } catch (err) {
        console.error('saveMessageToDb error:', err, 'randomid:', message.randomid);
        return false;
    }
}

async function updateMessageReadStatus(randomid, read) {
    try {
        const result = await sqlAsync(`UPDATE messages SET "read" = ${read ? 1 : 0} WHERE randomid = ${escapeSQL(randomid)}`);
        console.log('updateMessageReadStatus:', randomid, 'read:', read, 'result:', result?.status);
        return result && result.status;
    } catch (err) {
        console.error('updateMessageReadStatus error:', err);
        return false;
    }
}

async function loadMessagesFromDb() {
    try {
        const resp = await sqlAsync(`SELECT * FROM messages ORDER BY timestamp DESC`);
        console.log('loadMessagesFromDb: found', resp?.rows?.length || 0, 'messages');
        if (resp && resp.status && resp.rows) {
            // H2 database returns column names in UPPERCASE and numbers as strings
            return resp.rows.map(row => {
                const ts = row.TIMESTAMP || row.timestamp;
                const dir = row.DIRECTION || row.direction || 'sent';
                const rd = row.READ || row.read;
                console.log('loadMessagesFromDb row:', row.RANDOMID || row.randomid, 'direction:', dir, 'read:', rd);
                return {
                    id: row.ID || row.id,
                    randomid: row.RANDOMID || row.randomid,
                    ref: row.REF || row.ref,
                    type: row.TYPE || row.type,
                    product: row.PRODUCT || row.product,
                    size: row.SIZE || row.size,
                    amount: row.AMOUNT || row.amount,
                    currency: row.CURRENCY || row.currency,
                    delivery: row.DELIVERY || row.delivery,
                    shipping: row.SHIPPING || row.shipping,
                    message: row.MESSAGE || row.message,
                    timestamp: ts ? parseInt(ts, 10) : Date.now(),
                    coinid: row.COINID || row.coinid,
                    read: !!(rd && rd !== '0' && rd !== 0),
                    direction: dir,
                    buyerPublicKey: row.BUYERPUBLICKEY || row.buyerPublicKey,
                    vendorPublicKey: row.VENDORPUBLICKEY || row.vendorPublicKey,
                    vendorAddress: row.VENDORADDRESS || row.vendorAddress,
                    subject: row.SUBJECT || row.subject,
                    originalOrder: row.ORIGINALORDER || row.originalOrder
                };
            });
        }
    } catch (err) {
        console.error('loadMessagesFromDb error:', err);
    }
    return [];
}

async function isMessageStored(randomid) {
    if (!randomid) return false;
    try {
        const resp = await sqlAsync(`SELECT randomid FROM messages WHERE randomid = ${escapeSQL(randomid)}`);
        return resp && resp.status && resp.rows && resp.rows.length > 0;
    } catch (err) {
        return false;
    }
}

// ============ ENCRYPTION FUNCTIONS ============

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

// ChainMail pattern: Try to decrypt, if successful the message is for us
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

// ============ MESSAGE HANDLING ============

async function addMessage(message) {
    // Use randomid for deduplication (ChainMail pattern)
    const randomid = message.randomid || (message.ref + '_' + message.timestamp);
    const exists = currentMessages.find(m => m.randomid === randomid);
    if (exists) {
        console.log('Message already exists in memory:', randomid);
        return;
    }
    
    message.randomid = randomid;
    
    // Save to DB first (CRITICAL for persistence)
    const saved = await saveMessageToDb(message);
    console.log('addMessage: saved to DB:', saved, 'randomid:', randomid, 'direction:', message.direction);
    
    // Then add to memory
    currentMessages.unshift(message);
    currentMessages.sort((a, b) => b.timestamp - a.timestamp);
    
    // Update UI
    if (currentView === 'inbox' || currentView === 'sent') {
        renderInbox();
    }
    
    if (message.direction === 'received' && typeof MDS !== 'undefined') {
        MDS.notify('New message: ' + (message.ref || 'Reply'));
    }
}

async function processReplyMessage(coin) {
    const coinid = coin.coinid || coin.txid || '';
    const stateData = getState99Data(coin.state);
    if (!stateData) return;
    
    console.log('Processing potential reply message...');
    
    const decrypted = await tryDecryptMessage(stateData);
    if (!decrypted) {
        console.log('Could not decrypt (not for us)');
        return;
    }
    
    if (decrypted.type !== 'REPLY') {
        console.log('Not a reply message, ignoring');
        return;
    }
    
    // Check for duplicate
    const randomid = decrypted.randomid || (decrypted.ref + '_' + decrypted.timestamp);
    const stored = await isMessageStored(randomid);
    if (stored) {
        console.log('Reply already stored, skipping:', randomid);
        return;
    }
    
    console.log('Decrypted reply:', JSON.stringify(decrypted));
    
    const message = {
        id: Date.now().toString(),
        randomid: randomid,
        ref: decrypted.ref || 'REPLY-' + Date.now(),
        type: 'REPLY',
        subject: 'Reply: ' + (decrypted.ref || 'Order'),
        product: decrypted.originalOrder || '',
        message: decrypted.message || '',
        timestamp: decrypted.timestamp || Date.now(),
        coinid: coinid,
        read: false,
        direction: 'received',
        vendorPublicKey: decrypted.vendorPublicKey || decrypted._senderPublicKey || null,
        vendorAddress: decrypted.vendorAddress || null
    };
    
    await addMessage(message);
}

async function scanForReplies() {
    // ChainMail pattern: Query coins at the fixed MINIMERCH_ADDRESS
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
                
                await processReplyMessage(coin);
            }
            
            resolve();
        });
    });
}

// ============ BUYER REPLY TO VENDOR ============

let buyerReplyTarget = null;

function openBuyerReplyModal(msg) {
    buyerReplyTarget = msg;
    
    document.getElementById('buyer-reply-ref').textContent = 'Re: ' + (msg.ref || 'Order');
    document.getElementById('buyer-reply-message').value = '';
    document.getElementById('buyer-reply-status').textContent = '';
    document.getElementById('buyer-reply-status').className = 'reply-status';
    document.getElementById('buyer-send-reply-btn').disabled = false;
    document.getElementById('buyer-send-reply-btn').textContent = '📤 Send Reply';
    
    document.getElementById('buyer-reply-modal').classList.remove('hidden');
}

function closeBuyerReplyModal() {
    document.getElementById('buyer-reply-modal').classList.add('hidden');
    buyerReplyTarget = null;
}

async function sendBuyerReply() {
    if (!buyerReplyTarget) return;
    
    const messageText = document.getElementById('buyer-reply-message').value.trim();
    const statusEl = document.getElementById('buyer-reply-status');
    const sendBtn = document.getElementById('buyer-send-reply-btn');
    
    if (!messageText) {
        statusEl.textContent = 'Please enter a message';
        statusEl.className = 'reply-status error';
        return;
    }
    
    const msg = buyerReplyTarget;
    
    if (!msg.vendorPublicKey) {
        statusEl.textContent = 'Missing vendor public key';
        statusEl.className = 'reply-status error';
        return;
    }
    
    statusEl.textContent = 'Encrypting reply...';
    statusEl.className = 'reply-status pending';
    sendBtn.disabled = true;
    
    try {
        if (!buyerPublicKey) {
            buyerPublicKey = await getMyPublicKey();
        }
        
        const replyPayload = {
            type: 'BUYER_REPLY',
            randomid: generateRandomId(), // ChainMail pattern
            ref: msg.ref,
            originalOrder: msg.product || msg.originalOrder || '',
            message: messageText,
            timestamp: Date.now(),
            buyerPublicKey: buyerPublicKey || ''
        };
        
        console.log('Buyer sending reply payload:', replyPayload);
        
        const encrypted = await encryptMessage(msg.vendorPublicKey, replyPayload);
        
        if (!encrypted || !encrypted.encrypted) {
            throw new Error('Encryption failed');
        }
        
        statusEl.textContent = 'Sending encrypted reply...';
        
        const state = {};
        state[99] = encrypted.encrypted;
        
        // ChainMail pattern: Send to fixed MINIMERCH_ADDRESS
        const command = 'send address:' + MINIMERCH_ADDRESS + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        console.log('Sending buyer reply to MINIMERCH_ADDRESS');
        
        // Store reply data for pending handling
        pendingReplyData = {
            randomid: replyPayload.randomid,
            ref: msg.ref,
            product: msg.product || '',
            message: messageText
        };
        
        MDS.cmd(command, async (response) => {
            console.log('Buyer reply TX Response:', JSON.stringify(response));
            
            // Check if response is pending (node in read mode)
            if (response && response.pending) {
                pendingReplyUid = response.pendinguid;
                console.log('Reply is PENDING - UID:', pendingReplyUid, '- waiting for user approval');
                statusEl.textContent = 'Reply pending approval - check Pending Actions';
                statusEl.className = 'reply-status pending';
                sendBtn.textContent = '⏳ Pending...';
                // Don't close modal - user needs to see status
                return;
            }
            
            if (response && response.status) {
                completeReply(response, statusEl, sendBtn);
            } else {
                statusEl.textContent = 'Failed: ' + (response?.error || 'Transaction failed');
                statusEl.className = 'reply-status error';
                sendBtn.disabled = false;
                sendBtn.textContent = '📤 Send Reply';
                pendingReplyData = null;
            }
        });
        
    } catch (error) {
        console.error('Error sending buyer reply:', error);
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.className = 'reply-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send Reply';
    }
}

// ============ CART ============

function cartItemsSubtotal() {
    return cart.reduce((sum, item) => sum + item.lineTotal, 0);
}

function cartHasPhysicalItem() {
    // All products are physical unless their shipping is forced digital elsewhere.
    // We determine this at checkout time based on user's shipping choice.
    // Here we just always allow the physical shipping option — the fee logic
    // lives in cartShippingFee().
    return true;
}

function cartShippingFee() {
    if (selectedShipping === 'digital') return 0;
    if (selectedShipping === 'uk') return 5;
    if (selectedShipping === 'intl') return 20;
    return 0;
}

function cartGrandTotal() {
    return cartItemsSubtotal() + cartShippingFee();
}

function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = totalQty;
    badge.classList.toggle('hidden', totalQty === 0);
}

function addToCart() {
    const p = PRODUCT;
    let sizeId, sizeLabel, unitPrice;

    if (p.mode === 'units') {
        sizeId = 'units_' + selectedQuantity;
        sizeLabel = `${selectedQuantity} unit${selectedQuantity > 1 ? 's' : ''}`;
        unitPrice = p.pricePerUnit;
    } else {
        sizeId = selectedSize;
        const size = p.sizes.find(s => s.id === selectedSize);
        sizeLabel = `${size.name} (${size.weight}g)`;
        unitPrice = p.pricePerGram * size.weight;
    }

    // Increment quantity if same product+size already in cart
    const existing = cart.find(item => item.productName === p.name && item.sizeId === sizeId);
    if (existing) {
        existing.quantity += (p.mode === 'units' ? selectedQuantity : 1);
        existing.lineTotal = existing.unitPrice * existing.quantity;
    } else {
        cart.push({
            productName: p.name,
            productIndex: currentProductIndex,
            sizeId,
            sizeLabel,
            quantity: p.mode === 'units' ? selectedQuantity : 1,
            unitPrice,
            lineTotal: unitPrice * (p.mode === 'units' ? selectedQuantity : 1),
            mode: p.mode,
            image: p.image
        });
    }

    updateCartBadge();

    // Flash the button
    const btn = document.getElementById('buy-btn');
    if (btn) {
        const originalText = btn.querySelector('.btn-text').textContent;
        btn.querySelector('.btn-text').textContent = '✓ Added!';
        btn.classList.add('added');
        setTimeout(() => {
            btn.querySelector('.btn-text').textContent = originalText;
            btn.classList.remove('added');
        }, 1200);
    }
}

function openCartModal() {
    const modal = document.getElementById('cart-modal');
    const emptyEl = document.getElementById('cart-empty');
    const listEl = document.getElementById('cart-items-list');
    const totalsEl = document.getElementById('cart-totals');
    const actionsEl = document.getElementById('cart-actions');
    const subtotalEl = document.getElementById('cart-items-subtotal');

    if (cart.length === 0) {
        emptyEl.classList.remove('hidden');
        listEl.innerHTML = '';
        totalsEl.classList.add('hidden');
        actionsEl.classList.add('hidden');
    } else {
        emptyEl.classList.add('hidden');
        listEl.innerHTML = cart.map((item, idx) => `
            <div class="cart-item" data-index="${idx}">
                <div class="cart-item-info">
                    <span class="cart-item-name">${item.productName}</span>
                    <span class="cart-item-detail">${item.sizeLabel}${item.quantity > 1 && item.mode !== 'units' ? ' &times; ' + item.quantity : ''}</span>
                </div>
                <div class="cart-item-right">
                    <span class="cart-item-price">$${item.lineTotal.toFixed(2)}</span>
                    <button class="cart-remove-btn" data-index="${idx}" aria-label="Remove">&times;</button>
                </div>
            </div>
        `).join('');
        subtotalEl.textContent = `$${cartItemsSubtotal().toFixed(2)} USDT`;
        totalsEl.classList.remove('hidden');
        actionsEl.classList.remove('hidden');
    }

    modal.classList.remove('hidden');

    // Wire remove buttons
    listEl.querySelectorAll('.cart-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            cart.splice(idx, 1);
            updateCartBadge();
            openCartModal(); // re-render
        });
    });

    document.getElementById('cart-clear-btn').onclick = () => {
        cart = [];
        updateCartBadge();
        openCartModal();
    };

    document.getElementById('cart-checkout-btn').onclick = () => {
        closeCartModal();
        openCheckoutModal();
    };

    document.getElementById('cart-modal-close').onclick = closeCartModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeCartModal(); });
}

function closeCartModal() {
    document.getElementById('cart-modal').classList.add('hidden');
}

// ============ PAYMENT PROCESSING ============

async function processPayment() {
    if (cart.length === 0) {
        showPaymentStatus('Your cart is empty', 'error');
        return;
    }

    const postalAddress = document.getElementById('postal-address').value.trim();
    const emailAddress = document.getElementById('email-address').value.trim();

    // Validate delivery info
    if (selectedShipping === 'digital') {
        if (!emailAddress.includes('@')) {
            showPaymentStatus('Please enter a valid email address', 'error');
            return;
        }
    } else {
        if (postalAddress.length < 10) {
            showPaymentStatus('Please enter a complete postal address', 'error');
            return;
        }
    }

    // Build delivery string — include both if physical+email provided
    const deliveryInfo = selectedShipping === 'digital'
        ? emailAddress
        : (emailAddress.includes('@') ? `${postalAddress} | email: ${emailAddress}` : postalAddress);

    const totalPrice = cartGrandTotal();

    const payBtn = document.getElementById('pay-btn');
    payBtn.disabled = true;

    showPaymentStatus('Preparing transaction...', 'pending');

    try {
        if (!vendorPublicKey) {
            showPaymentStatus('Error: Vendor public key not configured', 'error');
            payBtn.disabled = false;
            return;
        }

        if (!buyerPublicKey) {
            showPaymentStatus('Getting buyer info...', 'pending');
            buyerPublicKey = await getMyPublicKey();
            if (!buyerPublicKey) {
                showPaymentStatus('Error: Could not get buyer public key', 'error');
                payBtn.disabled = false;
                return;
            }
        }

        const tokenName = selectedPaymentMethod === 'USDT' ? 'USDT' : 'Minima';
        const sendAmount = selectedPaymentMethod === 'USDT'
            ? totalPrice
            : totalPrice / mxToUsdRate * 1.10;

        // One shared order reference for the whole cart
        lastOrderReference = generateOrderReference('ORDER');

        // ── Send one encrypted ORDER message per cart item ──────────────────
        showPaymentStatus(`Sending ${cart.length} order message${cart.length > 1 ? 's' : ''}...`, 'pending');

        for (let i = 0; i < cart.length; i++) {
            const item = cart[i];
            const itemRef = `${lastOrderReference}-${i + 1}`;

            const orderPayload = {
                type: 'ORDER',
                randomid: generateRandomId(),
                ref: itemRef,
                cartRef: lastOrderReference,
                cartItem: `${i + 1} of ${cart.length}`,
                product: item.productName,
                size: item.sizeLabel,
                amount: item.lineTotal.toFixed(2),
                currency: tokenName,
                delivery: deliveryInfo,
                shipping: selectedShipping,
                timestamp: Date.now(),
                buyerPublicKey: buyerPublicKey
            };

            console.log(`Encrypting order ${i + 1}/${cart.length}:`, item.productName);
            const encryptResult = await encryptMessage(vendorPublicKey, orderPayload);
            if (!encryptResult || !encryptResult.encrypted) {
                throw new Error(`Failed to encrypt order for ${item.productName}`);
            }

            const state = {};
            state[99] = encryptResult.encrypted;
            const command = 'send address:' + MINIMERCH_ADDRESS + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);

            const orderResponse = await new Promise((resolve) => MDS.cmd(command, resolve));
            console.log(`Order ${i + 1} response:`, JSON.stringify(orderResponse));

            if (orderResponse && orderResponse.pending) {
                // Node is in read mode — store first pending and bail;
                // user must approve then retry. Full pending flow not practical for multi-item.
                pendingOrderUid = orderResponse.pendinguid;
                pendingOrderData = {
                    randomid: orderPayload.randomid,
                    ref: itemRef,
                    product: item.productName,
                    size: item.sizeLabel,
                    amount: item.lineTotal.toFixed(2),
                    currency: tokenName,
                    delivery: deliveryInfo,
                    shipping: selectedShipping,
                    buyerPublicKey: buyerPublicKey,
                    sendAmount: sendAmount
                };
                showPaymentStatus('Order pending approval — check Pending Actions to confirm', 'pending');
                payBtn.disabled = false;
                payBtn.querySelector('.btn-text').textContent = '⏳ Pending...';
                return;
            }

            if (!orderResponse || !orderResponse.status) {
                throw new Error(orderResponse?.error || `Order TX failed for ${item.productName}`);
            }

            // Save each order locally
            await addMessage({
                id: Date.now().toString() + i,
                randomid: orderPayload.randomid,
                ref: itemRef,
                type: 'ORDER',
                product: item.productName,
                size: item.sizeLabel,
                amount: item.lineTotal.toFixed(2),
                currency: tokenName,
                delivery: deliveryInfo,
                shipping: selectedShipping,
                timestamp: Date.now(),
                coinid: orderResponse?.response?.txnid || 'confirmed',
                read: true,
                direction: 'sent',
                buyerPublicKey: buyerPublicKey
            });
        }

        // ── Send one payment for the combined total ──────────────────────────
        showPaymentStatus('Sending payment...', 'pending');

        pendingPaymentData = { ref: lastOrderReference };

        const payCommand = selectedPaymentMethod === 'USDT'
            ? `send address:${vendorAddress} amount:${sendAmount.toFixed(8)} tokenid:${TOKEN_IDS.USDT}`
            : `send address:${vendorAddress} amount:${sendAmount.toFixed(8)} tokenid:${TOKEN_IDS.MINIMA}`;

        console.log('Payment command:', payCommand);

        MDS.cmd(payCommand, (payResponse) => {
            console.log('Payment Response:', JSON.stringify(payResponse));

            if (payResponse && payResponse.pending) {
                pendingPaymentUid = payResponse.pendinguid;
                showPaymentStatus('Payment pending approval — check Pending Actions', 'pending');
                if (payBtn) { payBtn.disabled = false; payBtn.querySelector('.btn-text').textContent = '⏳ Payment Pending...'; }
                return;
            }

            if (payResponse && payResponse.status) {
                completePayment(payResponse, payBtn);
                // Clear cart on successful payment
                cart = [];
                updateCartBadge();
            } else {
                showPaymentStatus((payResponse?.error || 'Payment may have failed') + ' (orders were sent)', 'error');
                if (payBtn) { payBtn.disabled = false; payBtn.querySelector('.btn-text').textContent = '💸 Pay Now'; }
            }
        });

    } catch (error) {
        console.error('Payment error:', error);
        payBtn.disabled = false;
        payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
        showPaymentStatus('Error: ' + error.message, 'error');
    }
}

// ============ PRICE FETCHING ============

async function saveLastPrice(price) {
    await saveSetting('minima_last_price', price.toString());
}

async function loadLastPrice() {
    const saved = await loadSetting('minima_last_price');
    return saved ? parseFloat(saved) : DEFAULT_MINIMA_PRICE;
}

// Complete order after it's confirmed (either immediately or after pending approval)
async function completeOrderAndPayment(orderResponse, payBtn) {
    const orderTxid = orderResponse?.response?.txnid || 'confirmed';
    console.log('Order sent with txid:', orderTxid);
    
    if (!pendingOrderData) {
        console.error('completeOrderAndPayment: No pending order data');
        return;
    }
    
    // Save sent order locally
    await addMessage({
        id: Date.now().toString(),
        randomid: pendingOrderData.randomid,
        ref: pendingOrderData.ref,
        type: 'ORDER',
        product: pendingOrderData.product,
        size: pendingOrderData.size,
        amount: pendingOrderData.amount,
        currency: pendingOrderData.currency,
        delivery: pendingOrderData.delivery,
        shipping: pendingOrderData.shipping,
        timestamp: Date.now(),
        coinid: orderTxid,
        read: true,
        direction: 'sent',
        buyerPublicKey: pendingOrderData.buyerPublicKey
    });
    
    showPaymentStatus('Sending payment...', 'pending');
    
    let payCommand;
    if (pendingOrderData.currency === 'USDT') {
        payCommand = 'send address:' + vendorAddress + ' amount:' + pendingOrderData.sendAmount.toFixed(8) + ' tokenid:' + TOKEN_IDS.USDT;
    } else {
        payCommand = 'send address:' + vendorAddress + ' amount:' + pendingOrderData.sendAmount.toFixed(8) + ' tokenid:' + TOKEN_IDS.MINIMA;
    }
    
    // Store payment data for pending handling
    pendingPaymentData = {
        ref: pendingOrderData.ref
    };
    
    console.log('Payment command:', payCommand);
    
    MDS.cmd(payCommand, (payResponse) => {
        console.log('Payment Response:', JSON.stringify(payResponse));
        
        // Check if payment is pending
        if (payResponse && payResponse.pending) {
            pendingPaymentUid = payResponse.pendinguid;
            console.log('Payment is PENDING - UID:', pendingPaymentUid, '- waiting for user approval');
            showPaymentStatus('Payment pending approval - check Pending Actions', 'pending');
            if (payBtn) {
                payBtn.disabled = false;
                payBtn.querySelector('.btn-text').textContent = '⏳ Payment Pending...';
            }
            return;
        }
        
        if (payResponse && payResponse.status) {
            completePayment(payResponse, payBtn);
        } else {
            const errorMsg = payResponse?.error || 'Payment may have failed';
            showPaymentStatus(errorMsg + ' (but order was sent)', 'error');
            if (payBtn) {
                payBtn.disabled = false;
                payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
            }
        }
    });
    
    // Clear pending order data after processing
    pendingOrderData = null;
}

// Complete payment after confirmation
function completePayment(payResponse, payBtn) {
    const txid = payResponse?.response?.txnid || 'confirmed';
    const ref = pendingPaymentData?.ref || lastOrderReference;
    
    if (payBtn) {
        payBtn.querySelector('.btn-text').textContent = '✓ Sent!';
        payBtn.classList.add('sent');
    }
    showPaymentStatus('Transaction sent! TX: ' + txid.substring(0, 20) + '...', 'success');
    
    setTimeout(() => {
        closeModal();
        showConfirmation(txid, ref);
    }, 3000);
    
    pendingPaymentData = null;
}

// Complete reply after confirmation (either immediately or after pending approval)
async function completeReply(response, statusEl, sendBtn) {
    const txid = response?.response?.txnid || 'confirmed';
    console.log('Reply confirmed with txid:', txid);
    
    if (!pendingReplyData) {
        console.error('completeReply: No pending reply data');
        return;
    }
    
    // Get UI elements if not passed (called from MDS_PENDING handler)
    if (!statusEl) statusEl = document.getElementById('buyer-reply-status');
    if (!sendBtn) sendBtn = document.getElementById('buyer-send-reply-btn');
    
    // Save sent message locally
    const sentMessage = {
        id: Date.now().toString(),
        randomid: pendingReplyData.randomid,
        ref: pendingReplyData.ref + '-R',
        type: 'BUYER_REPLY',
        subject: 'Re: ' + (pendingReplyData.ref || 'Order'),
        product: pendingReplyData.product || '',
        message: pendingReplyData.message,
        timestamp: Date.now(),
        coinid: txid,
        read: true,
        direction: 'sent'
    };
    await addMessage(sentMessage);
    
    if (statusEl) {
        statusEl.textContent = 'Reply sent! TX: ' + txid.substring(0, 20) + '...';
        statusEl.className = 'reply-status success';
    }
    if (sendBtn) {
        sendBtn.textContent = '✓ Sent!';
    }
    
    pendingReplyData = null;
    
    setTimeout(() => {
        closeBuyerReplyModal();
    }, 2000);
}

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

async function fetchMXPrice() {
    let price = await fetchCoinGeckoPrice();
    if (price && price > 0) {
        await saveLastPrice(price);
        return price;
    }
    
    price = await fetchCoinMarketCapPrice();
    if (price && price > 0) {
        await saveLastPrice(price);
        return price;
    }
    
    price = await loadLastPrice();
    if (price && price > 0) {
        return price;
    }
    
    return DEFAULT_MINIMA_PRICE;
}

// ============ UI FUNCTIONS ============

function initApp() {
    document.getElementById('product-name').textContent = PRODUCT.name;
    document.getElementById('product-description').textContent = PRODUCT.description;
    document.getElementById('product-image').src = PRODUCT.image;
    document.title = `miniShop - ${PRODUCT.name}`;
    
    const isUnitsMode = PRODUCT.mode === 'units';
    
    if (isUnitsMode) {
        document.getElementById('size-selector').classList.add('hidden');
        document.getElementById('quantity-selector').classList.remove('hidden');
        document.getElementById('quantity-input').max = PRODUCT.maxUnits;
        selectedQuantity = 1;
        document.getElementById('quantity-input').value = 1;
        document.getElementById('quantity-display').textContent = 1;
    } else {
        document.getElementById('size-selector').classList.remove('hidden');
        document.getElementById('quantity-selector').classList.add('hidden');
        updateSizeButtons();
    }
    
    updatePrices();
    setupEventListeners();
}

function updateSizeButtons() {
    const buttons = document.querySelectorAll('.size-btn');
    buttons.forEach(btn => {
        const sizeId = btn.dataset.size;
        const size = PRODUCT.sizes.find(s => s.id === sizeId);
        
        btn.querySelector('.size-weight').textContent = `${size.weight}g`;
        btn.querySelector('.size-percent').textContent = `${size.percentage}%`;
        
        if (sizeId === selectedSize) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function updatePrices() {
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
    }
    
    const priceUsdEl = document.getElementById('price-usd-value');
    if (priceUsdEl) {
        priceUsdEl.textContent = `$${productPrice.toFixed(2)} USDT`;
    }

    const buyBtnPriceEl = document.querySelector('.buy-button .btn-price');
    if (buyBtnPriceEl) {
        buyBtnPriceEl.textContent = `$${productPrice.toFixed(2)} USDT`;
    }
    
    const minimaPriceEl = document.getElementById('price-minima');
    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        const minimaAmount = productPrice / mxToUsdRate;
        if (minimaPriceEl) {
            minimaPriceEl.textContent = `${minimaAmount.toFixed(4)} Minima`;
        }
    } else {
        if (minimaPriceEl) {
            minimaPriceEl.textContent = 'Loading...';
        }
    }
    
    const modal = document.getElementById('modal');
    if (modal && !modal.classList.contains('hidden')) {
        updatePayButton();
    }
}

function setupEventListeners() {
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedSize = btn.dataset.size;
            updateSizeButtons();
            updatePrices();
        });
    });
    
    document.getElementById('qty-minus').addEventListener('click', () => {
        const input = document.getElementById('quantity-input');
        const current = parseInt(input.value) || 1;
        if (current > 1) {
            selectedQuantity = current - 1;
            input.value = selectedQuantity;
            document.getElementById('quantity-display').textContent = selectedQuantity;
            updatePrices();
        }
    });
    
    document.getElementById('qty-plus').addEventListener('click', () => {
        const input = document.getElementById('quantity-input');
        const current = parseInt(input.value) || 1;
        const max = parseInt(input.max) || 10;
        if (current < max) {
            selectedQuantity = current + 1;
            input.value = selectedQuantity;
            document.getElementById('quantity-display').textContent = selectedQuantity;
            updatePrices();
        }
    });
    
    document.getElementById('quantity-input').addEventListener('input', (e) => {
        let val = parseInt(e.target.value) || 1;
        const max = parseInt(e.target.max) || 10;
        if (val < 1) val = 1;
        if (val > max) val = max;
        selectedQuantity = val;
        document.getElementById('quantity-display').textContent = selectedQuantity;
        updatePrices();
    });
    
    document.querySelectorAll('.shipping-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedShipping = btn.dataset.shipping;
            shippingFee = parseFloat(btn.dataset.price);
            document.querySelectorAll('.shipping-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateAddressField();
            updatePrices();
            updateCheckoutSummary();
        });
    });
    
    document.getElementById('buy-btn').addEventListener('click', addToCart);
    
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPaymentMethod = btn.dataset.method;
            document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updatePayButton();
        });
    });
    
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    
    document.getElementById('postal-address').addEventListener('input', updatePayButton);
    document.getElementById('email-address').addEventListener('input', updatePayButton);
    document.getElementById('pay-btn').addEventListener('click', processPayment);
    document.getElementById('close-confirmation').addEventListener('click', closeConfirmationModal);
    
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });
}

function openCheckoutModal() {
    if (cart.length === 0) return;

    const modal = document.getElementById('modal');
    const itemsSubtotal = cartItemsSubtotal();
    const fee = cartShippingFee();
    const totalPrice = itemsSubtotal + fee;
    const minimaTotal = totalPrice / mxToUsdRate * 1.10;

    // Render per-item lines in checkout summary
    const linesEl = document.getElementById('checkout-cart-lines');
    if (linesEl) {
        linesEl.innerHTML = cart.map(item => `
            <div class="summary-item checkout-line">
                <span>${item.productName} &mdash; ${item.sizeLabel}${item.quantity > 1 && item.mode !== 'units' ? ' &times;' + item.quantity : ''}</span>
                <span>$${item.lineTotal.toFixed(2)}</span>
            </div>
        `).join('');
    }

    const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
    document.getElementById('modal-product').textContent = `${itemCount} item${itemCount > 1 ? 's' : ''}`;
    document.getElementById('summary-product').textContent = `$${itemsSubtotal.toFixed(2)} USDT`;
    document.getElementById('summary-shipping').textContent = fee === 0 ? 'Free' : `$${fee.toFixed(2)} USDT`;
    document.getElementById('summary-usd').textContent = `$${totalPrice.toFixed(2)} USDT`;

    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        document.getElementById('summary-minima').innerHTML = `${minimaTotal.toFixed(4)} Minima<br><span class="slippage-note">(+10% slippage)</span>`;
        document.getElementById('pay-amount').textContent = `${totalPrice.toFixed(2)} USD = ${minimaTotal.toFixed(4)} Minima`;
    } else {
        document.getElementById('summary-minima').textContent = 'Loading...';
        document.getElementById('pay-amount').textContent = '--';
    }

    document.getElementById('postal-address').value = '';
    document.getElementById('email-address').value = '';
    updateAddressField();
    updatePayButton();

    modal.classList.remove('hidden');
}

function updateCheckoutSummary() {
    const modal = document.getElementById('modal');
    if (modal.classList.contains('hidden')) return;

    const itemsSubtotal = cartItemsSubtotal();
    const fee = cartShippingFee();
    const totalPrice = itemsSubtotal + fee;
    const minimaTotal = totalPrice / mxToUsdRate * 1.10;

    document.getElementById('summary-product').textContent = `$${itemsSubtotal.toFixed(2)} USDT`;
    document.getElementById('summary-shipping').textContent = fee === 0 ? 'Free' : `$${fee.toFixed(2)} USDT`;
    document.getElementById('summary-usd').textContent = `$${totalPrice.toFixed(2)} USDT`;

    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        document.getElementById('summary-minima').innerHTML = `${minimaTotal.toFixed(4)} Minima<br><span class="slippage-note">(+10% slippage)</span>`;
        document.getElementById('pay-amount').textContent = `${totalPrice.toFixed(2)} USD = ${minimaTotal.toFixed(4)} Minima`;
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    hidePaymentStatus();
}

function updateAddressField() {
    const postalSection = document.getElementById('postal-address-section');
    const emailSection = document.getElementById('email-address-section');

    if (selectedShipping === 'digital') {
        // Digital only — hide postal, show email
        if (postalSection) postalSection.classList.add('hidden');
        if (emailSection) emailSection.classList.remove('hidden');
    } else {
        // Physical (uk/intl) — show both so mixed carts work
        if (postalSection) postalSection.classList.remove('hidden');
        if (emailSection) emailSection.classList.remove('hidden');
    }
}

function updatePayButton() {
    const postalAddress = document.getElementById('postal-address').value.trim();
    const emailAddress = document.getElementById('email-address').value.trim();
    const payBtn = document.getElementById('pay-btn');
    const payAmount = document.getElementById('pay-amount');

    const totalPrice = cartGrandTotal();

    let isAddressValid;
    if (selectedShipping === 'digital') {
        isAddressValid = emailAddress.includes('@') && emailAddress.length > 0;
    } else {
        // Physical: postal required; email optional (nice-to-have for mixed carts)
        isAddressValid = postalAddress.length >= 10;
    }

    if (mxToUsdRate > 0) {
        if (selectedPaymentMethod === 'USDT') {
            payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${totalPrice.toFixed(2)} USDT`;
        } else {
            const minimaAmount = totalPrice / mxToUsdRate * 1.10;
            payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${minimaAmount.toFixed(4)} Minima`;
        }
        payBtn.disabled = !isAddressValid || cart.length === 0;
    } else {
        payAmount.textContent = '--';
        payBtn.disabled = true;
    }
}
    
    const totalPrice = productPrice + shippingFee;
    
    let isAddressValid;
    if (selectedShipping === 'digital') {
        isAddressValid = emailAddress.includes('@') && emailAddress.length > 0;
    } else {
        isAddressValid = postalAddress.length >= 10;
    }
    
    if (mxToUsdRate > 0) {
        if (selectedPaymentMethod === 'USDT') {
            payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${totalPrice.toFixed(2)} USDT`;
        } else {
            const minimaAmount = totalPrice / mxToUsdRate * 1.10;
            payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${minimaAmount.toFixed(4)} Minima`;
        }
        payBtn.disabled = !isAddressValid;
    } else {
        payAmount.textContent = '--';
        payBtn.disabled = true;
    }
}

function showPaymentStatus(message, type) {
    const statusEl = document.getElementById('payment-status');
    statusEl.classList.remove('hidden', 'success', 'error', 'pending');
    statusEl.classList.add(type);
    statusEl.querySelector('.status-message').textContent = message;
}

function hidePaymentStatus() {
    const statusEl = document.getElementById('payment-status');
    statusEl.classList.add('hidden');
}

function showConfirmation(txid, orderRef) {
    document.getElementById('tx-id').textContent = txid || 'Pending...';
    document.getElementById('order-ref').textContent = orderRef || lastOrderReference || 'N/A';
    document.getElementById('confirmation-modal').classList.remove('hidden');
}

function closeConfirmationModal() {
    document.getElementById('confirmation-modal').classList.add('hidden');
}

function validateVendorAddress() {
    try {
        const decoded = JSON.parse(atob(VENDOR_CONFIG.obfuscatedAddress));
        if (decoded.address && decoded.address.startsWith('0x')) {
            vendorAddress = decoded.address;
            vendorPublicKey = getDecodedPublicKey();
            
            if (!vendorPublicKey) {
                console.error('Missing vendor public key');
                document.querySelector('.main-content').innerHTML = `
                    <div class="product-card" style="text-align: center; padding: 3rem;">
                        <h2 style="color: #c62828;">⚠️ Configuration Error</h2>
                        <p style="color: #333; margin-top: 1rem;">Vendor public key is missing.</p>
                    </div>
                `;
                return false;
            }
            
            return true;
        }
    } catch (e) {
        console.error('Vendor address validation failed:', e);
    }
    
    document.querySelector('.main-content').innerHTML = `
        <div class="product-card" style="text-align: center; padding: 3rem;">
            <h2 style="color: #c62828;">⚠️ Invalid Configuration</h2>
            <p style="color: #333; margin-top: 1rem;">This MiniDapp has been tampered with.</p>
        </div>
    `;
    return false;
}

// ============ INBOX VIEW ============

let currentView = 'shop';
let selectedMessage = null;

function renderShop() {
    const mainContent = document.querySelector('.main-content');
    mainContent.innerHTML = `
        <div class="product-card">
            <div class="product-image-container">
                <img id="product-image" src="item.jpg" alt="Product" class="product-image">
            </div>
            
            <div class="product-info">
                <h2 id="product-name" class="product-name">Loading...</h2>
                <p id="product-description" class="product-description">Loading product details...</p>
                
                <div class="price-display">
                    <div class="price-usd">
                        <span class="price-label">Price (MXUSDT)</span>
                        <span id="price-usd-value" class="price-value">$0.00</span>
                    </div>
                    <div class="price-crypto">
                        <span class="price-label">in Minima</span>
                        <span id="price-minima" class="price-value crypto">-- Minima</span>
                    </div>
                </div>
            </div>

            <div class="size-selector" id="size-selector">
                <h3 id="selector-title">Choose Your Size</h3>
                <div class="size-options">
                    <button class="size-btn" data-size="full">
                        <span class="size-name">Full</span>
                        <span class="size-weight">28g</span>
                        <span class="size-percent">100%</span>
                    </button>
                    <button class="size-btn" data-size="half">
                        <span class="size-name">Half</span>
                        <span class="size-weight">14g</span>
                        <span class="size-percent">50%</span>
                    </button>
                    <button class="size-btn" data-size="quarter">
                        <span class="size-name">Quarter</span>
                        <span class="size-weight">7g</span>
                        <span class="size-percent">25%</span>
                    </button>
                    <button class="size-btn active" data-size="eighth">
                        <span class="size-name">Eighth</span>
                        <span class="size-weight">3.5g</span>
                        <span class="size-percent">12.5%</span>
                    </button>
                </div>
            </div>

            <div class="quantity-selector hidden" id="quantity-selector">
                <h3>Choose Quantity</h3>
                <div class="quantity-input">
                    <button class="qty-btn qty-minus" id="qty-minus">−</button>
                    <input type="number" id="quantity-input" value="1" min="1" max="10">
                    <button class="qty-btn qty-plus" id="qty-plus">+</button>
                </div>
                <p class="quantity-label"><span id="quantity-display">1</span> unit(s)</p>
            </div>

            <button id="buy-btn" class="buy-button">
                <span class="btn-text">+ Add to Cart</span>
                <span class="btn-price">$0.00</span>
            </button>

            <div id="loading-indicator" class="loading hidden">
                <div class="spinner"></div>
                <span>Loading price...</span>
            </div>
        </div>
    `;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    
    return date.toLocaleDateString();
}

function getShippingLabel(shipping) {
    const labels = {
        'uk': '🇬🇧 UK Domestic ($5)',
        'intl': '🌍 International ($20)',
        'digital': '📧 Electronic Delivery (Free)'
    };
    return labels[shipping] || shipping;
}

function renderInbox() {
    const mainContent = document.querySelector('.main-content');
    const allReceivedMessages = currentMessages.filter(m => m.direction === 'received');
    const unreadMessages = allReceivedMessages.filter(m => !m.read);
    const sentMessages = currentMessages.filter(m => m.direction === 'sent');
    
    const unreadCount = unreadMessages.length;
    const totalCount = allReceivedMessages.length;
    const sentCount = sentMessages.length;
    
    // Determine which messages to show based on current view
    let displayMessages;
    if (currentView === 'inbox') {
        displayMessages = unreadMessages;
    } else if (currentView === 'all') {
        displayMessages = allReceivedMessages;
    } else if (currentView === 'sent') {
        displayMessages = sentMessages;
    } else {
        displayMessages = unreadMessages;
    }
    
    mainContent.innerHTML = `
        <div class="inbox-container">
            <div class="inbox-tabs">
                <button class="inbox-tab ${currentView === 'inbox' ? 'active' : ''}" data-view="inbox">
                    📥 Inbox ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : '(0)'}
                </button>
                <button class="inbox-tab ${currentView === 'all' ? 'active' : ''}" data-view="all">
                    📬 All (${totalCount})
                </button>
                <button class="inbox-tab ${currentView === 'sent' ? 'active' : ''}" data-view="sent">
                    📤 Sent (${sentCount})
                </button>
            </div>
            
            <div class="inbox-list" id="inbox-list">
                ${renderMessageList(displayMessages, currentView === 'sent' ? 'sent' : 'received')}
            </div>
            
            <div class="inbox-detail hidden" id="inbox-detail">
                ${selectedMessage ? renderMessageDetail(selectedMessage) : ''}
            </div>
        </div>
    `;
    
    setupInboxEventListeners();
}

function renderMessageList(messages, type) {
    if (messages.length === 0) {
        return `
            <div class="empty-inbox">
                <p>📭 No ${type} messages</p>
            </div>
        `;
    }
    
    return messages.map(msg => {
        const isReply = msg.type === 'REPLY';
        const isBuyerReply = msg.type === 'BUYER_REPLY';
        return `
        <div class="message-item ${msg.direction === 'received' && !msg.read ? 'unread' : ''} ${isBuyerReply ? 'buyer-reply' : ''}" data-id="${msg.id}">
            <div class="message-icon">${isBuyerReply ? '↩️' : (isReply ? '↩️' : (msg.direction === 'received' ? '📨' : '📤'))}</div>
            <div class="message-preview">
                <div class="message-subject">${msg.subject || msg.product || 'Order: ' + msg.ref}</div>
                <div class="message-meta">
                    <span class="message-ref">${msg.ref}</span>
                    ${isBuyerReply ? '<span class="message-type">Your Reply</span>' : 
                      (isReply ? '<span class="message-type">Vendor Reply</span>' : 
                      `<span class="message-amount">$${msg.amount} ${msg.currency}</span>`)}
                </div>
            </div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
        </div>
    `}).join('');
}

function renderMessageDetail(msg) {
    const isReceived = msg.direction === 'received';
    const isReply = msg.type === 'REPLY';
    const isBuyerReply = msg.type === 'BUYER_REPLY';
    const canReply = isReply && msg.vendorPublicKey;
    const showMarkAsRead = isReceived && !msg.read;
    
    // Vendor Reply (received)
    if (isReply && isReceived) {
        return `
            <button class="back-btn" id="back-to-list">← Back</button>
            <div class="message-header">
                <h3>↩️ Vendor Reply</h3>
                <span class="message-direction">${!msg.read ? '📨 Unread' : '📧 Read'}</span>
            </div>
            
            <div class="message-info">
                <div class="info-row">
                    <span class="info-label">Order Ref:</span>
                    <span class="info-value">${msg.ref}</span>
                </div>
                ${msg.product ? `
                <div class="info-row">
                    <span class="info-label">Re:</span>
                    <span class="info-value">${msg.product}</span>
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="info-label">Time:</span>
                    <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
            </div>
            
            <div class="reply-content">
                <h4>Message:</h4>
                <p class="reply-message">${msg.message}</p>
            </div>
            
            <div class="message-actions">
                ${showMarkAsRead ? `<button class="mark-read-btn" id="mark-read-btn" data-id="${msg.id}">✓ Mark as Read</button>` : ''}
                ${canReply ? `<button class="reply-to-vendor-btn" id="reply-to-vendor-btn" data-id="${msg.id}">↩️ Reply to Vendor</button>` : ''}
            </div>
            
            ${!canReply ? `
            <div class="reply-warning">
                <p>⚠️ Cannot reply - missing vendor contact info</p>
            </div>
            ` : ''}
        `;
    }
    
    // Sent BUYER_REPLY
    if (isBuyerReply && !isReceived) {
        return `
            <button class="back-btn" id="back-to-list">← Back</button>
            <div class="message-header">
                <h3>📤 Sent Reply</h3>
                <span class="message-direction">📤 Sent</span>
            </div>
            
            <div class="message-info">
                <div class="info-row">
                    <span class="info-label">Order Ref:</span>
                    <span class="info-value">${msg.ref}</span>
                </div>
                ${msg.product ? `
                <div class="info-row">
                    <span class="info-label">Re:</span>
                    <span class="info-value">${msg.product}</span>
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="info-label">Time:</span>
                    <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
            </div>
            
            <div class="reply-content">
                <h4>Your Message:</h4>
                <p class="reply-message">${msg.message}</p>
            </div>
        `;
    }
    
    // Sent ORDER
    if (!isReceived) {
        return `
            <button class="back-btn" id="back-to-list">← Back</button>
            <div class="message-header">
                <h3>📤 ${msg.subject || msg.product || 'Order: ' + msg.ref}</h3>
                <span class="message-direction">📤 Sent</span>
            </div>
            
            <div class="message-info">
                <div class="info-row">
                    <span class="info-label">Order Ref:</span>
                    <span class="info-value">${msg.ref}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Product:</span>
                    <span class="info-value">${msg.product}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Size:</span>
                    <span class="info-value">${msg.size}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Amount:</span>
                    <span class="info-value">$${msg.amount} ${msg.currency}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Shipping:</span>
                    <span class="info-value">${getShippingLabel(msg.shipping)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Time:</span>
                    <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Delivery To:</span>
                    <span class="info-value">${msg.delivery || 'N/A'}</span>
                </div>
            </div>
        `;
    }
    
    // Default: received message (should not reach here normally)
    return `
        <button class="back-btn" id="back-to-list">← Back</button>
        <div class="message-header">
            <h3>${msg.subject || msg.product || 'Message: ' + msg.ref}</h3>
            <span class="message-direction">${!msg.read ? '📨 Unread' : '📧 Read'}</span>
        </div>
        
        <div class="message-info">
            <div class="info-row">
                <span class="info-label">Ref:</span>
                <span class="info-value">${msg.ref}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Time:</span>
                <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
        </div>
        
        ${showMarkAsRead ? `
        <div class="message-actions">
            <button class="mark-read-btn" id="mark-read-btn" data-id="${msg.id}">✓ Mark as Read</button>
        </div>
        ` : ''}
    `;
}

function setupInboxEventListeners() {
    document.querySelectorAll('.inbox-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.dataset.view;
            selectedMessage = null;
            document.getElementById('inbox-detail').classList.add('hidden');
            document.getElementById('inbox-list').classList.remove('hidden');
            document.querySelectorAll('.inbox-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderInbox();
        });
    });
    
    document.querySelectorAll('.message-item').forEach(item => {
        item.addEventListener('click', () => {
            const msgId = item.dataset.id;
            selectedMessage = currentMessages.find(m => m.id == msgId);
            // Do NOT auto-mark as read - let user explicitly mark via button
            document.getElementById('inbox-list').classList.add('hidden');
            document.getElementById('inbox-detail').classList.remove('hidden');
            document.getElementById('inbox-detail').innerHTML = renderMessageDetail(selectedMessage);
            setupDetailEventListeners();
        });
    });
}

function setupDetailEventListeners() {
    const backBtn = document.getElementById('back-to-list');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            selectedMessage = null;
            document.getElementById('inbox-detail').classList.add('hidden');
            document.getElementById('inbox-list').classList.remove('hidden');
            renderInbox(); // Re-render to update counts
        });
    }
    
    // Mark as Read button
    const markReadBtn = document.getElementById('mark-read-btn');
    if (markReadBtn) {
        markReadBtn.addEventListener('click', async () => {
            const msgId = markReadBtn.dataset.id;
            const msg = currentMessages.find(m => m.id == msgId);
            if (msg) {
                msg.read = true;
                await updateMessageReadStatus(msg.randomid, true);
                markReadBtn.textContent = '✓ Marked as Read';
                markReadBtn.disabled = true;
                markReadBtn.style.opacity = '0.5';
                // Update the detail view header
                const directionEl = document.querySelector('.message-direction');
                if (directionEl) {
                    directionEl.textContent = '📧 Read';
                }
            }
        });
    }
    
    const replyToVendorBtn = document.getElementById('reply-to-vendor-btn');
    if (replyToVendorBtn) {
        replyToVendorBtn.addEventListener('click', () => {
            const msgId = replyToVendorBtn.dataset.id;
            const msg = currentMessages.find(m => m.id == msgId);
            if (msg) {
                openBuyerReplyModal(msg);
            }
        });
    }
    
    const buyerReplyModalClose = document.getElementById('buyer-reply-modal-close');
    if (buyerReplyModalClose) {
        buyerReplyModalClose.addEventListener('click', closeBuyerReplyModal);
    }
    
    const buyerReplyModal = document.getElementById('buyer-reply-modal');
    if (buyerReplyModal) {
        buyerReplyModal.addEventListener('click', (e) => {
            if (e.target.id === 'buyer-reply-modal') {
                closeBuyerReplyModal();
            }
        });
    }
    
    const buyerSendReplyBtn = document.getElementById('buyer-send-reply-btn');
    if (buyerSendReplyBtn) {
        buyerSendReplyBtn.addEventListener('click', sendBuyerReply);
    }
}

function switchView(view) {
    currentView = view;
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    if (view === 'shop') {
        renderShop();
        initApp();
        initCarousel();
    } else {
        renderInbox();
    }
}

function setupNavigation() {
    const header = document.querySelector('.header');
    header.innerHTML = `
        <div class="logo">
            <span class="logo-icon">🛒</span>
            <h1>miniMerch</h1>
        </div>
        <nav class="nav-tabs">
            <button class="nav-btn active" data-view="shop">Shop</button>
            <button class="nav-btn" data-view="inbox" id="nav-inbox">Mailbox</button>
        </nav>
        <button class="cart-btn" id="cart-btn" aria-label="Open cart">
            🛒
            <span class="cart-badge hidden" id="cart-badge">0</span>
        </button>
    `;

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('cart-btn').addEventListener('click', openCartModal);
}

// ============ CAROUSEL ============

let currentProductIndex = 0;

function initCarousel() {
    const total = PRODUCTS.length;

    // Hide arrows and dots if only one product — zero UX change for single-product shops
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dotsEl  = document.getElementById('carousel-dots');

    if (total <= 1) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (dotsEl)  dotsEl.style.display  = 'none';
        return;
    }

    renderCarouselDots();

    if (prevBtn) prevBtn.addEventListener('click', () => navigateProduct(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateProduct(1));

    // Touch swipe support
    let touchStartX = 0;
    const track = document.querySelector('.carousel-track');
    if (track) {
        track.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].clientX;
        }, { passive: true });
        track.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 40) navigateProduct(dx < 0 ? 1 : -1);
        }, { passive: true });
    }
}

function renderCarouselDots() {
    const dotsEl = document.getElementById('carousel-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = PRODUCTS.map((_, i) =>
        `<button class="carousel-dot${i === currentProductIndex ? ' active' : ''}" data-index="${i}" aria-label="Product ${i + 1}"></button>`
    ).join('');
    dotsEl.querySelectorAll('.carousel-dot').forEach(dot => {
        dot.addEventListener('click', () => navigateProduct(parseInt(dot.dataset.index) - currentProductIndex));
    });
}

function navigateProduct(direction) {
    const total = PRODUCTS.length;
    currentProductIndex = (currentProductIndex + direction + total) % total;

    // Update the global PRODUCT alias so all existing logic works unchanged
    // eslint-disable-next-line no-global-assign
    PRODUCT = PRODUCTS[currentProductIndex];

    // Reset per-product UI state
    selectedSize = 'eighth';
    selectedQuantity = 1;

    renderShop();
    initApp();
    renderCarouselDots();
}

// ============ MDS INITIALIZATION ============

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('MDS initialized (ChainMail protocol)');
        
        if (!validateVendorAddress()) return;
        
        await initDB();
        currentMessages = await loadMessagesFromDb();
        
        // Get buyer's public key
        buyerPublicKey = await getMyPublicKey();
        console.log('Buyer public key:', buyerPublicKey ? buyerPublicKey.substring(0, 20) + '...' : 'null');
        
        // Register coinnotify for the fixed MINIMERCH_ADDRESS
        MDS.cmd('coinnotify action:add address:' + MINIMERCH_ADDRESS, function(resp) {
            console.log('Shop: coinnotify registered for MINIMERCH_ADDRESS:', JSON.stringify(resp));
        });
        
        setupNavigation();
        renderShop();
        initApp();
        initCarousel();
        
        // Scan for replies
        setTimeout(() => scanForReplies(), 3000);
        
        // Periodic polling for replies
        setInterval(() => scanForReplies(), 30000);
        
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        
        mxToUsdRate = await fetchMXPrice();
        console.log('Got price:', mxToUsdRate);
        
        if (loadingIndicator) loadingIndicator.classList.add('hidden');
        updatePrices();
        
    } else if (msg.event === 'NOTIFYCOIN') {
        if (msg.data && msg.data.coin) {
            const coin = msg.data.coin;
            if (coin.address === MINIMERCH_ADDRESS) {
                processReplyMessage(coin);
            }
        }
    } else if (msg.event === 'NEWBLOCK') {
        mxToUsdRate = await fetchMXPrice();
        updatePrices();
    } else if (msg.event === 'MDS_TIMER_10SECONDS') {
        scanForReplies();
    } else if (msg.event === 'MDS_PENDING') {
        // Handle pending action results by matching UID (Wallet pattern)
        console.log('MDS_PENDING:', JSON.stringify(msg.data));
        const payBtn = document.getElementById('pay-btn');
        
        // Match our pending ORDER by UID
        if (pendingOrderUid && msg.data && msg.data.uid === pendingOrderUid) {
            pendingOrderUid = null;
            if (msg.data.accept && msg.data.result && msg.data.result.status) {
                console.log('Order ACCEPTED and succeeded');
                showPaymentStatus('Order approved! Sending payment...', 'pending');
                await completeOrderAndPayment(msg.data.result, payBtn);
            } else if (msg.data.accept) {
                console.log('Order accepted but FAILED:', msg.data.result?.error);
                showPaymentStatus('Order failed: ' + (msg.data.result?.error || 'Unknown error'), 'error');
                pendingOrderData = null;
                if (payBtn) { payBtn.disabled = false; payBtn.querySelector('.btn-text').textContent = '💸 Pay Now'; }
            } else {
                console.log('Order DENIED by user');
                showPaymentStatus('Order was denied', 'error');
                pendingOrderData = null;
                if (payBtn) { payBtn.disabled = false; payBtn.querySelector('.btn-text').textContent = '💸 Pay Now'; }
            }
            return;
        }
        
        // Match our pending PAYMENT by UID  
        if (pendingPaymentUid && msg.data && msg.data.uid === pendingPaymentUid) {
            pendingPaymentUid = null;
            if (msg.data.accept && msg.data.result && msg.data.result.status) {
                console.log('Payment ACCEPTED and succeeded');
                completePayment(msg.data.result, payBtn);
            } else if (msg.data.accept) {
                showPaymentStatus('Payment failed: ' + (msg.data.result?.error || 'Unknown'), 'error');
                pendingPaymentData = null;
            } else {
                showPaymentStatus('Payment denied (order was still sent)', 'error');
                pendingPaymentData = null;
            }
            if (payBtn) { payBtn.disabled = false; payBtn.querySelector('.btn-text').textContent = '💸 Pay Now'; }
            return;
        }
        
        // Match our pending REPLY by UID
        if (pendingReplyUid && msg.data && msg.data.uid === pendingReplyUid) {
            pendingReplyUid = null;
            const statusEl = document.getElementById('buyer-reply-status');
            const sendBtn = document.getElementById('buyer-send-reply-btn');
            
            if (msg.data.accept && msg.data.result && msg.data.result.status) {
                console.log('Reply ACCEPTED and succeeded');
                await completeReply(msg.data.result, statusEl, sendBtn);
            } else if (msg.data.accept) {
                console.log('Reply accepted but FAILED:', msg.data.result?.error);
                if (statusEl) {
                    statusEl.textContent = 'Reply failed: ' + (msg.data.result?.error || 'Unknown error');
                    statusEl.className = 'reply-status error';
                }
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = '📤 Send Reply';
                }
                pendingReplyData = null;
            } else {
                console.log('Reply DENIED by user');
                if (statusEl) {
                    statusEl.textContent = 'Reply was denied';
                    statusEl.className = 'reply-status error';
                }
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = '📤 Send Reply';
                }
                pendingReplyData = null;
            }
            return;
        }
    }
});

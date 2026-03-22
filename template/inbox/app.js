// ChainMail-style protocol: Fixed address for ALL messages, encryption-based privacy
const MINIMERCH_ADDRESS = '0x4D494E494D45524348'; // hex for "MINIMERCH"

const TOKEN_IDS = {
    MINIMA: '0x00'
};

let currentMessages = [];
let selectedMessage = null;
let myPublicKey = null;
let pollingInterval = null;
let dbReady = false;
let pendingReplyData = null; // Track pending reply for when confirmed
let pendingReplyUid = null; // UID of pending reply command

function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function generateRandomId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
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
        // Create table with all columns
        const createResult = await sqlAsync(
            `CREATE TABLE IF NOT EXISTS messages (` +
            `id INTEGER PRIMARY KEY AUTO_INCREMENT,` +
            `randomid VARCHAR(255) UNIQUE,` +
            `ref VARCHAR(255), type VARCHAR(50), product VARCHAR(500), size VARCHAR(100),` +
            `amount VARCHAR(50), currency VARCHAR(50), delivery VARCHAR(500), shipping VARCHAR(50),` +
            `message TEXT, timestamp BIGINT, coinid VARCHAR(255),` +
            `"read" INTEGER DEFAULT 0, direction VARCHAR(50) DEFAULT 'received',` +
            `buyerPublicKey TEXT, buyerAddress VARCHAR(255),` +
            `originalRef VARCHAR(255), originalOrder TEXT, originalProduct TEXT)`
        );
        console.log('CREATE messages table result:', JSON.stringify(createResult));
        
        // Migration: Add columns if they don't exist (for existing installs)
        // These may fail if columns already exist, that's OK
        await sqlAsync(`ALTER TABLE messages ADD COLUMN originalRef TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN originalOrder TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN originalProduct TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN direction TEXT DEFAULT 'received'`);
        
        // Verify table exists
        const verifyResult = await sqlAsync(`SELECT COUNT(*) as cnt FROM messages`);
        console.log('Verify messages table:', JSON.stringify(verifyResult));
        
        if (verifyResult && verifyResult.status) {
            dbReady = true;
            console.log('Inbox DB initialized successfully');
        } else {
            console.error('Inbox DB verification failed:', verifyResult?.error);
        }
    } catch (err) {
        console.error('Inbox DB init error:', err);
    }
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
            `timestamp, coinid, "read", direction, buyerPublicKey, buyerAddress, ` +
            `originalRef, originalOrder, originalProduct) ` +
            `VALUES (` +
            `${escapeSQL(message.randomid)}, ` +
            `${escapeSQL(message.ref || '')}, ${escapeSQL(message.type || 'ORDER')}, ` +
            `${escapeSQL(message.product || '')}, ${escapeSQL(message.size || '')}, ` +
            `${escapeSQL(message.amount || '')}, ${escapeSQL(message.currency || '')}, ` +
            `${escapeSQL(message.delivery || '')}, ${escapeSQL(message.shipping || '')}, ` +
            `${escapeSQL(message.message || '')}, ${message.timestamp || Date.now()}, ` +
            `${escapeSQL(message.coinid || '')}, ${message.read ? 1 : 0}, ` +
            `${escapeSQL(message.direction || 'received')}, ` +
            `${escapeSQL(message.buyerPublicKey || '')}, ${escapeSQL(message.buyerAddress || '')}, ` +
            `${escapeSQL(message.originalRef || '')}, ${escapeSQL(message.originalOrder || '')}, ` +
            `${escapeSQL(message.originalProduct || '')})`;
        
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

async function loadMessagesFromDb() {
    try {
        const resp = await sqlAsync(`SELECT * FROM messages ORDER BY timestamp DESC`);
        console.log('loadMessagesFromDb: found', resp?.rows?.length || 0, 'messages');
        if (resp && resp.status && resp.rows) {
            // H2 database returns column names in UPPERCASE and numbers as strings
            return resp.rows.map(row => {
                const ts = row.TIMESTAMP || row.timestamp;
                const dir = row.DIRECTION || row.direction || 'received';
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
                    buyerAddress: row.BUYERADDRESS || row.buyerAddress,
                    originalRef: row.ORIGINALREF || row.originalRef,
                    originalOrder: row.ORIGINALORDER || row.originalOrder,
                    originalProduct: row.ORIGINALPRODUCT || row.originalProduct
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

async function updateMessageInDb(message) {
    try {
        const result = await sqlAsync(
            `UPDATE messages SET "read" = ${message.read ? 1 : 0} WHERE randomid = ${escapeSQL(message.randomid)}`
        );
        console.log('updateMessageInDb:', message.randomid, 'read:', message.read, 'result:', result?.status);
    } catch (err) {
        console.error('updateMessageInDb error:', err);
    }
}

// ============ ENCRYPTION FUNCTIONS ============

function encryptMessage(publicKey, data) {
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
                senderPublicKey: message.mxpublickey || response.response?.mxpublickey || null
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
    renderInbox();
    
    if (message.direction === 'received' && typeof MDS !== 'undefined') {
        MDS.notify('New Order: ' + message.ref);
    }
}

async function processIncomingMessage(coin) {
    const coinid = coin.coinid || coin.txid || '';
    const stateData = getState99Data(coin.state);
    if (!stateData) return;
    
    console.log('Processing potential message...');
    
    const decrypted = await tryDecryptMessage(stateData);
    if (!decrypted) {
        console.log('Could not decrypt (not for us)');
        return;
    }
    
    // Check for duplicate
    const randomid = decrypted.randomid || (decrypted.ref + '_' + decrypted.timestamp);
    const stored = await isMessageStored(randomid);
    if (stored) {
        console.log('Message already stored, skipping:', randomid);
        return;
    }
    
    console.log('Decrypted message:', JSON.stringify({ type: decrypted.type, ref: decrypted.ref }));
    
    if (decrypted.type === 'ORDER') {
        // New order from buyer
        // cartItems is present for multi-product cart orders; store as JSON in originalOrder
        const cartItemsJson = decrypted.cartItems ? JSON.stringify(decrypted.cartItems) : null;
        const message = {
            id: Date.now().toString(),
            randomid: randomid,
            ref: decrypted.ref || 'Unknown-' + Date.now(),
            type: 'ORDER',
            product: decrypted.product || 'Unknown Product',
            size: decrypted.size || '',
            amount: decrypted.amount || '0',
            currency: decrypted.currency || 'USDT',
            delivery: decrypted.delivery || '',
            shipping: decrypted.shipping || 'uk',
            timestamp: decrypted.timestamp || Date.now(),
            coinid: coinid,
            read: false,
            direction: 'received',
            buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
            buyerAddress: decrypted.buyerAddress || '',
            originalOrder: cartItemsJson || ''
        };
        await addMessage(message);
        
    } else if (decrypted.type === 'BUYER_REPLY') {
        // Buyer's reply to vendor
        const message = {
            id: Date.now().toString(),
            randomid: randomid,
            ref: decrypted.ref || 'Unknown-' + Date.now(),
            type: 'BUYER_REPLY',
            product: decrypted.originalOrder || '',
            message: decrypted.message || '',
            timestamp: decrypted.timestamp || Date.now(),
            coinid: coinid,
            read: false,
            direction: 'received',
            buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
            buyerAddress: decrypted.buyerAddress || ''
        };
        await addMessage(message);
    }
}

async function scanForMessages() {
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

            console.log('Inbox: scanning', coins.length, 'coins at MINIMERCH_ADDRESS');

            for (const coin of coins) {
                const state99 = getState99Data(coin.state);
                if (!state99) continue;
                
                await processIncomingMessage(coin);
            }
            
            resolve();
        });
    });
}

// ============ VENDOR REPLY TO BUYER ============

function openReplyModal(msg) {
    const replyModal = document.getElementById('reply-modal');
    document.getElementById('reply-order-ref').textContent = msg.ref;
    document.getElementById('reply-to-address').textContent = msg.buyerPublicKey ? msg.buyerPublicKey.substring(0, 30) + '...' : 'Unknown';
    document.getElementById('reply-message').value = '';
    document.getElementById('reply-status').textContent = '';
    document.getElementById('reply-status').className = 'reply-status';
    
    const sendBtn = document.getElementById('send-reply-btn');
    sendBtn.disabled = false;
    sendBtn.textContent = '📤 Send Reply';
    sendBtn.onclick = () => sendReply(msg);
    
    replyModal.classList.remove('hidden');
}

function closeReplyModal() {
    document.getElementById('reply-modal').classList.add('hidden');
}

async function sendReply(msg) {
    const messageText = document.getElementById('reply-message').value.trim();
    const statusEl = document.getElementById('reply-status');
    const sendBtn = document.getElementById('send-reply-btn');
    
    if (!messageText) {
        statusEl.textContent = 'Please enter a message';
        statusEl.className = 'reply-status error';
        return;
    }
    
    if (!msg.buyerPublicKey) {
        statusEl.textContent = 'Missing buyer contact information';
        statusEl.className = 'reply-status error';
        return;
    }
    
    statusEl.textContent = 'Encrypting reply...';
    statusEl.className = 'reply-status pending';
    sendBtn.disabled = true;
    
    try {
        // Get our public key if not already fetched
        if (!myPublicKey) {
            myPublicKey = await getMyPublicKey();
        }
        
        const replyPayload = {
            type: 'REPLY',
            randomid: generateRandomId(), // ChainMail pattern for deduplication
            ref: msg.ref,
            originalOrder: msg.product + (msg.size ? ' - ' + msg.size : ''),
            message: messageText,
            timestamp: Date.now(),
            vendorPublicKey: myPublicKey || '' // Include explicitly for buyer to reply back
        };
        
        console.log('Sending reply payload:', replyPayload);
        
        const encryptResult = await encryptMessage(msg.buyerPublicKey, replyPayload);
        
        if (!encryptResult || !encryptResult.encrypted) {
            throw new Error('Encryption failed');
        }
        
        statusEl.textContent = 'Sending encrypted reply...';
        
        const state = {};
        state[99] = encryptResult.encrypted;
        
        // ChainMail pattern: Send to fixed MINIMERCH_ADDRESS
        const command = 'send address:' + MINIMERCH_ADDRESS + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        console.log('Sending vendor reply to MINIMERCH_ADDRESS');
        
        // Store reply data for pending handling
        pendingReplyData = {
            randomid: replyPayload.randomid,
            ref: msg.ref,
            originalOrder: msg.product ? (msg.product + (msg.size ? ' - ' + msg.size : '')) : msg.ref,
            originalProduct: msg.product || '',
            message: messageText,
            buyerPublicKey: msg.buyerPublicKey || '',
            buyerAddress: msg.buyerAddress || ''
        };
        
        MDS.cmd(command, (response) => {
            console.log('Reply TX Response:', JSON.stringify(response));
            
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
                completeVendorReply(response, statusEl, sendBtn);
            } else {
                statusEl.textContent = 'Failed: ' + (response?.error || 'Transaction failed');
                statusEl.className = 'reply-status error';
                sendBtn.disabled = false;
                sendBtn.textContent = '📤 Send Reply';
                pendingReplyData = null;
            }
        });
        
    } catch (error) {
        console.error('Error sending reply:', error);
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.className = 'reply-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send Reply';
    }
}

// Complete vendor reply after confirmation (either immediately or after pending approval)
async function completeVendorReply(response, statusEl, sendBtn) {
    const txid = response?.response?.txnid || 'confirmed';
    console.log('Reply confirmed with txid:', txid);
    
    if (!pendingReplyData) {
        console.error('completeVendorReply: No pending reply data');
        return;
    }
    
    // Get UI elements if not passed (called from MDS_PENDING handler)
    if (!statusEl) statusEl = document.getElementById('reply-status');
    if (!sendBtn) sendBtn = document.getElementById('send-reply-btn');
    
    // Save sent message locally
    const sentMsg = {
        id: Date.now().toString(),
        randomid: pendingReplyData.randomid,
        ref: pendingReplyData.ref,
        originalRef: pendingReplyData.ref,
        originalOrder: pendingReplyData.originalOrder,
        originalProduct: pendingReplyData.originalProduct,
        message: pendingReplyData.message,
        timestamp: Date.now(),
        type: 'REPLY',
        direction: 'sent',
        coinid: txid,
        buyerPublicKey: pendingReplyData.buyerPublicKey,
        buyerAddress: pendingReplyData.buyerAddress
    };
    
    currentMessages.unshift(sentMsg);
    await saveMessageToDb(sentMsg);
    
    if (statusEl) {
        statusEl.textContent = 'Reply sent! ✓';
        statusEl.className = 'reply-status success';
    }
    if (sendBtn) {
        sendBtn.textContent = '✓ Sent!';
    }
    
    pendingReplyData = null;
    
    setTimeout(() => {
        closeReplyModal();
        closeModal();
        renderInbox();
    }, 2000);
}

// ============ UI FUNCTIONS ============

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
        'uk': 'UK Domestic ($5)',
        'intl': 'International ($20)',
        'digital': 'Electronic Delivery (Free)'
    };
    return labels[shipping] || shipping;
}

let currentView = 'inbox';

function renderInbox() {
    const inboxList = document.getElementById('inbox-list');
    if (!inboxList) {
        console.log('RENDER: inboxList element not found');
        return;
    }
    
    const unreadCount = currentMessages.filter(m => !m.read && m.direction !== 'sent').length;
    const totalCount = currentMessages.filter(m => m.direction !== 'sent').length;
    const sentCount = currentMessages.filter(m => m.direction === 'sent').length;
    
    document.getElementById('unread-count').textContent = unreadCount;
    document.getElementById('total-count').textContent = totalCount;
    const sentCountEl = document.getElementById('sent-count');
    if (sentCountEl) sentCountEl.textContent = sentCount;
    
    let messages = currentMessages;
    if (currentView === 'inbox') {
        messages = currentMessages.filter(m => !m.read && m.direction !== 'sent');
    } else if (currentView === 'all') {
        messages = currentMessages.filter(m => m.direction !== 'sent');
    } else if (currentView === 'sent') {
        messages = currentMessages.filter(m => m.direction === 'sent');
    }
    
    console.log('RENDER:', messages.length, 'messages for view:', currentView);
    
    if (messages.length === 0) {
        inboxList.innerHTML = `
            <div class="empty-inbox">
                <div class="empty-icon">${currentView === 'inbox' ? '📭' : (currentView === 'sent' ? '📤' : '✅')}</div>
                <p>${currentView === 'inbox' ? 'No unread orders' : (currentView === 'sent' ? 'No sent replies' : 'No orders yet')}</p>
                <p class="empty-hint">${currentView === 'sent' ? 'Replies you send to buyers will appear here' : 'Orders from your shops will appear here'}</p>
                ${currentView !== 'sent' ? '<button class="refresh-btn" id="refresh-btn">🔄 Check for Orders</button>' : ''}
            </div>
        `;
        setupRefreshButton();
        return;
    }
    
    inboxList.innerHTML = messages.map(msg => {
        const isBuyerReply = msg.type === 'BUYER_REPLY';
        const isSent = msg.direction === 'sent';
        return `
        <div class="message-item ${!msg.read && !isSent ? 'unread' : ''} ${isBuyerReply ? 'buyer-reply' : ''} ${isSent ? 'sent-message' : ''}" data-id="${msg.id}">
            <div class="message-icon">${isSent ? '📤' : (isBuyerReply ? '↩️' : (msg.read ? '📧' : '📨'))}</div>
            <div class="message-preview">
                <div class="message-ref">${isSent ? '↩️ ' : ''}${isSent ? msg.originalRef || msg.ref : (isBuyerReply ? '↩️ ' : '') + msg.ref}</div>
                <div class="message-product">${isSent ? (msg.originalProduct || msg.originalOrder || 'Reply') : (isBuyerReply ? 'Buyer Reply' : msg.product)}</div>
                <div class="message-meta">
                    ${isSent ? '<span class="message-type sent-type">📤 Sent Reply</span>' : (isBuyerReply ? '<span class="message-type">Buyer Reply</span>' : `
                    <span class="message-size">${msg.size}</span>
                    <span class="message-amount">$${msg.amount} ${msg.currency}</span>
                    `)}
                </div>
            </div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
        </div>
    `}).join('');
    
    setupMessageListeners();
    setupRefreshButton();
}

function setupRefreshButton() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            btn.textContent = 'Checking...';
            btn.disabled = true;
            scanForMessages().then(() => {
                btn.textContent = '🔄 Check for Orders';
                btn.disabled = false;
            });
        });
    }
}

function setupMessageListeners() {
    document.querySelectorAll('.message-item').forEach(item => {
        item.addEventListener('click', () => {
            const msgId = item.dataset.id;
            selectedMessage = currentMessages.find(m => m.id == msgId);
            showMessageDetail(selectedMessage);
        });
    });
}

// ── Copy-to-clipboard helpers ────────────────────────────────────────────────
function wireCopyBtn(btnId, text) {
    const btn = document.getElementById(btnId);
    if (!btn || !text || text === '-') return;
    btn.style.display = 'inline-flex';
    btn.onclick = () => {
        const doFlash = () => {
            btn.textContent = '✓';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = '\u{1F4CB}';
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

function setTxid(fullId) {
    const el = document.getElementById('modal-txid');
    if (el) el.textContent = fullId || '-';
    wireCopyBtn('copy-txid-btn', fullId);
}

function showMessageDetail(msg) {
    if (!msg) return;
    
    const modal = document.getElementById('message-modal');
    const isBuyerReply = msg.type === 'BUYER_REPLY';
    
    // Reset all button/action states
    const replyBtn = document.getElementById('reply-btn');
    const replyAction = document.getElementById('reply-action');
    const replyWarning = document.getElementById('reply-warning');
    replyBtn.disabled = false;
    replyBtn.style.opacity = '1';
    replyBtn.style.cursor = 'pointer';
    replyBtn.textContent = '↩️ Reply to Buyer';
    replyBtn.onclick = null;
    replyAction.style.display = 'none';
    replyWarning.style.display = 'none';
    document.getElementById('copy-address-btn').style.display = 'none';
    document.getElementById('mark-read-btn').style.display = 'none';
    
    if (msg.direction === 'sent') {
        document.getElementById('modal-title').textContent = '📤 Sent Reply: ' + (msg.originalRef || msg.ref);
        document.getElementById('modal-direction').textContent = '📤 Sent';
        setTxid(msg.coinid || '-');
        
        document.getElementById('modal-info').innerHTML = `
            <div class="info-row">
                <span class="info-label">Order Ref:</span>
                <span class="info-value">${msg.originalRef || msg.ref}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Original Order:</span>
                <span class="info-value">${msg.originalProduct || msg.originalOrder || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Time Sent:</span>
                <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            <div class="reply-content">
                <h4>Your Reply:</h4>
                <p class="reply-message">${msg.message || 'No message'}</p>
            </div>
        `;
        
        replyBtn.disabled = true;
        replyBtn.style.opacity = '0.5';
        
        modal.classList.remove('hidden');
        return;
    }
    
    if (isBuyerReply) {
        document.getElementById('modal-title').textContent = '↩️ Buyer Reply: ' + msg.ref;
        document.getElementById('modal-direction').textContent = !msg.read ? '📨 Unread' : '📧 Read';
        setTxid(msg.coinid || '-');
        
        document.getElementById('modal-info').innerHTML = `
            <div class="info-row">
                <span class="info-label">Order Ref:</span>
                <span class="info-value">${msg.ref}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Original Order:</span>
                <span class="info-value">${msg.product || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Time:</span>
                <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            <div class="reply-content">
                <h4>Buyer's Message:</h4>
                <p class="reply-message">${msg.delivery || msg.message || 'No message'}</p>
            </div>
        `;
        
        const markReadBtn = document.getElementById('mark-read-btn');
        if (!msg.read) {
            markReadBtn.style.display = 'block';
            markReadBtn.onclick = () => {
                msg.read = true;
                updateMessageInDb(msg);
                renderInbox();
                markReadBtn.style.display = 'none';
            };
        }
        
        if (msg.buyerPublicKey) {
            replyAction.style.display = 'block';
            replyWarning.style.display = 'none';
            replyBtn.onclick = () => openReplyModal(msg);
        } else {
            replyAction.style.display = 'block';
            replyWarning.style.display = 'block';
            replyWarning.textContent = '⚠️ Cannot reply - missing buyer contact info';
            replyBtn.disabled = true;
            replyBtn.style.opacity = '0.5';
        }
        
        modal.classList.remove('hidden');
        return;
    }
    
    // Regular ORDER
    document.getElementById('modal-title').textContent = 'Order: ' + msg.ref;
    document.getElementById('modal-direction').textContent = !msg.read ? '📨 Unread' : '📧 Read';
    setTxid(msg.coinid || '-');

    // Try to parse cart items if this is a multi-product order
    let cartItemsHtml = '';
    let cartItems = null;
    try {
        if (msg.originalOrder) cartItems = JSON.parse(msg.originalOrder);
    } catch (e) { cartItems = null; }

    if (cartItems && Array.isArray(cartItems) && cartItems.length > 0) {
        // Multi-item cart order — render each line
        const rows = cartItems.map(item =>
            `<div class="cart-order-line">
                <span class="cart-order-name">${item.product}</span>
                <span class="cart-order-detail">${item.size}${item.quantity > 1 ? ' &times;' + item.quantity : ''}</span>
                <span class="cart-order-price">$${item.lineTotal}</span>
            </div>`
        ).join('');
        cartItemsHtml = `
        <div class="info-row">
            <span class="info-label">Items:</span>
            <span class="info-value"></span>
        </div>
        <div class="cart-order-lines">${rows}</div>`;
    } else {
        // Single-product order — legacy display
        cartItemsHtml = `
        <div class="info-row">
            <span class="info-label">Product:</span>
            <span class="info-value">${msg.product}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Size:</span>
            <span class="info-value">${msg.size}</span>
        </div>`;
    }

    document.getElementById('modal-info').innerHTML = `
        ${cartItemsHtml}
        <div class="info-row">
            <span class="info-label">Total:</span>
            <span class="info-value highlight">$${msg.amount} ${msg.currency}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Shipping:</span>
            <span class="info-value">${getShippingLabel(msg.shipping)}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Time:</span>
            <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
        </div>
        <div class="info-row delivery">
            <span class="info-label">Delivery Address:</span>
            <span class="info-value delivery-address">${msg.delivery}</span>
        </div>
    `;
    
    const copyBtn = document.getElementById('copy-address-btn');
    copyBtn.style.display = 'block';
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(msg.delivery).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                copyBtn.textContent = '📋 Copy Delivery Address';
            }, 2000);
        });
    };
    
    const markReadBtn = document.getElementById('mark-read-btn');
    if (!msg.read) {
        markReadBtn.style.display = 'block';
        markReadBtn.onclick = () => {
            msg.read = true;
            updateMessageInDb(msg);
            renderInbox();
            markReadBtn.style.display = 'none';
        };
    }
    
    if (msg.buyerPublicKey) {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'none';
        replyBtn.onclick = () => openReplyModal(msg);
    } else {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'block';
        replyWarning.textContent = '⚠️ Cannot reply - missing buyer contact info';
        replyBtn.disabled = true;
        replyBtn.style.opacity = '0.5';
    }
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('message-modal').classList.add('hidden');
}

function setupEventListeners() {
    document.querySelectorAll('.inbox-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.dataset.view;
            document.querySelectorAll('.inbox-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderInbox();
        });
    });
    
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    
    document.getElementById('message-modal').addEventListener('click', (e) => {
        if (e.target.id === 'message-modal') closeModal();
    });
    
    document.getElementById('reply-modal-close').addEventListener('click', closeReplyModal);
    
    document.getElementById('reply-modal').addEventListener('click', (e) => {
        if (e.target.id === 'reply-modal') closeReplyModal();
    });
}

// ============ MDS INITIALIZATION ============

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('Inbox MDS initialized (ChainMail protocol)');
        
        await initDB();
        currentMessages = await loadMessagesFromDb();
        
        // Get our public key
        myPublicKey = await getMyPublicKey();
        console.log('Vendor public key:', myPublicKey ? myPublicKey.substring(0, 20) + '...' : 'null');
        
        // Register coinnotify for the fixed MINIMERCH_ADDRESS
        MDS.cmd('coinnotify action:add address:' + MINIMERCH_ADDRESS, function(resp) {
            console.log('Inbox: coinnotify registered for MINIMERCH_ADDRESS:', JSON.stringify(resp));
        });
        
        renderInbox();
        setupEventListeners();
        
        // Initial scan for messages
        setTimeout(() => scanForMessages(), 2000);
        
        // Periodic polling
        pollingInterval = setInterval(() => scanForMessages(), 30000);
        
    } else if (msg.event === 'NOTIFYCOIN') {
        if (msg.data && msg.data.coin) {
            const coin = msg.data.coin;
            if (coin.address === MINIMERCH_ADDRESS) {
                processIncomingMessage(coin);
            }
        }
    } else if (msg.event === 'NEWBLOCK') {
        // Scan on new blocks
        scanForMessages();
    } else if (msg.event === 'MDS_TIMER_10SECONDS') {
        scanForMessages();
    } else if (msg.event === 'MDS_PENDING') {
        // Handle pending action results by matching UID (Wallet pattern)
        console.log('MDS_PENDING:', JSON.stringify(msg.data));
        
        // Match our pending REPLY by UID
        if (pendingReplyUid && msg.data && msg.data.uid === pendingReplyUid) {
            pendingReplyUid = null;
            const statusEl = document.getElementById('reply-status');
            const sendBtn = document.getElementById('send-reply-btn');
            
            if (msg.data.accept && msg.data.result && msg.data.result.status) {
                console.log('Reply ACCEPTED and succeeded');
                await completeVendorReply(msg.data.result, statusEl, sendBtn);
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

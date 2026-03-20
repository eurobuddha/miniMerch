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

const OBFUSCATED_CMC_KEY = '';
const CMC_KEY_SALT = '';
const PRICE_STORAGE_KEY = 'minima_last_price';
const MESSAGES_STORAGE_KEY = 'mishop_messages';
const BUYER_ADDRESS_STORAGE_KEY = 'mishop_buyer_address';

let dbReady = false;
let mdsSqlWorking = false;
let fileReady = false;
let selectedSize = 'eighth';
let selectedQuantity = 1;
let selectedPaymentMethod = 'USDT';
let selectedShipping = 'uk';
let shippingFee = 5;
let currentMinimaPrice = 0;
let mxToUsdRate = 0;
let vendorAddress = null;
let vendorPublicKey = null;
let lastOrderReference = null;
let isVendorMode = false;
let buyerAddress = null;
let buyerPublicKey = null;
let currentMessages = [];
let buyerInboxAddress = null;
let replyPollingInterval = null;

function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function saveFile(key, data) {
    return new Promise((resolve) => {
        if (typeof MDS === 'undefined' || !MDS.file) {
            localStorage.setItem(key, data);
            resolve();
            return;
        }
        MDS.file.save(key, data, (response) => {
            if (response && response.status) {
                fileReady = true;
                resolve();
            } else {
                console.error('saveFile failed for', key, response);
                localStorage.setItem(key, data);
                resolve();
            }
        });
    });
}

function loadFile(key) {
    return new Promise((resolve) => {
        if (typeof MDS === 'undefined' || !MDS.file) {
            resolve(localStorage.getItem(key));
            return;
        }
        MDS.file.load(key, (response) => {
            if (response && response.status && response.response) {
                fileReady = true;
                if (typeof response.response === 'object') {
                    resolve(JSON.stringify(response.response));
                } else {
                    resolve(String(response.response));
                }
            } else {
                const local = localStorage.getItem(key);
                resolve(local);
            }
        });
    });
}

async function initDB() {
    if (dbReady) return;
    try {
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS messages (` +
            `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
            `ref TEXT, type TEXT, product TEXT, size TEXT,` +
            `amount TEXT, currency TEXT, delivery TEXT, shipping TEXT,` +
            `message TEXT, timestamp INTEGER, txid TEXT,` +
            `read INTEGER, direction TEXT,` +
            `buyerPublicKey TEXT, buyerAddress TEXT,` +
            `vendorPublicKey TEXT, vendorAddress TEXT,` +
            `UNIQUE(ref, txid))`
        );
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`
        );
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS sent_orders (` +
            `ref TEXT PRIMARY KEY, product TEXT, size TEXT,` +
            `amount TEXT, currency TEXT, delivery TEXT, shipping TEXT,` +
            `encrypted_data TEXT, sent_at INTEGER,` +
            `acknowledged INTEGER DEFAULT 0,` +
            `rebroadcast_count INTEGER DEFAULT 0,` +
            `last_rebroadcast INTEGER)`
        );
        dbReady = true;
        mdsSqlWorking = true;
        console.log('DB initialized successfully, mdsSqlWorking = true');
    } catch (err) {
        dbReady = true;
        console.error('DB init error:', err);
    }
}

async function saveSetting(key, value) {
    if (!mdsSqlWorking) {
        localStorage.setItem('mishop_' + key, value);
        return;
    }
    try {
        await MDS.sql(`INSERT OR REPLACE INTO settings (key, value) VALUES (${escapeSQL(key)}, ${escapeSQL(value)})`);
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

async function loadSetting(key) {
    if (!mdsSqlWorking) {
        return localStorage.getItem('mishop_' + key);
    }
    try {
        const resp = await MDS.sql(`SELECT value FROM settings WHERE key = ${escapeSQL(key)}`);
        if (resp && resp.status && resp.rows && resp.rows.length > 0) {
            return resp.rows[0].value;
        }
    } catch (err) {
        console.error('loadSetting error:', err);
    }
    return null;
}

async function saveMessageToDb(message) {
    if (typeof MDS === 'undefined') return;
    try {
        await MDS.sql(
            `INSERT OR REPLACE INTO messages ` +
            `(ref, type, product, size, amount, currency, delivery, shipping, message, ` +
            `timestamp, txid, read, direction, buyerPublicKey, buyerAddress, vendorPublicKey, vendorAddress) ` +
            `VALUES (` +
            `${escapeSQL(message.ref || '')}, ${escapeSQL(message.type || 'ORDER')}, ` +
            `${escapeSQL(message.product || '')}, ${escapeSQL(message.size || '')}, ` +
            `${escapeSQL(message.amount || '')}, ${escapeSQL(message.currency || '')}, ` +
            `${escapeSQL(message.delivery || '')}, ${escapeSQL(message.shipping || '')}, ` +
            `${escapeSQL(message.message || '')}, ${message.timestamp || Date.now()}, ` +
            `${escapeSQL(message.txid || '')}, ${message.read ? 1 : 0}, ` +
            `${escapeSQL(message.direction || 'sent')}, ` +
            `${escapeSQL(message.buyerPublicKey || '')}, ${escapeSQL(message.buyerAddress || '')}, ` +
            `${escapeSQL(message.vendorPublicKey || '')}, ${escapeSQL(message.vendorAddress || '')})`
        );
    } catch (err) {
        console.error('saveMessageToDb error:', err);
    }
}

async function loadMessagesFromDb() {
    if (typeof MDS === 'undefined') {
        const data = localStorage.getItem('mishop_messages');
        return data ? JSON.parse(data) : [];
    }
    try {
        const resp = await MDS.sql(`SELECT * FROM messages ORDER BY timestamp DESC`);
        if (resp && resp.status && resp.rows) {
            return resp.rows.map(row => ({
                id: row.id,
                ref: row.ref,
                type: row.type,
                product: row.product,
                size: row.size,
                amount: row.amount,
                currency: row.currency,
                delivery: row.delivery,
                shipping: row.shipping,
                message: row.message,
                timestamp: row.timestamp,
                txid: row.txid,
                read: !!row.read,
                direction: row.direction,
                buyerPublicKey: row.buyerPublicKey,
                buyerAddress: row.buyerAddress,
                vendorPublicKey: row.vendorPublicKey,
                vendorAddress: row.vendorAddress
            }));
        }
    } catch (err) {
        console.error('loadMessagesFromDb error:', err);
    }
    return [];
}

async function saveSentOrder(order) {
    if (typeof MDS === 'undefined') return;
    try {
        await MDS.sql(
            `INSERT OR REPLACE INTO sent_orders ` +
            `(ref, product, size, amount, currency, delivery, shipping, encrypted_data, ` +
            `sent_at, acknowledged, rebroadcast_count, last_rebroadcast) ` +
            `VALUES (` +
            `${escapeSQL(order.ref || '')}, ${escapeSQL(order.product || '')}, ` +
            `${escapeSQL(order.size || '')}, ${escapeSQL(order.amount || '')}, ` +
            `${escapeSQL(order.currency || '')}, ${escapeSQL(order.delivery || '')}, ` +
            `${escapeSQL(order.shipping || '')}, ${escapeSQL(order.encrypted_data || '')}, ` +
            `${order.sent_at || Date.now()}, ${order.acknowledged ? 1 : 0}, ` +
            `${order.rebroadcast_count || 0}, ` +
            `${order.last_rebroadcast != null ? order.last_rebroadcast : 'NULL'})`
        );
    } catch (err) {
        console.error('saveSentOrder error:', err);
    }
}

async function loadUnacknowledgedOrders() {
    if (typeof MDS === 'undefined') return [];
    try {
        const resp = await MDS.sql(`SELECT * FROM sent_orders WHERE acknowledged = 0 ORDER BY sent_at ASC`);
        if (resp && resp.status && resp.rows) {
            return resp.rows.map(row => ({
                ref: row.ref,
                product: row.product,
                size: row.size,
                amount: row.amount,
                currency: row.currency,
                delivery: row.delivery,
                shipping: row.shipping,
                encrypted_data: row.encrypted_data,
                sent_at: row.sent_at,
                acknowledged: !!row.acknowledged,
                rebroadcast_count: row.rebroadcast_count,
                last_rebroadcast: row.last_rebroadcast
            }));
        }
    } catch (err) {
        console.error('loadUnacknowledgedOrders error:', err);
    }
    return [];
}

async function acknowledgeOrder(ref) {
    if (typeof MDS === 'undefined') return;
    try {
        await MDS.sql(`UPDATE sent_orders SET acknowledged = 1 WHERE ref = ${escapeSQL(ref)}`);
    } catch (err) {
        console.error('acknowledgeOrder error:', err);
    }
}

async function updateRebroadcastCount(ref) {
    if (typeof MDS === 'undefined') return;
    try {
        await MDS.sql(
            `UPDATE sent_orders SET rebroadcast_count = rebroadcast_count + 1, ` +
            `last_rebroadcast = ${Date.now()} WHERE ref = ${escapeSQL(ref)}`
        );
    } catch (err) {
        console.error('updateRebroadcastCount error:', err);
    }
}

function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const obfuscated = decoded.substring(0, decoded.length - salt.length);
    return obfuscated.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

function URLencodeString(str) {
    return encodeURIComponent(str).split("'").join("%27");
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
        console.log('Using vendorPublicKey for encryption:', key.substring(0, 20) + '...');
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

function decryptMessage(encryptedData) {
    return new Promise((resolve) => {
        let cleanData = encryptedData;
        if (cleanData && cleanData.startsWith('0x')) {
            cleanData = cleanData.substring(2);
        }

        MDS.cmd('maxmessage action:decrypt data:' + cleanData, (response) => {
            console.log('Decrypt response:', JSON.stringify(response));

            if (response && response.status) {
                try {
                    let hexData = response.response?.message?.data || response.response?.data;
                    if (hexData) {
                        if (hexData.startsWith('0x')) {
                            hexData = hexData.substring(2);
                        }
                        const jsonStr = hexToText(hexData);
                        const data = JSON.parse(jsonStr);
                        data._senderPublicKey = response.response?.message?.mxpublickey || response.response?.mxpublickey || null;
                        resolve(data);
                        return;
                    }
                } catch (e) {
                    console.error('Failed to parse decrypted data:', e);
                }
            }

            console.log('Decryption fallback triggered, attempting direct parse');
            try {
                const jsonStr = hexToText(cleanData);
                const data = JSON.parse(jsonStr);
                console.log('Parsed as plain JSON:', data);
                resolve(data);
            } catch (e) {
                console.log('Fallback parse failed');
                resolve(null);
            }
        });
    });
}

function getState99Data(state) {
    if (!state) return null;
    
    if (Array.isArray(state)) {
        for (const entry of state) {
            if (entry && entry.port === 99 && entry.data) {
                return entry.data;
            }
        }
        return null;
    }
    
    if (typeof state === 'object') {
        if (state[99]) return state[99];
        for (const key in state) {
            if (state[key] && typeof state[key] === 'object' && state[key].port === 99) {
                return state[key].data;
            }
        }
    }
    
    return null;
}

async function saveMessages(messages) {
    const data = JSON.stringify(messages);
    await saveFile(MESSAGES_STORAGE_KEY, data);
    console.log('saveMessages: saved', messages.length, 'messages to file');
}

async function loadMessages() {
    const data = await loadFile(MESSAGES_STORAGE_KEY);
    if (data) {
        try {
            const msgs = JSON.parse(data);
            console.log('loadMessages: loaded', msgs.length, 'messages from file');
            return msgs;
        } catch (e) {
            console.error('loadMessages: parse error', e);
        }
    }
    console.log('loadMessages: no file data, returning empty');
    return [];
}

function addMessage(message) {
    const exists = currentMessages.find(m => m.ref === message.ref && m.txid === message.txid);
    if (exists) {
        console.log('Message already exists:', message.ref, message.txid);
        return;
    }
    
    currentMessages.unshift(message);
    saveMessages(currentMessages);
    renderInbox();
    if (typeof MDS !== 'undefined') {
        MDS.notify('New message: ' + (message.subject || 'Order'));
    }
}

async function encryptMessage(publicKey, data) {
    return new Promise((resolve) => {
        const jsonStr = JSON.stringify(data);
        const hexData = textToHex(jsonStr);

        MDS.cmd('maxmessage action:encrypt publickey:' + publicKey + ' data:' + hexData, (response) => {
            console.log('Encrypt response:', JSON.stringify(response));

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
                buyerPublicKey: message.mxpublickey || response.response?.mxpublickey || '',
                buyerAddress: message.miniaddress || response.response?.miniaddress || '',
                senderPublicKey: message.mxpublickey || response.response?.mxpublickey || ''
            });
        });
    });
}

async function sendEncryptedOrder(orderDetails, callback) {
    console.log('=== sendEncryptedOrder START ===');
    
    if (!vendorPublicKey) {
        callback(false, "Vendor public key not available", null);
        return;
    }
    
    try {
        const encryptResult = await encryptMessage(vendorPublicKey, orderDetails);
        if (!encryptResult || !encryptResult.encrypted) {
            console.error('Encryption failed');
            callback(false, "Encryption failed", null);
            return;
        }
        
        console.log('Message encrypted successfully');
        console.log('Buyer PublicKey from encrypt:', encryptResult.buyerPublicKey);
        console.log('Buyer Address from encrypt:', encryptResult.buyerAddress);
        
        const state = {};
        state[99] = encryptResult.encrypted;
        
        const command = 'send address:' + vendorAddress + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        console.log('Sending encrypted message via TX:', command);
        
        MDS.cmd(command, (response) => {
            console.log('TX Response:', JSON.stringify(response));
            if (response && response.status) {
                const buyerAddress = response.response?.body?.txn?.inputs?.[0]?.miniaddress || encryptResult.buyerAddress;
                callback(true, { 
                    txid: response.response?.txnid || 'confirmed',
                    buyerPublicKey: encryptResult.buyerPublicKey,
                    buyerAddress: buyerAddress
                });
            } else {
                callback(false, response?.error || 'Transaction failed', null);
            }
        });
        
    } catch (error) {
        console.error('Error sending encrypted order:', error);
        callback(false, error.message, null);
    }
}

function getMyPublicKey() {
    return new Promise((resolve) => {
        MDS.cmd('maxmessage action:publickey', (response) => {
            console.log('getMyPublicKey response:', JSON.stringify(response));
            if (response.status && response.response && response.response.publickey) {
                resolve(response.response.publickey);
                return;
            }
            if (response.status && response.response && response.response.message && response.response.message.publickey) {
                resolve(response.response.message.publickey);
                return;
            }

            if (!vendorPublicKey) {
                resolve(null);
                return;
            }

            const dummyData = textToHex(JSON.stringify({type: 'KEY_REQUEST', timestamp: Date.now()}));
            MDS.cmd('maxmessage action:encrypt publickey:' + vendorPublicKey + ' data:' + dummyData, (fallbackResponse) => {
                console.log('getMyPublicKey fallback response:', JSON.stringify(fallbackResponse));
                if (fallbackResponse.status && fallbackResponse.response && fallbackResponse.response.message && fallbackResponse.response.message.mxpublickey) {
                    resolve(fallbackResponse.response.message.mxpublickey);
                } else if (fallbackResponse.status && fallbackResponse.response && fallbackResponse.response.mxpublickey) {
                    resolve(fallbackResponse.response.mxpublickey);
                } else {
                    resolve(null);
                }
            });
        });
    });
}

function getMyAddress(callback) {
    MDS.cmd('getaddress', (response) => {
        console.log('getaddress response:', JSON.stringify(response));
        if (response.status && response.response) {
            const address = response.response.address || response.response.miniaddress || response.response;
            if (address && (address.startsWith('0x') || address.startsWith('Mx'))) {
                callback(address);
                return;
            }
        }
        callback(null);
    });
}

async function saveBuyerAddress(address) {
    if (!address) return;
    await saveFile(BUYER_ADDRESS_STORAGE_KEY, address);
}

async function loadBuyerAddress() {
    const address = await loadFile(BUYER_ADDRESS_STORAGE_KEY);
    if (address && (address.startsWith('0x') || address.startsWith('Mx'))) {
        return address;
    }
    return null;
}

function getFreshBuyerAddress() {
    return new Promise((resolve) => {
        getMyAddress((address) => {
            if (address) {
                saveBuyerAddress(address);
            }
            resolve(address || null);
        });
    });
}

async function getOrCreateBuyerAddress() {
    const savedAddress = await loadBuyerAddress();
    if (savedAddress) {
        return savedAddress;
    }
    return getFreshBuyerAddress();
}

function processIncomingMessage(coin) {
    const stateData = getState99Data(coin.state);
    if (!stateData) return;
    
    console.log('Processing incoming message...');
    
    decryptMessage(stateData).then((decrypted) => {
        if (decrypted) {
            console.log('Decrypted message:', JSON.stringify(decrypted));
            
            const message = {
                id: Date.now().toString(),
                ref: decrypted.ref || '',
                type: decrypted.type || 'ORDER',
                product: decrypted.product || '',
                size: decrypted.size || '',
                amount: decrypted.amount || '',
                currency: decrypted.currency || '',
                delivery: decrypted.delivery || '',
                shipping: decrypted.shipping || '',
                timestamp: decrypted.timestamp || Date.now(),
                txid: coin.txid || '',
                read: false,
                direction: 'received'
            };
            
            addMessage(message);
        } else {
            console.log('Could not decrypt message (might not be for us)');
        }
    });
}

function processReplyMessage(coin) {
    const stateData = getState99Data(coin.state);
    if (!stateData) return;
    
    console.log('Processing reply message...');
    
    decryptMessage(stateData).then((decrypted) => {
        if (decrypted) {
            console.log('Decrypted reply:', JSON.stringify(decrypted));
            
            if (decrypted.type !== 'REPLY') {
                console.log('Not a reply message, ignoring');
                return;
            }
            
            const message = {
                id: Date.now().toString(),
                ref: decrypted.ref || 'REPLY-' + Date.now(),
                type: 'REPLY',
                subject: 'Reply: ' + (decrypted.ref || 'Order'),
                product: decrypted.originalOrder || '',
                message: decrypted.message || '',
                timestamp: decrypted.timestamp || Date.now(),
                txid: coin.txid || coin.txnid || coin.coinid || '',
                read: false,
                direction: 'received',
                vendorPublicKey: decrypted.vendorPublicKey || decrypted._senderPublicKey || null,
                vendorAddress: decrypted.vendorAddress || null
            };
            
            console.log('Vendor info for reply:', { publicKey: message.vendorPublicKey, address: message.vendorAddress });
            
            addMessage(message);
            
            if (decrypted.ref) {
                acknowledgeOrder(decrypted.ref);
            }
            
            if (typeof MDS !== 'undefined') {
                MDS.notify('New reply: ' + (decrypted.ref || 'Order'));
            }
        } else {
            console.log('Could not decrypt reply (might not be for us)');
        }
    });
}

function getStateFromArray(stateArr) {
    if (!stateArr || !Array.isArray(stateArr)) return null;
    for (const s of stateArr) {
        if (s && s.port === 99 && s.data) return s.data;
    }
    return null;
}

async function recoverRepliesFromChain() {
    if (!buyerInboxAddress) return;
    
    console.log('=== RECOVERING REPLIES FROM CHAIN HISTORY ===');
    
    try {
        const cmd = `txpow address:${buyerInboxAddress} max:500`;
        const result = await new Promise((resolve) => {
            MDS.cmd(cmd, resolve);
        });
        
        if (!result || !result.status || !result.response) {
            console.log('Reply recovery: no response');
            return;
        }
        
        const txpows = result.response;
        if (!Array.isArray(txpows)) return;
        
        console.log(`Reply recovery: checking ${txpows.length} txpows`);
        
        let recovered = 0;
        for (const txpow of txpows) {
            if (!txpow || !txpow.hasbody) continue;
            const body = txpow.body;
            if (!body || !body.txn) continue;
            
            const txn = body.txn;
            const outputs = txn.outputs || [];
            
            for (const output of outputs) {
                if (!output || !output.storestate) continue;
                
                const stateData = getStateFromArray(output.state);
                if (!stateData) continue;
                
                const txid = txpow.txpowid || '';
                const exists = currentMessages.find(m => m.txid === txid);
                if (exists) continue;
                
                console.log('Reply recovery: found state[99] in txpow:', txid.substring(0, 20));
                
                await new Promise((resolve) => {
                    decryptMessage(stateData).then((decrypted) => {
                        if (!decrypted) {
                            resolve();
                            return;
                        }
                        
                        if (decrypted.type !== 'REPLY') {
                            resolve();
                            return;
                        }
                        
                        const message = {
                            id: Date.now().toString() + '_' + Math.random(),
                            ref: decrypted.ref || 'REPLY-' + Date.now(),
                            type: 'REPLY',
                            subject: 'Reply: ' + (decrypted.ref || 'Order'),
                            product: decrypted.originalOrder || '',
                            message: decrypted.message || '',
                            timestamp: decrypted.timestamp || Date.now(),
                            txid: txid,
                            read: false,
                            direction: 'received',
                            vendorPublicKey: decrypted.vendorPublicKey || decrypted._senderPublicKey || null,
                            vendorAddress: decrypted.vendorAddress || null
                        };
                        
                        addMessage(message);
                        
                        if (decrypted.ref) {
                            acknowledgeOrder(decrypted.ref);
                        }
                        
                        recovered++;
                        resolve();
                    });
                });
            }
        }
        
        if (recovered > 0) {
            console.log(`Reply chain recovery complete: ${recovered} replies recovered`);
        }
        
    } catch (err) {
        console.error('Reply recovery error:', err);
    }
}

function startReplyPolling() {
    if (replyPollingInterval) {
        clearInterval(replyPollingInterval);
    }
    
    console.log('Starting reply polling for address:', buyerInboxAddress);
    
    replyPollingInterval = setInterval(() => {
        if (!buyerInboxAddress) return;
        
        MDS.cmd('coins address:' + buyerInboxAddress, (response) => {
            if (response.status && response.response) {
                let coins = response.response;
                if (typeof coins === 'string') {
                    try {
                        coins = JSON.parse(coins);
                    } catch (e) {
                        return;
                    }
                }
                
                if (Array.isArray(coins)) {
                    for (const coin of coins) {
                        if (getState99Data(coin.state)) {
                            const exists = currentMessages.find(m => m.txid === (coin.txid || coin.coinid));
                            if (!exists) {
                                console.log('Found new reply via polling!');
                                processReplyMessage(coin);
                            }
                        }
                    }
                }
            }
        });
        
        checkForUnacknowledgedOrders();
    }, 15000);
}

let rebroadcastInterval = null;

async function checkForUnacknowledgedOrders() {
    if (!vendorAddress || !vendorPublicKey) return;
    
    const unacked = await loadUnacknowledgedOrders();
    if (unacked.length === 0) return;
    
    const firstDelay = (PRODUCT.firstRebroadcastDelayHours || 2) * 60 * 60 * 1000;
    const maxInterval = (PRODUCT.rebroadcastMaxIntervalHours || 24) * 60 * 60 * 1000;
    const now = Date.now();
    
    for (const order of unacked) {
        const age = now - order.sent_at;
        const lastRebroadcastAgo = order.last_rebroadcast ? now - order.last_rebroadcast : Infinity;
        const minInterval = Math.min(Math.pow(2, order.rebroadcast_count) * firstDelay, maxInterval);
        
        if (age >= firstDelay && lastRebroadcastAgo >= minInterval) {
            console.log('Rebroadcasting unacknowledged order:', order.ref);
            await rebroadcastOrder(order);
        }
    }
}

async function rebroadcastOrder(order) {
    try {
        if (!order.encrypted_data) {
            console.log('No encrypted data for order:', order.ref);
            return;
        }
        
        const state = {};
        state[99] = order.encrypted_data;
        const command = 'send address:' + vendorAddress + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        
        MDS.cmd(command, (response) => {
            if (response && response.status) {
                console.log('Rebroadcast successful for:', order.ref, 'txid:', response.response?.txnid);
                updateRebroadcastCount(order.ref);
            } else {
                console.log('Rebroadcast failed for:', order.ref, response?.error);
            }
        });
    } catch (error) {
        console.error('Rebroadcast error for', order.ref, ':', error);
    }
}

async function saveLastPrice(price) {
    await saveFile(PRICE_STORAGE_KEY, price.toString());
}

async function loadLastPrice() {
    const saved = await loadFile(PRICE_STORAGE_KEY);
    return saved ? parseFloat(saved) : DEFAULT_MINIMA_PRICE;
}

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

function getTotalUsdPrice() {
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
    }
    
    return productPrice + shippingFee;
}

function updatePrices() {
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice, size;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
    }
    
    console.log('updatePrices called - mode:', PRODUCT.mode, 'quantity/size:', isUnitsMode ? selectedQuantity : selectedSize, 'price:', productPrice);
    
    const priceUsdEl = document.getElementById('price-usd-value');
    if (priceUsdEl) {
        priceUsdEl.textContent = `$${productPrice.toFixed(2)} USDT`;
    }

    const buyBtnPriceEl = document.querySelector('.buy-button .btn-price');
    if (buyBtnPriceEl) {
        buyBtnPriceEl.textContent = `$${productPrice.toFixed(2)} USDT`;
    }
    
    console.log('mxToUsdRate:', mxToUsdRate);
    
    const minimaPriceEl = document.getElementById('price-minima');
    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        const minimaAmount = productPrice / mxToUsdRate;
        if (minimaPriceEl) {
            minimaPriceEl.textContent = `${minimaAmount.toFixed(4)} Minima`;
        }
        console.log('Price displayed:', minimaAmount, 'MINI');
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

async function fetchMinimaPrice() {
    return new Promise((resolve) => {
        if (typeof MDS !== 'undefined') {
            MDS.cmd('price', (response) => {
                console.log('Minima node price response:', JSON.stringify(response));
                if (response.status && response.response) {
                    const price = parseFloat(response.response);
                    if (price > 0 && price < 1) {
                        resolve(price);
                        return;
                    }
                }
                resolve(null);
            });
            setTimeout(() => resolve(null), 5000);
        } else {
            resolve(null);
        }
    });
}

async function fetchCoinGeckoPrice() {
    return new Promise((resolve) => {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=minima&vs_currencies=usd';
        console.log('Fetching from CoinGecko...');
        
        if (typeof MDS !== 'undefined') {
            MDS.net.GET(url, (response) => {
                console.log('CoinGecko response status:', response.status);
                if (response.status && response.response) {
                    try {
                        const data = JSON.parse(response.response);
                        console.log('CoinGecko data:', JSON.stringify(data));
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
                .then(data => {
                    console.log('CoinGecko (browser):', JSON.stringify(data));
                    resolve(data.minima?.usd || null);
                })
                .catch(e => {
                    console.error('CoinGecko fetch error:', e);
                    resolve(null);
                });
        }
    });
}

async function fetchCoinMarketCapPrice() {
    return new Promise((resolve) => {
        const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=minima&convert=USD';
        const apiKey = decodeObfuscated(OBFUSCATED_CMC_KEY, CMC_KEY_SALT);
        console.log('CMC API key (first 10 chars):', apiKey ? apiKey.substring(0, 10) : 'EMPTY');
        
        if (typeof MDS !== 'undefined' && apiKey) {
            MDS.net.GETAUTH(url, 'X-CMC_PRO_API_KEY: ' + apiKey, (response) => {
                console.log('CMC response:', JSON.stringify(response));
                if (response.status && response.response) {
                    try {
                        const data = JSON.parse(response.response);
                        if (data.data && data.data.MINIMA && data.data.MINIMA.quote && data.data.MINIMA.quote.USD) {
                            resolve(data.data.MINIMA.quote.USD.price);
                            return;
                        }
                        if (data.status && data.status.error_code) {
                            console.log('CMC error:', data.status.error_message);
                        }
                    } catch (e) {
                        console.error('CoinMarketCap parse error:', e);
                    }
                }
                resolve(null);
            });
            setTimeout(() => resolve(null), 10000);
        } else {
            console.log('CMC: MDS not available or no API key');
            resolve(null);
        }
    });
}

async function fetchMXPrice() {
    console.log('Fetching Minima price...');
    
    let minimaPrice = await fetchCoinGeckoPrice();
    console.log('CoinGecko result:', minimaPrice);
    if (minimaPrice && minimaPrice > 0) {
        console.log('CoinGecko price:', minimaPrice);
        await saveLastPrice(minimaPrice);
        return minimaPrice;
    }
    
    minimaPrice = await fetchCoinMarketCapPrice();
    console.log('CoinMarketCap result:', minimaPrice);
    if (minimaPrice && minimaPrice > 0) {
        console.log('CoinMarketCap price:', minimaPrice);
        await saveLastPrice(minimaPrice);
        return minimaPrice;
    }
    
    minimaPrice = await fetchMinimaPrice();
    console.log('Minima node result:', minimaPrice);
    if (minimaPrice && minimaPrice > 0) {
        console.log('Minima node price:', minimaPrice);
        await saveLastPrice(minimaPrice);
        return minimaPrice;
    }
    
    minimaPrice = await loadLastPrice();
    console.log('Last saved price:', minimaPrice);
    if (minimaPrice && minimaPrice > 0) {
        return minimaPrice;
    }
    
    console.log('All sources failed, using default price:', DEFAULT_MINIMA_PRICE);
    return DEFAULT_MINIMA_PRICE;
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
    
    document.getElementById('buy-btn').addEventListener('click', openCheckoutModal);
    
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
    const modal = document.getElementById('modal');
    const isUnitsMode = PRODUCT.mode === 'units';
    let size, productPrice, sizeLabel;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
        sizeLabel = `${selectedQuantity} unit${selectedQuantity > 1 ? 's' : ''}`;
    } else {
        size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
        sizeLabel = `${size.name} (${size.weight}g)`;
    }
    
    const subtotal = productPrice;
    const totalPrice = productPrice + shippingFee;
    const minimaSubtotal = subtotal / mxToUsdRate;
    const minimaSlippage = subtotal / mxToUsdRate * 0.10;
    const minimaTotal = totalPrice / mxToUsdRate * 1.10;
    
    const payAmount = document.getElementById('pay-amount');
    const summaryProduct = document.getElementById('summary-product');
    const summaryShipping = document.getElementById('summary-shipping');
    const summarySubtotal = document.getElementById('summary-subtotal');
    const summaryUsd = document.getElementById('summary-usd');
    const summaryMinima = document.getElementById('summary-minima');
    
    document.getElementById('modal-product').textContent = PRODUCT.name;
    document.getElementById('summary-size').textContent = sizeLabel;
    
    summaryProduct.textContent = `$${subtotal.toFixed(2)} USDT`;
    summaryShipping.textContent = `$${shippingFee.toFixed(2)} USDT`;
    summarySubtotal.textContent = `${totalPrice.toFixed(2)} USDT`;
    summaryUsd.textContent = `$${totalPrice.toFixed(2)} USDT`;
    
    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        summaryMinima.innerHTML = `${minimaTotal.toFixed(4)} Minima<br><span class="slippage-note">(+10% slippage)</span>`;
        payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${minimaTotal.toFixed(4)} Minima`;
    } else if (mxToUsdRate === 1) {
        summaryMinima.textContent = `${totalPrice.toFixed(4)} Minima (price unavailable)`;
        payAmount.textContent = `${totalPrice.toFixed(2)} USD`;
    } else {
        summaryMinima.textContent = 'Loading...';
        payAmount.textContent = '--';
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
    
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
    }
    
    const subtotal = productPrice;
    const totalPrice = productPrice + shippingFee;
    const minimaTotal = totalPrice / mxToUsdRate * 1.10;
    
    const summaryShipping = document.getElementById('summary-shipping');
    const summarySubtotal = document.getElementById('summary-subtotal');
    const summaryUsd = document.getElementById('summary-usd');
    const summaryMinima = document.getElementById('summary-minima');
    const payAmount = document.getElementById('pay-amount');
    
    summaryShipping.textContent = `$${shippingFee.toFixed(2)} USDT`;
    summarySubtotal.textContent = `${totalPrice.toFixed(2)} USDT`;
    summaryUsd.textContent = `$${totalPrice.toFixed(2)} USDT`;
    
    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        summaryMinima.innerHTML = `${minimaTotal.toFixed(4)} Minima<br><span class="slippage-note">(+10% slippage)</span>`;
        payAmount.textContent = `${totalPrice.toFixed(2)} USD = ${minimaTotal.toFixed(4)} Minima`;
    } else if (mxToUsdRate === 1) {
        summaryMinima.textContent = `${totalPrice.toFixed(4)} Minima (price unavailable)`;
        payAmount.textContent = `${totalPrice.toFixed(2)} USD`;
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    hidePaymentStatus();
}

function updateAddressField() {
    const postalAddress = document.getElementById('postal-address');
    const emailAddress = document.getElementById('email-address');
    const addressHeading = document.getElementById('address-heading');
    const addressNote = document.getElementById('address-note');
    
    if (selectedShipping === 'digital') {
        postalAddress.classList.add('hidden');
        emailAddress.classList.remove('hidden');
        addressHeading.textContent = '📧 Email Address';
        addressNote.textContent = 'Your download link will be sent to this email';
    } else {
        postalAddress.classList.remove('hidden');
        emailAddress.classList.add('hidden');
        addressHeading.textContent = '📍 Postal Address';
        addressNote.textContent = 'This will be recorded with your payment transaction';
    }
}

function updatePayButton() {
    const postalAddress = document.getElementById('postal-address').value.trim();
    const emailAddress = document.getElementById('email-address').value.trim();
    const payBtn = document.getElementById('pay-btn');
    const payAmount = document.getElementById('pay-amount');
    
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
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

async function processPayment() {
    const postalAddress = document.getElementById('postal-address').value.trim();
    const emailAddress = document.getElementById('email-address').value.trim();
    const isUnitsMode = PRODUCT.mode === 'units';
    let productPrice;
    let sizeLabel;
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
        sizeLabel = `${selectedQuantity} unit${selectedQuantity > 1 ? 's' : ''}`;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
        sizeLabel = `${size.name} (${size.weight}g)`;
    }
    
    const totalPrice = productPrice + shippingFee;
    
    let deliveryInfo;
    if (selectedShipping === 'digital') {
        if (!emailAddress.includes('@')) {
            showPaymentStatus('Please enter a valid email address', 'error');
            return;
        }
        deliveryInfo = emailAddress;
    } else {
        if (postalAddress.length < 10) {
            showPaymentStatus('Please enter a complete postal address', 'error');
            return;
        }
        deliveryInfo = postalAddress;
    }
    
    const payBtn = document.getElementById('pay-btn');
    payBtn.disabled = true;
    
    showPaymentStatus('Preparing transaction...', 'pending');
    
    try {
        if (!vendorPublicKey) {
            showPaymentStatus('Error: ChainMail public key not configured', 'error');
            payBtn.disabled = false;
            payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
            return;
        }

        if (!buyerAddress) {
            buyerAddress = await getOrCreateBuyerAddress();
            buyerInboxAddress = buyerAddress;
        }

        if (!buyerAddress) {
            showPaymentStatus('Error: Could not get buyer address', 'error');
            payBtn.disabled = false;
            payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
            return;
        }
        
        if (!buyerPublicKey) {
            showPaymentStatus('Getting buyer info...', 'pending');
            buyerPublicKey = await getMyPublicKey();
            buyerAddress = buyerInboxAddress;
            if (!buyerPublicKey) {
                showPaymentStatus('Error: Could not get buyer public key', 'error');
                payBtn.disabled = false;
                payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
                return;
            }
            console.log('Buyer info fetched on-demand:', { buyerPublicKey, buyerAddress });
        }
        
        let sendAmount;
        let tokenName;
        if (selectedPaymentMethod === 'USDT') {
            sendAmount = totalPrice;
            tokenName = 'USDT';
        } else {
            sendAmount = totalPrice / mxToUsdRate * 1.10;
            tokenName = 'Minima';
        }
        
        payBtn.querySelector('.btn-text').textContent = `Pay ${totalPrice.toFixed(2)} USD`;
        
        lastOrderReference = generateOrderReference(PRODUCT.name);
        
        const messagePayload = {
            ref: lastOrderReference,
            product: PRODUCT.name,
            size: sizeLabel,
            amount: totalPrice.toFixed(2),
            currency: tokenName,
            delivery: deliveryInfo,
            shipping: selectedShipping,
            timestamp: Date.now(),
            buyerPublicKey: '',
            buyerAddress: ''
        };
        
        showPaymentStatus('Getting buyer info...', 'pending');
        console.log('=== SENDING ORDER (Single TX) ===');
        
        const orderPayload = {
            ref: lastOrderReference,
            product: PRODUCT.name,
            size: sizeLabel,
            amount: totalPrice.toFixed(2),
            currency: tokenName,
            delivery: deliveryInfo,
            shipping: selectedShipping,
            timestamp: Date.now(),
            buyerPublicKey: '',
            buyerAddress: ''
        };
        
        try {
            const buyerInfo = await encryptMessage(vendorPublicKey, orderPayload);
            
            if (!buyerInfo || !buyerInfo.encrypted) {
                throw new Error('Failed to encrypt message');
            }
            
            const fullPayload = {
                ...orderPayload,
                buyerPublicKey: buyerPublicKey || buyerInfo.buyerPublicKey || '',
                buyerAddress: buyerAddress || buyerInfo.buyerAddress || buyerInboxAddress || ''
            };
            
            console.log('Buyer info obtained:', {
                publicKey: buyerInfo.buyerPublicKey,
                address: buyerInfo.buyerAddress
            });
            
            showPaymentStatus('Sending encrypted order...', 'pending');
            
            const encryptedFinal = await encryptMessage(vendorPublicKey, fullPayload);
            
            if (!encryptedFinal || !encryptedFinal.encrypted) {
                throw new Error('Failed to encrypt full message');
            }
            
            const state = {};
            state[99] = encryptedFinal.encrypted;
            console.log('Encrypted state length:', String(encryptedFinal.encrypted || '').length);
            
            const command = 'send address:' + vendorAddress + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
            
            await new Promise((resolve, reject) => {
                MDS.cmd(command, (response) => {
                    console.log('Order TX Response:', JSON.stringify(response));
                    if (response && response.status) {
                        const orderTxid = response.response?.txnid || 'confirmed';
                        console.log('Order sent with txid:', orderTxid);
                        
                        addMessage({
                            id: Date.now().toString(),
                            ref: lastOrderReference,
                            type: 'ORDER',
                            product: PRODUCT.name,
                            size: sizeLabel,
                            amount: totalPrice.toFixed(2),
                            currency: tokenName,
                            delivery: deliveryInfo,
                            shipping: selectedShipping,
                            timestamp: Date.now(),
                            txid: orderTxid,
                            read: true,
                            direction: 'sent',
                            buyerPublicKey: buyerPublicKey || buyerInfo.buyerPublicKey || '',
                            buyerAddress: buyerAddress || buyerInfo.buyerAddress || buyerInboxAddress || ''
                        });
                        
                        saveSentOrder({
                            ref: lastOrderReference,
                            product: PRODUCT.name,
                            size: sizeLabel,
                            amount: totalPrice.toFixed(2),
                            currency: tokenName,
                            delivery: deliveryInfo,
                            shipping: selectedShipping,
                            encrypted_data: encryptedFinal.encrypted,
                            sent_at: Date.now(),
                            acknowledged: false,
                            rebroadcast_count: 0,
                            last_rebroadcast: null
                        });
                        
                        showPaymentStatus('Sending payment...', 'pending');
                        
                        let payCommand;
                        if (selectedPaymentMethod === 'USDT') {
                            payCommand = 'send address:' + vendorAddress + ' amount:' + sendAmount.toFixed(8) + ' tokenid:' + TOKEN_IDS.USDT;
                        } else {
                            payCommand = 'send address:' + vendorAddress + ' amount:' + sendAmount.toFixed(8) + ' tokenid:' + TOKEN_IDS.MINIMA;
                        }
                        
                        console.log('Payment command:', payCommand);
                        
                        MDS.cmd(payCommand, (payResponse) => {
                            console.log('MDS Payment Response:', JSON.stringify(payResponse));
                            
                            if (payResponse && payResponse.status) {
                                const txid = payResponse.response?.txnid || payResponse.response?.tx?.pow || 'confirmed';
                                payBtn.querySelector('.btn-text').textContent = '✓ Sent!';
                                payBtn.classList.add('sent');
                                showPaymentStatus('Transaction sent! TX: ' + txid.substring(0, 20) + '...', 'success');
                                
                                setTimeout(() => {
                                    closeModal();
                                    showConfirmation(txid, lastOrderReference);
                                }, 3000);
                            } else {
                                const errorMsg = payResponse?.error || 'Payment may have failed';
                                showPaymentStatus(errorMsg + ' (but order was encrypted and sent)', 'error');
                                payBtn.disabled = false;
                                payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
                            }
                            resolve();
                        });
                    } else {
                        reject(new Error(response?.error || 'Order TX failed'));
                    }
                });
            });
        } catch (error) {
            showPaymentStatus('Failed to send order: ' + error.message, 'error');
            payBtn.disabled = false;
            payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
        }
        
    } catch (error) {
        payBtn.disabled = false;
        payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
        showPaymentStatus('Error processing payment: ' + error.message, 'error');
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
                console.error('Missing or invalid vendor public key in config');
                document.querySelector('.main-content').innerHTML = `
                    <div class="product-card" style="text-align: center; padding: 3rem;">
                        <h2 style="color: #c62828;">⚠️ Configuration Error</h2>
                        <p style="color: #333; margin-top: 1rem;">
                            Vendor public key is missing or invalid.<br>
                            Please regenerate your MiniDapp with a valid config.
                        </p>
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
            <p style="color: #333; margin-top: 1rem;">
                This MiniDapp has been tampered with.<br>
                Please download a fresh copy from the vendor.
            </p>
        </div>
    `;
    return false;
}

let currentView = 'shop';
let selectedMessage = null;

function renderShop() {
    const mainContent = document.querySelector('.main-content');
    mainContent.innerHTML = `
        <div class="product-card">
            <div class="product-image-container">
                <img id="product-image" src="item.jpg" alt="Product" class="product-image">
                <div class="product-badge">Fresh</div>
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
                <span class="btn-text">🛒 Buy Now</span>
                <span class="btn-price">$0.00</span>
            </button>

            <div id="loading-indicator" class="loading hidden">
                <div class="spinner"></div>
                <span>Loading price...</span>
            </div>
        </div>
    `;
}

function renderInbox() {
    const mainContent = document.querySelector('.main-content');
    const inboxMessages = currentMessages.filter(m => m.direction === 'received');
    const sentMessages = currentMessages.filter(m => m.direction === 'sent');
    
    const unreadCount = inboxMessages.filter(m => !m.read).length;
    
    mainContent.innerHTML = `
        <div class="inbox-container">
            <div class="inbox-tabs">
                <button class="inbox-tab ${currentView === 'inbox' ? 'active' : ''}" data-view="inbox">
                    📥 Inbox ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : ''}
                </button>
                <button class="inbox-tab ${currentView === 'sent' ? 'active' : ''}" data-view="sent">
                    📤 Sent (${sentMessages.length})
                </button>
            </div>
            
            <div class="inbox-list" id="inbox-list">
                ${currentView === 'inbox' ? renderMessageList(inboxMessages, 'received') : renderMessageList(sentMessages, 'sent')}
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
        const isSent = msg.direction === 'sent';
        return `
        <div class="message-item ${msg.direction === 'received' && !msg.read ? 'unread' : ''} ${isBuyerReply ? 'buyer-reply' : ''}" data-id="${msg.id}">
            <div class="message-icon">${isBuyerReply ? '↩️' : (isReply ? '↩️' : (msg.direction === 'received' ? '📨' : '📤'))}</div>
            <div class="message-preview">
                <div class="message-subject">${msg.subject || msg.product || 'Order: ' + msg.ref}</div>
                <div class="message-meta">
                    <span class="message-ref">${msg.ref}</span>
                    ${isBuyerReply ? '<span class="message-type">Your Reply</span>' : 
                      (isReply ? '<span class="message-type">Vendor Reply</span>' : 
                      (isSent ? '<span class="message-type">Sent</span>' : `<span class="message-amount">$${msg.amount} ${msg.currency}</span>`))}
                </div>
            </div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
        </div>
    `}).join('');
}

function renderMessageDetail(msg) {
    const isReceived = msg.direction === 'received';
    const isReply = msg.type === 'REPLY';
    const canReply = isReply && (msg.vendorPublicKey || msg.vendorAddress);
    
    if (isReply) {
        return `
            <button class="back-btn" id="back-to-list">← Back</button>
            <div class="message-header">
                <h3>↩️ Vendor Reply</h3>
                <span class="message-direction">📥 Received</span>
            </div>
            
            <div class="message-info">
                <div class="info-row">
                    <span class="info-label">Order Ref:</span>
                    <span class="info-value">${msg.ref}</span>
                </div>
                ${msg.originalOrder ? `
                <div class="info-row">
                    <span class="info-label">Re:</span>
                    <span class="info-value">${msg.originalOrder}</span>
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="info-label">Time:</span>
                    <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                ${msg.txid ? `
                <div class="info-row">
                    <span class="info-label">TX ID:</span>
                    <span class="info-value txid">${msg.txid.substring(0, 20)}...</span>
                </div>
                ` : ''}
            </div>
            
            <div class="reply-content">
                <h4>Message:</h4>
                <p class="reply-message">${msg.message}</p>
            </div>
            
            ${canReply ? `
            <div class="reply-actions">
                <button class="reply-to-vendor-btn" id="reply-to-vendor-btn" data-id="${msg.id}">
                    ↩️ Reply to Vendor
                </button>
            </div>
            ` : `
            <div class="reply-warning">
                <p>⚠️ Cannot reply - missing vendor contact info</p>
            </div>
            `}
        `;
    }
    
    return `
        <button class="back-btn" id="back-to-list">← Back</button>
        <div class="message-header">
            <h3>${msg.subject || msg.product || 'Order: ' + msg.ref}</h3>
            <span class="message-direction">${isReceived ? '📥 Received' : '📤 Sent'}</span>
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
            ${isReceived ? `
            <div class="info-row">
                <span class="info-label">Delivery:</span>
                <span class="info-value delivery-address">${msg.delivery}</span>
            </div>
            ` : ''}
            <div class="info-row">
                <span class="info-label">Shipping:</span>
                <span class="info-value">${getShippingLabel(msg.shipping)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Time:</span>
                <span class="info-value">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            ${msg.txid ? `
            <div class="info-row">
                <span class="info-label">TX ID:</span>
                <span class="info-value txid">${msg.txid.substring(0, 20)}...</span>
            </div>
            ` : ''}
        </div>
        
        ${isReceived ? `
        <div class="message-actions">
            <button class="action-btn copy-address" data-address="${msg.delivery}">📋 Copy Address</button>
        </div>
        ` : ''}
    `;
}

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
        const replyPayload = {
            type: 'BUYER_REPLY',
            ref: msg.ref,
            originalOrder: msg.product || msg.originalOrder || '',
            message: messageText,
            timestamp: Date.now(),
            buyerPublicKey: buyerPublicKey || '',
            buyerAddress: buyerAddress || ''
        };
        
        console.log('Buyer sending reply payload:', replyPayload);
        
        const encrypted = await encryptMessage(msg.vendorPublicKey, replyPayload);
        
        if (!encrypted || !encrypted.encrypted) {
            throw new Error('Encryption failed');
        }
        
        statusEl.textContent = 'Sending encrypted reply...';
        
        const state = {};
        state[99] = encrypted.encrypted;
        console.log('Buyer reply encrypted length:', String(encrypted.encrypted).length);
        
        const sendAddress = msg.vendorAddress || buyerInboxAddress;
        
        const command = 'send address:' + sendAddress + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        console.log('Sending buyer reply via TX:', command);
        
        MDS.cmd(command, (response) => {
            console.log('Buyer reply TX Response:', JSON.stringify(response));
            if (response && response.status) {
                const txid = response.response?.txnid || 'confirmed';
                statusEl.textContent = 'Reply sent! TX: ' + txid.substring(0, 20) + '...';
                statusEl.className = 'reply-status success';
                sendBtn.textContent = '✓ Sent!';
                
                const message = {
                    id: Date.now().toString(),
                    ref: msg.ref + '-R',
                    type: 'BUYER_REPLY',
                    subject: 'Re: ' + (msg.ref || 'Order'),
                    product: msg.product || '',
                    message: messageText,
                    timestamp: Date.now(),
                    txid: txid,
                    read: true,
                    direction: 'sent'
                };
                addMessage(message);
                
                setTimeout(() => {
                    closeBuyerReplyModal();
                }, 2000);
            } else {
                statusEl.textContent = 'Failed: ' + (response?.error || 'Transaction failed');
                statusEl.className = 'reply-status error';
                sendBtn.disabled = false;
                sendBtn.textContent = '📤 Send Reply';
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

function setupInboxEventListeners() {
    document.querySelectorAll('.inbox-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.dataset.view;
            selectedMessage = null;
            document.getElementById('inbox-detail').classList.add('hidden');
            document.getElementById('inbox-list').classList.remove('hidden');
            renderInbox();
        });
    });
    
    document.querySelectorAll('.message-item').forEach(item => {
        item.addEventListener('click', () => {
            const msgId = item.dataset.id;
            selectedMessage = currentMessages.find(m => m.id === msgId);
            if (selectedMessage && selectedMessage.direction === 'received' && !selectedMessage.read) {
                selectedMessage.read = true;
                saveMessages(currentMessages);
            }
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
        });
    }
    
    document.querySelectorAll('.copy-address').forEach(btn => {
        btn.addEventListener('click', () => {
            const address = btn.dataset.address;
            navigator.clipboard.writeText(address).then(() => {
                btn.textContent = '✓ Copied!';
                setTimeout(() => {
                    btn.textContent = '📋 Copy Address';
                }, 2000);
            });
        });
    });
    
    const replyToVendorBtn = document.getElementById('reply-to-vendor-btn');
    if (replyToVendorBtn) {
        replyToVendorBtn.addEventListener('click', () => {
            const msgId = replyToVendorBtn.dataset.id;
            const msg = currentMessages.find(m => m.id === msgId);
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

function switchView(view) {
    currentView = view;
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    if (view === 'shop') {
        renderShop();
        initApp();
    } else {
        renderInbox();
    }
}

function setupNavigation() {
    const header = document.querySelector('.header');
    header.innerHTML = `
        <div class="logo">
            <span class="logo-icon">🛒</span>
            <h1>miShop</h1>
        </div>
        <nav class="nav-tabs">
            <button class="nav-btn active" data-view="shop">🛍️ Shop</button>
            <button class="nav-btn" data-view="inbox" id="nav-inbox">📬 Inbox</button>
        </nav>
        <div class="header-decoration">
            <svg class="peace-sign" viewBox="0 0 100 100" width="40" height="40">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#FFD700" stroke-width="4"/>
                <line x1="50" y1="5" x2="50" y2="50" stroke="#FFD700" stroke-width="4"/>
                <line x1="50" y1="50" x2="85" y2="75" stroke="#FFD700" stroke-width="4"/>
                <line x1="50" y1="50" x2="15" y2="75" stroke="#FFD700" stroke-width="4"/>
                <circle cx="50" cy="50" r="20" fill="#FFD700"/>
                <circle cx="50" cy="50" r="12" fill="#2D5016"/>
            </svg>
        </div>
    `;
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
}

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('MDS initialized');
        
        if (!validateVendorAddress()) return;
        
        if (typeof MDS !== 'undefined') {
            MDS.cmd('coinnotify action:add address:' + vendorAddress, function(resp) {
                console.log('Coin notify registered for vendor:', resp);
            });
        }
        
        await initDB();
        currentMessages = await loadMessages();
        
        setupNavigation();
        renderShop();
        initApp();
        
        buyerAddress = await getOrCreateBuyerAddress();
        buyerInboxAddress = buyerAddress;
        if (buyerInboxAddress) {
            console.log('Buyer inbox address:', buyerInboxAddress);

            buyerPublicKey = await getMyPublicKey();
            if (buyerPublicKey) {
                console.log('Buyer public key set:', buyerPublicKey);
            }

            if (typeof MDS !== 'undefined') {
                MDS.cmd('coinnotify action:add address:' + buyerInboxAddress, function(resp) {
                    console.log('Coin notify registered for buyer inbox:', resp);
                });
            }

            startReplyPolling();
            setTimeout(() => recoverRepliesFromChain(), 5000);
        }
        
        setTimeout(() => checkForUnacknowledgedOrders(), 5000);
        
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        
        console.log('Fetching price...');
        mxToUsdRate = await fetchMXPrice();
        console.log('Got price:', mxToUsdRate);
        
        if (loadingIndicator) loadingIndicator.classList.add('hidden');
        updatePrices();
        
    } else if (msg.event === 'NOTIFYCOIN') {
        if (msg.data && buyerInboxAddress && msg.data.address === buyerInboxAddress) {
            processReplyMessage(msg.data.coin);
        }
    } else if (msg.event === 'NEWBLOCK') {
        mxToUsdRate = await fetchMXPrice();
        updatePrices();
    }
});

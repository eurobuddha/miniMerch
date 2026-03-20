const TOKEN_IDS = {
    MINIMA: '0x00'
};

let currentMessages = [];
let selectedMessage = null;
let myAddress = null;
let pollingInterval = null;
let dbReady = false;
let mdsSqlWorking = false;
let fileReady = false;
const MESSAGES_FILE_KEY = 'mishop_inbox_messages';
const INBOX_CONFIG_FILE_KEY = 'mishop_inbox_config';

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
            if (response && response.status && response.response != null) {
                fileReady = true;
                if (typeof response.response === 'string') {
                    resolve(response.response);
                } else {
                    try {
                        resolve(JSON.stringify(response.response));
                    } catch (e) {
                        resolve(null);
                    }
                }
            } else {
                console.log('loadFile: MDS load failed/unavailable for', key, 'trying localStorage');
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
            `read INTEGER, buyerPublicKey TEXT, buyerAddress TEXT,` +
            `UNIQUE(ref, txid))`
        );
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS processed_txids (` +
            `txid TEXT PRIMARY KEY, processed_at INTEGER)`
        );
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS processed_addrs (` +
            `address TEXT PRIMARY KEY, publickey TEXT, first_seen INTEGER)`
        );
        await MDS.sql(
            `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`
        );
        dbReady = true;
        mdsSqlWorking = true;
        console.log('Inbox DB initialized successfully, mdsSqlWorking = true');
    } catch (err) {
        console.error('Inbox DB init error:', err);
    }
}

async function saveMessageToDb(message) {
    try {
        await MDS.sql(
            `INSERT OR REPLACE INTO messages ` +
            `(ref, type, product, size, amount, currency, delivery, shipping, message, ` +
            `timestamp, txid, read, buyerPublicKey, buyerAddress) ` +
            `VALUES (` +
            `${escapeSQL(message.ref || '')}, ${escapeSQL(message.type || 'ORDER')}, ` +
            `${escapeSQL(message.product || '')}, ${escapeSQL(message.size || '')}, ` +
            `${escapeSQL(message.amount || '')}, ${escapeSQL(message.currency || '')}, ` +
            `${escapeSQL(message.delivery || '')}, ${escapeSQL(message.shipping || '')}, ` +
            `${escapeSQL(message.message || '')}, ${message.timestamp || Date.now()}, ` +
            `${escapeSQL(message.txid || '')}, ${message.read ? 1 : 0}, ` +
            `${escapeSQL(message.buyerPublicKey || '')}, ${escapeSQL(message.buyerAddress || '')})`
        );
    } catch (err) {
        console.error('saveMessageToDb error:', err);
    }
}

async function loadMessagesFromDb() {
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
                buyerPublicKey: row.buyerPublicKey,
                buyerAddress: row.buyerAddress
            }));
        }
    } catch (err) {
        console.error('loadMessagesFromDb error:', err);
    }
    return [];
}

async function isTxProcessed(txid) {
    if (!txid) return false;
    if (currentMessages.some(m => m.txid === txid)) return true;
    const data = await loadFile(MESSAGES_FILE_KEY);
    if (!data) return false;
    try {
        let messages = typeof data === 'string' ? JSON.parse(data) : (Array.isArray(data) ? data : []);
        if (!Array.isArray(messages)) return false;
        return messages.some(m => m.txid === txid);
    } catch (e) {
        return false;
    }
}

async function markTxProcessed(txid) {
    if (!txid) return;
    if (!mdsSqlWorking) return;
    try {
        await MDS.sql(
            `INSERT OR IGNORE INTO processed_txids (txid, processed_at) ` +
            `VALUES (${escapeSQL(txid)}, ${Date.now()})`
        );
    } catch (err) {
        console.error('markTxProcessed error:', err);
    }
}

async function loadProcessedAddresses() {
    try {
        const resp = await MDS.sql(`SELECT * FROM processed_addrs`);
        if (resp && resp.status && resp.rows) {
            const addrs = {};
            resp.rows.forEach(row => {
                addrs[row.address] = { publickey: row.publickey, first_seen: row.first_seen };
            });
            return addrs;
        }
    } catch (err) {
        console.error('loadProcessedAddresses error:', err);
    }
    return {};
}

async function saveProcessedAddress(address, publickey) {
    if (!address) return;
    if (!mdsSqlWorking) return;
    try {
        await MDS.sql(
            `INSERT OR REPLACE INTO processed_addrs (address, publickey, first_seen) ` +
            `VALUES (${escapeSQL(address)}, ${escapeSQL(publickey || '')}, ${Date.now()})`
        );
    } catch (err) {
        console.error('saveProcessedAddress error:', err);
    }
}

async function getLastProcessedBlock() {
    try {
        const resp = await MDS.sql(`SELECT value FROM settings WHERE key = 'last_block'`);
        if (resp && resp.status && resp.rows && resp.rows.length > 0) {
            return parseInt(resp.rows[0].value) || 0;
        }
    } catch (err) {
        console.error('getLastProcessedBlock error:', err);
    }
    return 0;
}

async function saveLastProcessedBlock(block) {
    try {
        await MDS.sql(
            `INSERT OR REPLACE INTO settings (key, value) VALUES ('last_block', ${escapeSQL(String(block))})`
        );
    } catch (err) {
        console.error('saveLastProcessedBlock error:', err);
    }
}

function getStateFromArray(stateArr) {
    if (!stateArr || !Array.isArray(stateArr)) return null;
    for (const s of stateArr) {
        if (s && s.port === 99 && s.data) return s.data;
    }
    return null;
}

async function recoverFromChain() {
    if (!myAddress) return;
    
    console.log('=== RECOVERING FROM CHAIN HISTORY ===');
    const MAX_BATCH = 500;
    let offset = 0;
    let totalRecovered = 0;
    let hasMore = true;
    
    while (hasMore) {
        try {
            const cmd = `txpow address:${myAddress} max:${MAX_BATCH}`;
            const result = await new Promise((resolve) => {
                MDS.cmd(cmd, resolve);
            });
            
            if (!result || !result.status || !result.response) {
                console.log('txpow recovery: no response or error');
                break;
            }
            
            const txpows = result.response;
            if (!Array.isArray(txpows) || txpows.length === 0) {
                console.log('txpow recovery: no txpows found');
                break;
            }
            
            console.log(`txpow recovery: checking ${txpows.length} txpows (offset ${offset})`);
            
            for (const txpow of txpows) {
                if (!txpow || !txpow.hasbody) continue;
                const body = txpow.body;
                if (!body || !body.txn) continue;
                
                const txn = body.txn;
                const outputs = txn.outputs || [];
                
                for (const output of outputs) {
                    if (!output || !output.storestate) continue;
                    
                    const stateData = getStateFromArray(output.state);
                    let isSentRecord = false;
                    let sentStateData = null;
                    if (!stateData && output.state && Array.isArray(output.state)) {
                        for (const s of output.state) {
                            if (s && s.port === 98 && s.data) {
                                stateData = s.data;
                                isSentRecord = true;
                                sentStateData = s.data;
                                break;
                            }
                        }
                    }
                    if (!stateData) continue;
                    
                    const txid = txpow.txpowid || '';
                    
                    const alreadyProcessed = await isTxProcessed(txid);
                    if (alreadyProcessed) continue;
                    
                    const existsInMem = currentMessages.find(m => m.txid === txid);
                    if (existsInMem) {
                        await markTxProcessed(txid);
                        continue;
                    }
                    
                    console.log('Recovery: found state[99]/state[98] in txpow:', txid.substring(0, 20), 'isSentRecord:', isSentRecord);
                    
                    const coin = {
                        txid: txid,
                        coinid: output.coinid || txid,
                        state: output.state
                    };
                    
                    await markTxProcessed(txid);
                    
                    await new Promise((resolve) => {
                        decryptMessage(stateData).then((decrypted) => {
                            if (!decrypted) {
                                console.log('Recovery: could not decrypt txpow state[99]/state[98], skipping');
                                resolve();
                                return;
                            }
                            
                            if (isSentRecord || decrypted.type === 'SENT_RECORD') {
                                const sentMessage = {
                                    id: 'sent_' + (decrypted.timestamp || Date.now()) + '_' + Math.random().toString(36).substr(2, 6),
                                    ref: decrypted.ref || 'Unknown',
                                    type: 'REPLY',
                                    originalOrder: decrypted.originalOrder || decrypted.ref || '',
                                    originalProduct: decrypted.originalOrder || '',
                                    message: decrypted.message || '',
                                    timestamp: decrypted.timestamp || Date.now(),
                                    txid: txid,
                                    read: true,
                                    direction: 'sent',
                                    buyerPublicKey: '',
                                    buyerAddress: decrypted.buyerAddress || ''
                                };
                                const exists = currentMessages.find(m => m.txid === txid && m.direction === 'sent');
                                if (!exists) {
                                    currentMessages.unshift(sentMessage);
                                    saveMessages(currentMessages);
                                    console.log('Recovery: sent message recovered:', sentMessage.ref);
                                }
                                resolve();
                                return;
                            }
                            
                            const isBuyerReply = decrypted.type === 'BUYER_REPLY';
                            
                            const message = {
                                id: Date.now().toString() + '_' + Math.random(),
                                ref: decrypted.ref || 'Unknown-' + Date.now(),
                                type: decrypted.type || 'ORDER',
                                product: decrypted.product || (isBuyerReply ? decrypted.originalOrder : 'Unknown Product'),
                                size: decrypted.size || '',
                                amount: decrypted.amount || '0',
                                currency: decrypted.currency || 'USDT',
                                delivery: decrypted.delivery || (isBuyerReply ? decrypted.message : ''),
                                message: decrypted.message || '',
                                shipping: decrypted.shipping || 'uk',
                                timestamp: decrypted.timestamp || Date.now(),
                                txid: txid,
                                read: false,
                                buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
                                buyerAddress: decrypted.buyerAddress || ''
                            };
                            
                            if (message.buyerPublicKey || message.buyerAddress) {
                                saveProcessedAddress(message.buyerAddress, message.buyerPublicKey);
                            }
                            
                            addMessage(message);
                            totalRecovered++;
                            resolve();
                        });
                    });
                }
            }
            
            hasMore = txpows.length === MAX_BATCH;
            offset += MAX_BATCH;
            
        } catch (err) {
            console.error('txpow recovery error:', err);
            break;
        }
    }
    
    if (totalRecovered > 0) {
        console.log(`Chain recovery complete: ${totalRecovered} orders recovered`);
    }
}

function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const combined = decoded.substring(0, decoded.length - salt.length);
    return combined.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

function getVendorAddress() {
    if (typeof INBOX_CONFIG === 'undefined' || !INBOX_CONFIG.obfuscatedVendorAddress) {
        console.error('INBOX_CONFIG not found');
        return null;
    }
    return INBOX_CONFIG.obfuscatedVendorAddress;
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
        if (!encryptedData) {
            resolve(null);
            return;
        }
        
        let cleanData = encryptedData;
        if (cleanData.startsWith('0x')) {
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

                        let jsonStr = hexToText(hexData);
                        console.log('Decrypted string (hex):', jsonStr);

                        if (jsonStr.startsWith('%')) {
                            try {
                                jsonStr = decodeURIComponent(jsonStr);
                                console.log('URL decoded string:', jsonStr);
                            } catch (e) {
                                console.log('URL decode failed, trying as-is');
                            }
                        }

                        const data = JSON.parse(jsonStr);
                        data._senderPublicKey = response.response?.message?.mxpublickey || response.response?.mxpublickey || null;
                        resolve(data);
                        return;
                    }
                } catch (e) {
                    console.error('Failed to parse decrypted data:', e);
                }
            }

            console.log('Decrypt fallback - attempting direct parse');
            try {
                let jsonStr = hexToText(cleanData);
                if (jsonStr.startsWith('%')) {
                    try {
                        jsonStr = decodeURIComponent(jsonStr);
                    } catch (e) {
                        console.log('Fallback decodeURIComponent failed');
                    }
                }
                const data = JSON.parse(jsonStr);
                resolve(data);
            } catch (e) {
                console.log('Fallback parse failed');
                resolve(null);
            }
        });
    });
}

function encryptMessage(publicKey, data) {
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
                senderPublicKey: message.mxpublickey || response.response?.mxpublickey || null,
                senderAddress: message.miniaddress || response.response?.miniaddress || null
            });
        });
    });
}

async function saveMessages(messages) {
    const data = JSON.stringify(messages);
    await saveFile(MESSAGES_FILE_KEY, data);
    console.log('saveMessages: saved', messages.length, 'messages to file');
}

async function loadMessages() {
    const data = await loadFile(MESSAGES_FILE_KEY);
    if (!data || data === 'undefined' || data === 'null') {
        console.log('loadMessages: no file data, trying SQL');
        return loadMessagesFromDb();
    }
    try {
        let msgs;
        console.log('loadMessages: raw data type:', typeof data, 'preview:', typeof data === 'string' ? data.substring(0, 80) : (Array.isArray(data) ? '[array len:'+data.length+']' : typeof data));
        if (typeof data === 'string') {
            try { msgs = JSON.parse(data); } catch (e) { msgs = null; }
        } else if (data !== null && typeof data === 'object') {
            if (Array.isArray(data)) {
                msgs = data;
            } else {
                const extracted = Object.values(data).find(v => Array.isArray(v));
                msgs = extracted || data;
            }
        } else {
            msgs = null;
        }
        console.log('loadMessages: parsed type:', typeof msgs, 'isArray:', Array.isArray(msgs), 'len:', Array.isArray(msgs) ? msgs.length : 'N/A');
        if (!Array.isArray(msgs)) {
            console.error('loadMessages: not an array, falling back to SQL');
            return loadMessagesFromDb();
        }
        console.log('loadMessages: loaded', msgs.length, 'messages from file');
        return msgs;
    } catch (e) {
        console.error('loadMessages: parse error, falling back to SQL:', e);
        return loadMessagesFromDb();
    }
}

async function recoverMessagesFromChain() {
    console.log('=== INBOX: RECOVERING MESSAGES FROM CHAIN ===');
    
    try {
        const result = await new Promise((resolve) => {
            MDS.cmd('coins address:' + myAddress, resolve);
        });
        
        if (!result || !result.status || !Array.isArray(result.response)) {
            console.log('Inbox recovery: no UTXOs found');
            return [];
        }
        
        console.log('Inbox recovery: checking', result.response.length, 'UTXOs');
        
        const recovered = [];
        for (const coin of result.response) {
            const coinTxid = coin.txid || coin.txnid || coin.coinid || '';
            const exists = recovered.find(m => m.txid === coinTxid);
            if (exists) continue;
            
            const stateData = getState99Data(coin.state);
            if (!stateData) continue;
            
            const decrypted = await new Promise((resolve) => {
                decryptMessage(stateData).then(resolve);
            });
            
            if (!decrypted) continue;
            
            const isBuyerReply = decrypted.type === 'BUYER_REPLY';
            
            const message = {
                id: Date.now().toString() + '_' + Math.random(),
                ref: decrypted.ref || 'Unknown-' + Date.now(),
                type: decrypted.type || 'ORDER',
                product: decrypted.product || (isBuyerReply ? decrypted.originalOrder : 'Unknown Product'),
                size: decrypted.size || '',
                amount: decrypted.amount || '0',
                currency: decrypted.currency || 'USDT',
                delivery: decrypted.delivery || (isBuyerReply ? decrypted.message : ''),
                message: decrypted.message || '',
                shipping: decrypted.shipping || 'uk',
                timestamp: decrypted.timestamp || Date.now(),
                txid: coinTxid,
                read: false,
                buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
                buyerAddress: decrypted.buyerAddress || ''
            };
            
            await markTxProcessed(coinTxid);
            recovered.push(message);
            currentMessages.push(message);
        }
        
        if (recovered.length > 0) {
            console.log('Inbox recovery: found', recovered.length, 'messages from chain');
            currentMessages.sort((a, b) => b.timestamp - a.timestamp);
            await saveMessages(currentMessages);
            renderInbox();
        }
        
        return currentMessages;
    } catch (e) {
        console.error('Inbox recovery error:', e);
        return currentMessages;
    }
}

function addMessage(message) {
    console.log('ADD MESSAGE CALLED with:', { ref: message.ref, txid: message.txid });
    const exists = currentMessages.find(m => m.ref === message.ref && m.txid === message.txid);
    if (exists) {
        console.log('Message already exists:', message.ref, 'txid:', message.txid);
        return;
    }
    
    console.log('ADD MESSAGE: Adding', message.ref, 'txid:', message.txid, 'to currentMessages. Before:', currentMessages.length);
    currentMessages.unshift(message);
    currentMessages.sort((a, b) => b.timestamp - a.timestamp);
    saveMessages(currentMessages);
    saveMessageToDb(message);
    console.log('ADD MESSAGE: After adding', message.ref, 'currentMessages has', currentMessages.length, 'messages');
    console.log('ADD MESSAGE: Calling renderInbox...');
    renderInbox();
    console.log('ADD MESSAGE: renderInbox completed');
    
    MDS.notify('New Order: ' + message.ref);
    console.log('Order added to inbox:', message.ref);
}

function getState99Data(state) {
    if (!state || !Array.isArray(state)) return null;
    
    for (const entry of state) {
        if (entry && entry.port === 99 && entry.data) {
            return entry.data;
        }
    }
    return null;
}

function processIncomingMessage(coin) {
    if (!coin) {
        console.log('No coin data provided');
        return;
    }
    
    const coinTxid = coin.txid || coin.txnid || coin.coinid || '';
    
    isTxProcessed(coinTxid).then(alreadyProcessed => {
        if (alreadyProcessed) {
            console.log('TX already processed, skipping:', coinTxid.substring(0, 20));
            return;
        }
        
        let stateData = getState99Data(coin.state);
        let isSentRecord = false;
        
        if (!stateData && coin.state && coin.state[98]) {
            stateData = coin.state[98];
            isSentRecord = true;
        }
        
        if (!stateData) {
            if (coin.state && coin.state[99]) {
                stateData = coin.state[99];
            } else {
                console.log('Coin has no state[99]/state[98] - not a message');
                return;
            }
        }
        
        console.log('Processing incoming message, coin:', coin.coinid || coin.txid, 'isSentRecord:', isSentRecord);
        console.log('Found state[99]/state[98] data, length:', stateData.length);
        
        markTxProcessed(coinTxid);
        
        decryptMessage(stateData).then((decrypted) => {
            if (decrypted) {
                console.log('Decrypted message:', JSON.stringify(decrypted));
                
                if (isSentRecord || decrypted.type === 'SENT_RECORD') {
                    const sentMessage = {
                        id: 'sent_' + (decrypted.timestamp || Date.now()) + '_' + Math.random().toString(36).substr(2, 6),
                        ref: decrypted.ref || 'Unknown',
                        type: 'REPLY',
                        originalOrder: decrypted.originalOrder || decrypted.ref || '',
                        originalProduct: decrypted.originalOrder || '',
                        message: decrypted.message || '',
                        timestamp: decrypted.timestamp || Date.now(),
                        txid: coinTxid,
                        read: true,
                        direction: 'sent',
                        buyerPublicKey: '',
                        buyerAddress: decrypted.buyerAddress || ''
                    };
                    const exists = currentMessages.find(m => m.txid === coinTxid && m.direction === 'sent');
                    if (!exists) {
                        currentMessages.unshift(sentMessage);
                        saveMessages(currentMessages);
                        console.log('Sent message recovered from chain:', sentMessage.ref);
                    }
                    return;
                }
                
                const isBuyerReply = decrypted.type === 'BUYER_REPLY';
                
                const message = {
                    id: Date.now().toString(),
                    ref: decrypted.ref || 'Unknown-' + Date.now(),
                    type: decrypted.type || 'ORDER',
                    product: decrypted.product || (isBuyerReply ? decrypted.originalOrder : 'Unknown Product'),
                    size: decrypted.size || '',
                    amount: decrypted.amount || '0',
                    currency: decrypted.currency || 'USDT',
                    delivery: decrypted.delivery || (isBuyerReply ? decrypted.message : ''),
                    message: decrypted.message || '',
                    shipping: decrypted.shipping || 'uk',
                    timestamp: decrypted.timestamp || Date.now(),
                    txid: coinTxid,
                    read: false,
                    buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
                    buyerAddress: decrypted.buyerAddress || ''
                };
                
                if (message.buyerPublicKey || message.buyerAddress) {
                    saveProcessedAddress(message.buyerAddress, message.buyerPublicKey);
                }
                
                addMessage(message);
                
                console.log('=== ' + (isBuyerReply ? 'BUYER REPLY RECEIVED' : 'ORDER RECEIVED') + ' ===');
                console.log('Message ref:', decrypted.ref);
                console.log('Product:', decrypted.product || decrypted.originalOrder);
                console.log('Buyer info stored:', {
                    publicKey: message.buyerPublicKey ? 'YES' : 'MISSING',
                    publicKeyValue: message.buyerPublicKey || 'N/A',
                    address: message.buyerAddress ? 'YES' : 'MISSING',
                    addressValue: message.buyerAddress || 'N/A'
                });
            } else {
                console.log('Could not decrypt message (not for us)');
            }
        });
    });
}

function checkForNewCoins() {
    if (!myAddress) {
        console.log('No address configured');
        return;
    }
    
    console.log('=== CHECKING FOR COINS ===');
    console.log('Looking at address:', myAddress);
    console.log('Current messages in memory:', currentMessages.length);
    currentMessages.forEach(m => console.log('  - ref:', m.ref, 'txid:', (m.txid || '').substring(0, 30)));
    
    const cmd = 'coins address:' + myAddress;
    console.log('Command:', cmd);
    
    MDS.cmd(cmd, (response) => {
        console.log('Raw response type:', typeof response);
        console.log('Response keys:', response ? Object.keys(response) : 'none');
        console.log('Full response:', JSON.stringify(response, null, 2));
        
        if (response.status && response.response) {
            let coins = response.response;
            console.log('response.response type:', typeof coins);
            console.log('response.response keys:', typeof coins === 'object' && coins !== null ? Object.keys(coins) : 'N/A');
            console.log('Is array?:', Array.isArray(coins));
            
            if (typeof coins === 'string') {
                try {
                    coins = JSON.parse(coins);
                    console.log('Parsed string to:', typeof coins, Array.isArray(coins));
                } catch (e) {
                    console.log('JSON parse failed:', e.message);
                    return;
                }
            }
            
                if (Array.isArray(coins)) {
                console.log('Found', coins.length, 'coins');
                
                let messageCoins = 0;
                for (const coin of coins) {
                    console.log('---');
                    console.log('Coin ID:', coin.coinid);
                    console.log('Address:', coin.address);
                    console.log('Amount:', coin.amount);
                    console.log('Has state?:', coin.state !== undefined);
                    console.log('State keys:', coin.state ? Object.keys(coin.state) : 'none');
                    
                    let stateData = getState99Data(coin.state);
                    let isSentRecord = false;
                    if (!stateData && coin.state && Array.isArray(coin.state)) {
                        for (const entry of coin.state) {
                            if (entry && entry.port === 98 && entry.data) {
                                stateData = entry.data;
                                isSentRecord = true;
                                break;
                            }
                        }
                    }
                    console.log('state[99]/state[98] data:', stateData ? (stateData.substring(0, 50) + '...') : 'N/A', 'isSentRecord:', isSentRecord);
                    
                    if (stateData) {
                        messageCoins++;
                        console.log('*** HAS STATE[99]/STATE[98]! ***');
                        const coinTxid = coin.txid || coin.coinid || '';
                        const existsInMem = currentMessages.find(m => m.txid === coinTxid);
                        if (existsInMem) {
                            console.log('Already in currentMessages, skipping:', coinTxid.substring(0, 20));
                        } else {
                            console.log('FOUND MESSAGE COIN!');
                            processIncomingMessage(coin);
                        }
                    }
                }
                console.log('Total coins with state[99]:', messageCoins);
            } else {
                console.log('Response is not an array, it is:', coins);
            }
        } else {
            console.log('Command failed or no response');
            console.log('Status:', response.status);
            console.log('Error:', response.error);
        }
    });
}

function registerCoinNotify() {
    if (!myAddress) return;
    
    console.log('Registering coin notify for:', myAddress);
    MDS.cmd('coinnotify action:add address:' + myAddress, (resp) => {
        console.log('Coin notify registered:', resp);
    });
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
    
    const unreadCount = currentMessages.filter(m => !m.read).length;
    const totalCount = currentMessages.length;
    
    console.log('RENDER DEBUG:', {
        currentMessagesCount: currentMessages.length,
        unreadCount,
        totalCount,
        currentView
    });
    
    document.getElementById('unread-count').textContent = unreadCount;
    document.getElementById('total-count').textContent = totalCount;
    const sentCount = currentMessages.filter(m => m.direction === 'sent').length;
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
    
    console.log('RENDER: Will show', messages.length, 'messages out of', currentMessages.length);
    console.log('RENDER: currentMessages contents:', currentMessages.map(m => ({ ref: m.ref, txid: (m.txid || '').substring(0, 20), read: m.read })));
    
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
            checkForNewCoins();
            setTimeout(() => {
                btn.textContent = '🔄 Check for Orders';
                btn.disabled = false;
            }, 3000);
        });
    }
}

function setupMessageListeners() {
    document.querySelectorAll('.message-item').forEach(item => {
        item.addEventListener('click', () => {
            const msgId = item.dataset.id;
            selectedMessage = currentMessages.find(m => m.id === msgId);
            showMessageDetail(selectedMessage);
        });
    });
}

function showMessageDetail(msg) {
    if (!msg) return;
    
    const modal = document.getElementById('message-modal');
    const isBuyerReply = msg.type === 'BUYER_REPLY';
    
    // Reset all button/action states to clean defaults before any branch
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
        document.getElementById('modal-txid').textContent = msg.txid ? msg.txid.substring(0, 30) + '...' : '-';
        
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
            <div class="info-row">
                <span class="info-label">To Buyer:</span>
                <span class="info-value">${msg.buyerAddress ? msg.buyerAddress.substring(0, 20) + '...' : 'Unknown'}</span>
            </div>
        `;
        
        document.getElementById('copy-address-btn').style.display = 'none';
        document.getElementById('mark-read-btn').style.display = 'none';
        document.getElementById('reply-action').style.display = 'none';
        document.getElementById('reply-btn').disabled = true;
        
        modal.classList.remove('hidden');
        return;
    }
    
    if (isBuyerReply) {
        document.getElementById('modal-title').textContent = '↩️ Buyer Reply: ' + msg.ref;
        document.getElementById('modal-direction').textContent = !msg.read ? '📨 Unread' : '📧 Read';
        document.getElementById('modal-txid').textContent = msg.txid ? msg.txid.substring(0, 30) + '...' : '-';
        
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
        
        document.getElementById('copy-address-btn').style.display = 'none';
        
        const markReadBtn = document.getElementById('mark-read-btn');
        if (msg.read) {
            markReadBtn.style.display = 'none';
        } else {
            markReadBtn.style.display = 'block';
            markReadBtn.onclick = () => {
                msg.read = true;
                saveMessages(currentMessages);
                renderInbox();
                markReadBtn.style.display = 'none';
            };
        }
        
        if (msg.buyerPublicKey && msg.buyerAddress) {
            replyAction.style.display = 'block';
            replyWarning.style.display = 'none';
            replyBtn.style.opacity = '1';
            replyBtn.style.cursor = 'pointer';
            replyBtn.disabled = false;
            replyBtn.onclick = () => openReplyModal(msg);
        } else {
            replyAction.style.display = 'block';
            replyWarning.style.display = 'block';
            replyWarning.textContent = '⚠️ Cannot reply - missing buyer contact info';
            replyBtn.disabled = true;
            replyBtn.style.opacity = '0.5';
            replyBtn.style.cursor = 'not-allowed';
        }
        
        modal.classList.remove('hidden');
        return;
    }
    
    document.getElementById('modal-title').textContent = 'Order: ' + msg.ref;
    document.getElementById('modal-direction').textContent = !msg.read ? '📨 Unread' : '📧 Read';
    document.getElementById('modal-txid').textContent = msg.txid ? msg.txid.substring(0, 30) + '...' : '-';
    
    document.getElementById('modal-info').innerHTML = `
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
    if (msg.read) {
        markReadBtn.style.display = 'none';
    } else {
        markReadBtn.style.display = 'block';
        markReadBtn.onclick = () => {
            msg.read = true;
            saveMessages(currentMessages);
            renderInbox();
            markReadBtn.style.display = 'none';
        };
    }
    
    if (msg.buyerPublicKey && msg.buyerAddress) {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'none';
        replyBtn.onclick = () => openReplyModal(msg);
    } else {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'block';
        replyWarning.textContent = '⚠️ Cannot reply - missing buyer contact info';
        replyBtn.disabled = true;
        replyBtn.style.opacity = '0.5';
        replyBtn.style.cursor = 'not-allowed';
    }
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('message-modal').classList.add('hidden');
}

function openReplyModal(msg) {
    const replyModal = document.getElementById('reply-modal');
    document.getElementById('reply-order-ref').textContent = msg.ref;
    document.getElementById('reply-to-address').textContent = msg.buyerAddress || 'Unknown';
    document.getElementById('reply-message').value = '';
    document.getElementById('reply-status').textContent = '';
    document.getElementById('reply-status').className = 'reply-status';
    
    const sendBtn = document.getElementById('send-reply-btn');
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
    
    if (!msg.buyerPublicKey || !msg.buyerAddress) {
        statusEl.textContent = 'Missing buyer contact information';
        statusEl.className = 'reply-status error';
        return;
    }
    
    statusEl.textContent = 'Encrypting reply...';
    statusEl.className = 'reply-status pending';
    sendBtn.disabled = true;
    
    try {
        const replyPayload = {
            type: 'REPLY',
            ref: msg.ref,
            originalOrder: msg.product + ' - ' + msg.size,
            message: messageText,
            timestamp: Date.now(),
            vendorAddress: myAddress || ''
        };
        
        console.log('Sending reply payload:', replyPayload);
        
        const encryptResult = await encryptMessage(msg.buyerPublicKey, replyPayload);
        
        if (!encryptResult || !encryptResult.encrypted) {
            throw new Error('Encryption failed');
        }
        
        const encrypted = encryptResult.encrypted;
        const vendorPublicKey = encryptResult.senderPublicKey;
        
        statusEl.textContent = 'Sending encrypted reply...';
        
        const state = {};
        state[99] = encrypted;
        console.log('Vendor reply encrypted length:', String(encrypted).length);
        
        const sentRecordPayload = {
            type: 'SENT_RECORD',
            ref: msg.ref,
            originalOrder: msg.product ? (msg.product + ' - ' + (msg.size || '')) : msg.ref,
            message: messageText,
            timestamp: Date.now(),
            direction: 'sent',
            buyerAddress: msg.buyerAddress || ''
        };
        const encryptSentResult = await encryptMessage(msg.buyerPublicKey, sentRecordPayload);
        if (encryptSentResult && encryptSentResult.encrypted) {
            state[98] = encryptSentResult.encrypted;
            console.log('Sent message record encrypted for chain persistence');
        } else {
            console.error('Failed to encrypt sent message record for chain persistence');
        }
        
        console.log('Vendor public key for buyer reply:', vendorPublicKey);
        console.log('Vendor address for buyer reply:', myAddress);
        
        const command = 'send address:' + msg.buyerAddress + ' amount:0.0001 tokenid:' + TOKEN_IDS.MINIMA + ' state:' + JSON.stringify(state);
        console.log('Sending reply via TX:', command);
        
        MDS.cmd(command, (response) => {
            console.log('Reply TX Response:', JSON.stringify(response));
            if (response && response.status) {
                const txid = response.response?.txnid || 'confirmed';
                statusEl.textContent = 'Reply sent! TX: ' + txid.substring(0, 20) + '...';
                statusEl.className = 'reply-status success';
                sendBtn.textContent = '✓ Sent!';
                
                const sentMsg = {
                    id: Date.now().toString(),
                    txid: txid,
                    ref: msg.ref,
                    originalRef: msg.ref,
                    originalOrder: msg.product ? (msg.product + ' - ' + (msg.size || '')) : msg.ref,
                    originalProduct: msg.product ? (msg.product + ' - ' + (msg.size || '')) : '',
                    message: messageText,
                    timestamp: Date.now(),
                    type: 'REPLY',
                    direction: 'sent',
                    buyerPublicKey: msg.buyerPublicKey || '',
                    buyerAddress: msg.buyerAddress || ''
                };
                const exists = currentMessages.find(m => m.id === sentMsg.id);
                if (!exists) {
                    currentMessages.unshift(sentMsg);
                    saveMessages(currentMessages);
                }
                
                setTimeout(() => {
                    closeReplyModal();
                    closeModal();
                }, 2000);
            } else {
                statusEl.textContent = 'Failed: ' + (response?.error || 'Transaction failed');
                statusEl.className = 'reply-status error';
                sendBtn.disabled = false;
                sendBtn.textContent = '📤 Send Reply';
    }
});

async function saveInboxConfig() {
    const config = {
        inboxAddress: myAddress || null,
        inboxPublicKey: null,
        vendorAddress: getVendorAddress() ? (() => { try { return JSON.parse(atob(getVendorAddress())).address; } catch(e) { return null; } })() : null
    };
    await saveFile(INBOX_CONFIG_FILE_KEY, JSON.stringify(config));
    console.log('saveInboxConfig: saved to file');
}

async function loadInboxConfig() {
    const data = await loadFile(INBOX_CONFIG_FILE_KEY);
    if (!data) return null;
    try {
        let config = typeof data === 'string' ? JSON.parse(data) : data;
        if (config && typeof config === 'object') {
            console.log('loadInboxConfig: loaded from file');
            return config;
        }
    } catch (e) {
        console.error('loadInboxConfig: parse error', e);
    }
    return null;
}

    } catch (error) {
        console.error('Error sending reply:', error);
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.className = 'reply-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send Reply';
    }
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

function initInbox() {
    const obfuscatedAddress = getVendorAddress();
    
    if (!obfuscatedAddress) {
        console.error('No vendor address configured');
        document.getElementById('inbox-list').innerHTML = `
            <div class="empty-inbox">
                <div class="empty-icon">⚠️</div>
                <p>Configuration Error</p>
                <p class="empty-hint">Vendor address not configured</p>
            </div>
        `;
        return;
    }
    
    const decoded = JSON.parse(atob(obfuscatedAddress));
    myAddress = decoded.address;
    
    console.log('Inbox configured for address:', myAddress);

    registerCoinNotify();

    setTimeout(() => {
        checkForNewCoins();
    }, 2000);

    pollingInterval = setInterval(() => {
        checkForNewCoins();
    }, 30000);
}

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('MDS initialized, setting up inbox...');
        
        await initDB();
        currentMessages = await loadMessages();
        renderInbox();
        setupEventListeners();
        initInbox();
        await saveInboxConfig();
        
        setTimeout(() => recoverFromChain(), 3000);
        
    } else if (msg.event === 'NOTIFYCOIN') {
        console.log('NOTIFYCOIN event:', JSON.stringify(msg.data));
        if (msg.data && msg.data.coin && msg.data.coin.address === myAddress) {
            const coin = msg.data.coin;
            const state98 = coin.state && coin.state[98];
            if (getState99Data(coin.state) || state98) {
                processIncomingMessage(coin);
            }
        }
    } else if (msg.event === 'NEWBLOCK') {
        if (myAddress) {
            checkForNewCoins();
        }
    } else if (msg.event === 'MDS_TIMER_10SECONDS') {
        if (myAddress) {
            checkForNewCoins();
        }
    }
});

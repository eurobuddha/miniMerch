// ChainMail-style protocol: Fixed address for ALL messages, encryption-based privacy
// MINIMERCH_ADDRESS is declared in app.js
// const MINIMERCH_ADDRESS = '0x4D494E494D45524348'; // hex for "MINIMERCH"
// TOKEN_ID_MINIMA is declared in app.js as TOKEN_IDS.MINIMA
// const TOKEN_ID_MINIMA = '0x00';

// dbReady is declared in app.js
// let dbReady = false;

function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function hexToText(hex) {
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return text;
}

function generateRandomId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function getState99Data(state) {
    if (!state) return null;
    if (Array.isArray(state)) {
        for (let i = 0; i < state.length; i++) {
            let entry = state[i];
            if (entry && entry.port === 99 && entry.data) return entry.data;
            if (entry && entry.port === '99' && entry.data) return entry.data;
        }
        return null;
    }
    if (typeof state === 'object') {
        if (state[99]) return state[99];
        if (state['99']) return state['99'];
    }
    return null;
}

function initDatabase(callback) {
    if (dbReady) {
        callback(true);
        return;
    }
    MDS.sql(
        'CREATE TABLE IF NOT EXISTS messages (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'randomid TEXT UNIQUE,' +
        'ref TEXT, type TEXT, product TEXT, size TEXT,' +
        'amount TEXT, currency TEXT, delivery TEXT, shipping TEXT,' +
        'message TEXT, timestamp INTEGER, coinid TEXT,' +
        'read INTEGER, direction TEXT,' +
        'buyerPublicKey TEXT, buyerAddress TEXT,' +
        'vendorPublicKey TEXT, vendorAddress TEXT)',
        function(response) {
            if (response && response.status) {
                dbReady = true;
                console.log('SVC shop: messages table ready');
                callback(true);
            } else {
                console.log('SVC shop: DB init failed:', JSON.stringify(response));
                callback(false);
            }
        }
    );
}

function isMessageStored(randomid, callback) {
    if (!randomid) {
        callback(false);
        return;
    }
    MDS.sql(
        'SELECT randomid FROM messages WHERE randomid = ' + escapeSQL(randomid),
        function(response) {
            callback(response && response.status && response.rows && response.rows.length > 0);
        }
    );
}

function saveMessageToDb(message) {
    MDS.sql(
        'INSERT OR IGNORE INTO messages ' +
        '(randomid, ref, type, product, size, amount, currency, delivery, shipping, message, ' +
        'timestamp, coinid, read, direction, buyerPublicKey, buyerAddress, vendorPublicKey, vendorAddress) ' +
        'VALUES (' +
        escapeSQL(message.randomid || generateRandomId()) + ', ' +
        escapeSQL(message.ref || '') + ', ' + escapeSQL(message.type || 'ORDER') + ', ' +
        escapeSQL(message.product || '') + ', ' + escapeSQL(message.size || '') + ', ' +
        escapeSQL(message.amount || '') + ', ' + escapeSQL(message.currency || '') + ', ' +
        escapeSQL(message.delivery || '') + ', ' + escapeSQL(message.shipping || '') + ', ' +
        escapeSQL(message.message || '') + ', ' + (message.timestamp || Date.now()) + ', ' +
        escapeSQL(message.coinid || '') + ', ' + (message.read ? 1 : 0) + ', ' +
        escapeSQL(message.direction || 'sent') + ', ' +
        escapeSQL(message.buyerPublicKey || '') + ', ' + escapeSQL(message.buyerAddress || '') + ', ' +
        escapeSQL(message.vendorPublicKey || '') + ', ' + escapeSQL(message.vendorAddress || '') + ')',
        function(response) {
            if (response && response.status) {
                console.log('SVC shop: saved msg to DB:', message.ref || message.randomid);
            }
        }
    );
}

// ChainMail pattern: Try to decrypt, if successful the message is for us
function tryDecryptMessage(coinid, stateData, callback) {
    let cleanData = stateData;
    if (cleanData && cleanData.startsWith('0x')) cleanData = cleanData.substring(2);

    MDS.cmd('maxmessage action:decrypt data:' + cleanData, function(response) {
        if (!response || !response.status) {
            callback(null); // Not for us
            return;
        }

        // Check if decryption was valid (ChainMail pattern)
        let valid = response.response && response.response.message && response.response.message.valid;
        if (!valid) {
            callback(null); // Not for us
            return;
        }

        try {
            let hexData = response.response.message.data;
            if (!hexData) {
                callback(null);
                return;
            }
            if (hexData.startsWith('0x')) hexData = hexData.substring(2);
            let jsonStr = hexToText(hexData);
            let decrypted = JSON.parse(jsonStr);
            
            // Attach sender's public key from decryption response
            decrypted._senderPublicKey = response.response.message.mxpublickey || null;
            
            callback(decrypted);
        } catch (e) {
            console.log('SVC shop: decrypt parse error:', e.message);
            callback(null);
        }
    });
}

function processDecryptedMessage(coinid, decrypted, direction) {
    // Check for duplicate using randomid (ChainMail pattern)
    let randomid = decrypted.randomid || (decrypted.ref + '_' + decrypted.timestamp);
    
    isMessageStored(randomid, function(stored) {
        if (stored) {
            console.log('SVC shop: message already stored, skipping:', randomid);
            return;
        }

        console.log('SVC shop: decrypted message:', JSON.stringify({ type: decrypted.type, ref: decrypted.ref }));

        if (decrypted.type === 'REPLY') {
            // Vendor reply to buyer
            let message = {
                id: 'svc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
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
            saveMessageToDb(message);
        } else if (decrypted.type === 'STATUS_UPDATE') {
            // Vendor status update notification to buyer
            let statusLabel = decrypted.status
                ? decrypted.status.charAt(0) + decrypted.status.slice(1).toLowerCase()
                : 'Updated';
            let message = {
                id: 'svc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                randomid: randomid,
                ref: decrypted.ref || 'STATUS-' + Date.now(),
                type: 'STATUS_UPDATE',
                subject: 'Order status: ' + statusLabel,
                product: decrypted.status || '',
                message: 'Your order status has been updated to ' + statusLabel,
                timestamp: decrypted.timestamp || Date.now(),
                coinid: coinid,
                read: false,
                direction: 'received',
                vendorPublicKey: decrypted.vendorPublicKey || decrypted._senderPublicKey || null,
                vendorAddress: null
            };
            saveMessageToDb(message);
        }
        // Note: We don't store our own sent orders here - that's handled by app.js
    });
}

function scanForNewMessages() {
    // ChainMail pattern: Query coins at the fixed MINIMERCH_ADDRESS
    MDS.cmd('coins address:' + MINIMERCH_ADDRESS, function(response) {
        if (!response || !response.status || !response.response) return;
        
        let coins = response.response;
        if (typeof coins === 'string') {
            try { coins = JSON.parse(coins); } catch (e) { return; }
        }
        if (!Array.isArray(coins)) return;

        console.log('SVC shop: found', coins.length, 'coins at MINIMERCH_ADDRESS');

        coins.forEach(function(coin) {
            let state99 = getState99Data(coin.state);
            if (!state99) return;

            let coinid = coin.coinid || coin.txid || '';
            
            // Try to decrypt - if successful, it's for us
            tryDecryptMessage(coinid, state99, function(decrypted) {
                if (decrypted) {
                    processDecryptedMessage(coinid, decrypted, 'received');
                }
            });
        });
    });
}

MDS.init(function(msg) {
    if (msg.event === 'inited') {
        console.log('SVC shop: MDS inited (ChainMail protocol)');
        initDatabase(function(ok) {
            if (ok) {
                // Register coinnotify for the fixed MINIMERCH_ADDRESS
                MDS.cmd('coinnotify action:add address:' + MINIMERCH_ADDRESS, function(resp) {
                    console.log('SVC shop: coinnotify registered for MINIMERCH_ADDRESS:', JSON.stringify(resp));
                });
            }
            console.log('SVC shop: service ready');
        });
    }

    if (msg.event === 'NOTIFYCOIN') {
        let coin = msg.data && msg.data.coin;
        if (!coin) return;
        
        let addr = coin.address;
        if (addr !== MINIMERCH_ADDRESS) return;

        let state99 = getState99Data(coin.state);
        if (!state99) return;

        let coinid = coin.coinid || coin.txid || '';
        
        // ChainMail pattern: Try to decrypt, if successful it's for us
        tryDecryptMessage(coinid, state99, function(decrypted) {
            if (decrypted) {
                processDecryptedMessage(coinid, decrypted, 'received');
            }
        });
    }

    if (msg.event === 'MDS_TIMER_10SECONDS') {
        scanForNewMessages();
    }
});

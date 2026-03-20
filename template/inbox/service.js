const MESSAGES_FILE_KEY = 'mishop_inbox_messages';
const CONFIG_FILE_KEY = 'mishop_inbox_config';
const PROCESSED_FILE_KEY = 'mishop_inbox_processed';
const TOKEN_ID_MINIMA = '0x00';

let config = null;
let dbReady = false;

function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function saveFile(key, data) {
    return new Promise((resolve) => {
        MDS.file.save(key, data, (response) => {
            if (response && response.status) {
                resolve(true);
            } else {
                console.log('SVC saveFile failed for ' + key);
                resolve(false);
            }
        });
    });
}

function loadFile(key) {
    return new Promise((resolve) => {
        MDS.file.load(key, (response) => {
            if (response && response.status && response.response != null) {
                if (typeof response.response === 'string') {
                    resolve(response.response);
                } else {
                    resolve(JSON.stringify(response.response));
                }
            } else {
                resolve(null);
            }
        });
    });
}

function saveFileAsync(key, data) {
    if (typeof MDS !== 'undefined' && MDS.file) {
        MDS.file.save(key, data, function(response) {
            if (!response || !response.status) {
                console.log('SVC saveFile async failed: ' + key);
            }
        });
    }
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
        for (let i = 0; i < state.length; i++) {
            let entry = state[i];
            if (entry && entry.port === 99 && entry.data) return entry.data;
            if (entry && entry.port === '99' && entry.data) return entry.data;
            if (entry && typeof entry === 'object' && entry[99]) return entry[99];
        }
        return null;
    }
    if (typeof state === 'object') {
        if (state[99]) return state[99];
        if (state['99']) return state['99'];
        for (let key in state) {
            if (state[key] && typeof state[key] === 'object' && state[key].port === 99) {
                return state[key].data;
            }
        }
    }
    return null;
}

function getState98Data(state) {
    if (!state) return null;
    if (Array.isArray(state)) {
        for (let i = 0; i < state.length; i++) {
            let entry = state[i];
            if (entry && entry.port === 98 && entry.data) return entry.data;
            if (entry && entry.port === '98' && entry.data) return entry.data;
            if (entry && typeof entry === 'object' && entry[98]) return entry[98];
        }
        return null;
    }
    if (typeof state === 'object') {
        if (state[98]) return state[98];
        if (state['98']) return state['98'];
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
        'ref TEXT, type TEXT, product TEXT, size TEXT,' +
        'amount TEXT, currency TEXT, delivery TEXT, shipping TEXT,' +
        'message TEXT, timestamp INTEGER, txid TEXT,' +
        'read INTEGER, buyerPublicKey TEXT, buyerAddress TEXT,' +
        'UNIQUE(ref, txid))',
        function(response) {
            if (response && response.status) {
                dbReady = true;
                console.log('SVC DB: messages table ready');
                callback(true);
            } else {
                console.log('SVC DB init failed: ' + JSON.stringify(response));
                callback(false);
            }
        }
    );
}

function isTxProcessed(txid, callback) {
    MDS.sql(
        'SELECT txid FROM processed_txids WHERE txid = ' + escapeSQL(txid),
        function(response) {
            if (response && response.status && response.rows && response.rows.length > 0) {
                callback(true);
            } else {
                callback(false);
            }
        }
    );
}

function markTxProcessed(txid) {
    MDS.sql(
        'INSERT OR IGNORE INTO processed_txids (txid, processed_at) VALUES (' + escapeSQL(txid) + ', ' + Date.now() + ')',
        function(response) {}
    );
    loadFile(PROCESSED_FILE_KEY).then(function(data) {
        let processed = [];
        if (data) {
            try {
                let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (Array.isArray(parsed)) processed = parsed;
            } catch (e) { processed = []; }
        }
        if (processed.indexOf(txid) === -1) {
            processed.push(txid);
            saveFileAsync(PROCESSED_FILE_KEY, JSON.stringify(processed));
        }
    });
}

function saveMessageToDb(message) {
    MDS.sql(
        'INSERT OR IGNORE INTO messages ' +
        '(ref, type, product, size, amount, currency, delivery, shipping, message, ' +
        'timestamp, txid, read, buyerPublicKey, buyerAddress) ' +
        'VALUES (' +
        escapeSQL(message.ref || '') + ', ' + escapeSQL(message.type || 'ORDER') + ', ' +
        escapeSQL(message.product || '') + ', ' + escapeSQL(message.size || '') + ', ' +
        escapeSQL(message.amount || '') + ', ' + escapeSQL(message.currency || '') + ', ' +
        escapeSQL(message.delivery || '') + ', ' + escapeSQL(message.shipping || '') + ', ' +
        escapeSQL(message.message || '') + ', ' + (message.timestamp || Date.now()) + ', ' +
        escapeSQL(message.txid || '') + ', ' + (message.read ? 1 : 0) + ', ' +
        escapeSQL(message.buyerPublicKey || '') + ', ' + escapeSQL(message.buyerAddress || '') + ')',
        function(response) {
            if (response && response.status) {
                console.log('SVC saved msg to DB: ' + (message.ref || 'unknown'));
            }
        }
    );
}

function appendMessageToFile(message) {
    loadFile(MESSAGES_FILE_KEY).then(function(data) {
        let messages = [];
        if (data) {
            try {
                let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (Array.isArray(parsed)) messages = parsed;
            } catch (e) {
                messages = [];
            }
        }
        let exists = false;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].ref === message.ref && messages[i].txid === message.txid) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            messages.unshift(message);
            saveFileAsync(MESSAGES_FILE_KEY, JSON.stringify(messages));
            console.log('SVC appended msg to file: ' + (message.ref || 'unknown') + ', total: ' + messages.length);
        }
    });
}

function saveMessageBoth(message) {
    saveMessageToDb(message);
    appendMessageToFile(message);
}

function getInboxAddress() {
    try {
        let obfuscated = null;
        if (typeof INBOX_CONFIG !== 'undefined' && INBOX_CONFIG.obfuscatedVendorAddress) {
            obfuscated = INBOX_CONFIG.obfuscatedVendorAddress;
        }
        if (!obfuscated) return null;
        let decoded = JSON.parse(atob(obfuscated));
        return decoded.address;
    } catch (e) {
        return null;
    }
}

MDS.init(function(msg) {
    if (msg.event === 'inited') {
        console.log('SVC inbox: MDS inited');
        let inboxAddress = getInboxAddress();
        loadFile(CONFIG_FILE_KEY).then(function(data) {
            if (data) {
                try {
                    config = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('SVC inbox: config loaded, inboxAddress: ' + (config.inboxAddress ? config.inboxAddress.substring(0, 20) + '...' : 'none'));
                } catch (e) {
                    config = null;
                }
            }
            if (!config) {
                config = { inboxAddress: inboxAddress };
                saveFileAsync(CONFIG_FILE_KEY, JSON.stringify(config));
            }
            initDatabase(function(ok) {
                if (ok && config && config.inboxAddress) {
                    MDS.cmd('coinnotify action:add address:' + config.inboxAddress, function(resp) {
                        console.log('SVC coinnotify registered: ' + JSON.stringify(resp));
                    });
                }
                console.log('SVC inbox: service ready, inbox=' + (config && config.inboxAddress ? config.inboxAddress.substring(0, 20) + '...' : '?'));
            });
        });
    }

    if (msg.event === 'NOTIFYCOIN') {
        if (!config) return;
        let coin = msg.data && msg.data.coin;
        if (!coin) return;
        let addr = coin.address || (coin.state && coin.state.address);
        if (addr !== config.inboxAddress) return;

        let state99 = getState99Data(coin.state);
        let state98 = getState98Data(coin.state);

        let txid = coin.txid || coin.txnid || coin.coinid || '';
        if (state99 || state98) {
            processIncomingMessage(txid, coin.state, state99, state98);
        }
    }

    if (msg.event === 'MDS_TIMER_10SECONDS') {
        if (!config || !config.inboxAddress) {
            loadFile(CONFIG_FILE_KEY).then(function(data) {
                if (!data) return;
                try {
                    let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                    if (parsed && parsed.inboxAddress && (!config || config.inboxAddress !== parsed.inboxAddress)) {
                        config = parsed;
                        console.log('SVC inbox: config updated, inboxAddress: ' + config.inboxAddress.substring(0, 20) + '...');
                        MDS.cmd('coinnotify action:add address:' + config.inboxAddress, function(resp) {
                            console.log('SVC coinnotify registered: ' + JSON.stringify(resp));
                        });
                    }
                } catch (e) {}
            });
        }
        scanForNewMessages();
    }
});

function processIncomingMessage(txid, rawState, state99, state98) {
    isTxProcessed(txid, function(processed) {
        if (processed) return;
        markTxProcessed(txid);

        if (state98) {
            decryptMessage(txid, state98, true);
        }
        if (state99) {
            decryptMessage(txid, state99, false);
        }
    });
}

function decryptMessage(txid, stateData, isSentRecord) {
    let cleanData = stateData;
    if (cleanData && cleanData.startsWith('0x')) cleanData = cleanData.substring(2);

    MDS.cmd('maxmessage action:decrypt data:' + cleanData, function(response) {
        let decrypted = null;
        if (response && response.status) {
            try {
                let hexData = response.response && response.response.message && response.response.message.data
                    ? response.response.message.data
                    : (response.response && response.response.data ? response.response.data : null);
                if (hexData) {
                    if (hexData.startsWith('0x')) hexData = hexData.substring(2);
                    let jsonStr = hexToText(hexData);
                    decrypted = JSON.parse(jsonStr);
                    if (response.response && response.response.message && response.response.message.mxpublickey) {
                        decrypted._senderPublicKey = response.response.message.mxpublickey;
                    }
                }
            } catch (e) {
                console.log('SVC decrypt parse error: ' + e.message);
            }
        }

        if (!decrypted) {
            console.log('SVC: could not decrypt UTXO ' + txid.substring(0, 20));
            return;
        }

        console.log('SVC decrypted: ' + JSON.stringify({ type: decrypted.type, ref: decrypted.ref, isSent: isSentRecord }));

        if (isSentRecord || decrypted.type === 'SENT_RECORD') {
            let sentMessage = {
                id: 'svc_sent_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
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
            saveSentMessageToFile(sentMessage);
            return;
        }

        let isBuyerReply = decrypted.type === 'BUYER_REPLY';
        let message = {
            id: 'svc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
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
        saveMessageBoth(message);
    });
}

function saveSentMessageToFile(message) {
    loadFile(MESSAGES_FILE_KEY).then(function(data) {
        let messages = [];
        if (data) {
            try {
                let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (Array.isArray(parsed)) messages = parsed;
            } catch (e) {
                messages = [];
            }
        }
        let exists = false;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].txid === message.txid && messages[i].direction === 'sent') {
                exists = true;
                break;
            }
        }
        if (!exists) {
            messages.unshift(message);
            saveFileAsync(MESSAGES_FILE_KEY, JSON.stringify(messages));
            console.log('SVC saved sent record to file: ' + (message.ref || 'unknown'));
        }
    });
}

function scanForNewMessages() {
    if (!config || !config.inboxAddress) return;

    MDS.cmd('coins address:' + config.inboxAddress, function(response) {
        if (!response || !response.status || !response.response) return;
        let coins = response.response;
        if (typeof coins === 'string') {
            try { coins = JSON.parse(coins); } catch (e) { return; }
        }
        if (!Array.isArray(coins)) return;

        coins.forEach(function(coin) {
            let state99 = getState99Data(coin.state);
            let state98 = getState98Data(coin.state);
            let txid = coin.txid || coin.txnid || coin.coinid || '';

            if (!state99 && !state98) return;
            isTxProcessed(txid, function(processed) {
                if (!processed) {
                    processIncomingMessage(txid, coin.state, state99, state98);
                }
            });
        });
    });
}

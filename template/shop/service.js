const MESSAGES_FILE_KEY = 'mishop_messages';
const CONFIG_FILE_KEY = 'mishop_config';
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
        'read INTEGER, direction TEXT,' +
        'buyerPublicKey TEXT, buyerAddress TEXT,' +
        'vendorPublicKey TEXT, vendorAddress TEXT,' +
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

function isTxStored(txid, callback) {
    MDS.sql(
        'SELECT txid FROM messages WHERE txid = ' + escapeSQL(txid),
        function(response) {
            if (response && response.status && response.rows && response.rows.length > 0) {
                callback(true);
            } else {
                callback(false);
            }
        }
    );
}

function saveMessageToDb(message) {
    MDS.sql(
        'INSERT OR IGNORE INTO messages ' +
        '(ref, type, product, size, amount, currency, delivery, shipping, message, ' +
        'timestamp, txid, read, direction, buyerPublicKey, buyerAddress, vendorPublicKey, vendorAddress) ' +
        'VALUES (' +
        escapeSQL(message.ref || '') + ', ' + escapeSQL(message.type || 'ORDER') + ', ' +
        escapeSQL(message.product || '') + ', ' + escapeSQL(message.size || '') + ', ' +
        escapeSQL(message.amount || '') + ', ' + escapeSQL(message.currency || '') + ', ' +
        escapeSQL(message.delivery || '') + ', ' + escapeSQL(message.shipping || '') + ', ' +
        escapeSQL(message.message || '') + ', ' + (message.timestamp || Date.now()) + ', ' +
        escapeSQL(message.txid || '') + ', ' + (message.read ? 1 : 0) + ', ' +
        escapeSQL(message.direction || 'sent') + ', ' +
        escapeSQL(message.buyerPublicKey || '') + ', ' + escapeSQL(message.buyerAddress || '') + ', ' +
        escapeSQL(message.vendorPublicKey || '') + ', ' + escapeSQL(message.vendorAddress || '') + ')',
        function(response) {
            if (response && response.status) {
                console.log('SVC saved msg to DB: ' + (message.ref || 'unknown'));
            }
        }
    );
}

function saveMessagesToFile(messages) {
    saveFileAsync(MESSAGES_FILE_KEY, JSON.stringify(messages));
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
            saveMessagesToFile(messages);
            console.log('SVC appended msg to file: ' + (message.ref || 'unknown') + ', total: ' + messages.length);
        }
    });
}

function saveMessageBoth(message) {
    saveMessageToDb(message);
    appendMessageToFile(message);
}

MDS.init(function(msg) {
    if (msg.event === 'inited') {
        console.log('SVC shop: MDS inited');
        loadFile(CONFIG_FILE_KEY).then(function(data) {
            if (data) {
                try {
                    config = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('SVC shop: config loaded, buyerInbox: ' + (config.buyerInboxAddress ? config.buyerInboxAddress.substring(0, 20) + '...' : 'none'));
                } catch (e) {
                    config = null;
                }
            }
            if (!config) {
                console.log('SVC shop: no config file found, will read from VENDOR_CONFIG');
            }
            initDatabase(function(ok) {
                if (ok && config && config.buyerInboxAddress) {
                    MDS.cmd('coinnotify action:add address:' + config.buyerInboxAddress, function(resp) {
                        console.log('SVC coinnotify registered: ' + JSON.stringify(resp));
                    });
                }
                console.log('SVC shop: service ready');
            });
        });
    }

    if (msg.event === 'NOTIFYCOIN') {
        if (!config) return;
        let coin = msg.data && msg.data.coin;
        if (!coin) return;
        let addr = coin.address || (coin.state && coin.state.address);
        if (addr !== config.buyerInboxAddress) return;

        let state99 = getState99Data(coin.state);
        if (!state99) return;

        let txid = coin.txid || coin.txnid || coin.coinid || '';
        isTxStored(txid, function(stored) {
            if (stored) return;
            decryptAndStore(txid, state99, coin.state, 'received');
        });
    }

    if (msg.event === 'MDS_TIMER_10SECONDS') {
        if (!config || !config.buyerInboxAddress) {
            loadFile(CONFIG_FILE_KEY).then(function(data) {
                if (!data) return;
                try {
                    let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                    if (parsed && parsed.buyerInboxAddress && (!config || config.buyerInboxAddress !== parsed.buyerInboxAddress)) {
                        config = parsed;
                        console.log('SVC shop: config updated, buyerInbox: ' + config.buyerInboxAddress.substring(0, 20) + '...');
                        MDS.cmd('coinnotify action:add address:' + config.buyerInboxAddress, function(resp) {
                            console.log('SVC coinnotify registered: ' + JSON.stringify(resp));
                        });
                    }
                } catch (e) {}
            });
        }
        scanForNewMessages();
    }
});

function decryptAndStore(txid, stateData, rawState, direction) {
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

        console.log('SVC decrypted: ' + JSON.stringify({ type: decrypted.type, ref: decrypted.ref }));

        if (decrypted.type === 'REPLY') {
            let message = {
                id: 'svc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
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
            saveMessageBoth(message);
        } else {
            let message = {
                id: 'svc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                ref: decrypted.ref || '',
                type: decrypted.type || 'ORDER',
                product: decrypted.product || '',
                size: decrypted.size || '',
                amount: decrypted.amount || '',
                currency: decrypted.currency || '',
                delivery: decrypted.delivery || '',
                shipping: decrypted.shipping || '',
                timestamp: decrypted.timestamp || Date.now(),
                txid: txid,
                read: true,
                direction: direction
            };
            saveMessageBoth(message);
        }
    });
}

function scanForNewMessages() {
    if (!config) return;
    let addresses = [];
    if (config.buyerInboxAddress) addresses.push(config.buyerInboxAddress);
    if (config.vendorAddress) addresses.push(config.vendorAddress);

    if (addresses.length === 0) return;

    addresses.forEach(function(addr) {
        MDS.cmd('coins address:' + addr, function(response) {
            if (!response || !response.status || !response.response) return;
            let coins = response.response;
            if (typeof coins === 'string') {
                try { coins = JSON.parse(coins); } catch (e) { return; }
            }
            if (!Array.isArray(coins)) return;

            coins.forEach(function(coin) {
                let state99 = getState99Data(coin.state);
                if (!state99) return;
                let txid = coin.txid || coin.txnid || coin.coinid || '';
                isTxStored(txid, function(stored) {
                    if (!stored) {
                        let direction = (addr === config.buyerInboxAddress) ? 'received' : 'sent';
                        decryptAndStore(txid, state99, coin.state, direction);
                    }
                });
            });
        });
    });
}

const MESSAGES_STORAGE_KEY = 'mishop_inbox_messages';
const LAST_COIN_STORAGE_KEY = 'mishop_last_coin_check';

let currentMessages = [];
let selectedMessage = null;
let myAddress = null;
let myPublicKey = null;
let lastCheckedCoinId = null;
let pollingInterval = null;
let initAttempts = 0;

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
            if (response.status && response.response && response.response.data) {
                try {
                    let hexData = response.response.data;
                    if (hexData.startsWith('0x')) {
                        hexData = hexData.substring(2);
                    }
                    const jsonStr = hexToText(hexData);
                    console.log('Decrypted string:', jsonStr);
                    const data = JSON.parse(jsonStr);
                    resolve(data);
                } catch (e) {
                    console.error('Failed to parse decrypted data:', e);
                    console.log('Raw response data:', response.response.data);
                    resolve(null);
                }
            } else {
                console.log('Decrypt failed - response:', JSON.stringify(response));
                resolve(null);
            }
        });
    });
}

function saveMessages(messages) {
    const data = JSON.stringify(messages);
    if (typeof MDS !== 'undefined') {
        MDS.file.save(MESSAGES_STORAGE_KEY, data);
    } else {
        localStorage.setItem(MESSAGES_STORAGE_KEY, data);
    }
}

function loadMessages() {
    return new Promise((resolve) => {
        if (typeof MDS !== 'undefined') {
            MDS.file.load(MESSAGES_STORAGE_KEY, (response) => {
                if (response.status && response.response) {
                    try {
                        resolve(JSON.parse(response.response));
                    } catch (e) {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        } else {
            const data = localStorage.getItem(MESSAGES_STORAGE_KEY);
            resolve(data ? JSON.parse(data) : []);
        }
    });
}

function saveLastCoinId(coinId) {
    if (typeof MDS !== 'undefined') {
        MDS.file.save(LAST_COIN_STORAGE_KEY, coinId);
    } else {
        localStorage.setItem(LAST_COIN_STORAGE_KEY, coinId);
    }
}

function loadLastCoinId() {
    return new Promise((resolve) => {
        if (typeof MDS !== 'undefined') {
            MDS.file.load(LAST_COIN_STORAGE_KEY, (response) => {
                if (response.status && response.response) {
                    resolve(response.response);
                } else {
                    resolve(null);
                }
            });
        } else {
            resolve(localStorage.getItem(LAST_COIN_STORAGE_KEY));
        }
    });
}

function addMessage(message) {
    const exists = currentMessages.find(m => m.ref === message.ref && m.txid === message.txid);
    if (exists) {
        console.log('Message already exists:', message.ref);
        return;
    }
    
    currentMessages.unshift(message);
    currentMessages.sort((a, b) => b.timestamp - a.timestamp);
    saveMessages(currentMessages);
    renderInbox();
    
    MDS.notify('New Order: ' + message.ref);
    console.log('Order added to inbox:', message.ref);
}

function processIncomingMessage(coin) {
    if (!coin) {
        console.log('No coin data provided');
        return;
    }
    
    if (!coin.state || !coin.state[99]) {
        console.log('Coin has no state[99] - not a message');
        return;
    }
    
    console.log('Processing incoming message, coin:', coin.coinid || coin.txid);
    console.log('State[99] preview:', coin.state[99].substring(0, 50) + '...');
    
    decryptMessage(coin.state[99]).then((decrypted) => {
        if (decrypted) {
            console.log('Decrypted message:', JSON.stringify(decrypted));
            
            const message = {
                id: Date.now().toString(),
                ref: decrypted.ref || 'Unknown-' + Date.now(),
                type: decrypted.type || 'ORDER',
                product: decrypted.product || 'Unknown Product',
                size: decrypted.size || '',
                amount: decrypted.amount || '0',
                currency: decrypted.currency || 'USDT',
                delivery: decrypted.delivery || '',
                shipping: decrypted.shipping || 'uk',
                timestamp: decrypted.timestamp || Date.now(),
                txid: coin.txid || coin.txnid || coin.coinid || '',
                read: false
            };
            
            addMessage(message);
            saveLastCoinId(coin.coinid);
        } else {
            console.log('Could not decrypt message (might not be for us or wrong format)');
        }
    });
}

function getMyAddress(callback) {
    console.log('Getting address...');
    MDS.cmd('address', (response) => {
        console.log('Address response:', JSON.stringify(response));
        if (response.status && response.response && response.response.address) {
            myAddress = response.response.address;
            console.log('My address:', myAddress);
            callback(myAddress);
        } else {
            console.error('Failed to get address:', response);
            callback(null);
        }
    });
}

function checkForNewCoins() {
    if (!myAddress) {
        console.log('No address yet, skipping coin check');
        return;
    }
    
    console.log('Checking for new coins at:', myAddress);
    
    MDS.cmd('coins unspent', (response) => {
        if (response.status && response.response) {
            let coins = response.response;
            if (typeof coins === 'string') {
                try {
                    coins = JSON.parse(coins);
                } catch (e) {
                    console.log('Failed to parse coins response');
                    return;
                }
            }
            
            if (Array.isArray(coins)) {
                console.log('Found', coins.length, 'unspent coins');
                
                for (const coin of coins) {
                    if (coin.address === myAddress && coin.state && coin.state[99]) {
                        const exists = currentMessages.find(m => m.txid === (coin.txid || coin.coinid));
                        if (!exists) {
                            console.log('Found new message coin!');
                            processIncomingMessage(coin);
                        }
                    }
                }
            }
        } else {
            console.log('Coins response failed:', response);
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
    if (!inboxList) return;
    
    const unreadCount = currentMessages.filter(m => !m.read).length;
    const totalCount = currentMessages.length;
    
    const unreadBadge = document.getElementById('unread-count');
    const totalBadge = document.getElementById('total-count');
    if (unreadBadge) unreadBadge.textContent = unreadCount;
    if (totalBadge) totalBadge.textContent = totalCount;
    
    let messages = currentMessages;
    if (currentView === 'inbox') {
        messages = currentMessages.filter(m => !m.read);
    }
    
    if (messages.length === 0) {
        inboxList.innerHTML = `
            <div class="empty-inbox">
                <div class="empty-icon">${currentView === 'inbox' ? '📭' : '✅'}</div>
                <p>${currentView === 'inbox' ? 'No unread orders' : 'No orders yet'}</p>
                <p class="empty-hint">Orders from your shops will appear here</p>
                <button class="refresh-btn" id="refresh-btn">🔄 Check for Orders</button>
            </div>
        `;
        setupRefreshButton();
        return;
    }
    
    inboxList.innerHTML = messages.map(msg => `
        <div class="message-item ${!msg.read ? 'unread' : ''}" data-id="${msg.id}">
            <div class="message-icon">${msg.read ? '📧' : '📨'}</div>
            <div class="message-preview">
                <div class="message-ref">${msg.ref}</div>
                <div class="message-product">${msg.product}</div>
                <div class="message-meta">
                    <span class="message-size">${msg.size}</span>
                    <span class="message-amount">$${msg.amount} ${msg.currency}</span>
                </div>
            </div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
        </div>
    `).join('');
    
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
    
    const modalClose = document.querySelector('.modal-close');
    if (modalClose) {
        modalClose.addEventListener('click', closeModal);
    }
    
    const modal = document.getElementById('message-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'message-modal') closeModal();
        });
    }
}

function initInbox() {
    initAttempts++;
    console.log('Initializing inbox, attempt:', initAttempts);
    
    const addrEl = document.getElementById('vendor-address');
    if (addrEl) {
        addrEl.textContent = 'Getting address...';
    }
    
    getMyAddress((address) => {
        if (address) {
            const shortAddr = address.substring(0, 10) + '...' + address.substring(address.length - 8);
            const addrEl = document.getElementById('vendor-address');
            if (addrEl) {
                addrEl.textContent = shortAddr;
                addrEl.title = address;
            }
            
            registerCoinNotify();
            
            setTimeout(() => {
                console.log('Initial coin check...');
                checkForNewCoins();
            }, 2000);
            
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
            pollingInterval = setInterval(() => {
                checkForNewCoins();
            }, 30000);
        } else {
            console.error('Could not get address, retrying in 5 seconds...');
            if (initAttempts < 10) {
                setTimeout(initInbox, 5000);
            } else {
                const addrEl = document.getElementById('vendor-address');
                if (addrEl) {
                    addrEl.textContent = 'Error - retrying...';
                }
                setTimeout(initInbox, 30000);
            }
        }
    });
}

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('MDS initialized, setting up inbox...');
        
        currentMessages = await loadMessages();
        renderInbox();
        setupEventListeners();
        
        initInbox();
        
    } else if (msg.event === 'NOTIFYCOIN') {
        console.log('NOTIFYCOIN event received!:', JSON.stringify(msg.data));
        if (msg.data && msg.data.coin) {
            const coin = msg.data.coin;
            if (coin.address === myAddress) {
                console.log('Coin is for us, processing...');
                processIncomingMessage(coin);
            } else {
                console.log('Coin address mismatch:', coin.address, 'vs', myAddress);
            }
        }
    } else if (msg.event === 'NEWBLOCK') {
        console.log('New block - checking for coins...');
        checkForNewCoins();
    } else if (msg.event === 'MDS_TIMER_10SECONDS') {
        if (myAddress) {
            checkForNewCoins();
        }
    } else if (msg.event === 'MDS_TIMER_60SECONDS') {
        if (!myAddress) {
            console.log('Still no address, reinitializing...');
            initInbox();
        }
    }
});

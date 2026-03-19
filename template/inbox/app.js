const MESSAGES_STORAGE_KEY = 'mishop_inbox_messages';
const TOKEN_IDS = {
    MINIMA: '0x00'
};

let currentMessages = [];
let selectedMessage = null;
let myAddress = null;
let pollingInterval = null;

function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const combined = decoded.substring(0, decoded.length - salt.length);
    return combined.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

function getVendorAddress() {
    if (typeof INBOX_CONFIG === 'undefined' || !INBOX_CONFIG.vendorAddress) {
        console.error('INBOX_CONFIG not found');
        return null;
    }
    return INBOX_CONFIG.vendorAddress;
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
            if (response.status && response.response && response.response.message && response.response.message.data) {
                try {
                    let hexData = response.response.message.data;
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
                    data._senderPublicKey = response.response.message?.mxpublickey || null;
                    resolve(data);
                } catch (e) {
                    console.error('Failed to parse decrypted data:', e);
                    resolve(null);
                }
            } else {
                console.log('Decrypt failed - response:', JSON.stringify(response));
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
            if (response.status && response.response && response.response.message && response.response.message.data) {
                resolve({
                    encrypted: response.response.message.data,
                    senderPublicKey: response.response.message?.mxpublickey || null
                });
            } else {
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
    
    let stateData = getState99Data(coin.state);
    
    if (!stateData) {
        if (coin.state && coin.state[99]) {
            stateData = coin.state[99];
        } else {
            console.log('Coin has no state[99] - not a message');
            return;
        }
    }
    
    console.log('Processing incoming message, coin:', coin.coinid || coin.txid);
    console.log('Found state[99] data, length:', stateData.length);
    
    decryptMessage(stateData).then((decrypted) => {
        if (decrypted) {
            console.log('Decrypted message:', JSON.stringify(decrypted));
            
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
                txid: coin.txid || coin.txnid || coin.coinid || '',
                read: false,
                buyerPublicKey: decrypted.buyerPublicKey || decrypted._senderPublicKey || '',
                buyerAddress: decrypted.buyerAddress || ''
            };
            
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
}

function checkForNewCoins() {
    if (!myAddress) {
        console.log('No address configured');
        return;
    }
    
    console.log('=== CHECKING FOR COINS ===');
    console.log('Looking at address:', myAddress);
    
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
                    
                    const stateData = getState99Data(coin.state);
                    console.log('state[99] data:', stateData ? (stateData.substring(0, 50) + '...') : 'N/A');
                    
                    if (stateData) {
                        messageCoins++;
                        console.log('*** HAS STATE[99]! ***');
                        const exists = currentMessages.find(m => m.txid === (coin.txid || coin.coinid));
                        if (!exists) {
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
    if (!inboxList) return;
    
    const unreadCount = currentMessages.filter(m => !m.read).length;
    const totalCount = currentMessages.length;
    
    document.getElementById('unread-count').textContent = unreadCount;
    document.getElementById('total-count').textContent = totalCount;
    
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
    
    inboxList.innerHTML = messages.map(msg => {
        const isBuyerReply = msg.type === 'BUYER_REPLY';
        return `
        <div class="message-item ${!msg.read ? 'unread' : ''} ${isBuyerReply ? 'buyer-reply' : ''}" data-id="${msg.id}">
            <div class="message-icon">${isBuyerReply ? '↩️' : (msg.read ? '📧' : '📨')}</div>
            <div class="message-preview">
                <div class="message-ref">${isBuyerReply ? '↩️ ' : ''}${msg.ref}</div>
                <div class="message-product">${isBuyerReply ? 'Buyer Reply' : msg.product}</div>
                <div class="message-meta">
                    ${isBuyerReply ? '<span class="message-type">Buyer Reply</span>' : `
                    <span class="message-size">${msg.size}</span>
                    <span class="message-amount">$${msg.amount} ${msg.currency}</span>
                    `}
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
        
        const replyBtn = document.getElementById('reply-btn');
        const replyAction = document.getElementById('reply-action');
        const replyWarning = document.getElementById('reply-warning');
        
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
    
    const replyBtn = document.getElementById('reply-btn');
    const replyAction = document.getElementById('reply-action');
    const replyWarning = document.getElementById('reply-warning');
    
    if (msg.buyerPublicKey && msg.buyerAddress) {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'none';
        replyBtn.onclick = () => openReplyModal(msg);
    } else {
        replyAction.style.display = 'block';
        replyWarning.style.display = 'block';
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
        
        currentMessages = await loadMessages();
        renderInbox();
        setupEventListeners();
        initInbox();
        
    } else if (msg.event === 'NOTIFYCOIN') {
        console.log('NOTIFYCOIN event:', JSON.stringify(msg.data));
        if (msg.data && msg.data.coin && msg.data.coin.address === myAddress) {
            const coin = msg.data.coin;
            if (getState99Data(coin.state)) {
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

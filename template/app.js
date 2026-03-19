const TOKEN_IDS = {
    USDT: '0x7E6E60E033C7F74400B02F270074D0DA99FB863C33F8EA75078219258DCFC6CE',
    MINIMA: '0x00'
};

const PRICE_STORAGE_KEY = 'minima_last_price';
const DEFAULT_MINIMA_PRICE = 0.004;

const OBFUSCATED_CMC_KEY = '';
const CMC_KEY_SALT = '';

let selectedSize = 'eighth';
let selectedQuantity = 1;
let selectedPaymentMethod = 'USDT';
let selectedShipping = 'uk';
let shippingFee = 5;
let currentMinimaPrice = 0;
let mxToUsdRate = 0;
let vendorAddress = null;

const SHIPPING_RATES = {
    uk: 5,
    intl: 20,
    digital: 0
};

function decodeObfuscated(str, salt) {
    const decoded = atob(str);
    const combined = decoded.substring(0, decoded.length - salt.length);
    const obfuscated = decoded.substring(0, decoded.length - salt.length);
    return obfuscated.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join('');
}

async function saveLastPrice(price) {
    if (typeof MDS !== 'undefined') {
        MDS.file.save(PRICE_STORAGE_KEY, price.toString());
    }
}

async function loadLastPrice() {
    return new Promise((resolve) => {
        if (typeof MDS !== 'undefined') {
            MDS.file.load(PRICE_STORAGE_KEY, (response) => {
                if (response.status && response.response) {
                    const price = parseFloat(response.response);
                    if (price > 0) {
                        resolve(price);
                        return;
                    }
                }
                resolve(DEFAULT_MINIMA_PRICE);
            });
        } else {
            const saved = localStorage.getItem(PRICE_STORAGE_KEY);
            resolve(saved ? parseFloat(saved) : DEFAULT_MINIMA_PRICE);
        }
    });
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
    
    document.getElementById('price-usd-value').textContent = `$${productPrice.toFixed(2)} USDT`;
    document.querySelector('.buy-button .btn-price').textContent = `$${productPrice.toFixed(2)} USDT`;
    
    console.log('mxToUsdRate:', mxToUsdRate);
    
    if (mxToUsdRate > 0 && mxToUsdRate !== 1) {
        const minimaAmount = productPrice / mxToUsdRate;
        document.getElementById('price-minima').textContent = `${minimaAmount.toFixed(4)} Minima`;
        console.log('Price displayed:', minimaAmount, 'MINI');
    } else {
        document.getElementById('price-minima').textContent = `Loading...`;
    }
    
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('hidden')) {
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
    
    if (isUnitsMode) {
        productPrice = PRODUCT.pricePerUnit * selectedQuantity;
    } else {
        const size = PRODUCT.sizes.find(s => s.id === selectedSize);
        productPrice = PRODUCT.pricePerGram * size.weight;
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
        
        const cleanAddress = deliveryInfo
            .replace(/\n/g, ', ')
            .replace(/"/g, "'")
            .replace(/\\/g, '')
            .substring(0, 200);
        
        let command;
        if (selectedPaymentMethod === 'USDT') {
            command = `send address:${vendorAddress} amount:${sendAmount.toFixed(8)} tokenid:${TOKEN_IDS.USDT} state:{"44":"[${cleanAddress}]"}`;
        } else {
            command = `send address:${vendorAddress} amount:${sendAmount.toFixed(8)} tokenid:${TOKEN_IDS.MINIMA} state:{"44":"[${cleanAddress}]"}`;
        }
        
        console.log('Send command:', command);
        
        MDS.cmd(command, (response) => {
            console.log('MDS Response:', JSON.stringify(response));
            
            if (response && response.status) {
                const txid = response.response?.txnid || response.response?.tx?.pow || 'confirmed';
                payBtn.querySelector('.btn-text').textContent = '✓ Sent!';
                payBtn.classList.add('sent');
                showPaymentStatus('Transaction sent! TX: ' + txid.substring(0, 20) + '...', 'success');
                
                setTimeout(() => {
                    closeModal();
                    showConfirmation(txid);
                }, 3000);
            } else {
                const errorMsg = response?.error || 'Transaction may have failed';
                showPaymentStatus(errorMsg, 'error');
                payBtn.disabled = false;
                payBtn.querySelector('.btn-text').textContent = '💸 Pay Now';
            }
        });
        
        setTimeout(() => {
            if (document.getElementById('pay-btn').querySelector('.btn-text').textContent.includes('Sending')) {
                document.getElementById('pay-btn').querySelector('.btn-text').textContent = 'Sent! (confirming...)';
                showPaymentStatus('Transaction sent! Confirming...', 'success');
            }
        }, 10000);
        
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

function showConfirmation(txid) {
    document.getElementById('tx-id').textContent = txid || 'Pending...';
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

MDS.init(async (msg) => {
    console.log('MDS event:', msg.event);
    
    if (msg.event === 'inited') {
        console.log('MDS initialized, validating vendor...');
        if (!validateVendorAddress()) return;
        
        console.log('Vendor valid, initializing app...');
        initApp();
        
        const loadingIndicator = document.getElementById('loading-indicator');
        loadingIndicator.classList.remove('hidden');
        
        console.log('Fetching price...');
        mxToUsdRate = await fetchMXPrice();
        console.log('Got price:', mxToUsdRate);
        
        loadingIndicator.classList.add('hidden');
        updatePrices();
        
    } else if (msg.event === 'NEWBLOCK') {
        mxToUsdRate = await fetchMXPrice();
        updatePrices();
    }
});

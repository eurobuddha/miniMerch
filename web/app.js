'use strict';
// miniMerch Studio — frontend logic

// ── State ─────────────────────────────────────────────────────────────────────
let productCount = 0;          // total cards in DOM
let dragSrcEl    = null;       // card being dragged

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    addProductCard();          // start with one card
    loadConfigStatus();
    document.getElementById('add-product-btn').addEventListener('click', addProductCard);
    document.getElementById('build-btn').addEventListener('click', buildShop);
    document.getElementById('setup-form').addEventListener('submit', saveSetup);
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });
}

// ── Config status ─────────────────────────────────────────────────────────────
async function loadConfigStatus() {
    try {
        const res  = await fetch('/api/config');
        const data = await res.json();
        const el   = document.getElementById('config-status');
        if (data.configured) {
            el.className   = 'config-status ok';
            el.textContent = '✓ Vendor configured';
        } else {
            el.className   = 'config-status warn';
            el.innerHTML   = '⚠ Setup needed — <button class="tab-link" data-tab="setup">go to Vendor Setup</button>';
            el.querySelector('.tab-link').addEventListener('click', e => {
                e.preventDefault();
                document.querySelector('[data-tab="setup"]').click();
            });
        }
    } catch (_) {}
}

// ── Setup form ────────────────────────────────────────────────────────────────
async function saveSetup(e) {
    e.preventDefault();
    const statusEl = document.getElementById('setup-status');
    statusEl.textContent = 'Saving…';
    statusEl.className   = 'setup-status';

    try {
        const res = await fetch('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address:       document.getElementById('setup-address').value.trim(),
                publicKey:     document.getElementById('setup-pubkey').value.trim(),
                apiKey:        document.getElementById('setup-apikey').value.trim(),
                inboxPublicKey:document.getElementById('setup-inboxpubkey').value.trim(),
            }),
        });
        const data = await res.json();
        if (data.ok) {
            statusEl.textContent = '✓ Saved!';
            statusEl.className   = 'setup-status ok';
            loadConfigStatus();
        } else {
            statusEl.textContent = '✗ ' + (data.error || 'Failed');
            statusEl.className   = 'setup-status error';
        }
    } catch (err) {
        statusEl.textContent = '✗ ' + err.message;
        statusEl.className   = 'setup-status error';
    }
}

// ── Product cards ─────────────────────────────────────────────────────────────
function addProductCard() {
    const list = document.getElementById('product-list');
    if (list.children.length >= 8) return;

    const template = document.getElementById('product-card-template');
    const card     = template.content.cloneNode(true).querySelector('.product-card');

    list.appendChild(card);
    productCount++;
    renumberCards();
    updateAddButton();
    wireCard(card);
}

function removeCard(card) {
    const list = document.getElementById('product-list');
    if (list.children.length <= 1) return;
    card.remove();
    renumberCards();
    updateAddButton();
}

function renumberCards() {
    document.querySelectorAll('.product-card').forEach((card, i) => {
        card.querySelector('.card-number').textContent = `Product ${i + 1}`;
    });
    const count = document.querySelectorAll('.product-card').length;
    document.getElementById('product-count-label').textContent = `${count} / 8 product${count > 1 ? 's' : ''}`;

    // Disable remove button when only 1 card
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.disabled = count <= 1;
    });
}

function updateAddButton() {
    const count = document.querySelectorAll('.product-card').length;
    document.getElementById('add-product-btn').disabled = count >= 8;
}

// ── Wire a single card's interactions ────────────────────────────────────────
function wireCard(card) {
    // Remove button
    card.querySelector('.remove-btn').addEventListener('click', () => removeCard(card));

    // Mode toggle
    card.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            card.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateModeLabels(card, btn.dataset.mode);
        });
    });

    // Image drop zone
    wireImageDrop(card);

    // Drag to reorder
    wireCardDrag(card);
}

function updateModeLabels(card, mode) {
    const priceLabel = card.querySelector('.f-price-label');
    const qtyLabel   = card.querySelector('.f-qty-label');
    const qtyInput   = card.querySelector('.f-qty');
    if (mode === 'units') {
        priceLabel.textContent  = 'Price per unit (USD)';
        qtyLabel.textContent    = 'Max units';
        qtyInput.placeholder    = '10';
    } else {
        priceLabel.textContent  = 'Price per gram (USD)';
        qtyLabel.textContent    = 'Max weight (g)';
        qtyInput.placeholder    = '28';
    }
}

// ── Image drop zone ───────────────────────────────────────────────────────────
function wireImageDrop(card) {
    const zone    = card.querySelector('.image-drop-zone');
    const input   = card.querySelector('.f-image-input');
    const preview = card.querySelector('.drop-preview');
    const pholder = card.querySelector('.drop-placeholder');

    // Click to browse (clicks the hidden file input)
    zone.addEventListener('click', (e) => {
        if (e.target !== input) input.click();
    });

    input.addEventListener('change', () => {
        if (input.files[0]) handleImageFile(input.files[0], card, zone, preview, pholder);
    });

    // Drag over
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only activate if dragging a file, not a card
        if (e.dataTransfer.types.includes('Files')) {
            zone.classList.add('drag-active');
        }
    });

    zone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        zone.classList.remove('drag-active');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-active');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file, card, zone, preview, pholder);
        }
    });
}

async function handleImageFile(file, card, zone, preview, pholder) {
    // Show local preview immediately via FileReader
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        pholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);

    // Upload to server so it has the file path for building
    try {
        const formData = new FormData();
        formData.append('image', file, file.name);

        const res  = await fetch('/api/upload-image', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.path) {
            card.dataset.imagePath = data.path;
        }
    } catch (err) {
        console.error('Image upload failed:', err);
    }
}

// ── Card drag-to-reorder ──────────────────────────────────────────────────────
function wireCardDrag(card) {
    const handle = card.querySelector('.drag-handle');

    handle.addEventListener('mousedown', () => { card.draggable = true; });
    handle.addEventListener('mouseup',   () => { card.draggable = false; });

    card.addEventListener('dragstart', (e) => {
        if (!card.draggable) { e.preventDefault(); return; }
        dragSrcEl = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        document.querySelectorAll('.product-card').forEach(c => c.classList.remove('drag-over'));
        dragSrcEl = null;
        renumberCards();
    });

    card.addEventListener('dragover', (e) => {
        if (!dragSrcEl || dragSrcEl === card) return;
        if (e.dataTransfer.types.includes('Files')) return;  // ignore file drags
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
        if (!dragSrcEl || dragSrcEl === card) return;
        if (e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        card.classList.remove('drag-over');

        const list     = document.getElementById('product-list');
        const allCards = [...list.children];
        const srcIdx   = allCards.indexOf(dragSrcEl);
        const dstIdx   = allCards.indexOf(card);

        if (srcIdx < dstIdx) {
            list.insertBefore(dragSrcEl, card.nextSibling);
        } else {
            list.insertBefore(dragSrcEl, card);
        }
        renumberCards();
    });
}

// ── Build ─────────────────────────────────────────────────────────────────────
async function buildShop() {
    const buildBtn     = document.getElementById('build-btn');
    const buildBtnText = document.getElementById('build-btn-text');
    const buildSpinner = document.getElementById('build-spinner');
    const statusEl     = document.getElementById('build-status');
    const resultPanel  = document.getElementById('result-panel');

    // Collect products from cards
    const cards    = [...document.querySelectorAll('.product-card')];
    const products = [];
    let valid      = true;

    for (const card of cards) {
        const name   = card.querySelector('.f-name').value.trim();
        const mode   = card.querySelector('.mode-btn.active').dataset.mode;
        const price  = parseFloat(card.querySelector('.f-price').value);
        const qty    = parseFloat(card.querySelector('.f-qty').value);
        const desc   = card.querySelector('.f-desc').value.trim();
        const imgPath = card.dataset.imagePath || '';

        if (!name) {
            card.querySelector('.f-name').focus();
            showStatus(statusEl, 'error', `Product ${cards.indexOf(card) + 1}: name is required.`);
            valid = false; break;
        }
        if (!price || price <= 0) {
            card.querySelector('.f-price').focus();
            showStatus(statusEl, 'error', `Product ${cards.indexOf(card) + 1}: price must be greater than 0.`);
            valid = false; break;
        }
        if (!qty || qty <= 0) {
            card.querySelector('.f-qty').focus();
            showStatus(statusEl, 'error', `Product ${cards.indexOf(card) + 1}: ${mode === 'units' ? 'max units' : 'max weight'} must be greater than 0.`);
            valid = false; break;
        }

        products.push({
            name,
            mode,
            price,
            units:     mode === 'units'  ? qty : undefined,
            weight:    mode === 'weight' ? qty : undefined,
            description: desc || 'Premium product',
            imagePath,
        });
    }

    if (!valid) return;

    const shopName = document.getElementById('shop-name').value.trim();
    const slippage = parseFloat(document.getElementById('slippage').value) || 10;

    // Start build
    buildBtn.disabled      = true;
    buildBtnText.textContent = 'Building…';
    buildSpinner.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    showStatus(statusEl, 'pending', 'Generating MiniDapp files…');

    try {
        const res  = await fetch('/api/build', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ products, slippage, shopName }),
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Build failed');
        }

        // Success
        showStatus(statusEl, 'success', `✓ Built ${products.length} product${products.length > 1 ? 's' : ''} — files saved to dist/`);
        showResult(data);

    } catch (err) {
        showStatus(statusEl, 'error', '✗ ' + err.message);
    } finally {
        buildBtn.disabled        = false;
        buildBtnText.textContent = 'Build Shop';
        buildSpinner.classList.add('hidden');
    }
}

function showStatus(el, type, msg) {
    el.textContent = msg;
    el.className   = `build-status ${type}`;
    el.classList.remove('hidden');
}

function showResult(data) {
    const panel     = document.getElementById('result-panel');
    const shopName  = document.getElementById('shop-filename');
    const shopBtn   = document.getElementById('shop-download-btn');
    const inboxBtn  = document.getElementById('inbox-download-btn');

    shopName.textContent = data.shop;
    shopBtn.href  = `/api/download/${encodeURIComponent(data.shop)}`;
    inboxBtn.href = `/api/download/${encodeURIComponent(data.inbox)}`;

    // Show sizes if available
    if (data.shopSize) {
        shopName.textContent += `  (${(data.shopSize / 1024).toFixed(1)} KB)`;
    }

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Tab-link helper (config status warning) ───────────────────────────────────
document.addEventListener('click', (e) => {
    const target = e.target.closest('.tab-link');
    if (target) {
        e.preventDefault();
        const tabName = target.dataset.tab;
        document.querySelector(`[data-tab="${tabName}"]`)?.click();
    }
});

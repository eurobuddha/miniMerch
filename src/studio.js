#!/usr/bin/env node
// miniMerch Studio — local web UI for building multi-product shops
// Usage: mini-merch studio   (or: node src/studio.js)

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { exec } = require('child_process');

const PORT     = 3456;
const WEB_DIR  = path.join(__dirname, '..', 'web');
const DIST_DIR = path.join(process.cwd(), 'dist');
const TMP_IMG  = path.join(os.tmpdir(), 'mini-merch-images');

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function mime(ext) {
    return {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.zip': 'application/zip', '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';
}

function serveFile(res, filePath) {
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    res.writeHead(200, { 'Content-Type': mime(ext), 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
}

function jsonResponse(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// Parse multipart/form-data (images). Returns { fields, files: [{ name, data, filename, mimetype }] }
function parseMultipart(buffer, boundary) {
    const sep    = Buffer.from('--' + boundary);
    const endSep = Buffer.from('--' + boundary + '--');
    const parts  = [];
    let start = 0;

    while (start < buffer.length) {
        const sepIdx = buffer.indexOf(sep, start);
        if (sepIdx === -1) break;
        const afterSep = sepIdx + sep.length;
        if (buffer.slice(afterSep, afterSep + 2).equals(Buffer.from('--'))) break;
        const headerEnd = buffer.indexOf('\r\n\r\n', afterSep);
        if (headerEnd === -1) break;
        const headerStr = buffer.slice(afterSep + 2, headerEnd).toString();
        const bodyStart = headerEnd + 4;
        const nextSep   = buffer.indexOf('\r\n' + sep.toString(), bodyStart);
        const bodyEnd   = nextSep === -1 ? buffer.length : nextSep;
        const bodyData  = buffer.slice(bodyStart, bodyEnd);

        const nameMatch     = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        const ctMatch       = headerStr.match(/Content-Type:\s*(.+)/i);

        parts.push({
            name:     nameMatch     ? nameMatch[1]     : '',
            filename: filenameMatch ? filenameMatch[1] : '',
            mimetype: ctMatch       ? ctMatch[1].trim(): 'application/octet-stream',
            data:     bodyData,
        });
        start = bodyEnd + 2;
    }
    return parts;
}

function openBrowser(url) {
    const cmds = { darwin: `open "${url}"`, win32: `start "" "${url}"` };
    const cmd  = cmds[process.platform] || `xdg-open "${url}"`;
    exec(cmd, (err) => { if (err) console.log(`  Could not open browser automatically. Visit: ${url}`); });
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleConfig(res) {
    try {
        const { loadConfig } = require('./setup');
        const cfg = loadConfig();
        if (cfg) {
            jsonResponse(res, 200, {
                configured:      true,
                vendorPublicKey: cfg.vendorPublicKey || '',
                inboxPublicKey:  cfg.inboxPublicKey  || '',
                hasApiKey:       !!(cfg.obfuscatedApiKey),
            });
        } else {
            jsonResponse(res, 200, { configured: false });
        }
    } catch (e) {
        jsonResponse(res, 500, { error: e.message });
    }
}

async function handleSetup(req, res) {
    try {
        const body = JSON.parse((await readBody(req)).toString());
        const { address, apiKey, publicKey, inboxPublicKey } = body;

        if (!address || !publicKey) {
            return jsonResponse(res, 400, { error: 'address and publicKey are required' });
        }

        const { saveConfig, validateAddress, validatePublicKey } = require('./setup');

        if (!validateAddress(address)) {
            return jsonResponse(res, 400, { error: 'Invalid Minima address — must start with 0x and be 66 characters' });
        }
        if (!validatePublicKey(publicKey)) {
            return jsonResponse(res, 400, { error: 'Invalid public key — must start with Mx' });
        }
        if (inboxPublicKey && !validatePublicKey(inboxPublicKey)) {
            return jsonResponse(res, 400, { error: 'Invalid inbox public key — must start with Mx' });
        }

        saveConfig(address, apiKey || '', publicKey, inboxPublicKey || '');
        jsonResponse(res, 200, { ok: true });
    } catch (e) {
        jsonResponse(res, 500, { error: e.message });
    }
}

async function handleUploadImage(req, res) {
    try {
        ensureDir(TMP_IMG);
        const ct = req.headers['content-type'] || '';
        const boundaryMatch = ct.match(/boundary=(.+)/);
        if (!boundaryMatch) return jsonResponse(res, 400, { error: 'No multipart boundary' });

        const buffer = await readBody(req);
        const parts  = parseMultipart(buffer, boundaryMatch[1]);
        const file   = parts.find(p => p.filename);
        if (!file) return jsonResponse(res, 400, { error: 'No file found in upload' });

        const id  = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.filename) || '.jpg';
        const dest = path.join(TMP_IMG, id + ext);
        fs.writeFileSync(dest, file.data);

        jsonResponse(res, 200, { id: id + ext, path: dest, previewUrl: `/api/preview/${id + ext}` });
    } catch (e) {
        jsonResponse(res, 500, { error: e.message });
    }
}

function handlePreview(res, filename) {
    const filePath = path.join(TMP_IMG, path.basename(filename));
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    serveFile(res, filePath);
}

async function handleBuild(req, res) {
    try {
        const body     = JSON.parse((await readBody(req)).toString());
        const products = body.products;
        const slippage = typeof body.slippage === 'number' ? body.slippage : 10;
        const shopName = (body.shopName || '').trim() || 'miniMerch Shop';

        if (!products || !products.length) {
            return jsonResponse(res, 400, { error: 'No products provided' });
        }
        if (products.length > 8) {
            return jsonResponse(res, 400, { error: 'Maximum 8 products per shop' });
        }

        // Validate each product
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            if (!p.name) return jsonResponse(res, 400, { error: `Product ${i + 1} has no name` });
            if (!p.mode || !['weight', 'units'].includes(p.mode)) {
                return jsonResponse(res, 400, { error: `Product ${i + 1}: mode must be weight or units` });
            }
        }

        // Build product objects and image paths
        const productObjs = products.map(p => ({
            name:                     p.name,
            description:              p.description || 'Premium product',
            mode:                     p.mode,
            pricePerGram:             p.mode === 'weight' ? parseFloat(p.price) || 0 : 0,
            pricePerUnit:             p.mode === 'units'  ? parseFloat(p.price) || 0 : 0,
            weight:                   p.mode === 'weight' ? parseFloat(p.weight) || 0 : 0,
            maxUnits:                 p.mode === 'units'  ? parseInt(p.units)   || 10 : 10,
            firstRebroadcastDelayHours:  2,
            rebroadcastMaxIntervalHours: 24,
        }));

        const imagePaths = products.map(p =>
            p.imagePath && fs.existsSync(p.imagePath)
                ? p.imagePath
                : path.join(__dirname, '..', 'item.jpg')
        );

        // Set shop name on first product for dapp.conf headline
        productObjs[0]._shopName = shopName;

        ensureDir(DIST_DIR);

        // Require build functions from index.js (they're not exported, so we replicate inline here)
        const studioBuilder = require('./studio-builder');
        const result = await studioBuilder.build(productObjs, imagePaths, slippage, shopName, DIST_DIR);

        // Clean up temp images
        products.forEach(p => {
            if (p.imagePath && p.imagePath.startsWith(TMP_IMG) && fs.existsSync(p.imagePath)) {
                try { fs.unlinkSync(p.imagePath); } catch (_) {}
            }
        });

        jsonResponse(res, 200, {
            ok:        true,
            shop:      result.shopFile,
            inbox:     result.inboxFile,
            shopSize:  result.shopSize,
            inboxSize: result.inboxSize,
        });
    } catch (e) {
        console.error('Build error:', e);
        jsonResponse(res, 500, { error: e.message });
    }
}

function handleDownload(res, filename) {
    const filePath = path.join(DIST_DIR, path.basename(filename));
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('File not found'); return; }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
        'Content-Length':      stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
}

// ── Server ────────────────────────────────────────────────────────────────────

function createServer() {
    return http.createServer(async (req, res) => {
        // CORS for local dev
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const url = req.url.split('?')[0];

        try {
            // Static web files
            if (url === '/' || url === '/index.html') {
                return serveFile(res, path.join(WEB_DIR, 'index.html'));
            }
            if (url === '/style.css') return serveFile(res, path.join(WEB_DIR, 'style.css'));
            if (url === '/app.js')    return serveFile(res, path.join(WEB_DIR, 'app.js'));

            // API routes
            if (url === '/api/config' && req.method === 'GET') return handleConfig(res);
            if (url === '/api/setup'  && req.method === 'POST') return await handleSetup(req, res);
            if (url === '/api/upload-image' && req.method === 'POST') return await handleUploadImage(req, res);
            if (url === '/api/build'  && req.method === 'POST') return await handleBuild(req, res);

            if (url.startsWith('/api/preview/')) {
                return handlePreview(res, url.replace('/api/preview/', ''));
            }
            if (url.startsWith('/api/download/')) {
                return handleDownload(res, decodeURIComponent(url.replace('/api/download/', '')));
            }

            res.writeHead(404); res.end('Not found');
        } catch (e) {
            console.error('Server error:', e);
            jsonResponse(res, 500, { error: 'Internal server error' });
        }
    });
}

function start() {
    ensureDir(TMP_IMG);
    const server = createServer();
    const url    = `http://localhost:${PORT}`;

    server.listen(PORT, '127.0.0.1', () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║              🛒 miniMerch Studio                           ║
╠═══════════════════════════════════════════════════════════╣
║  Local server running at:                                  ║
║  ${url.padEnd(52)}║
║                                                            ║
║  Opening browser...                                        ║
║  Press Ctrl+C to stop                                      ║
╚═══════════════════════════════════════════════════════════╝
`);
        openBrowser(url);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${PORT} is already in use. Is miniMerch Studio already running?`);
            console.error(`   Try visiting: http://localhost:${PORT}\n`);
        } else {
            console.error('Server error:', e);
        }
        process.exit(1);
    });

    process.on('SIGINT', () => {
        console.log('\n\nStopping miniMerch Studio...');
        server.close(() => process.exit(0));
    });
}

module.exports = { start };

// Allow running directly
if (require.main === module) start();

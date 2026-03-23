# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the Studio web UI (local shop builder at http://localhost:3456)
npm run studio

# Build desktop app binaries
npm run build:mac    # macOS .app
npm run build:win    # Windows .exe installer

# Lint
npx eslint src/

# CLI usage (dev)
node src/index.js setup
node src/index.js generate
node src/index.js generate-multi
node src/index.js config
```

There is no test suite.

## Architecture

miniMerch is a **MiniDapp shop builder** for the Minima blockchain. It takes vendor configuration (wallet address, product details, pricing) and outputs `.mds.zip` MiniDapp packages that vendors install on their Minima node.

### Entry Points

- **`src/index.js`** — CLI entry point. Commands: `setup`, `generate` (single product), `generate-multi` (up to 40 products), `config`, `studio`.
- **`src/studio.js`** — HTTP server on port 3456 serving a visual shop builder UI. This is also the entry point for the packaged desktop binary.
- **`src/studio-builder.js`** — Zip generation logic used by the Studio server.
- **`src/setup.js`** — Vendor config read/write with obfuscation, stored at `~/.mini-merch/config.json`.

### Output: Two MiniDapps Per Shop

Every shop build generates two `.mds.zip` files in `./dist/` (or `~/Documents/miniMerch/dist/` when running as a packaged binary):

1. **miniMerch Shop** (`template/shop/`) — Buyer-facing storefront: browse products, cart, Minima/USDT checkout, encrypted order submission.
2. **miniMerchInbox** (`template/inbox/`) — Vendor-facing inbox: receives and decrypts orders via Minima P2P messaging.

### Template Injection

The `template/` directory contains static MiniDapp source. During build, these files are **dynamically generated** and injected into the zip:

- `template/shop/products.js` — Product catalog (titles, prices, images, variants)
- `template/shop/config.js` — Vendor wallet address, shop name, currency settings
- `template/inbox/config.js` — Vendor credentials for decrypting incoming orders

Everything else in `template/shop/` and `template/inbox/` (including `mds.js`, the Minima MDS library) is copied as-is.

### MiniDapp Runtime

Templates run inside a Minima node's MiniDapp System (MDS). They use the `MDS` global API (defined in `.eslintrc.js` globals) for wallet operations, P2P messaging, and SQL storage. There is no bundler — templates are vanilla JS served directly by the Minima node.

### Packaging

`@yao-pkg/pkg` bundles `src/studio.js` + all assets into standalone macOS/Windows binaries. The build scripts in `build/` handle icon embedding and installer creation.

# miShop - MiniDapp Generator for Minima

Generate MiniDapps for the Minima blockchain that function as storefronts for selling products.

## Features

- **Dual Sales Modes**: Sell by weight or by unit quantity
- **Multi-Currency Payments**: Accept USDT or Minima
- **Live Price Fetching**: CoinGecko, CoinMarketCap, or Minima node fallback
- **Vendor Address Obfuscation**: Security through simple encoding
- **API Key Obfuscation**: CoinMarketCap API key protection
- **Shipping Options**: UK and International

## Quick Start

### First Time Setup

```bash
node setup.js <your-minima-address>
```

### Generate a MiniDapp

**Weight Mode** (by gram):
```bash
node generator.js -n "Purple Haze" -m weight -p 10 -w 28 -d "Smooth sativa"
```

**Units Mode** (by quantity):
```bash
node generator.js -n "T-Shirts" -m units -p 25 -u 50 -d "Cotton t-shirts"
```

### Options

| Flag | Description | Example |
|------|-------------|---------|
| `-n, --name` | Product name | `"Purple Haze"` |
| `-m, --mode` | Sales mode: `weight` or `units` | `weight` |
| `-p, --price` | Price per gram or per unit | `10` |
| `-w, --weight` | Total weight in grams (weight mode) | `28` |
| `-u, --units` | Max units (units mode) | `50` |
| `-d, --desc` | Product description | `"Smooth sativa"` |
| `-i, --image` | Path to product image | `./photo.jpg` |

## Payment Calculations

- **USDT**: `totalUSD` (no conversion)
- **Minima**: `totalUSD / minimaPrice * 1.10` (10% slippage)

## Output

Generated MiniDapps are saved to `dist/` as `.mds.zip` files.

## Powered by Minima

Built for the Minima blockchain - the embedded blockchain empowering edge devices with full decentralization.

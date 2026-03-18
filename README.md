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
node generator.js -n "Organic Barley" -m weight -p 5 -w 1000 -d "Premium malting barley"
```

**Units Mode** (by quantity):
```bash
node generator.js -n "Rolled Oats" -m units -p 25 -u 100 -d "Organic rolled oats"
```

### Options

| Flag | Description | Example |
|------|-------------|---------|
| `-n, --name` | Product name | `"Organic Barley"` |
| `-m, --mode` | Sales mode: `weight` or `units` | `weight` |
| `-p, --price` | Price per gram or per unit | `10` |
| `-w, --weight` | Total weight in grams (weight mode) | `1000` |
| `-u, --units` | Max units (units mode) | `100` |
| `-d, --desc` | Product description | `"Premium malting barley"` |
| `-i, --image` | Path to product image | `./photo.jpg` |

## Payment Calculations

- **USDT**: `totalUSD` (no conversion)
- **Minima**: `totalUSD / minimaPrice * 1.10` (10% slippage)

## Output

Generated MiniDapps are saved to `dist/` as `.mds.zip` files.

## Powered by Minima

Built for the Minima blockchain - the embedded blockchain empowering edge devices with full decentralization.

const path = require('path');
const fs = require('fs');
const { build } = require('./src/studio-builder');

// Load vendor config
const vendorConfig = JSON.parse(fs.readFileSync('vendor.config.json', 'utf8'));

// Define 8 products for Claude Bibeau Artwork
const products = [
    { name: 'Cloud',   description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Ocean',   description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Shrub',   description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Corner',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Bird',    description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Wall',    description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Shadow',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 },
    { name: 'Beach',   description: 'Oil on canvas', mode: 'units', pricePerUnit: 1, maxUnits: 1, weight: 1 }
];

// Image paths (from images folder)
const imagePaths = [
    path.join(__dirname, 'images', 'app_022.jpg'),
    path.join(__dirname, 'images', 'app_023.jpg'),
    path.join(__dirname, 'images', 'app_027.jpg'),
    path.join(__dirname, 'images', 'app_028.jpg'),
    path.join(__dirname, 'images', 'app_031.jpg'),
    path.join(__dirname, 'images', 'app_032.jpg'),
    path.join(__dirname, 'images', 'app_075.jpg'),
    path.join(__dirname, 'images', 'app_078.jpg')
];

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Build the MiniDapps
async function buildShop() {
    console.log('\\n🎨 Building Claude Bibeau Artwork MiniDapps...\\n');

    try {
        const result = await build(
            products,
            imagePaths,
            10,                      // slippage
            'ClaudeBibeauArtwork',   // shop name
            distDir
        );

        console.log('\\n✅ Build Complete!');
        console.log('─────────────────────────────────────────');
        console.log(`Shop:  ${result.shopFile}  (${(result.shopSize / 1024).toFixed(1)} KB)`);
        console.log(`Inbox: ${result.inboxFile} (${(result.inboxSize / 1024).toFixed(1)} KB)`);
        console.log('─────────────────────────────────────────');
        console.log('\\n8 Original Oil Paintings:');
        products.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
        console.log('\\nLocation: dist/');

    } catch (err) {
        console.error('\\n❌ Build failed:', err.message);
        process.exit(1);
    }
}

buildShop();

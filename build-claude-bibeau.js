const path = require('path');
const fs = require('fs');
const { build } = require('./src/studio-builder');

// Base products for Claude Bibeau Art Gallery (40 artworks)
const baseProducts = [
    { name: 'Claude Bibeau art 1',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 2',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 3',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 4',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 5',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 6',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 7',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 8',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 9',  description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 10', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 11', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 12', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 13', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 14', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 15', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 16', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 17', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 18', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 19', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 20', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 21', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 22', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 23', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 24', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 25', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 26', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 27', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 28', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 29', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 30', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 31', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 32', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 33', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 34', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 35', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 36', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 37', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 38', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 39', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 },
    { name: 'Claude Bibeau art 40', description: 'Oil on canvas', mode: 'units', pricePerUnit: 0.01, maxUnits: 1, weight: 1 }
];

// Base 8 image paths (from images folder, repeated 5 times)
const baseImagePaths = [
    'app_022.jpg',
    'app_023.jpg',
    'app_027.jpg',
    'app_028.jpg',
    'app_031.jpg',
    'app_032.jpg',
    'app_075.jpg',
    'app_078.jpg'
];

// Repeat images 5 times for 40 products total
const imagePaths = [];
for (let i = 0; i < 40; i++) {
    imagePaths.push(path.join(__dirname, 'images', baseImagePaths[i % 8]));
}

// Products are already defined above (40 unique artworks)

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Build the MiniDapps
async function buildShop() {
    console.log(`\n🎨 Building Claude Bibeau Art Gallery (${baseProducts.length} artworks)...\n`);

    try {
        const result = await build(
            baseProducts,
            imagePaths,
            10,                                     // slippage
            'Claude Bibeau Art Gallery',            // shop name
            distDir
        );

        console.log('\n✅ Build Complete!');
        console.log('─────────────────────────────────────────');
        console.log(`Shop:  ${result.shopFile}  (${(result.shopSize / 1024).toFixed(1)} KB)`);
        console.log(`Inbox: ${result.inboxFile} (${(result.inboxSize / 1024).toFixed(1)} KB)`);
        console.log('─────────────────────────────────────────');
        console.log(`\n${baseProducts.length} Original Oil Paintings ($0.01 each):`);
        baseProducts.slice(0, 8).forEach((p, i) => {
            console.log(`  ${i + 1}. ${p.name}`);
        });
        console.log('  ... (and 32 more)');
        console.log('\nLocation: dist/');

    } catch (err) {
        console.error('\n❌ Build failed:', err.message);
        process.exit(1);
    }
}

buildShop();

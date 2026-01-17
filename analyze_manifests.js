import fs from 'fs';

function analyzeManifest(path) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    const totalCount = data.reduce((sum, entry) => sum + entry.count, 0);
    const sizeMap = {};
    data.forEach(e => {
        sizeMap[e.texture_size] = (sizeMap[e.texture_size] || 0) + 1;
    });
    console.log(`Path: ${path}`);
    console.log(`Total Chunks: ${data.length}`);
    console.log(`Total Points: ${totalCount}`);
    console.log(`Texture Sizes:`, JSON.stringify(sizeMap));
    console.log('---');
}

analyzeManifest('public/scatter_chunks_lisbon/scatter_manifest.json');
analyzeManifest('public/scatter_chunks_london/scatter_manifest.json');

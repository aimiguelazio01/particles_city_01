import fs from 'fs';

function getGlobalCenter(manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];

    manifest.forEach(entry => {
        const { center, radius } = entry.bounds;
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], center[i] - radius);
            max[i] = Math.max(max[i], center[i] + radius);
        }
    });

    return [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2
    ];
}

try {
    const lisbonCenter = getGlobalCenter('c:/Users/corsair/Desktop/GoogleMaps_3d/vibecoding/scatter01/public/scatter_chunks_lisbon/scatter_manifest.json');
    const londonCenter = getGlobalCenter('c:/Users/corsair/Desktop/GoogleMaps_3d/vibecoding/scatter01/public/scatter_chunks_london/scatter_manifest.json');

    console.log('Lisbon Center:', JSON.stringify(lisbonCenter));
    console.log('London Center:', JSON.stringify(londonCenter));
} catch (e) {
    console.error(e);
}

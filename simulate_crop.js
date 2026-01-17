import fs from 'fs';

function simulateCrop(path, cropFactor = 0.7) {
    const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));

    // Find global extent of centers
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    manifest.forEach(e => {
        const c = e.bounds.center;
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], c[i]);
            max[i] = Math.max(max[i], c[i]);
        }
    });

    const fullCenter = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const fullSize = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    let loadedCount = 0;
    let loadedPoints = 0;

    manifest.forEach(entry => {
        const c = entry.bounds.center;
        const r = entry.bounds.radius;
        const insideX = Math.abs(c[0] - fullCenter[0]) < (fullSize[0] * 0.5 * cropFactor + r);
        const insideZ = Math.abs(c[2] - fullCenter[2]) < (fullSize[2] * 0.5 * cropFactor + r);

        if (insideX && insideZ) {
            loadedCount++;
            loadedPoints += entry.count;
        }
    });

    console.log(`Path: ${path}`);
    console.log(`Total: ${manifest.length} chunks`);
    console.log(`Cropped: ${loadedCount} chunks (${Math.round(loadedCount / manifest.length * 100)}%)`);
    console.log(`Points: ${loadedPoints.toLocaleString()}`);
    console.log('---');
}

simulateCrop('public/scatter_chunks_lisbon/scatter_manifest.json', 0.7);
simulateCrop('public/scatter_chunks_london/scatter_manifest.json', 0.6);

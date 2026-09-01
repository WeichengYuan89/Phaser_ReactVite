import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(root, '../stimuli');
const output = path.join(root, 'dist-cloudflare');
const catalog = await readFile(path.join(root, 'src/game/data/stimulusCatalog.ts'), 'utf8');
const candidates = [...catalog.matchAll(/\bpath: '([^']+)'/g)].map((m) => m[1]);
const files = candidates.filter((file) => (
    (file.startsWith('train/') || file.startsWith('v1_plus_r9/train/'))
    && !file.endsWith('_f156_v00.wav')
));
if (files.length !== 520 || new Set(files).size !== 520)
    throw new Error(`Expected exactly 520 unique pilot WAVs, got ${files.length}`);
const assets = [];
await rm(path.join(output, 'stimuli'), { force: true, recursive: true });
await rm(path.join(output, 'assets/Audio'), { force: true, recursive: true });
for (const relative of files.sort()) {
    if (relative.includes('..') || !relative.endsWith('.wav')) throw new Error('Invalid asset path');
    const source = path.join(sourceRoot, relative);
    const target = path.join(output, 'stimuli', relative);
    const bytes = await readFile(source);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    const shipped = await readFile(target);
    if (!bytes.equals(shipped)) throw new Error(`Copy mismatch: ${relative}`);
    assets.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const allFiles = [];
async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await visit(file);
        else if (item.name === '.DS_Store') await rm(file);
        else allFiles.push(file);
    }
}
await visit(output);
const expected = new Set(files.map((file) => path.join(output, 'stimuli', file)));
for (const file of allFiles) {
    if (/\.(wav|opus|mp3|ogg|m4a)$/i.test(file) && !expected.has(file)) throw new Error(`Unexpected audio: ${file}`);
    if ((await stat(file)).size > 25 * 1024 * 1024) throw new Error(`Cloudflare asset too large: ${file}`);
}
if (allFiles.length > 20000) throw new Error('Cloudflare Free asset-count limit exceeded');
await writeFile(path.join(output, 'stimuli/asset-manifest.json'), JSON.stringify({
    stimulusVersion: 'v1_plus_r9', scope: 'D24-training-only', count: assets.length, files: assets
}, null, 2) + '\n');
await writeFile(path.join(output, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n');
console.log(`Verified ${assets.length} unchanged training WAVs (${assets.reduce((n, f) => n + f.bytes, 0)} bytes); excluded audio absent.`);

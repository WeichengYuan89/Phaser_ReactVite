import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(HERE, '..');
const THESIS_STIMULI_ROOT = path.resolve(GAME_ROOT, '../stimuli');
const CATALOG_PATH = path.join(GAME_ROOT, 'src/game/data/stimulusCatalog.ts');
const DIST_ROOT = path.join(GAME_ROOT, 'dist');
const DIST_STIMULI_ROOT = path.join(DIST_ROOT, 'stimuli');
const LEGACY_DEMO_AUDIO = path.join(DIST_ROOT, 'assets/Audio');
const EXPECTED_STIMULI = 640;

function fail (message)
{
    throw new Error(`Stimulus packaging failed: ${message}`);
}

function inside (root, candidate)
{
    return candidate === root || candidate.startsWith(root + path.sep);
}

async function sha256 (file)
{
    const bytes = await readFile(file);
    return createHash('sha256').update(bytes).digest('hex');
}

async function collectFiles (root)
{
    const files = [];

    async function visit (directory)
    {
        for (const entry of await readdir(directory, { withFileTypes: true }))
        {
            const full = path.join(directory, entry.name);

            if (entry.isDirectory())
                await visit(full);
            else if (entry.isFile())
                files.push(path.relative(root, full).split(path.sep).join('/'));
        }
    }

    await visit(root);
    return files.sort();
}

const catalog = await readFile(CATALOG_PATH, 'utf8');
const paths = [...catalog.matchAll(/\bpath: '([^']+)'/g)].map((match) => match[1]);
const uniquePaths = [...new Set(paths)].sort();

if (paths.length !== EXPECTED_STIMULI)
    fail(`catalog exposes ${paths.length} paths; expected ${EXPECTED_STIMULI}`);

if (uniquePaths.length !== EXPECTED_STIMULI)
    fail(`catalog has ${paths.length - uniquePaths.length} duplicate path(s)`);

for (const relative of uniquePaths)
{
    if (!relative.endsWith('.wav'))
        fail(`non-WAV runtime asset: ${relative}`);

    if (relative.includes('r1_r9_v2') || relative.includes('..'))
        fail(`forbidden runtime path: ${relative}`);

    if (!(relative.startsWith('train/') || relative.startsWith('test/') || relative.startsWith('v1_plus_r9/train/')))
        fail(`unexpected runtime root: ${relative}`);
}

await rm(DIST_STIMULI_ROOT, { recursive: true, force: true });
await rm(LEGACY_DEMO_AUDIO, { recursive: true, force: true });

const manifest = [];

for (const relative of uniquePaths)
{
    const source = path.resolve(THESIS_STIMULI_ROOT, relative);
    const destination = path.resolve(DIST_STIMULI_ROOT, relative);

    if (!inside(THESIS_STIMULI_ROOT, source) || !inside(DIST_STIMULI_ROOT, destination))
        fail(`path traversal rejected: ${relative}`);

    let sourceStat;

    try
    {
        sourceStat = await stat(source);
    }
    catch
    {
        fail(`missing source asset: ${relative}`);
    }

    if (!sourceStat.isFile())
        fail(`source is not a file: ${relative}`);

    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);

    manifest.push({
        path: relative,
        bytes: sourceStat.size,
        sha256: await sha256(destination)
    });
}

await writeFile(
    path.join(DIST_STIMULI_ROOT, 'asset-manifest.json'),
    `${JSON.stringify({ stimulusVersion: 'v1_plus_r9', count: manifest.length, files: manifest }, null, 2)}\n`,
    'utf8'
);

const packaged = await collectFiles(DIST_STIMULI_ROOT);
const packagedWavs = packaged.filter((relative) => relative.endsWith('.wav'));
const unexpected = packaged.filter((relative) => relative !== 'asset-manifest.json' && !relative.endsWith('.wav'));

if (packagedWavs.length !== EXPECTED_STIMULI || unexpected.length > 0)
    fail(`output contains ${packagedWavs.length} WAVs and ${unexpected.length} unexpected file(s)`);

process.stdout.write(
    `Packaged ${packagedWavs.length} validated WAVs in dist/stimuli/ `
    + `(manifest: ${manifest.length} SHA-256 entries).\n`
);

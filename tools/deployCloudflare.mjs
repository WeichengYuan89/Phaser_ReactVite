import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.vars?.STUDY_MODE !== 'synthetic-only') throw new Error('This deployment is restricted to synthetic preview data.');
if (!config.d1_databases?.[0]?.database_id) throw new Error('Create and bind an EU-jurisdiction D1 database before deploying. Automatic provisioning is disabled in this deploy entry.');
const provision = JSON.parse(await readFile(new URL('../cloudflare-provisioning.local', import.meta.url), 'utf8'));
if (provision.jurisdiction !== 'eu' || provision.database_id !== config.d1_databases[0].database_id)
    throw new Error('EU database provisioning evidence is missing or does not match.');
for (const [command, args] of [
    ['npm', ['run', 'build:cloudflare']],
    ['node_modules/.bin/wrangler', ['deploy', '--dry-run']],
    ['node_modules/.bin/wrangler', ['deploy']]
]) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

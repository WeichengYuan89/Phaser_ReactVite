import { readFile, writeFile } from 'node:fs/promises';

const [action, origin = 'http://127.0.0.1:8787', id] = process.argv.slice(2);
if (!['create', 'export', 'unlock-sitting-2', 'revoke'].includes(action))
    throw new Error('Usage: npm run study:admin -- create|export|unlock-sitting-2|revoke [origin] [participant-id]');
const base = new URL(origin);
if (!['https:', 'http:'].includes(base.protocol) || (base.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(base.hostname)))
    throw new Error('Use HTTPS except on localhost');
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = vars.match(/^RESEARCHER_SECRET=["']?([a-zA-Z0-9_-]{32,})["']?$/m)?.[1];
if (!secret) throw new Error('Set a random RESEARCHER_SECRET in ignored .dev.vars and the Cloudflare secret binding first');
const path = action === 'create' ? '/api/researcher/participants'
    : `/api/researcher/participants/${encodeURIComponent(id ?? '')}/${action}`;
const response = await fetch(new URL(path, base), {
    method: action === 'export' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${secret}` }
});
if (!response.ok) throw new Error(`Researcher operation failed (${response.status}): ${await response.text()}`);
const result = await response.json();
const output = action === 'export' ? `export-${id}.local` : action === 'create' ? `invite-${result.participantId}.local` : null;
if (output) {
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.log(`Saved ${action} result to ${output}. Do not commit or share this file publicly.`);
} else console.log(`${action}: completed`);

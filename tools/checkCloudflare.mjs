// Integration tests against a running, migrated Wrangler/D1 instance.
// Creates synthetic records only; never shortens the 60-trial protocol.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8787');
const startedAt = new Date().toISOString();
const requestElapsedMs = [];
const vars = await readFile('.dev.vars', 'utf8');
const secret = vars.match(/^RESEARCHER_SECRET=([a-f0-9]+)$/m)?.[1];
assert(secret, 'Missing local researcher secret');
const folder = await mkdtemp(path.join(tmpdir(), 'voice-plant-cloudflare-'));
const modulePath = path.join(folder, 'simulation.mjs');
await build({ stdin: { contents: "export * from './src/shared/remoteProtocol'; export { TrialLog } from './src/study/trialLog';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath });
const { CLIENT_BUILD_VERSION, remoteTrainingSession, appendTrainingRecord, TrialLog } = await import(pathToFileURL(modulePath));
let cookie = '';
let checks = 0;
async function call(url, data, { admin = false, expected = 200, origin = base.origin, authenticated = true } = {}) {
    const started = performance.now();
    const response = await fetch(new URL(url, base), {
        signal: AbortSignal.timeout(30_000),
        method: data === undefined ? 'GET' : 'POST',
        headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}),
            ...(admin ? { Authorization: `Bearer ${secret}` } : {}),
            ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
        body: data === undefined ? undefined : JSON.stringify(data)
    });
    const result = await response.json();
    requestElapsedMs.push(performance.now() - started);
    assert.equal(response.status, expected, `${url}: ${JSON.stringify(result)}`);
    const session = response.headers.get('set-cookie');
    if (session) cookie = session.split(';')[0];
    return result;
}
function check(label) { checks++; console.log(`ok ${label}`); }
async function start() {
    return call('/api/attempts', { attemptId: randomUUID(), build: CLIENT_BUILD_VERSION }, { expected: 201 });
}
function simulation(attempt) {
    const game = remoteTrainingSession(attempt.checkpoint, attempt.identity.sessionId, attempt.seed);
    const log = new TrialLog({ ...attempt.identity, block: `block-${attempt.block}` });
    return { game, next() {
        const trial = game.nextTrial();
        const response = trial.answer ?? 'woman';
        const outcome = game.recordResult(trial.trialType === 'wildcard_probe' ? 'wildcard' : 'correct', response);
        return appendTrainingRecord(log, trial, outcome, response, 4500, 1000 + log.length * 5500, response === 'man' ? 200 : 800);
    } };
}
try {
    await call('/api/health');
    await call('/api/state', undefined, { expected: 401, authenticated: false });
    await call('/api/researcher/participants', {}, { expected: 401 });
    await call('/api/access', { token: '0'.repeat(64) }, { expected: 401 });
    await call('/api/access', { token: '0'.repeat(64) }, { expected: 403, origin: 'https://untrusted.example' });
    const invite = await call('/api/researcher/participants', {}, { admin: true, expected: 201 });
    const token = new URLSearchParams(new URL(invite.inviteUrl).hash.slice(1)).get('invite');
    let current = await call('/api/access', { token });
    assert.equal(current.checkpoint, null);
    check('private access, invalid token, researcher authorization and CSRF');

    const inventory = JSON.parse(await readFile('dist-cloudflare/stimuli/asset-manifest.json', 'utf8'));
    assert.equal(inventory.files.length, 520);
    let cursor = 0;
    await Promise.all(Array.from({length: 6}, async () => {
        while (cursor < inventory.files.length) {
            const asset = inventory.files[cursor++];
            const response = await fetch(new URL('/stimuli/' + asset.path, base), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000) });
            assert.equal(response.status, 200);
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
            assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
            assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
        }
    }));
    for (const denied of ['/test', '/researcher', '/stimuli/train/train_USf1_s01_f156_v00.wav', '/stimuli/test/test_USf1_bead_f156_v00.wav', '/stimuli/r1_r9_v2/train/example.wav']) {
        const response = await fetch(new URL(denied, base), { headers: { Cookie: cookie } });
        assert.equal(response.status, 404, denied);
    }
    check('520/520 remote asset hashes, WAV headers and excluded routes/assets');

    for (const stopAt of [3, 59]) {
        const a = await start();
        const repeated = await call('/api/attempts', { attemptId: a.attemptId, build: CLIENT_BUILD_VERSION });
        assert.equal(repeated.seed, a.seed);
        const sim = simulation(a);
        while (sim.game.scoredTrialsPresented < stopAt) {
            const record = sim.next();
            if (record.presentationIdx === 0) {
                await call(`/api/attempts/${a.attemptId}/trials`, { record: {...record, presentationIdx: 2} }, { expected: 409 });
            }
            await call(`/api/attempts/${a.attemptId}/trials`, { record });
            if (record.presentationIdx === 0) {
                await call(`/api/attempts/${a.attemptId}/trials`, { record });
                await call(`/api/attempts/${a.attemptId}/trials`, { record: {...record, response: 'timeout'} }, { expected: 409 });
            }
        }
        await call(`/api/attempts/${a.attemptId}/commit`, { placements: {man:[],woman:[]}, audioStalls: 0 }, {expected: 422});
        current = await call('/api/bootstrap', {});
        assert.equal(current.checkpoint, null);
        await call(`/api/attempts/${a.attemptId}/trials`, {record:sim.next()}, {expected:409});
    }
    check('early/late interruption, whole-block rollback, immutable idempotency and ordered uploads');

    for (let block = 1; block <= 6; block++) {
        if (block === 4) {
            await call('/api/attempts', {attemptId:randomUUID(),build:CLIENT_BUILD_VERSION}, {expected:409});
            await call(`/api/researcher/participants/${invite.participantId}/unlock-sitting-2`, {}, {admin:true});
            current = await call('/api/bootstrap', {});
            assert.equal(current.identity.sessionId, 'sitting-2');
        }
        const a = await start();
        const sim = simulation(a);
        while (!sim.game.roundOver) await call(`/api/attempts/${a.attemptId}/trials`, {record:sim.next()});
        const commit = () => call(`/api/attempts/${a.attemptId}/commit`, {placements:{man:[],woman:[]},audioStalls:0});
        const concurrent = await Promise.all([commit(), commit()]);
        assert(concurrent.every((state) => state.checkpoint.blocksCompleted === block));
        current = concurrent[0];
        assert.equal(current.checkpoint.blocksCompleted, block);
        assert.equal((await commit()).checkpoint.blocksCompleted, block);
        assert.equal((await call('/api/bootstrap', {})).checkpoint.blocksCompleted, block);
        console.log(`  Block ${block}/6 committed once and recovered after bootstrap.`);
    }
    await call('/api/attempts', {attemptId:randomUUID(),build:CLIENT_BUILD_VERSION}, {expected:409});
    check('six complete blocks, server-gated Sitting 2, duplicate commit and refresh recovery');
    const exported = await call(`/api/researcher/participants/${invite.participantId}/export`, undefined, {admin:true});
    assert.equal(exported.attempts.filter((a)=>a.status==='complete').length,6);
    assert.equal(exported.attempts.filter((a)=>a.status==='interrupted').length,2);
    for (const a of exported.attempts.filter((a)=>a.status==='complete')) {
        const rows = exported.trials.filter((r)=>r.attempt_id===a.id);
        assert.equal(rows.filter((r)=>r.trialType==='scored_staircase').length,60);
        assert(rows.filter((r)=>r.trialType==='wildcard_probe').length <=4);
        assert(rows.every((r)=>r.protocol_version && r.build_version && r.stimulus_version && r.received_at));
    }
    const {sha256,...payload}=exported;
    assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),sha256);
    const csv=await fetch(new URL(`/api/researcher/participants/${invite.participantId}/export?format=csv`,base),{headers:{Authorization:`Bearer ${secret}`}});
    assert.equal(csv.status,200);
    const csvLines = (await csv.text()).trim().split('\n');
    assert.equal(csvLines.length,exported.trialCount+1);
    const csvColumns = csvLines[0].split(',');
    for (let i = 0; i < exported.trials.length; i++) {
        const cells = [...csvLines[i + 1].matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replace(/""/g, '"'));
        assert.equal(cells.length, csvColumns.length);
        for (let j = 0; j < csvColumns.length; j++) {
            const value = exported.trials[i][csvColumns[j]];
            const expected = value === null || value === undefined ? ''
                : typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : String(value);
            assert.equal(cells[j], expected, `CSV row ${i} column ${csvColumns[j]}`);
        }
    }
    await call(`/api/researcher/participants/${invite.participantId}/revoke`, {}, {admin:true});
    await call('/api/state',undefined,{expected:401});
    await call('/api/access',{token},{expected:401});
    check('complete/incomplete JSON+CSV export, checksum, row counts and revoked sessions');
    const tamperedInvite = await call('/api/researcher/participants', {}, {admin:true,expected:201});
    await call('/api/access',{token:new URLSearchParams(new URL(tamperedInvite.inviteUrl).hash.slice(1)).get('invite')});
    const tamperedAttempt = await start();
    const tamperedSim = simulation(tamperedAttempt);
    while (!tamperedSim.game.roundOver) {
        const record = tamperedSim.next();
        if (record.presentationIdx === 0) record.stimulusId = 'test-not-authorized';
        await call(`/api/attempts/${tamperedAttempt.attemptId}/trials`,{record});
    }
    await call(`/api/attempts/${tamperedAttempt.attemptId}/commit`,{placements:{man:[],woman:[]},audioStalls:0},{expected:422});
    assert.equal((await call('/api/state')).checkpoint,null);
    await call('/api/bootstrap',{});
    check('server rejects a full-count block with a tampered stimulus sequence');
    const sorted = requestElapsedMs.toSorted((a, b) => a - b);
    const report = { origin: base.origin, startedAt, completedAt: new Date().toISOString(),
        integrationGroups: checks, assetCount: inventory.files.length,
        completedBlocks: 6, persistedPresentations: exported.trialCount,
        participantId: invite.participantId, mode: 'synthetic-only',
        requestElapsedMs: { count: sorted.length, p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) },
        cpuTime: 'Not measured by this HTTP check; elapsed time includes network and database waits.' };
    const reportFile = base.protocol === 'https:' ? 'cloudflare-integration-result.local' : 'local-integration-result.local';
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`Passed ${checks} integration groups; ${exported.trialCount} persisted synthetic presentations. No real participant data used.`);
} finally { await rm(folder,{recursive:true,force:true}); }

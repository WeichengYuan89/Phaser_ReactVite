import { STIMULI, STIMULUS_VERSION } from '../src/game/data/stimulusCatalog';
import { CLIENT_BUILD_VERSION, REMOTE_PROTOCOL_VERSION, replayRecords } from '../src/shared/remoteProtocol';
import type { RemoteAttempt, RemoteState } from '../src/shared/remoteProtocol';
import type { CarryOver } from '../src/study/sessionStore';
import type { TrialRecord } from '../src/study/trialLog';
import { isPlacementList, MAX_PLACEMENTS } from '../src/game/ui/gardenPlacement';

interface Statement {
    bind(...values: unknown[]): Statement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number } }>;
}
interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> };
    DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]> };
    RESEARCHER_SECRET?: string;
    STUDY_MODE: string;
}
interface Participant {
    id: string; status: string; permitted_sitting: number; blocks_completed: number;
    checkpoint_json: string | null; canonical_attempt: string | null; active_attempt: string | null;
}
interface Attempt {
    id: string; participant_id: string; block_number: number; sitting: number; seed: number;
    start_checkpoint: string | null; status: string; last_seen: number;
}
const CONTINUITY_MS = 90_000;
const audioPaths = new Set(STIMULI.filter((s) => s.set === 'train' && s.cellId !== 'f156_v00').map((s) => '/stimuli/' + s.path));
class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const now = () => new Date().toISOString();
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
async function hash(value: string): Promise<string> {
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, '0')).join('');
}
function encodedJson(data: string, status = 200): Response {
    return new Response(data, { status, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow'
    } });
}
function json(data: unknown, status = 200): Response { return encodedJson(JSON.stringify(data), status); }
async function body(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required');
    // Bound actual bytes too: Content-Length alone is untrusted.
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'Body required');
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 32_768) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
        chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
        return value;
    } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function state(p: Participant): RemoteState {
    return { identity: { participantId: p.id, group: 'CI', sessionId: `sitting-${p.permitted_sitting}` },
        checkpoint: p.checkpoint_json ? JSON.parse(p.checkpoint_json) : null, mode: 'synthetic-only' };
}
function attemptState(p: Participant, a: Attempt): RemoteAttempt {
    return { ...state(p), identity: { participantId: p.id, group: 'CI', sessionId: `sitting-${a.sitting}` },
        checkpoint: a.start_checkpoint ? JSON.parse(a.start_checkpoint) : null,
        attemptId: a.id, block: a.block_number, seed: a.seed };
}
const participant = (env: Env, id: string) => env.DB.prepare('SELECT * FROM participants WHERE id=?').bind(id).first<Participant>();
async function authenticate(request: Request, env: Env): Promise<Participant> {
    const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)vp_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) throw new HttpError(401, 'Open your private preview link');
    const row = await env.DB.prepare('SELECT p.* FROM participants p JOIN sessions s ON s.participant_id=p.id WHERE s.token_hash=? AND s.expires_at>? AND p.status=\'active\'')
        .bind(await hash(token), Date.now()).first<Participant>();
    if (!row) throw new HttpError(401, 'Link revoked or session expired');
    return row;
}
async function interrupt(env: Env, p: Participant, reason: string): Promise<void> {
    if (!p.active_attempt) return;
    await env.DB.batch([
        env.DB.prepare("UPDATE attempts SET status='interrupted',ended_at=?,interruption_reason=? WHERE id=? AND status='active'").bind(now(), reason, p.active_attempt),
        env.DB.prepare('UPDATE participants SET active_attempt=NULL WHERE id=? AND active_attempt=?').bind(p.id, p.active_attempt)
    ]);
}
async function activeAttempt(env: Env, p: Participant, id: string, allowComplete = false): Promise<Attempt> {
    const a = await env.DB.prepare('SELECT * FROM attempts WHERE id=? AND participant_id=?').bind(id, p.id).first<Attempt>();
    if (!a) throw new HttpError(404, 'Attempt not found');
    if (allowComplete && a.status === 'complete') return a;
    if (a.status !== 'active' || p.active_attempt !== id) throw new HttpError(409, 'This attempt has ended; reopen the study link');
    if (Date.now() - a.last_seen > CONTINUITY_MS) {
        await interrupt(env, p, 'continuity-timeout');
        throw new HttpError(409, 'Connection timed out; repeat this block');
    }
    return a;
}
async function researcher(request: Request, env: Env, url: URL): Promise<Response> {
    if (!env.RESEARCHER_SECRET || env.RESEARCHER_SECRET.length < 32) throw new HttpError(503, 'Researcher access not configured');
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (await hash(bearer) !== await hash(env.RESEARCHER_SECRET)) throw new HttpError(401, 'Researcher access required');
    if (url.pathname === '/api/researcher/participants' && request.method === 'POST') {
        const token = randomToken();
        const id = 'synthetic-' + crypto.randomUUID();
        await env.DB.prepare('INSERT INTO participants (id,token_hash,created_at) VALUES (?,?,?)').bind(id, await hash(token), now()).run();
        return json({ participantId: id, inviteUrl: `${url.origin}/#invite=${token}`, mode: 'synthetic-only' }, 201);
    }
    const match = url.pathname.match(/^\/api\/researcher\/participants\/(synthetic-[a-f0-9-]+)\/(export|unlock-sitting-2|revoke)$/);
    if (!match) throw new HttpError(404, 'Unknown researcher operation');
    const p = await participant(env, match[1]);
    if (!p) throw new HttpError(404, 'Participant not found');
    if (match[2] === 'revoke' && request.method === 'POST') {
        await interrupt(env, p, 'access-revoked');
        await env.DB.batch([
            env.DB.prepare("UPDATE participants SET status='revoked',revoked_at=? WHERE id=?").bind(now(), p.id),
            env.DB.prepare('DELETE FROM sessions WHERE participant_id=?').bind(p.id)
        ]);
        return json({ revoked: true });
    }
    if (match[2] === 'unlock-sitting-2' && request.method === 'POST') {
        if (p.blocks_completed !== 3 || p.status !== 'active') throw new HttpError(409, 'Complete Sitting 1 first');
        await env.DB.prepare('UPDATE participants SET permitted_sitting=2 WHERE id=? AND blocks_completed=3').bind(p.id).run();
        return json({ permittedSitting: 2 });
    }
    if (match[2] === 'export' && request.method === 'GET') {
        const attempts = (await env.DB.prepare('SELECT * FROM attempts WHERE participant_id=? ORDER BY started_at,id').bind(p.id).all<Record<string, unknown>>()).results;
        const rows = (await env.DB.prepare('SELECT t.*,a.block_number,a.sitting,a.status AS attempt_status,a.seed,a.protocol_version,a.build_version,a.stimulus_version FROM trials t JOIN attempts a ON a.id=t.attempt_id WHERE a.participant_id=? ORDER BY a.started_at,a.id,t.presentation_idx').bind(p.id).all<Record<string, unknown>>()).results;
        const trials: Record<string, unknown>[] = rows.map((row) => {
            // Extend the parsed record in place instead of copying its dozens
            // of fields into another object for every exported presentation.
            const record = JSON.parse(String(row.record_json));
            for (const key in row) if (key !== 'record_json') record[key] = row[key];
            return record;
        });
        if (url.searchParams.get('format') === 'csv') {
            const columnSet = new Set<string>();
            for (const row of trials) for (const key in row) columnSet.add(key);
            const columns = [...columnSet];
            const escaped = new Map<string, string>();
            const cell = (value: unknown) => {
                if (value === null || value === undefined) return '""';
                if (typeof value === 'number' || typeof value === 'boolean') return '"' + String(value) + '"';
                const raw = String(value);
                const prior = escaped.get(raw);
                if (prior !== undefined) return prior;
                const text = /^[=+@-]/.test(raw) ? "'" + raw : raw;
                const encoded = '"' + text.replace(/"/g, '""') + '"';
                escaped.set(raw, encoded);
                return encoded;
            };
            return new Response([columns.join(','), ...trials.map((r) => columns.map((k) => cell(r[k])).join(','))].join('\n') + '\n', {
                headers: { 'Content-Type': 'text/csv', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="synthetic-trials.csv"' }
            });
        }
        const payload = { mode: 'synthetic-only', exportedAt: now(), participant: state(p), canonicalAttempt: p.canonical_attempt, attempts, trials, trialCount: trials.length };
        const serialized = JSON.stringify(payload);
        // The checksum still covers exactly the payload without its sha256
        // field; reuse the same serialization rather than encoding it twice.
        return encodedJson(serialized.slice(0, -1) + ',"sha256":"' + await hash(serialized) + '"}');
    }
    throw new HttpError(405, 'Method not allowed');
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
    if (env.STUDY_MODE !== 'synthetic-only') throw new HttpError(503, 'This build permits synthetic previews only');
    if (request.method !== 'GET' && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)
        throw new HttpError(403, 'Cross-origin write rejected');
    if (url.pathname === '/api/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT id FROM participants LIMIT 1').first();
        return json({ status: 'ok', mode: env.STUDY_MODE, build: CLIENT_BUILD_VERSION, protocol: REMOTE_PROTOCOL_VERSION, stimulusVersion: STIMULUS_VERSION });
    }
    if (url.pathname.startsWith('/api/researcher/')) return researcher(request, env, url);
    if (url.pathname === '/api/access' && request.method === 'POST') {
        const data = await body(request);
        if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new HttpError(401, 'Invalid preview link');
        const p = await env.DB.prepare("SELECT * FROM participants WHERE token_hash=? AND status='active'").bind(await hash(data.token)).first<Participant>();
        if (!p) throw new HttpError(401, 'Invalid or revoked preview link');
        await interrupt(env, p, 'link-reopened');
        const session = randomToken();
        await env.DB.batch([
            env.DB.prepare('DELETE FROM sessions WHERE participant_id=?').bind(p.id),
            env.DB.prepare('INSERT INTO sessions (token_hash,participant_id,expires_at) VALUES (?,?,?)').bind(await hash(session), p.id, Date.now() + 12 * 3600_000)
        ]);
        const response = json(state(p));
        response.headers.set('Set-Cookie', `vp_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${url.protocol === 'https:' ? '; Secure' : ''}`);
        return response;
    }
    const p = await authenticate(request, env);
    if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
        await interrupt(env, p, 'page-reopened');
        return json(state(p));
    }
    if (url.pathname === '/api/state' && request.method === 'GET') return json(state(p));
    if (url.pathname === '/api/attempts' && request.method === 'POST') {
        const data = await body(request);
        const id = data.attemptId;
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || data.build !== CLIENT_BUILD_VERSION) throw new HttpError(400, 'Invalid attempt or build');
        const existing = await env.DB.prepare('SELECT * FROM attempts WHERE id=? AND participant_id=?').bind(id, p.id).first<Attempt>();
        if (existing) return json(attemptState(p, await activeAttempt(env, p, id)));
        if (p.active_attempt || p.blocks_completed >= p.permitted_sitting * 3 || p.blocks_completed >= 6) throw new HttpError(409, 'Block not permitted');
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const started = now();
        await env.DB.batch([
            env.DB.prepare("INSERT INTO attempts (id,participant_id,block_number,sitting,seed,start_checkpoint,start_checkpoint_hash,status,started_at,last_seen,protocol_version,build_version,stimulus_version) SELECT ?,id,blocks_completed+1,permitted_sitting,?,checkpoint_json,?,'active',?,?,?,?,? FROM participants WHERE id=? AND active_attempt IS NULL AND blocks_completed=? AND status='active'")
                .bind(id, seed, await hash(p.checkpoint_json ?? 'null'), started, Date.now(), REMOTE_PROTOCOL_VERSION, CLIENT_BUILD_VERSION, STIMULUS_VERSION, p.id, p.blocks_completed),
            env.DB.prepare("UPDATE participants SET active_attempt=? WHERE id=? AND active_attempt IS NULL AND EXISTS (SELECT 1 FROM attempts WHERE id=? AND status='active')").bind(id, p.id, id)
        ]);
        const created = await env.DB.prepare('SELECT * FROM attempts WHERE id=? AND participant_id=?').bind(id, p.id).first<Attempt>();
        if (!created) throw new HttpError(409, 'Another block has started');
        return json(attemptState(p, created), 201);
    }
    const match = url.pathname.match(/^\/api\/attempts\/([a-f0-9-]{36})\/(trials|commit|interrupt)$/);
    if (!match || request.method !== 'POST') throw new HttpError(404, 'Unknown endpoint');
    const a = await activeAttempt(env, p, match[1], match[2] === 'commit');
    if (match[2] === 'interrupt') { await interrupt(env, p, 'client-interruption'); return json({ interrupted: true }); }
    if (match[2] === 'commit' && a.status === 'complete') return json(state((await participant(env, p.id))!));
    const data = await body(request);
    if (match[2] === 'trials') {
        const row = data.record as TrialRecord;
        if (!row || typeof row !== 'object' || !Number.isInteger(row.presentationIdx) || row.presentationIdx < 0 || row.presentationIdx > 63
            || row.participantId !== p.id || row.block !== `block-${a.block_number}` || row.sessionId !== `sitting-${a.sitting}`
            || row.mode !== 'train' || row.stimulusVersion !== STIMULUS_VERSION) throw new HttpError(400, 'Invalid trial record');
        const content = JSON.stringify(row);
        // Enforce order inside the atomic insertion, avoiding separate prior
        // and count reads. Existing rows remain immutable on a retry.
        await env.DB.batch([
            env.DB.prepare("INSERT INTO trials (attempt_id,presentation_idx,record_json,received_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM attempts a JOIN participants p ON p.id=a.participant_id WHERE a.id=? AND a.status='active' AND p.status='active' AND p.active_attempt=a.id) AND ?=COALESCE((SELECT MAX(presentation_idx)+1 FROM trials WHERE attempt_id=?),0) ON CONFLICT(attempt_id,presentation_idx) DO NOTHING")
                .bind(a.id, row.presentationIdx, content, now(), a.id, row.presentationIdx, a.id),
            env.DB.prepare("UPDATE attempts SET last_seen=? WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM trials WHERE attempt_id=? AND presentation_idx=? AND record_json=?)")
                .bind(Date.now(), a.id, a.id, row.presentationIdx, content)
        ]);
        const saved = await env.DB.prepare('SELECT record_json FROM trials WHERE attempt_id=? AND presentation_idx=?').bind(a.id, row.presentationIdx).first<{record_json: string}>();
        if (saved?.record_json !== content) throw new HttpError(409, 'Attempt ended or payload conflict');
        return json({ saved: true, presentationIdx: row.presentationIdx });
    }
    const records = (await env.DB.prepare('SELECT record_json FROM trials WHERE attempt_id=? ORDER BY presentation_idx').bind(a.id).all<{record_json: string}>()).results.map((r) => JSON.parse(r.record_json));
    let replay;
    try { replay = replayRecords(attemptState(p, a), records); }
    catch { throw new HttpError(422, 'Trial sequence failed server validation'); }
    if (!replay.roundOver) throw new HttpError(422, 'Block requires 60 scored presentations');
    const placements = data.placements as CarryOver['placements'];
    if (!placements || !isPlacementList(placements.man) || !isPlacementList(placements.woman)
        || placements.man.length > MAX_PLACEMENTS || placements.woman.length > MAX_PLACEMENTS
        || [...placements.man, ...placements.woman].some((v) => !Number.isFinite(v.x + v.y + v.scale) || v.x < 0 || v.x > 1024 || v.y < 0 || v.y > 768 || v.scale <= 0 || v.scale > 10))
        throw new HttpError(400, 'Invalid garden placements');
    if (!Number.isInteger(data.audioStalls) || Number(data.audioStalls) < 0 || Number(data.audioStalls) > 1000) throw new HttpError(400, 'Invalid audio stall count');
    const checkpoint: CarryOver = { version: 4, group: 'CI', lastSittingId: `sitting-${a.sitting}`, staircase: replay.state,
        garden: replay.garden, wildcard: replay.wildcard, placements, blocksCompleted: a.block_number };
    const results = await env.DB.batch([
        env.DB.prepare("UPDATE participants SET checkpoint_json=?,blocks_completed=?,canonical_attempt=?,active_attempt=NULL WHERE id=? AND blocks_completed=? AND active_attempt=? AND status='active'")
            .bind(JSON.stringify(checkpoint), a.block_number, a.id, p.id, a.block_number - 1, a.id),
        env.DB.prepare("UPDATE attempts SET status='complete',ended_at=?,audio_stalls=? WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM participants WHERE id=? AND canonical_attempt=?)")
            .bind(now(), data.audioStalls, a.id, p.id, a.id)
    ]);
    const current = await participant(env, p.id);
    if (!current || (results[0].meta.changes === 0 && current.canonical_attempt !== a.id)) throw new HttpError(409, 'Checkpoint changed; reopen the preview');
    return json(state(current));
}
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        try {
            if (url.pathname.startsWith('/api/')) return await api(request, env, url);
            if (/^\/(test|researcher)(\/|$)/.test(url.pathname)) return json({ error: 'Not available in this preview' }, 404);
            if (url.pathname.startsWith('/stimuli/')) {
                if (!audioPaths.has(url.pathname) && url.pathname !== '/stimuli/asset-manifest.json') return json({error: 'Asset not in pilot'}, 404);
                await authenticate(request, env);
            }
            return await env.ASSETS.fetch(request);
        } catch (error) {
            return json({ error: error instanceof HttpError ? error.message : 'Service unavailable; please retry' }, error instanceof HttpError ? error.status : 503);
        }
    }
};

import { acceptRemoteState } from './sessionStore';
import { CLIENT_BUILD_VERSION } from '../shared/remoteProtocol';
import type { RemoteAttempt, RemoteState } from '../shared/remoteProtocol';
import type { TrialRecord } from './trialLog';
import type { GardenPlacements } from '../game/ui/gardenPlacement';

export type SaveStatus = 'saved' | 'saving' | 'retrying' | 'interrupted';
type Listener = (status: SaveStatus) => void;
const listeners = new Set<Listener>();
function status(value: SaveStatus): void { for (const listener of listeners) listener(value); }
export function observeRemoteSave(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
class RequestError extends Error {
    constructor(public code: number, message: string) { super(message); }
}
async function request<T>(path: string, data?: unknown, retry = true): Promise<T> {
    const serialized = data === undefined ? undefined : JSON.stringify(data);
    const deadline = Date.now() + (retry ? 25_000 : 6_000);
    let delay = 500;
    while (true) {
        const abort = new AbortController();
        const timeout = window.setTimeout(() => abort.abort(), Math.min(5_000, Math.max(1, deadline - Date.now())));
        try {
            const response = await fetch(path, { method: serialized === undefined ? 'GET' : 'POST',
                headers: serialized ? { 'Content-Type': 'application/json' } : undefined,
                body: serialized, credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
            const result = await response.json();
            if (!response.ok) throw new RequestError(response.status, result.error ?? 'Unable to save');
            return result as T;
        } catch (error) {
            if (!retry || Date.now() >= deadline || (error instanceof RequestError && error.code < 500 && error.code !== 429)) throw error;
            status('retrying');
        } finally { window.clearTimeout(timeout); }
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
        delay = Math.min(delay * 2, 3000);
    }
}
function accept(state: RemoteState): RemoteState {
    acceptRemoteState(state.identity, state.checkpoint);
    return state;
}
let bootstrapPromise: Promise<RemoteState> | null = null;
export function bootstrapRemote(): Promise<RemoteState> {
    // React StrictMode must not repeat an exchange and interrupt its own session.
    if (!bootstrapPromise) bootstrapPromise = (async () => {
        const token = new URLSearchParams(window.location.hash.slice(1)).get('invite');
        const result = await request<RemoteState>(token ? '/api/access' : '/api/bootstrap', token ? { token } : {}, false);
        if (token) window.history.replaceState(null, '', window.location.pathname);
        return accept(result);
    })();
    return bootstrapPromise;
}
export async function startRemoteAttempt(): Promise<RemoteAttempt> {
    status('saving');
    const attempt = await request<RemoteAttempt>('/api/attempts', { attemptId: crypto.randomUUID(), build: CLIENT_BUILD_VERSION });
    accept(attempt);
    status('saved');
    return attempt;
}
export async function uploadRemoteTrial(attempt: RemoteAttempt, record: TrialRecord): Promise<void> {
    status('saving');
    await request(`/api/attempts/${attempt.attemptId}/trials`, { record });
    status('saved');
}
export async function commitRemoteAttempt(attempt: RemoteAttempt, placements: GardenPlacements, audioStalls: number): Promise<void> {
    status('saving');
    accept(await request<RemoteState>(`/api/attempts/${attempt.attemptId}/commit`, { placements, audioStalls }));
    status('saved');
}
export function interruptRemoteAttempt(attempt: RemoteAttempt): void {
    status('interrupted');
    // Best effort only. Bootstrap and server timeout also invalidate this attempt.
    void fetch(`/api/attempts/${attempt.attemptId}/interrupt`, { method: 'POST',
        credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}

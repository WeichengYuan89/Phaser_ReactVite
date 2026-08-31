/**
 * Web Audio playback for voice stimuli — INTEGRATION_DESIGN §4.3.
 *
 * Deliberately bypasses Phaser's sound manager, for three reasons that matter to
 * the measurement rather than to the code: (a) it yields an exact onset
 * timestamp, which is what RT is measured from; (b) buffer lifetime is explicit,
 * where Phaser's audio cache never evicts; (c) it works in the plain-React
 * `/test` route, which has no Phaser at all.
 *
 * Shared by both activities. The pre/post test preloads its whole 100-stimulus
 * set up front (§3.2); the training loop will lazily fetch one stimulus per
 * trial and keep an LRU of decoded buffers (§4.3, TODO 2.1).
 */

import { Stimulus } from '../game/data/stimulusCatalog';

/** Local Vite mounts this path; production packages the same URLs in dist. */
export const STIMULUS_BASE = '/stimuli/';

/**
 * Decoded buffers retained in training mode (INTEGRATION_DESIGN §4.3).
 *
 * ~40 training stimuli ≈ 25 MB as Float32 PCM, against the 265 MB the whole
 * training set would occupy if it were preloaded the way `Preloader` used to
 * load the old clips. A session visits ~60 stimuli, so this holds most of a
 * session's working set while staying bounded across sessions.
 */
export const DEFAULT_CACHE_LIMIT = 40;

export interface StimulusPlayerOptions
{
    /**
     * Maximum decoded buffers kept. `Infinity` disables eviction, which is what
     * the pre/post test wants: it preloads all 100 stimuli up front and every
     * one of them is played exactly once, so evicting would guarantee a refetch.
     */
    cacheLimit?: number;
}

export interface PlaybackHandle
{
    /**
     * `performance.now()` at the moment the buffer was scheduled to start.
     * RT is measured from here, not from the response-enable time, so that any
     * scheduling latency is inside the measurement rather than hidden by it.
     */
    onsetMs: number;
    /** Resolves when playback ends naturally; rejects nothing. */
    ended: Promise<void>;
    stop: () => void;
}

export class StimulusPlayer
{
    private context: AudioContext | null = null;
    /** Insertion order is the LRU order; `touch()` maintains it. */
    private buffers = new Map<string, AudioBuffer>();
    private inFlight = new Map<string, Promise<AudioBuffer>>();
    private active: AudioBufferSourceNode | null = null;
    private readonly cacheLimit: number;

    constructor (options: StimulusPlayerOptions = {})
    {
        this.cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT;
    }

    /**
     * Browsers refuse to start an AudioContext outside a user gesture, so this
     * must be called from a click/keypress handler — the test route's "start"
     * button does it. Safe to call repeatedly.
     */
    async unlock (): Promise<void>
    {
        const context = this.ensureContext();

        if (context.state === 'suspended')
        {
            await context.resume();
        }
    }

    get ready (): boolean
    {
        return this.context !== null && this.context.state === 'running';
    }

    private ensureContext (): AudioContext
    {
        if (!this.context)
        {
            this.context = new AudioContext();
        }

        return this.context;
    }

    private url (stimulus: Stimulus): string
    {
        return STIMULUS_BASE + stimulus.path;
    }

    /**
     * Fetch and decode one stimulus, de-duplicating concurrent requests for the
     * same file. Resolves to the decoded buffer, which is retained.
     */
    /** Move a buffer to the most-recently-used end of the LRU order. */
    private touch (id: string, buffer: AudioBuffer): void
    {
        this.buffers.delete(id);
        this.buffers.set(id, buffer);

        while (this.buffers.size > this.cacheLimit)
        {
            const oldest = this.buffers.keys().next();

            if (oldest.done)
            {
                break;
            }

            this.buffers.delete(oldest.value);
        }
    }

    async load (stimulus: Stimulus): Promise<AudioBuffer>
    {
        const cached = this.buffers.get(stimulus.id);

        if (cached)
        {
            this.touch(stimulus.id, cached);

            return cached;
        }

        const pending = this.inFlight.get(stimulus.id);

        if (pending)
        {
            return pending;
        }

        const context = this.ensureContext();
        const request = (async () =>
        {
            const response = await fetch(this.url(stimulus));

            if (!response.ok)
            {
                throw new Error(
                    `Failed to fetch ${stimulus.id} (${response.status}) from ${this.url(stimulus)} — `
                    + 'is the dev server running with vite/stimuliPlugin.mjs?'
                );
            }

            const buffer = await context.decodeAudioData(await response.arrayBuffer());

            this.touch(stimulus.id, buffer);
            this.inFlight.delete(stimulus.id);

            return buffer;
        })();

        this.inFlight.set(stimulus.id, request);

        try
        {
            return await request;
        }
        catch (error)
        {
            this.inFlight.delete(stimulus.id);
            throw error;
        }
    }

    /**
     * Load a whole set, reporting progress. Sequential on purpose: 100 parallel
     * decodes spike memory and give a jumpier progress bar, and preloading the
     * 4.7 MB test set takes a moment either way.
     */
    async preload (stimuli: readonly Stimulus[], onProgress?: (done: number, total: number) => void): Promise<void>
    {
        let done = 0;

        for (const stimulus of stimuli)
        {
            await this.load(stimulus);
            done += 1;
            onProgress?.(done, stimuli.length);
        }
    }

    /**
     * Start fetching a stimulus without waiting for it — the training loop calls
     * this the instant a trial resolves, so the ~1 s inter-trial gap is spent
     * decoding (INTEGRATION_DESIGN §4.3). Errors are swallowed here on purpose;
     * `play()` will surface them if the stimulus is actually needed.
     */
    prefetch (stimulus: Stimulus): void
    {
        void this.load(stimulus).catch(() => undefined);
    }

    /** True when a stimulus can be played with no fetch or decode. */
    isReady (stimulus: Stimulus): boolean
    {
        return this.buffers.has(stimulus.id);
    }

    /** Play a preloaded (or freshly loaded) stimulus, stopping anything already sounding. */
    async play (stimulus: Stimulus): Promise<PlaybackHandle>
    {
        const context = this.ensureContext();
        const buffer = await this.load(stimulus);

        this.stop();

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);

        const ended = new Promise<void>((resolve) =>
        {
            source.onended = () =>
            {
                if (this.active === source)
                {
                    this.active = null;
                }

                resolve();
            };
        });

        this.active = source;
        source.start();

        return {
            onsetMs: performance.now(),
            ended,
            stop: () =>
            {
                if (this.active === source)
                {
                    this.stop();
                }
            }
        };
    }

    stop (): void
    {
        if (!this.active)
        {
            return;
        }

        const source = this.active;
        this.active = null;
        source.onended = null;

        try
        {
            source.stop();
        }
        catch
        {
            // Already stopped; nothing to do.
        }

        source.disconnect();
    }

    /** Release every decoded buffer and close the context. */
    async dispose (): Promise<void>
    {
        this.stop();
        this.buffers.clear();
        this.inFlight.clear();

        if (this.context)
        {
            const context = this.context;
            this.context = null;
            await context.close();
        }
    }
}

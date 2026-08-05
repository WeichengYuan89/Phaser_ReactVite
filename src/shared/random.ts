/**
 * Shared randomness for the study.
 *
 * Every consumer takes an injectable `rng` so that trial orders, cell draws and
 * sentence deals can be reproduced exactly from a seed — a session that has to
 * be reconstructed for analysis should not depend on Math.random.
 */

/**
 * mulberry32 — small, seedable, and good enough for ordering. Not for anything
 * cryptographic, which nothing here is.
 */
export function seededRng (seed: number): () => number
{
    let state = seed >>> 0;

    return () =>
    {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates, on a copy. */
export function shuffled<T> (items: readonly T[], rng: () => number): T[]
{
    const result = items.slice();

    for (let i = result.length - 1; i > 0; i -= 1)
    {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

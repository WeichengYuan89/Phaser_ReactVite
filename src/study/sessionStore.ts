/**
 * Participant identity and cross-session carry-over.
 *
 * Two things must survive between training sessions (DECISIONS D10-3, D11-3):
 * the staircase rung the last session converged at, and the garden. They are
 * stored together here, per participant.
 *
 * **The storage medium is provisional.** INTEGRATION_DESIGN §10 lists
 * "cross-session persistence — localStorage vs. file export" as undecided.
 * localStorage is the default because the study is run locally on one laptop
 * with the experimenter present (D9-2), so the browser profile *is* the study
 * machine; it is also trivially replaceable, since everything crosses this one
 * module. It is **not** a data-retention mechanism: trial logs are exported to
 * file at the end of every block and must not be left to depend on this.
 */

import { GardenState } from '../game/training/garden';
import { Rung } from '../game/data/difficulty';

const KEY_PREFIX = 'voice-plant:participant:';
const IDENTITY_KEY = 'voice-plant:current';

export interface ParticipantIdentity
{
    participantId: string;
    sessionId: string;
}

export interface CarryOver
{
    /** Rung the next session should start at, one below the last convergence. */
    startRung: Rung;
    garden: GardenState;
    /** Training blocks this participant has completed. */
    blocksCompleted: number;
}

function safeParse<T> (raw: string | null): T | null
{
    if (!raw)
    {
        return null;
    }

    try
    {
        return JSON.parse(raw) as T;
    }
    catch
    {
        // A corrupt entry must never take a session down: start fresh instead.
        return null;
    }
}

function storage (): Storage | null
{
    try
    {
        return window.localStorage;
    }
    catch
    {
        // Private browsing and file:// origins can throw on access.
        return null;
    }
}

export function readIdentity (): ParticipantIdentity | null
{
    return safeParse<ParticipantIdentity>(storage()?.getItem(IDENTITY_KEY) ?? null);
}

export function writeIdentity (identity: ParticipantIdentity): void
{
    storage()?.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function clearIdentity (): void
{
    storage()?.removeItem(IDENTITY_KEY);
}

export function readCarryOver (participantId: string): CarryOver | null
{
    return safeParse<CarryOver>(storage()?.getItem(KEY_PREFIX + participantId) ?? null);
}

export function writeCarryOver (participantId: string, carry: CarryOver): void
{
    storage()?.setItem(KEY_PREFIX + participantId, JSON.stringify(carry));
}

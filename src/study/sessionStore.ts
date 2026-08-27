/**
 * Participant identity and cross-block carry-over.
 *
 * Four things must survive between training blocks:
 *
 *   - the staircase track (D10-3, D15-3) — in full, not just its rung, because
 *     the next block of the *same sitting* resumes it rather than restarting it;
 *   - which sitting the last block belonged to, which is what tells those two
 *     cases apart;
 *   - the garden, and now also where each plant stands (D11-3, D16-3);
 *   - how many blocks are done, which is the roadmap's only input (D15-4).
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
import { GardenPlacements, isPlacementList, trimPlacements } from '../game/ui/gardenPlacement';
import { StaircaseState } from '../game/training/staircase';
import { ParticipantGroup, isGroup } from './protocol';

const KEY_PREFIX = 'voice-plant:participant:';
const IDENTITY_KEY = 'voice-plant:current';

/**
 * Bump when the record's meaning changes, not merely its shape.
 *
 * Records from an older version are read as "no record" rather than migrated.
 * That is safe because carry-over is progress, never data — every block's trials
 * are already on disk as CSV and JSON — and it is the only honest option for
 * the garden coordinates, which are absolute canvas pixels and become wrong if
 * the canvas is ever resized (D16 cost (b)).
 *
 * v2 (2026-08-13, D16): staircase state replaces the bare `startRung`; adds
 * sitting identity, participant group and garden placements.
 * v3 (2026-08-26, D19): stimulus inventory changes from legacy v1 R1–R8 to the
 * declared v1_plus_r9 R1–R9 composite. Old carry-over must not silently resume
 * inside a block using the new ladder.
 */
const RECORD_VERSION = 3;

export interface ParticipantIdentity
{
    participantId: string;
    group: ParticipantGroup;
    /** The sitting this appointment is, e.g. `sitting-2` (see protocol.ts). */
    sessionId: string;
}

export interface CarryOver
{
    version: number;
    group: ParticipantGroup;
    /** Sitting the last completed block belonged to (D15-3). */
    lastSittingId: string;
    /** The staircase exactly as the last block left it. */
    staircase: StaircaseState;
    garden: GardenState;
    placements: GardenPlacements;
    /** Training blocks this participant has completed — the roadmap's input. */
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
    const stored = safeParse<Partial<ParticipantIdentity>>(storage()?.getItem(IDENTITY_KEY) ?? null);

    if (!stored?.participantId || !isGroup(stored.group))
    {
        return null;
    }

    return {
        participantId: stored.participantId,
        group: stored.group,
        sessionId: stored.sessionId ?? ''
    };
}

export function writeIdentity (identity: ParticipantIdentity): void
{
    storage()?.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

/**
 * A participant's progress, or null if there is none this version understands.
 *
 * Validated field by field rather than trusted: this is hand-editable text in a
 * browser profile, and a half-written record that type-checks only because it
 * was cast would surface as a crash mid-block.
 */
export function readCarryOver (participantId: string): CarryOver | null
{
    const stored = safeParse<Partial<CarryOver>>(storage()?.getItem(KEY_PREFIX + participantId) ?? null);

    if (!stored
        || stored.version !== RECORD_VERSION
        || !isGroup(stored.group)
        || typeof stored.lastSittingId !== 'string'
        || typeof stored.blocksCompleted !== 'number'
        || !stored.staircase
        || !stored.garden)
    {
        return null;
    }

    const placements = stored.placements;

    return {
        version: RECORD_VERSION,
        group: stored.group,
        lastSittingId: stored.lastSittingId,
        staircase: stored.staircase,
        garden: stored.garden,
        placements: {
            man: isPlacementList(placements?.man) ? placements.man : [],
            woman: isPlacementList(placements?.woman) ? placements.woman : []
        },
        blocksCompleted: stored.blocksCompleted
    };
}

export function writeCarryOver (
    participantId: string,
    carry: Omit<CarryOver, 'version'>
): void
{
    const record: CarryOver = {
        ...carry,
        version: RECORD_VERSION,
        placements: {
            man: trimPlacements(carry.placements.man),
            woman: trimPlacements(carry.placements.woman)
        }
    };

    storage()?.setItem(KEY_PREFIX + participantId, JSON.stringify(record));
}

/**
 * Discard one participant's accumulated progress — staircase, garden and block
 * count — so their next block starts from scratch.
 *
 * Needed mainly for piloting: without it, repeated test runs under one id keep
 * inheriting (by design, D10-3 / D11-3), and there is no way to see a first
 * session again. Deliberately scoped to one participant, and deliberately does
 * **not** touch the remembered identity — during testing you want the id field
 * to stay filled in.
 *
 * Exported trial logs are files and are unaffected; nothing here is a record of
 * what a participant did.
 */
export function clearCarryOver (participantId: string): void
{
    storage()?.removeItem(KEY_PREFIX + participantId);
}

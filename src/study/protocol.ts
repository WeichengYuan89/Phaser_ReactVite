/**
 * Training dose and session structure — DECISIONS D15.
 *
 * Every number describing "how much training" lives here and nowhere else. It
 * replaces the `train-1 … train-5` list that used to sit inline in GameRoute:
 * that 5 was a placeholder with no basis in any document (D14 verified this),
 * and it silently defined the protocol for anyone reading the code.
 *
 * The terms are not interchangeable (D15-3):
 *
 *   trial    one raindrop
 *   block    60 trials, ~5.5 min — one roadmap node (D15-4)
 *   sitting  3 blocks with rests, ~16.5 min of play — one appointment
 *
 * The distinction is load-bearing for the staircase: blocks 2 and 3 of a sitting
 * resume at the current rung with no warm-up, while a new sitting drops one rung
 * and re-runs the 6-trial warm-up (which doubles as arrival calibration, after
 * Andersson 2024 §7.2 p.25).
 *
 * Dose is stratified because CI appointments are expensive and NH ones are not
 * (D15-1); it is small because the dose literature reports no dose-response
 * relationship in this line at all (D15 rationale (a)), so a larger protocol
 * would buy nothing it could be defended with.
 */

export type ParticipantGroup = 'CI' | 'NH';

export const GROUPS: readonly ParticipantGroup[] = ['CI', 'NH'];

/** D15-1. A sitting is three blocks, both arms. */
export const BLOCKS_PER_SITTING = 3;

/**
 * Sittings per arm (D15-1). The CI participant attends once — a second visit is
 * opportunistic, not part of the protocol — and NH participants three times
 * within a week.
 */
export const SITTINGS: Record<ParticipantGroup, number> = { CI: 1, NH: 3 };

export const GROUP_LABEL: Record<ParticipantGroup, string> = {
    CI: 'CI user (1 sitting)',
    NH: 'Normal hearing (3 sittings)'
};

/** Total training blocks in the protocol — the roadmap's path length (D15-4). */
export function totalBlocks (group: ParticipantGroup): number
{
    return SITTINGS[group] * BLOCKS_PER_SITTING;
}

/** 1-based sitting number a 0-based block index falls in. */
export function sittingOfBlock (blockIndex: number): number
{
    return Math.floor(blockIndex / BLOCKS_PER_SITTING) + 1;
}

/** 1-based position of a block within its sitting. */
export function blockWithinSitting (blockIndex: number): number
{
    return (blockIndex % BLOCKS_PER_SITTING) + 1;
}

/**
 * Stable identifier for a sitting, stored with the carry-over so the next block
 * can tell "same appointment, keep going" from "new appointment, re-calibrate".
 */
export function sittingId (sitting: number): string
{
    return `sitting-${sitting}`;
}

/** Sitting ids a participant of this group will attend, for the setup form. */
export function sittingIds (group: ParticipantGroup): string[]
{
    return Array.from({ length: SITTINGS[group] }, (_, index) => sittingId(index + 1));
}

export function isGroup (value: unknown): value is ParticipantGroup
{
    return value === 'CI' || value === 'NH';
}

export interface RoadmapNode
{
    /** 0-based block index across the whole protocol. */
    index: number;
    sitting: number;
    /** 1-based position within the sitting. */
    positionInSitting: number;
    state: 'done' | 'current' | 'locked';
}

/**
 * The roadmap, derived from one number: blocks completed.
 *
 * **Never from accuracy, and never from the staircase rung** (D16-2, D15-4). A
 * node lights up because a block was finished, which by D11-1 happens after a
 * fixed 60 trials regardless of how well it went. That is the whole point of
 * having this display alongside the garden: the garden tracks correct answers,
 * this tracks dose, and a participant who is struggling still watches the path
 * advance on schedule.
 *
 * Nothing here is read back into stimulus selection — see the P1 regression
 * assertion in `tools/checkTrainingLoop.mjs`.
 */
export function roadmap (group: ParticipantGroup, blocksCompleted: number): RoadmapNode[]
{
    const total = totalBlocks(group);
    const done = Math.max(0, Math.min(blocksCompleted, total));

    return Array.from({ length: total }, (_, index) => ({
        index,
        sitting: sittingOfBlock(index),
        positionInSitting: blockWithinSitting(index),
        state: index < done ? 'done' : (index === done ? 'current' : 'locked')
    }));
}

/** True once the participant has completed every block the protocol asks for. */
export function protocolComplete (group: ParticipantGroup, blocksCompleted: number): boolean
{
    return blocksCompleted >= totalBlocks(group);
}

#!/usr/bin/env python3
"""Generate the game's stimulus catalog from the validated manifest.

    ../stimuli/v1_plus_r9/manifest_validated.csv  ──►  src/game/data/stimulusCatalog.ts

The CSV stays the single source of truth (CLAUDE.md "Where things live"); the
generated TypeScript is committed so the app builds without Python present.
Re-run this whenever the stimuli are regenerated.

Spec: ../drafts/02-integration/INTEGRATION_DESIGN.md §5 (DECISIONS D9-3).

The generated file carries **data only**. Difficulty ordering is runtime policy
and lives in game/src/game/data/difficulty.ts (DECISIONS D10) — see --check
below for why this script nevertheless knows about it.

Usage:
    cd game
    npm run catalog          # write the catalog
    npm run catalog:check    # verify only, write nothing
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from collections import defaultdict
from pathlib import Path
from statistics import fmean

GAME_ROOT = Path(__file__).resolve().parent.parent
THESIS_ROOT = GAME_ROOT.parent
STIMULI_ROOT = THESIS_ROOT / "stimuli"
MANIFEST = STIMULI_ROOT / "v1_plus_r9" / "manifest_validated.csv"
OUT = GAME_ROOT / "src" / "game" / "data" / "stimulusCatalog.ts"

# --- composite invariants (STIMULUS_DESIGN §7, DECISIONS D19) ----------------
STIMULUS_VERSION = "v1_plus_r9"
N_MANIFEST_ROWS = 664
N_PLAYABLE_STIMULI = 640
N_TRAIN_STIMULI = 540
N_TEST_STIMULI = 100
N_CONTROLS = 24
N_CELLS = 27
N_ASSESSMENT_CELLS = 25
N_TRAIN_PER_CELL = 20  # 20 carrier sentences (D5)
N_TEST_PER_CELL = 4  # 4 CVC words (D4)

CELL_TAG = re.compile(r"(f\d+_v[a-z]*\d+)$")

# --- cross-check only; the runtime source of truth is difficulty.ts ----------
# Fuller (2014) CI weights, as adopted by DECISIONS D10 / TRAINING_LOOP §3.
BETA_F0, BETA_VTL = 6.88, 0.59
VTL_NORM_ST = 3.6  # ΔVTL → vtl_n (DECISIONS D2 / D6)
# The ladder as published in TRAINING_LOOP.md §3, easiest (R1) → hardest (R9).
# If regenerated stimuli reorder this, the doc and difficulty.ts must be revised
# together — hence a hard failure rather than a warning.
EXPECTED_LADDER = [
    ("f110_vp28", "f220_vm28"),
    ("f110_vp14", "f220_vm14"),
    ("f110_v00", "f220_v00"),
    ("f131_vp28", "f185_vm28"),
    ("f131_vp14", "f185_vm14"),
    ("f131_v00", "f185_v00"),
    ("f156_vp28", "f156_vm28"),
    ("f156_vp14", "f156_vm14"),
    ("r09_man", "r09_woman"),
]


class CheckFailed(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


def answer_for(f0_n: float, vtl_n: float) -> str | None:
    """'man' | 'woman' | None, from the sign of the two cues.

    Convention (manifest): negative = female on both axes. Cells whose cues
    point opposite ways (`conflict`) and the centre cell have no ground truth —
    they get None, never False (INTEGRATION_DESIGN §8).
    """
    if f0_n <= 0 and vtl_n <= 0 and (f0_n < 0 or vtl_n < 0):
        return "woman"
    if f0_n >= 0 and vtl_n >= 0 and (f0_n > 0 or vtl_n > 0):
        return "man"
    return None


def read_manifest(path: Path) -> tuple[list[dict], str]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()[:16]
    rows = list(csv.DictReader(raw.decode("utf-8").splitlines()))
    return rows, digest


def cell_id_for(row: dict) -> str:
    """Legacy cells keep their filename tag; the non-grid R9 pair is explicit."""
    rung = row.get("rung", "").strip()
    answer = row.get("answer", "").strip()

    if rung in {"9", "9.0"}:
        require(answer in {"man", "woman"}, f"R9 row has invalid answer: {row['stimulus_id']}")
        return f"r09_{answer}"

    tag = CELL_TAG.search(row["stimulus_id"])
    require(tag is not None, f"cannot parse a cell tag from {row['stimulus_id']}")
    return tag.group(1)


def runtime_path(row: dict, manifest: Path) -> str:
    """Resolve a composite-relative path, then express it under /stimuli/."""
    resolved = (manifest.parent / row["rel_path"]).resolve()

    try:
        relative = resolved.relative_to(STIMULI_ROOT.resolve())
    except ValueError as error:
        raise CheckFailed(f"asset escapes the stimuli root: {row['rel_path']}") from error

    require(resolved.is_file(), f"asset does not exist: {row['rel_path']}")
    return relative.as_posix()


def build(rows: list[dict], manifest: Path) -> tuple[list[dict], list[dict]]:
    stimuli: list[dict] = []
    by_cell: dict[str, dict] = {}
    realized: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    require(len(rows) == N_MANIFEST_ROWS, f"expected {N_MANIFEST_ROWS} manifest rows, found {len(rows)}")
    set_counts = defaultdict(int)
    origin_counts = defaultdict(int)

    for row in rows:
        set_counts[row["set"]] += 1
        origin_counts[row["asset_origin"]] += 1
        flags = row["flags"].strip()
        require(not flags, f"{row['stimulus_id']} carries validation flags: {flags}")
        require(
            row["stimulus_version"] == STIMULUS_VERSION,
            f"{row['stimulus_id']} has version {row['stimulus_version']!r}, expected {STIMULUS_VERSION!r}",
        )

        # Identity controls belong to the composite provenance inventory, not to
        # either runtime activity. They are intentionally absent from STIMULI.
        if row["set"] == "control":
            require(row["asset_origin"] == "legacy_v1", "a control is not from frozen legacy v1")
            runtime_path(row, manifest)  # still require the referenced WAV to resolve
            continue

        require(row["set"] in {"train", "test"}, f"unknown set {row['set']!r}")
        require(row["asset_origin"] in {"legacy_v1", "v1_plus_r9"}, "unknown asset origin")

        cell_id = cell_id_for(row)

        f0_n = float(row["f0_n"])
        vtl_n = float(row["vtl_n"])
        derived_answer = answer_for(f0_n, vtl_n)
        explicit_answer = row.get("answer", "").strip() or None
        require(
            explicit_answer is None or explicit_answer == derived_answer,
            f"{row['stimulus_id']} answer disagrees with its cue signs",
        )
        cell = {
            "id": cell_id,
            "f0TargetHz": float(row["F0_target_Hz"]),
            "dvtlNominalSt": float(row["dVTL_st"]),
            "f0n": f0_n,
            "vtlNominalN": vtl_n,
            "region": row["region"],
            "answer": derived_answer,
        }
        known = by_cell.setdefault(cell_id, cell)
        require(known == cell, f"cell {cell_id} has inconsistent grid values across rows")

        realized[cell_id][row["set"]].append(float(row["dVTL_realized_st"]))
        stimuli.append(
            {
                "id": row["stimulus_id"],
                "path": runtime_path(row, manifest),
                "set": row["set"],
                "token": row["token"],
                "cellId": cell_id,
                "stimulusVersion": row["stimulus_version"],
                "assetOrigin": row["asset_origin"],
                "durationS": round(float(row["duration_s"]), 3),
                "f0RealizedHz": round(float(row["F0_realized_Hz"]), 2),
                "dvtlRealizedSt": round(float(row["dVTL_realized_st"]), 3),
            }
        )

    require(
        dict(set_counts) == {"train": N_TRAIN_STIMULI, "test": N_TEST_STIMULI, "control": N_CONTROLS},
        f"wrong composite set counts: {dict(set_counts)}",
    )
    require(
        dict(origin_counts) == {"legacy_v1": 624, "v1_plus_r9": 40},
        f"wrong asset-origin counts: {dict(origin_counts)}",
    )
    require(len(stimuli) == N_PLAYABLE_STIMULI, f"expected {N_PLAYABLE_STIMULI} playable stimuli")

    for cell_id, cell in by_cell.items():
        is_r9 = cell_id in {"r09_man", "r09_woman"}
        for name, key, expected in (
            ("Train", "train", N_TRAIN_PER_CELL),
            ("Test", "test", 0 if is_r9 else N_TEST_PER_CELL),
        ):
            values = realized[cell_id][key]
            require(
                len(values) == expected,
                f"cell {cell_id} has {len(values)} {key} stimuli, expected {expected}",
            )
            cell[f"n{name}"] = len(values)
            cell[f"dvtlRealizedSt{name}"] = round(fmean(values), 3) if values else None

    require(len(by_cell) == N_CELLS, f"expected {N_CELLS} cells, found {len(by_cell)}")
    require(
        sum(cell["nTest"] > 0 for cell in by_cell.values()) == N_ASSESSMENT_CELLS,
        f"expected {N_ASSESSMENT_CELLS} assessment cells",
    )
    require(
        sum(cell["nTrain"] > 0 for cell in by_cell.values()) == N_CELLS,
        f"expected all {N_CELLS} cells to have training stimuli",
    )

    # Grid order: F0 descending (woman-most first), ΔVTL ascending — the reading
    # order of fig_A, so the generated table can be eyeballed against the figure.
    cells = sorted(
        by_cell.values(), key=lambda c: (-c["f0TargetHz"], c["dvtlNominalSt"])
    )
    stimuli.sort(key=lambda s: s["id"])
    return stimuli, cells


def derive_ladder(cells: list[dict]) -> list[tuple[tuple[str, str], float]]:
    """Re-derive the D10 ladder as a cross-check on difficulty.ts.

    Trainable cells = legacy 16 + the D19 R9 pair = 18, paired by mirror symmetry
    (f0_n, vtl_n) ↔ (−f0_n, −vtl_n); a rung's difficulty is the mean |E| of its
    two cells; rungs sort by descending E (large E = strong evidence = easy).
    """
    trainable = [c for c in cells if c["answer"] is not None]
    require(len(trainable) == 18, f"expected 18 trainable cells, found {len(trainable)}")

    def evidence(cell: dict) -> float:
        vtl_n = cell["dvtlRealizedStTrain"] / VTL_NORM_ST
        return BETA_F0 * cell["f0n"] + BETA_VTL * vtl_n

    rungs: dict[tuple[str, str], float] = {}
    for cell in trainable:
        mirror = next(
            (
                c
                for c in trainable
                if c["f0n"] == -cell["f0n"] and c["vtlNominalN"] == -cell["vtlNominalN"]
            ),
            None,
        )
        require(mirror is not None, f"cell {cell['id']} has no mirror partner")
        man, woman = sorted([cell, mirror], key=lambda c: c["answer"] != "man")
        rungs[(man["id"], woman["id"])] = (abs(evidence(man)) + abs(evidence(woman))) / 2

    require(len(rungs) == 9, f"expected 9 rungs, found {len(rungs)}")
    ordered = sorted(rungs.items(), key=lambda kv: -kv[1])
    derived = [pair for pair, _ in ordered]
    require(
        derived == EXPECTED_LADDER,
        "the derived ladder no longer matches TRAINING_LOOP §3 —\n"
        f"  derived:  {derived}\n"
        f"  expected: {EXPECTED_LADDER}\n"
        "  update TRAINING_LOOP.md §3, difficulty.ts and this constant together.",
    )
    return ordered


def ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render(stimuli: list[dict], cells: list[dict], digest: str, source_rows: int) -> str:
    def num(value: float | None) -> str:
        if value is None:
            return "null"
        return f"{value + 0.0:.10g}"  # + 0.0 normalises -0.0 away; keeps R9 targets exact

    cell_lines = []
    for c in cells:
        answer = ts_string(c["answer"]) if c["answer"] else "null"
        cell_lines.append(
            "    { "
            f"id: {ts_string(c['id'])}, "
            f"f0TargetHz: {num(c['f0TargetHz'])}, "
            f"dvtlNominalSt: {num(c['dvtlNominalSt'])}, "
            f"f0n: {num(c['f0n'])}, "
            f"vtlNominalN: {num(c['vtlNominalN'])}, "
            f"dvtlRealizedStTrain: {num(c['dvtlRealizedStTrain'])}, "
            f"dvtlRealizedStTest: {num(c['dvtlRealizedStTest'])}, "
            f"region: {ts_string(c['region'])}, "
            f"answer: {answer}, "
            f"nTrain: {c['nTrain']}, "
            f"nTest: {c['nTest']} "
            "}"
        )

    stimulus_lines = []
    for s in stimuli:
        stimulus_lines.append(
            "    { "
            f"id: {ts_string(s['id'])}, "
            f"path: {ts_string(s['path'])}, "
            f"set: {ts_string(s['set'])}, "
            f"token: {ts_string(s['token'])}, "
            f"cellId: {ts_string(s['cellId'])}, "
            f"stimulusVersion: {ts_string(s['stimulusVersion'])}, "
            f"assetOrigin: {ts_string(s['assetOrigin'])}, "
            f"durationS: {num(s['durationS'])}, "
            f"f0RealizedHz: {num(s['f0RealizedHz'])}, "
            f"dvtlRealizedSt: {num(s['dvtlRealizedSt'])} "
            "}"
        )

    regions = sorted({c["region"] for c in cells})
    region_union = " | ".join(ts_string(r) for r in regions)
    max_duration = max(s["durationS"] for s in stimuli)
    cell_table = ",\n".join(cell_lines)
    stimulus_table = ",\n".join(stimulus_lines)
    train_tokens = ", ".join(
        ts_string(token)
        for token in sorted({s["token"] for s in stimuli if s["set"] == "train"})
    )
    test_tokens = ", ".join(
        ts_string(token)
        for token in sorted({s["token"] for s in stimuli if s["set"] == "test"})
    )

    return f"""// GENERATED FILE — do not edit by hand.
//
// Source:      ../stimuli/v1_plus_r9/manifest_validated.csv (sha256:{digest}, {source_rows} rows; {len(stimuli)} playable)
// Generator:   tools/build_catalog.py
// Regenerate:  npm run catalog
// Spec:        ../drafts/02-integration/INTEGRATION_DESIGN.md §5 (DECISIONS D9-3)
//
// The manifest is the single source of truth for every acoustic value here; the
// audio itself is never hand-edited (CLAUDE.md). This file is data only —
// difficulty ordering is policy and lives in ./difficulty.ts (DECISIONS D10).

export const STIMULUS_VERSION = {ts_string(STIMULUS_VERSION)} as const;
export type StimulusVersion = typeof STIMULUS_VERSION;
export type StimulusSet = 'train' | 'test';
export type AssetOrigin = 'legacy_v1' | 'v1_plus_r9';
export type Region = {region_union};

/** 'man' | 'woman', or null where the grid defines no ground truth. */
export type Answer = 'man' | 'woman' | null;

/** A legacy grid tag (e.g. f110_vp28), or the explicit D19 r09_man/r09_woman id. */
export type CellId = string;

/**
 * One of the 25 assessment-grid points, or one of the two training-only R9 points.
 *
 * Sign convention, inherited from the manifest: **negative = female** on both
 * axes. `answer` is null for the 8 `conflict` cells and the centre cell, which
 * have no stimulus-intrinsic correct response — null, never false
 * (INTEGRATION_DESIGN §8).
 */
export interface Cell
{{
    id: CellId;
    /** Nominal F0 target in Hz; R9 uses 154.3196 / 157.6987. */
    f0TargetHz: number;
    /** Nominal ΔVTL in semitones as designed. */
    dvtlNominalSt: number;
    /** Boundary-centred normalised F0 (D2 addendum); -0.5 (woman) .. +0.5 (man). */
    f0n: number;
    /** Nominal ΔVTL / 3.6. Prefer the realized values below for anything quantitative. */
    vtlNominalN: number;
    /** Mean *realized* ΔVTL over the cell's train stimuli — the D6 regressor. */
    dvtlRealizedStTrain: number;
    /** Mean *realized* ΔVTL over test stimuli; null for the training-only R9 pair. */
    dvtlRealizedStTest: number | null;
    region: Region;
    answer: Answer;
    nTrain: number;
    nTest: number;
}}

/** One rendered WAV. `id` keys back to manifest_validated.csv for Phase 3 analysis. */
export interface Stimulus
{{
    id: string;
    /** Path relative to the stimulus root; the loader supplies the base (INTEGRATION_DESIGN §4.3). */
    path: string;
    set: StimulusSet;
    /** Carrier sentence id (s01..s20) for train, CVC word for test. */
    token: string;
    cellId: CellId;
    stimulusVersion: StimulusVersion;
    assetOrigin: AssetOrigin;
    /** Measured duration in seconds — load-bearing: sizes the fall (INTEGRATION_DESIGN §7 P3). */
    durationS: number;
    f0RealizedHz: number;
    dvtlRealizedSt: number;
}}

export const CELLS: readonly Cell[] = [
{cell_table}
];

export const STIMULI: readonly Stimulus[] = [
{stimulus_table}
];

/** Longest stimulus in the set, in seconds — the floor for any fall-duration rule. */
export const MAX_DURATION_S = {num(max_duration)};

const CELL_INDEX: ReadonlyMap<CellId, Cell> = new Map(CELLS.map((cell) => [cell.id, cell]));

const STIMULI_INDEX: ReadonlyMap<string, readonly Stimulus[]> = (() =>
{{
    const index = new Map<string, Stimulus[]>();

    for (const stimulus of STIMULI)
    {{
        const key = `${{stimulus.cellId}}:${{stimulus.set}}`;
        const bucket = index.get(key);

        if (bucket)
        {{
            bucket.push(stimulus);
        }}
        else
        {{
            index.set(key, [stimulus]);
        }}
    }}

    return index;
}})();

export function cellById (id: CellId): Cell
{{
    const cell = CELL_INDEX.get(id);

    if (!cell)
    {{
        throw new Error(`Unknown cell: ${{id}}`);
    }}

    return cell;
}}

/** The stimuli at one cell: 20 train sentences; legacy grid cells also have 4 test words. */
export function stimuliFor (cellId: CellId, set: StimulusSet): readonly Stimulus[]
{{
    return STIMULI_INDEX.get(`${{cellId}}:${{set}}`) ?? [];
}}

/** The one stimulus at (cell, set, token), e.g. the cell crossed with the dealt sentence. */
export function stimulusFor (cellId: CellId, set: StimulusSet, token: string): Stimulus
{{
    const stimulus = stimuliFor(cellId, set).find((candidate) => candidate.token === token);

    if (!stimulus)
    {{
        throw new Error(`No ${{set}} stimulus for cell ${{cellId}} and token ${{token}}`);
    }}

    return stimulus;
}}

/** Carrier sentence ids, for the dealer's shuffle-without-replacement (TRAINING_LOOP §5). */
export const TRAIN_TOKENS: readonly string[] = [
    {train_tokens}
];

/** Test words (D4). */
export const TEST_TOKENS: readonly string[] = [
    {test_tokens}
];
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the manifest and the committed catalog, write nothing",
    )
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    rows, digest = read_manifest(args.manifest)

    try:
        stimuli, cells = build(rows, args.manifest.resolve())
        ladder = derive_ladder(cells)
    except CheckFailed as error:
        print(f"FAIL  {error}", file=sys.stderr)
        return 1

    rendered = render(stimuli, cells, digest, len(rows))

    print(f"manifest  {args.manifest.relative_to(THESIS_ROOT)}  sha256:{digest}")
    print(
        f"          {len(rows)} inventory rows, {len(stimuli)} playable stimuli, "
        f"{len(cells)} train cells / {N_ASSESSMENT_CELLS} assessment cells, 0 flagged"
    )
    print("ladder    (cross-check against TRAINING_LOOP §3; runtime truth is difficulty.ts)")
    for rung, ((man, woman), e) in enumerate(ladder, start=1):
        print(f"  R{rung}  E={e:5.2f}   man={man:<11} woman={woman}")

    if args.check:
        if not args.out.exists():
            print(f"FAIL  {args.out.relative_to(THESIS_ROOT)} does not exist", file=sys.stderr)
            return 1
        if args.out.read_text() != rendered:
            print(
                f"FAIL  {args.out.relative_to(THESIS_ROOT)} is stale — run npm run catalog",
                file=sys.stderr,
            )
            return 1
        print(f"ok        {args.out.relative_to(THESIS_ROOT)} is up to date")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered)
    print(f"wrote     {args.out.relative_to(THESIS_ROOT)}  ({len(rendered.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

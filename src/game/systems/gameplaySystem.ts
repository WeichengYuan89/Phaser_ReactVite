import { DifficultyClass, VoiceClip, VoiceGender } from '../utils/audioCatalog';

export type PlantId = 'lupinus' | 'mushroom';
export type DifficultyLevel = 1 | 2 | 3;

export interface DifficultyState
{
    difficultyLevel: DifficultyLevel;
    levelCorrectCount: number;
    level2WrongStreak: number;
}

export interface LandingResult
{
    wateredPlant: PlantId;
    correct: boolean;
    delta: number;
}

export function pickTargetPlantByHits (
    lupinusHits: number,
    mushroomHits: number,
    randomValue: number = Math.random()
): PlantId
{
    if (lupinusHits === mushroomHits)
    {
        return randomValue < 0.5 ? 'lupinus' : 'mushroom';
    }

    return lupinusHits < mushroomHits ? 'lupinus' : 'mushroom';
}

export function getAllowedDifficulties (difficultyLevel: DifficultyLevel): DifficultyClass[]
{
    if (difficultyLevel === 1)
    {
        return ['D1', 'D2'];
    }

    if (difficultyLevel === 2)
    {
        return ['D3'];
    }

    return ['D1', 'D2', 'D3'];
}

export function pickVoiceClipForTarget (
    targetPlant: PlantId,
    difficultyLevel: DifficultyLevel,
    clips: VoiceClip[],
    randomValue: number = Math.random()
): VoiceClip
{
    const requiredGender: VoiceGender = targetPlant === 'lupinus' ? 'M' : 'F';
    const allowedDifficulties = getAllowedDifficulties(difficultyLevel);

    const candidates = clips.filter((clip) => (
        allowedDifficulties.includes(clip.difficulty) && clip.gender === requiredGender
    ));

    if (candidates.length > 0)
    {
        const index = Math.floor(randomValue * candidates.length);
        return candidates[index];
    }

    return clips.find((clip) => clip.gender === requiredGender) ?? clips[0];
}

export function resolveLandingResult (
    landedX: number,
    width: number,
    targetPlant: PlantId,
    drops: number
): LandingResult
{
    const wateredPlant: PlantId = landedX < (width / 2) ? 'lupinus' : 'mushroom';
    const correct = wateredPlant === targetPlant;
    const delta = correct ? (10 * drops) : (-5 * drops);

    return {
        wateredPlant,
        correct,
        delta
    };
}

export function updateDifficultyStateByResult (
    state: DifficultyState,
    correct: boolean
): { state: DifficultyState; transitionMessage: string | null }
{
    if (state.difficultyLevel === 1)
    {
        if (!correct)
        {
            return { state, transitionMessage: null };
        }

        const levelCorrectCount = state.levelCorrectCount + 1;

        if (levelCorrectCount >= 3)
        {
            return {
                state: {
                    difficultyLevel: 2,
                    levelCorrectCount: 0,
                    level2WrongStreak: 0
                },
                transitionMessage: 'Difficulty up: Level 2 (D3 only)'
            };
        }

        return {
            state: {
                ...state,
                levelCorrectCount
            },
            transitionMessage: null
        };
    }

    if (state.difficultyLevel === 2)
    {
        if (correct)
        {
            const levelCorrectCount = state.levelCorrectCount + 1;

            if (levelCorrectCount >= 3)
            {
                return {
                    state: {
                        difficultyLevel: 3,
                        levelCorrectCount: 0,
                        level2WrongStreak: 0
                    },
                    transitionMessage: 'Difficulty up: Level 3 (D1/D2/D3 mixed)'
                };
            }

            return {
                state: {
                    ...state,
                    levelCorrectCount,
                    level2WrongStreak: 0
                },
                transitionMessage: null
            };
        }

        const level2WrongStreak = state.level2WrongStreak + 1;

        if (level2WrongStreak >= 2)
        {
            return {
                state: {
                    difficultyLevel: 1,
                    levelCorrectCount: 0,
                    level2WrongStreak: 0
                },
                transitionMessage: 'Difficulty down: Back to Level 1 (D1/D2)'
            };
        }

        return {
            state: {
                ...state,
                level2WrongStreak
            },
            transitionMessage: null
        };
    }

    return { state, transitionMessage: null };
}

export type DifficultyClass = 'D1' | 'D2' | 'D3';
export type VoiceGender = 'F' | 'M';

export interface VoiceClip
{
    file: string;
    key: string;
    id: string;
    difficulty: DifficultyClass;
    gender: VoiceGender;
}

const AUDIO_FILES = [
    'S01_D1_F_PP+100p_VTL-20p.opus',
    'S01_D1_M_PP-100p_VTL+20p.opus',
    'S02_D2_F_PP+100p_VTL-10p.opus',
    'S02_D2_F_PP+33p_VTL-20p.opus',
    'S02_D2_M_PP-100p_VTL+10p.opus',
    'S02_D2_M_PP-33p_VTL+20p.opus',
    'S03_D3_F_PP+33p_VTL-10p.opus',
    'S03_D3_M_PP-33p_VTL+10p.opus',
    'S04_D3_F_PP+100p_VTL0.opus',
    'S04_D3_M_PP-100p_VTL0.opus',
    'S05_D3_F_PP0_VTL-20p.opus',
    'S05_D3_M_PP0_VTL+20p.opus'
] as const;

function toVoiceClip (file: string): VoiceClip
{
    const id = file.replace(/\.[^/.]+$/, '');
    const match = id.match(/_D([123])_([FM])_/);

    if (!match)
    {
        throw new Error(`Invalid voice file name: ${file}`);
    }

    const difficulty = `D${match[1]}` as DifficultyClass;
    const gender = match[2] as VoiceGender;

    return {
        file,
        id,
        key: `voice:${id}`,
        difficulty,
        gender
    };
}

export const VOICE_CLIPS: VoiceClip[] = AUDIO_FILES.map(toVoiceClip);

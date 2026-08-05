/**
 * How the pre/post test *renders* the response options.
 *
 * The mapping itself — left = Lupinus = "man", right = Cactus = "woman" — is not
 * restated here; it comes from `shared/sides.ts`, which the game uses too, so
 * the two activities cannot drift apart (INTEGRATION_DESIGN §3.2, D9-1).
 *
 * The icons are cut from the game's own spritesheets rather than redrawn, so
 * the two activities are pixel-identical.
 */

import { PLANT_FOR_SIDE, PLANT_LABEL, Side } from '../shared/sides';

export type ResponseSide = 'left' | 'right';

export interface ResponseOption
{
    side: ResponseSide;
    /** The answer this side records, matching Cell.answer in the catalog. */
    answer: Side;
    label: string;
    /** The plant this side waters in the game, for the icon. */
    plant: string;
    keys: readonly string[];
    icon: SpriteFrame;
}

/** One frame of a Phaser multiatlas, for rendering as a CSS sprite. */
export interface SpriteFrame
{
    sheet: string;
    sheetWidth: number;
    sheetHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Integer upscale; these are tiny pixel-art frames (13x15 and 38x43). */
    scale: number;
}

/** `8flowers by Brysiaa-4.png`, the adult stage, from Sprite/Flower/flowersheet.json. */
const LUPINUS_ADULT: SpriteFrame = {
    sheet: '/assets/Sprite/Flower/flowersheet.png',
    sheetWidth: 38,
    sheetHeight: 15,
    x: 25,
    y: 0,
    width: 13,
    height: 15,
    scale: 8
};

/** `Cactus_Sprite_4.png`, the adult stage, from Sprite/cactus/cactussheet.json. */
const CACTUS_ADULT: SpriteFrame = {
    sheet: '/assets/Sprite/cactus/cactussheet.png',
    sheetWidth: 57,
    sheetHeight: 121,
    x: 1,
    y: 1,
    width: 38,
    height: 43,
    scale: 3
};

export const RESPONSE_OPTIONS: readonly ResponseOption[] = [
    {
        side: 'left',
        answer: 'man',
        label: 'Man',
        plant: PLANT_LABEL[PLANT_FOR_SIDE.man],
        keys: ['f', 'F', 'ArrowLeft'],
        icon: LUPINUS_ADULT
    },
    {
        side: 'right',
        answer: 'woman',
        label: 'Woman',
        plant: PLANT_LABEL[PLANT_FOR_SIDE.woman],
        keys: ['j', 'J', 'ArrowRight'],
        icon: CACTUS_ADULT
    }
];

export function optionForKey (key: string): ResponseOption | undefined
{
    return RESPONSE_OPTIONS.find((option) => option.keys.includes(key));
}

/** Inline styles that crop one atlas frame and scale it up without blurring. */
export function spriteStyle (frame: SpriteFrame): Record<string, string>
{
    return {
        width: `${frame.width * frame.scale}px`,
        height: `${frame.height * frame.scale}px`,
        backgroundImage: `url(${frame.sheet})`,
        backgroundPosition: `-${frame.x * frame.scale}px -${frame.y * frame.scale}px`,
        backgroundSize: `${frame.sheetWidth * frame.scale}px ${frame.sheetHeight * frame.scale}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated'
    };
}

import { GameObjects, Scene } from 'phaser';

import { VoiceClip } from '../utils/audioCatalog';

const FIRST_HOLD_FILL = 0.28;
const LOG_DECAY = 1.4;
const WAVE_AMPLITUDE = 3;
const WAVE_FREQUENCY = 0.004;
const WAVE_LENGTH = 0.06;
const WATER_FILL_COLOR = 0x38bdf8;
const WATER_FILL_ALPHA = 0.92;
const WATER_HIGHLIGHT_COLOR = 0xbae6fd;
const SPLASH_TEXTURE = 'rain-particle';

export interface WaterBucketConfig
{
    x: number;
    bottomY: number;
    width: number;
    height: number;
}

export interface WaterBucket
{
    holdCluster: (
        cluster: GameObjects.Container,
        voiceClip: VoiceClip,
        onAbsorbed: () => void
    ) => void;
    getHeldClips: () => VoiceClip[];
    destroy: () => void;
}

export function createWaterBucket (scene: Scene, config: WaterBucketConfig): WaterBucket
{
    const heldClips: VoiceClip[] = [];

    const halfW = config.width / 2;
    const wallThickness = 14;
    const innerLeft = config.x - halfW;
    const innerRight = config.x + halfW;
    const innerTop = config.bottomY - config.height;
    const innerBottom = config.bottomY;

    const bucketVisual = drawBucketVisual(scene, config, wallThickness);

    const waterGfx = scene.add.graphics();
    waterGfx.setDepth(bucketVisual.depth + 1);

    const maskShape = scene.make.graphics({});
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(innerLeft, innerTop, config.width, config.height);
    waterGfx.setMask(maskShape.createGeometryMask());

    let fillRatio = 0;
    const splashDrops: GameObjects.Image[] = [];

    function getSurfaceY (): number
    {
        return innerBottom - (config.height * fillRatio);
    }

    function renderWater (time: number)
    {
        waterGfx.clear();

        if (fillRatio <= 0)
        {
            return;
        }

        const surfaceY = getSurfaceY();
        const samples = 18;
        const points: Phaser.Types.Math.Vector2Like[] = [];

        for (let i = 0; i <= samples; i++)
        {
            const t = i / samples;
            const x = innerLeft + t * config.width;
            const y = surfaceY + Math.sin(time * WAVE_FREQUENCY + x * WAVE_LENGTH) * WAVE_AMPLITUDE;
            points.push({ x, y });
        }

        points.push({ x: innerRight, y: innerBottom });
        points.push({ x: innerLeft, y: innerBottom });

        waterGfx.fillStyle(WATER_FILL_COLOR, WATER_FILL_ALPHA);
        waterGfx.fillPoints(points, true);

        waterGfx.lineStyle(2, WATER_HIGHLIGHT_COLOR, 0.55);
        waterGfx.beginPath();

        for (let i = 0; i <= samples; i++)
        {
            const p = points[i];

            if (i === 0)
            {
                waterGfx.moveTo(p.x, p.y);
            }
            else
            {
                waterGfx.lineTo(p.x, p.y);
            }
        }

        waterGfx.strokePath();
    }

    const updateHandler = () => renderWater(scene.time.now);
    scene.events.on(Phaser.Scenes.Events.UPDATE, updateHandler);

    function spawnSplash (amount: number)
    {
        const surfaceY = getSurfaceY();
        const dropCount = Phaser.Math.Clamp(Math.round(amount * 30), 4, 9);

        for (let i = 0; i < dropCount; i++)
        {
            const startX = config.x + Phaser.Math.Between(-10, 10);
            const drop = scene.add.image(startX, surfaceY - 2, SPLASH_TEXTURE);
            drop.setDisplaySize(7, 7);
            drop.setTint(WATER_FILL_COLOR);
            drop.setDepth(bucketVisual.depth + 2);

            const dx = Phaser.Math.FloatBetween(-22, 22);
            const peakDy = Phaser.Math.FloatBetween(22, 38);

            scene.tweens.add({
                targets: drop,
                x: drop.x + dx,
                y: drop.y - peakDy,
                duration: 220,
                ease: 'Sine.easeOut',
                onComplete: () => {
                    scene.tweens.add({
                        targets: drop,
                        y: drop.y + peakDy + 4,
                        alpha: 0,
                        duration: 220,
                        ease: 'Sine.easeIn',
                        onComplete: () => {
                            const idx = splashDrops.indexOf(drop);

                            if (idx >= 0)
                            {
                                splashDrops.splice(idx, 1);
                            }

                            drop.destroy();
                        }
                    });
                }
            });

            splashDrops.push(drop);
        }
    }

    function holdCluster (
        cluster: GameObjects.Container,
        voiceClip: VoiceClip,
        onAbsorbed: () => void
    )
    {
        const targetX = config.x;
        const targetY = getSurfaceY() - 4;

        scene.tweens.add({
            targets: cluster,
            x: targetX,
            y: targetY,
            scaleX: 0.35,
            scaleY: 0.35,
            alpha: 0.5,
            duration: 380,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                heldClips.push(voiceClip);
                const holdIndex = heldClips.length - 1;
                const add = FIRST_HOLD_FILL / (1 + Math.log(holdIndex + 1) * LOG_DECAY);
                const newFill = Math.min(1, fillRatio + add);

                spawnSplash(add);

                const holder = { v: fillRatio };
                scene.tweens.add({
                    targets: holder,
                    v: newFill,
                    duration: 520,
                    ease: 'Cubic.easeOut',
                    onUpdate: () => { fillRatio = holder.v; }
                });

                onAbsorbed();
            }
        });
    }

    return {
        holdCluster,
        getHeldClips: () => heldClips.slice(),
        destroy: () => {
            scene.events.off(Phaser.Scenes.Events.UPDATE, updateHandler);
            waterGfx.clearMask(true);
            waterGfx.destroy();
            bucketVisual.destroy();

            for (const drop of splashDrops)
            {
                drop.destroy();
            }

            splashDrops.length = 0;
        }
    };
}

function drawBucketVisual (scene: Scene, config: WaterBucketConfig, wallThickness: number): GameObjects.Graphics
{
    const halfW = config.width / 2;
    const top = config.bottomY - config.height;
    const bottom = config.bottomY;
    const left = config.x - halfW;
    const right = config.x + halfW;

    const g = scene.add.graphics();

    g.fillStyle(0x0c2231, 1);
    g.fillRect(left, top, config.width, config.height);

    g.fillStyle(0x4a5563, 1);
    g.fillRect(left - wallThickness, top - 4, wallThickness, config.height + 8);
    g.fillRect(right, top - 4, wallThickness, config.height + 8);
    g.fillRect(left - wallThickness, bottom, config.width + wallThickness * 2, wallThickness);

    g.fillStyle(0x6b7785, 1);
    g.fillRect(left - wallThickness - 4, top - 10, config.width + wallThickness * 2 + 8, 6);

    g.fillStyle(0x9aa4b2, 0.7);
    g.fillRect(left - wallThickness - 4, top - 10, 6, 6);
    g.fillRect(right + wallThickness - 2, top - 10, 6, 6);

    g.lineStyle(1, 0x111827, 0.6);
    g.strokeRect(left, top - 4, config.width, config.height + 4);

    return g;
}

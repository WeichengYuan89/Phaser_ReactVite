import { GameObjects, Physics, Scene } from 'phaser';

import { VoiceClip } from '../utils/audioCatalog';

const WATER_PARTICLE_TEXTURE = 'rain-particle';
const PARTICLE_RADIUS = 4;
const FIRST_HOLD_PARTICLES = 30;
const LOG_DECAY = 1.4;

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
    const particles: Physics.Matter.Image[] = [];

    const halfW = config.width / 2;
    const wallThickness = 14;
    const innerLeft = config.x - halfW;
    const innerRight = config.x + halfW;
    const innerTop = config.bottomY - config.height;
    const innerBottom = config.bottomY;
    const wallCenterY = (innerTop + innerBottom) / 2;

    const visual = drawBucketVisual(scene, config, wallThickness);

    scene.matter.add.rectangle(
        innerLeft - wallThickness / 2,
        wallCenterY,
        wallThickness,
        config.height + wallThickness,
        { isStatic: true, label: 'bucket-wall-left' }
    );
    scene.matter.add.rectangle(
        innerRight + wallThickness / 2,
        wallCenterY,
        wallThickness,
        config.height + wallThickness,
        { isStatic: true, label: 'bucket-wall-right' }
    );
    scene.matter.add.rectangle(
        config.x,
        innerBottom + wallThickness / 2,
        config.width + wallThickness * 2,
        wallThickness,
        { isStatic: true, label: 'bucket-floor' }
    );

    function spawnParticles (count: number)
    {
        for (let i = 0; i < count; i++)
        {
            const px = Phaser.Math.Between(innerLeft + PARTICLE_RADIUS + 2, innerRight - PARTICLE_RADIUS - 2);
            const py = innerTop + 10 + Phaser.Math.Between(0, 14);

            const drop = scene.matter.add.image(px, py, WATER_PARTICLE_TEXTURE, undefined, {
                shape: { type: 'circle', radius: PARTICLE_RADIUS },
                friction: 0.04,
                frictionStatic: 0.1,
                restitution: 0.05,
                density: 0.01
            }) as Physics.Matter.Image;

            drop.setDisplaySize(PARTICLE_RADIUS * 2.4, PARTICLE_RADIUS * 2.4);
            drop.setVelocity(Phaser.Math.FloatBetween(-0.5, 0.5), Phaser.Math.FloatBetween(0.4, 1.4));
            particles.push(drop);
        }
    }

    function holdCluster (
        cluster: GameObjects.Container,
        voiceClip: VoiceClip,
        onAbsorbed: () => void
    )
    {
        const targetX = config.x;
        const targetY = innerTop + 16;

        scene.tweens.add({
            targets: cluster,
            x: targetX,
            y: targetY,
            scaleX: 0.4,
            scaleY: 0.4,
            alpha: 0.7,
            duration: 380,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                heldClips.push(voiceClip);
                const holdIndex = heldClips.length - 1;
                const count = Math.max(1, Math.round(FIRST_HOLD_PARTICLES / (1 + Math.log(holdIndex + 1) * LOG_DECAY)));
                spawnParticles(count);
                onAbsorbed();
            }
        });
    }

    return {
        holdCluster,
        getHeldClips: () => heldClips.slice(),
        destroy: () => {
            visual.destroy();
            for (const drop of particles)
            {
                drop.destroy();
            }
            particles.length = 0;
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


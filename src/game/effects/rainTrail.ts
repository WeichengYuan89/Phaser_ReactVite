import { GameObjects, Scene } from 'phaser';

const RAIN_PARTICLE_TEXTURE = 'rain-particle';

export interface RainTrail
{
    updateVelocity: (vx: number, vy: number) => void;
    destroy: () => void;
}

export function createRainTrail (scene: Scene, target: GameObjects.GameObject & { x: number; y: number }, options?: { offsetX?: number; offsetY?: number; maxSpeed?: number; }): RainTrail
{
    ensureRainParticleTexture(scene);

    const maxSpeed = options?.maxSpeed ?? 420;
    let velocityX = 0;
    let velocityY = 0;

    const getSpeed = () => Math.sqrt((velocityX * velocityX) + (velocityY * velocityY));
    const getSpeedPercent = () => Phaser.Math.Clamp(Phaser.Math.Percent(getSpeed(), 0, maxSpeed), 0, 1);
    const getAngle = () =>
    {
        if (velocityX === 0 && velocityY === 0)
        {
            return 90;
        }

        return Phaser.Math.RadToDeg(Math.atan2(velocityY, velocityX)) + 180;
    };

    const emitter = scene.add.particles(0, 0, RAIN_PARTICLE_TEXTURE, {
        frequency: 45,
        quantity: 1,
        speed: {
            onEmit: () => Phaser.Math.Linear(30, 160, getSpeedPercent())
        },
        lifespan: {
            onEmit: () => Phaser.Math.Linear(140, 520, getSpeedPercent())
        },
        alpha: {
            onEmit: () => Phaser.Math.Linear(0.12, 0.45, getSpeedPercent())
        },
        scale: { start: 4, end: 1 },
        angle: {
            onEmit: () => getAngle()
        },
        blendMode: 'ADD'
    });

    emitter.startFollow(target, options?.offsetX ?? 0, options?.offsetY ?? 16);

    return {
        updateVelocity: (vx: number, vy: number) => {
            velocityX = vx;
            velocityY = vy;
        },
        destroy: () => {
            emitter.stop();
            emitter.destroy();
        }
    };
}

function ensureRainParticleTexture (scene: Scene)
{
    if (scene.textures.exists(RAIN_PARTICLE_TEXTURE))
    {
        return;
    }

    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(0x7dd3fc, 1);
    gfx.fillCircle(4, 4, 4);
    gfx.generateTexture(RAIN_PARTICLE_TEXTURE, 8, 8);
    gfx.destroy();
}

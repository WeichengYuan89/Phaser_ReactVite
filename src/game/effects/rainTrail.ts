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

    const maxSpeed = options?.maxSpeed ?? 300;
    let velocityX = 0;
    let velocityY = 0;

    const getSpeed = () => Math.sqrt((velocityX * velocityX) + (velocityY * velocityY));

    // Mirrors Phaser's "scene config" example: each emission point is a small
    // 360° puff (speed > 0) rather than a single static dot. Successive puffs
    // overlap in space, so ADD-blending smooths the corners on sharp turns and
    // particles keep drifting outward after emission, giving the "floating then
    // fading" feel of the reference.
    const emitter = scene.add.particles(0, 0, RAIN_PARTICLE_TEXTURE, {
        speed: 50,
        lifespan: {
            onEmit: () => Phaser.Math.Percent(getSpeed(), 0, maxSpeed) * 10000
        },
        alpha: {
            onEmit: () => Phaser.Math.Percent(getSpeed(), 0, maxSpeed)
        },
        scale: { start: 1.0, end: 0 },
        blendMode: 'ADD'
    });

    emitter.startFollow(target, options?.offsetX ?? 0, options?.offsetY ?? 0);

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

    // Soft glowing blue blob: concentric circles with decreasing alpha for a
    // gradient-like falloff under ADD blending.
    const size = 10;
    const center = size / 2;
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(0x38bdf8, 0.18);
    gfx.fillCircle(center, center, center);
    gfx.fillStyle(0x7dd3fc, 0.35);
    gfx.fillCircle(center, center, center * 0.7);
    gfx.fillStyle(0xbae6fd, 0.6);
    gfx.fillCircle(center, center, center * 0.4);
    gfx.fillStyle(0xe0f2fe, 1);
    gfx.fillCircle(center, center, center * 0.2);
    gfx.generateTexture(RAIN_PARTICLE_TEXTURE, size, size);
    gfx.destroy();
}

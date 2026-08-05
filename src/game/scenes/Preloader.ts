import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        this.add.image(512, 384, 'background');

        this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

        const bar = this.add.rectangle(512 - 230, 384, 4, 28, 0xffffff);

        this.load.on('progress', (progress: number) => {
            bar.width = 4 + (460 * progress);
        });
    }

    /**
     * Sprites only — voice stimuli are deliberately absent (INTEGRATION_DESIGN
     * §4.1/§4.3, DECISIONS D9-2).
     *
     * This used to loop `this.load.audio(...)` over the whole clip list. At the
     * real training-set size that fails on its own terms: 500 files are 132 MB
     * on disk and ~265 MB once `decodeAudioData` has turned the 16-bit samples
     * into Float32, and Phaser's audio cache never evicts. `Preloader` also
     * gates `MainMenu` on completion, so it would be a blocking wall in front of
     * a CI-user session — to preload 500 stimuli for a session that plays ~60.
     *
     * Voice audio now goes through `study/StimulusPlayer`, on raw Web Audio,
     * which gives an exact onset timestamp for RT and an explicit buffer
     * lifetime.
     */
    preload ()
    {
        this.load.setPath('assets');
        this.load.multiatlas('flowers', 'Sprite/Flower/flowersheet.json', 'assets/Sprite/Flower/');
        this.load.multiatlas('cactus', 'Sprite/cactus/cactussheet.json', 'assets/Sprite/cactus/');
        this.load.image('rain-particle', 'Sprite/Particles/blue.png');
    }

    create ()
    {
        this.scene.start('MainMenu');
    }
}

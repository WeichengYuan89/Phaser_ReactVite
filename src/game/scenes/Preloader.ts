import { Scene } from 'phaser';

import { VOICE_CLIPS } from '../audioCatalog';

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

    preload ()
    {
        this.load.setPath('assets');

        this.load.image('logo', 'logo.png');
        this.load.image('star', 'star.png');

        for (const clip of VOICE_CLIPS)
        {
            this.load.audio(clip.key, `Audio/${clip.file}`);
        }
    }

    create ()
    {
        this.scene.start('MainMenu');
    }
}

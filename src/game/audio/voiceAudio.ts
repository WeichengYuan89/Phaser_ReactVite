import { Scene } from 'phaser';

export function startClusterVoice (scene: Scene, key: string): Phaser.Sound.BaseSound | null
{
    if (!scene.cache.audio.exists(key))
    {
        return null;
    }

    const voice = scene.sound.add(key, {
        loop: false,
        volume: 1
    });

    voice.play();

    return voice;
}

export function stopClusterVoice (voiceSound: Phaser.Sound.BaseSound | null)
{
    if (!voiceSound)
    {
        return;
    }

    voiceSound.stop();
    voiceSound.destroy();
}

import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#000000',
    physics: {
        default: 'matter',
        matter: {
            gravity: { x: 0, y: 1 },
            debug: false,
            positionIterations: 10,
            velocityIterations: 8,
            constraintIterations: 4
        }
    },
    scene: [
        Boot,
        Preloader,
        MainMenu,
        MainGame,
        GameOver
    ]
};

/**
 * `registry` carries what the scenes need but cannot create for themselves —
 * above all the `StimulusPlayer`, whose AudioContext must be started inside a
 * user gesture in React (see study/GameRoute.tsx).
 */
const StartGame = (parent: string, registry: Record<string, unknown> = {}) => {

    const game = new Game({ ...config, parent });

    for (const [key, value] of Object.entries(registry))
    {
        game.registry.set(key, value);
    }

    return game;

}

export default StartGame;

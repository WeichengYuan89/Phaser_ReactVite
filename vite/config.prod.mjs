import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sites } from '@openai/sites-vite-plugin';

import { stimuli } from './stimuliPlugin.mjs';

const phasermsg = () => {
    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`);
        },
        buildEnd() {
            const line = "---------------------------------------------------------";
            const msg = `❤️❤️❤️ Tell us about your game! - games@phaser.io ❤️❤️❤️`;
            process.stdout.write(`${line}\n${msg}\n${line}\n`);

            process.stdout.write(`✨ Done ✨\n`);
        }
    }
}

export default defineConfig(async () => {
    const { cloudflare } = await import('@cloudflare/vite-plugin');

    return {
        base: './',
        plugins: [
            react(),
            phasermsg(),
            stimuli(),
            sites(),
            cloudflare({
                config: {
                    main: './worker/index.ts',
                    compatibility_date: '2026-08-28',
                    assets: {
                        not_found_handling: 'single-page-application'
                    }
                }
            })
        ],
        logLevel: 'warning',
        build: {
            rollupOptions: {
                output: {
                    manualChunks (id) {
                        if (id.includes('/node_modules/phaser/'))
                            return 'phaser';
                    }
                }
            },
            minify: 'terser',
            terserOptions: {
                compress: {
                    passes: 2
                },
                mangle: true,
                format: {
                    comments: false
                }
            }
        }
    };
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { stimuli } from './stimuliPlugin.mjs'

// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        react(),
        stimuli(),
    ],
    server: {
        port: 8080,
        strictPort: true
    }
})

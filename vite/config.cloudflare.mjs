import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Direct-account Cloudflare build. Keep the separate Sites build intact.
export default defineConfig({
    base: '/',
    plugins: [react()],
    define: { __REMOTE_PILOT__: 'true' },
    build: {
        outDir: 'dist-cloudflare',
        rollupOptions: {
            output: { manualChunks: (id) => id.includes('/node_modules/phaser/') ? 'phaser' : undefined }
        }
    }
});

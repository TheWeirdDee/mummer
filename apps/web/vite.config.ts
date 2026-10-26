import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Worker (workers/api) serves the built files from ./dist and the API under /api.
// In development, run `npm run dev:api` and `npm run dev:web`; /api is proxied to the local Worker.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0, // never inline assets: the CSP allows no inline resources
    chunkSizeWarningLimit: 1500, // libsodium embeds its WebAssembly; it is lazy-loaded only on routes that handle secrets
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:2567' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    chunkSizeWarningLimit: 1600,
  },
});

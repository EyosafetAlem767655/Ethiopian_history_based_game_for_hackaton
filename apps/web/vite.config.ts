import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  // Prebundle optional worker dependencies before play: discovering them during camera capture reloads Vite.
  optimizeDeps: { include: ['@mediapipe/tasks-vision', 'tesseract.js'] },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:2567' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    chunkSizeWarningLimit: 1600,
  },
});

// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'public',          // look in public/ for index.html
  build: {
    outDir: '../dist',     // output back to dist/ or wherever you like
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: (assetInfo) => {
          // Keep audio files in root of dist
          if (assetInfo.name && assetInfo.name.endsWith('.mp3')) {
            return '[name][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    },
    assetsInclude: ['**/*.mp3'] // Explicitly include MP3 files as assets
  }
})

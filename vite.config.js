// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'public',          // look in public/ for index.html
  build: {
    outDir: '../dist',     // output back to dist/ or wherever you like
  }
})

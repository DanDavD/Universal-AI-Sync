import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.js'),
        'content/chatgpt': resolve(__dirname, 'src/content/chatgpt/index.js'),
        'content/claude': resolve(__dirname, 'src/content/claude/index.js'),
        'content/gemini': resolve(__dirname, 'src/content/gemini/index.js'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.js'),
        'options/options': resolve(__dirname, 'src/options/options.js'),
      },
      output: {
        // IIFE = each entry is a fully self-contained bundle, no shared chunks.
        // Required for MV3 content scripts and service workers.
        format: 'iife',
        entryFileNames: '[name].js',
        // No assetFileNames hash — predictable paths for static HTML <link> tags.
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    cssCodeSplit: false,
  },
  // publicDir is copied verbatim to dist/ — this is where manifest.json + icons live.
  publicDir: 'public',
})

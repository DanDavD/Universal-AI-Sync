/**
 * Build orchestrator for the Universal AI Sync extension.
 *
 * Vite 8 uses Rolldown (not Rollup) which disallows IIFE format with multiple
 * entry points simultaneously ("codeSplitting: false + multiple inputs" error).
 * The fix: call vite.build() once per entry so Rolldown always sees a single
 * entry and produces a fully self-contained IIFE bundle.
 *
 * Usage:
 *   node build.mjs           # production (minified)
 *   node build.mjs --watch   # development (sourcemaps, no minify, re-runs on change)
 */

import { build } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rmSync, cpSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWatch = process.argv.includes('--watch')
const isDev   = isWatch || process.argv.includes('--dev')

// ---------------------------------------------------------------------------
// 1. Clean dist/ and copy public/ assets (manifest.json, HTML pages, icons)
// ---------------------------------------------------------------------------
rmSync(resolve(__dirname, 'dist'), { recursive: true, force: true })
cpSync(resolve(__dirname, 'public'), resolve(__dirname, 'dist'), { recursive: true })
console.log('✓ public/ → dist/')

// ---------------------------------------------------------------------------
// 2. Script entries — each becomes its own self-contained IIFE bundle
// ---------------------------------------------------------------------------
const ENTRIES = [
  // [outputDir, outputFilename,  sourceEntry]
  ['background', 'service-worker.js', 'src/background/service-worker.js'],
  ['content',    'chatgpt.js',        'src/content/chatgpt/index.js'],
  ['content',    'claude.js',         'src/content/claude/index.js'],
  ['content',    'gemini.js',         'src/content/gemini/index.js'],
  ['content',    'copilot.js',        'src/content/copilot/index.js'],
  ['popup',      'popup.js',          'src/popup/popup.js'],
]

for (const [outDir, outFile, entry] of ENTRIES) {
  const absOutDir  = resolve(__dirname, 'dist', outDir)
  const absEntry   = resolve(__dirname, entry)
  const iifeName   = outFile.replace('.js', '').replace(/[^a-zA-Z0-9]/g, '_')

  mkdirSync(absOutDir, { recursive: true })

  await build({
    configFile: false,          // ignore vite.config.js — we configure inline
    publicDir: false,           // we already copied public/ once above; don't re-copy per entry
    logLevel: 'warn',
    build: {
      emptyOutDir: false,       // don't wipe sibling output files
      outDir: absOutDir,
      sourcemap: isDev,
      minify: !isDev,
      lib: {
        entry: absEntry,
        name: iifeName,
        fileName: () => outFile,
        formats: ['iife'],
      },
      rollupOptions: {
        output: {
          // Predictable asset names so static HTML can reference them
          assetFileNames: '../assets/[name].[ext]',
        },
      },
    },
  })

  console.log(`✓ dist/${outDir}/${outFile}`)
}

console.log('\nBuild complete.')

// @ts-check
import { injectAndSubmit, clickElement, sleep, clearInput } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'
import { discoverInputEl, findFileInput, getInputAreaRoot, waitForFileChip } from '../shared/domDiscovery.js'

const CHUNK_SIZE  = 25000
const CHUNK_DELAY = 2000

/**
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const input = /** @type {HTMLElement|null} */ (
    queryFirst(sel.input)
      ?? await waitForElement(sel.input.split(',')[0].trim(), 8000)
      ?? discoverInputEl()
  )
  if (!input) throw new Error('[claude] ProseMirror input not found')
  await injectAndSubmit(input, queryFirst(sel.submitBtn), text, opts)
}

/**
 * Attaches a markdown file to Claude and sends a context prompt.
 * Uses the universal findFileInput() pipeline from domDiscovery.
 *
 * Claude always pre-renders input[type="file"] in the DOM, so Phase 1
 * of findFileInput() resolves in < 150 ms without any button clicking.
 * No attach button selectors are needed.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const inputEl = /** @type {HTMLElement} */ (queryFirst(sel.input) ?? discoverInputEl())
  if (!inputEl) throw new Error('[claude] Input not found')

  // Claude pre-renders the file input — no button selectors needed.
  // findFileInput Phase 1 finds it instantly. Passing [] for knownSelectors
  // skips Phase 2 entirely and goes straight to probing only if Phase 1 fails.
  const fileInput = await findFileInput(inputEl, /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn)), [])
  if (!fileInput) throw new Error('[claude] No file input found. File upload may not be available on this page.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  // Wait for Claude to show the file chip (DOM settles 300 ms after last mutation)
  await waitForFileChip(getInputAreaRoot(inputEl), 10000)

  const prompt = `I've attached our full conversation history from ${sourcePlatform}. Please read the context file and briefly acknowledge the main topics so we can continue from where we left off.`
  await injectText(prompt, sel, { autoSubmit: true })
}

/**
 * @param {string} summary
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {((part: number, total: number) => void) | null} [onProgress]
 */
export async function injectSync(summary, sel, onProgress = null) {
  const chunks = splitIntoChunks(summary, CHUNK_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    onProgress?.(i + 1, chunks.length)
    await injectText(wrapChunk(chunks[i], i + 1, chunks.length, isLast), sel, { autoSubmit: true })
    for (let t = 0; t < 20; t++) {
      const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
      if (stop) { clickElement(stop); break }
      await sleep(150)
    }
    if (isLast) {
      const input = /** @type {HTMLElement|null} */ (queryFirst(sel.input))
      if (input) await clearInput(input)
    } else {
      await sleep(CHUNK_DELAY)
    }
  }
}

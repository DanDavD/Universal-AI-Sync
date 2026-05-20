// @ts-check
import { injectAndSubmit, clickElement, sleep } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'

const CHUNK_SIZE  = 12500
const CHUNK_DELAY = 1500

/**
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const input = /** @type {HTMLElement|null} */ (
    queryFirst(sel.input) ?? await waitForElement(sel.input.split(',')[0].trim())
  )
  if (!input) throw new Error('[chatgpt] Input element not found')
  await injectAndSubmit(input, () => queryFirst(sel.submitBtn), text, opts)
}

/**
 * Injects the full markdown conversation as text, chunked if needed.
 * ChatGPT does not support programmatic file attachment via synthetic events.
 *
 * @param {string} markdownContent
 * @param {string} _sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {((part: number, total: number) => void) | null} [onProgress]
 */
export async function injectFile(markdownContent, _sourcePlatform, sel, onProgress = null) {
  const chunks = splitIntoChunks(markdownContent, CHUNK_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    onProgress?.(i + 1, chunks.length)
    await injectText(wrapChunk(chunks[i], i + 1, chunks.length, isLast), sel, { autoSubmit: true })
    for (let t = 0; t < 20; t++) {
      const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
      if (stop) { clickElement(stop); break }
      await sleep(150)
    }
    if (!isLast) await sleep(CHUNK_DELAY)
  }
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
    // Click stop after every chunk so the send button is always available for the next one
    for (let t = 0; t < 20; t++) {
      const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
      if (stop) { clickElement(stop); break }
      await sleep(150)
    }
    if (!isLast) await sleep(CHUNK_DELAY)
  }
}

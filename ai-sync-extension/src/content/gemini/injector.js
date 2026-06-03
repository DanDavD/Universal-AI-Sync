// @ts-check
import { injectAndSubmit, simulateEnter, setContentEditable, clickElement, sleep, clearInput } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'
import { discoverInputEl, findFileInput, getInputAreaRoot, waitForFileChip } from '../shared/domDiscovery.js'

const CHUNK_SIZE  = 12500
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
  if (!input) throw new Error('[gemini] Input not found')
  const inputRoot = getInputAreaRoot(input)
  await injectAndSubmit(input, () => /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn, inputRoot)), text, opts)
}

/** Fast-path selectors for Gemini's attach button — tried before probing. */
const ATTACH_BTN_SELECTORS = [
  'ms-attachment-button button',
  'bard-upload-button button',
  'button[aria-label="Add files and more"]',
  'button[aria-label="Upload files"]',
  'button[aria-label*="Upload"]',
  'button[aria-label*="Attach"]',
  'button[aria-label*="Add file"]',
  '[data-test-id="attachment-button"]',
]

/**
 * Attaches a markdown file to Gemini and sends a context prompt.
 * Uses the universal findFileInput() pipeline from domDiscovery.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const inputEl = /** @type {HTMLElement} */ (queryFirst(sel.input) ?? discoverInputEl())
  if (!inputEl) throw new Error('[gemini] Input not found')

  const fileInput = await findFileInput(inputEl, /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn)), ATTACH_BTN_SELECTORS)
  if (!fileInput) throw new Error('[gemini] Could not open file upload dialog. Make sure you are on the Gemini chat page.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  // Wait for Gemini to show the file chip (DOM settles 300 ms after last mutation)
  await waitForFileChip(getInputAreaRoot(inputEl), 10000)
  // Extra settle time — Gemini re-enables the input after processing the chip
  await sleep(800)

  const prompt = `I've attached our full conversation history from ${sourcePlatform}. Please read the context file and briefly acknowledge the main topics so we can continue from where we left off.`

  // Re-query input: Gemini may have rebuilt the editor component after the file chip appeared
  const activeInput = /** @type {HTMLElement} */ (queryFirst(sel.input) ?? discoverInputEl() ?? inputEl)
  activeInput.focus()
  await sleep(60)
  await setContentEditable(activeInput, prompt)
  await sleep(200)

  // Submit via Enter — DOM-independent, works regardless of send button's selector or state.
  // Retry up to 5 times with 400 ms between each to cover slow UI updates.
  for (let i = 0; i < 5; i++) {
    simulateEnter(activeInput)
    await sleep(400)
    if (!(activeInput.textContent ?? '').trim()) return
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
    if (isLast) {
      await sleep(500)
      const input = /** @type {HTMLElement|null} */ (queryFirst(sel.input))
      if (input) await clearInput(input)
    } else {
      for (let t = 0; t < 20; t++) {
        const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
        if (stop) { clickElement(stop); break }
        await sleep(150)
      }
      await sleep(CHUNK_DELAY)
    }
  }
}

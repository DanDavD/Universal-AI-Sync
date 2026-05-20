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
    queryFirst(sel.input) ?? await waitForElement(sel.input.split(',')[0].trim(), 8000)
  )
  if (!input) throw new Error('[gemini] Quill editor not found')
  await injectAndSubmit(input, queryFirst(sel.submitBtn), text, opts)
}

/**
 * Attaches a markdown file to the chat and sends a context prompt.
 * Finds the file input co-located with the Quill editor to avoid picking
 * unrelated file inputs elsewhere on the page.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  // Try direct approach first — same as Claude
  let fileInput = /** @type {HTMLInputElement|null} */ (queryFirst(sel.fileInput))

  if (!fileInput) {
    // File input not yet in DOM — click the + button to trigger lazy render,
    // then intercept the internal input.click() call Gemini makes
    const origClick = HTMLInputElement.prototype.click
    /** @type {HTMLInputElement|null} */
    let intercepted = null
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') intercepted = this
      else origClick.call(this)
    }

    const btn = /** @type {HTMLElement|null} */ (document.querySelector(
      'button[aria-label*="Upload" i],button[aria-label*="Add file" i],' +
      'button[aria-label="Attach files"],button[aria-label="Attach file"]'
    ))
    if (btn) btn.click()

    // Poll up to 3 s for the file input to appear or be intercepted
    for (let i = 0; i < 30; i++) {
      await sleep(100)
      fileInput = intercepted ?? /** @type {HTMLInputElement|null} */ (document.querySelector('input[type="file"]'))
      if (fileInput) break
    }

    HTMLInputElement.prototype.click = origClick
  }

  if (!fileInput) throw new Error('[gemini] No file input found. File upload may require Gemini Advanced.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  await sleep(3000)

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
    if (!isLast) {
      await sleep(CHUNK_DELAY)
    } else {
      for (let t = 0; t < 20; t++) {
        const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
        if (stop) { clickElement(stop); break }
        await sleep(150)
      }
    }
  }
}

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
 * Recursively queries through open Shadow DOM boundaries.
 *
 * @param {string} selector
 * @param {Document|Element|ShadowRoot} root
 * @returns {Element|null}
 */
function deepQuery(selector, root = document) {
  const hit = root.querySelector(selector)
  if (hit) return hit
  for (const el of root.querySelectorAll('*')) {
    const sr = /** @type {any} */ (el).shadowRoot
    if (sr) {
      const inner = deepQuery(selector, sr)
      if (inner) return inner
    }
  }
  return null
}

/** Ordered list of selectors to find Gemini's attach/upload button. */
const ATTACH_BTN_SELECTORS = [
  'ms-attachment-button button',
  'bard-upload-button button',
  'button[aria-label*="Upload"]',
  'button[aria-label*="Attach"]',
  'button[aria-label*="upload"]',
  'button[aria-label*="attach"]',
  'button[aria-label*="Add image"]',
  'button[aria-label*="Add file"]',
  '[data-test-id="attachment-button"]',
  '.upload-button',
  'button[jsname][data-tooltip*="file" i]',
]

/**
 * Returns a Promise that resolves to the file input element intercepted when
 * Gemini internally calls fileInput.click() after the attach button is pressed.
 * Uses a capture-phase listener + composedPath() to pierce shadow DOM retargeting.
 *
 * @param {HTMLElement} attachBtn
 * @returns {Promise<HTMLInputElement|null>}
 */
function interceptFileInputClick(attachBtn) {
  return new Promise((resolve) => {
    /** @param {Event} e */
    const onCapture = (e) => {
      // composedPath() returns the full path through open shadow roots,
      // even when e.target is retargeted to the shadow host.
      const path = /** @type {EventTarget[]} */ (e.composedPath())
      const inp = /** @type {HTMLInputElement|undefined} */ (
        path.find((t) => t instanceof HTMLInputElement && /** @type {HTMLInputElement} */(t).type === 'file')
      )
      if (inp) {
        e.preventDefault()           // prevent native file-picker dialog
        e.stopImmediatePropagation() // stop further propagation
        document.removeEventListener('click', onCapture, true)
        resolve(inp)
      }
    }

    document.addEventListener('click', onCapture, true)

    // Timeout: if no file-input click is intercepted within 5 s, give up
    setTimeout(() => {
      document.removeEventListener('click', onCapture, true)
      resolve(null)
    }, 5000)

    attachBtn.click()
  })
}

/**
 * Attaches a markdown file to the chat and sends a context prompt.
 *
 * Phase 1 – deepQuery: works when Gemini pre-renders the file input inside
 *   an open Shadow DOM subtree (no button interaction needed).
 *
 * Phase 2 – click interception: if Phase 1 finds nothing, we locate the
 *   attach button (also via deepQuery), register a capture-phase listener on
 *   document that uses composedPath() to find the file input in Gemini's
 *   internal click dispatch, then preventDefault() to skip the dialog and
 *   inject the file programmatically.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  /** @type {HTMLInputElement|null} */
  let fileInput = null

  // ── Phase 1: try shadow-DOM traversal without any button click ───────────
  for (let i = 0; i < 20; i++) {
    fileInput = /** @type {HTMLInputElement|null} */ (deepQuery('input[type="file"]'))
    if (fileInput) break
    await sleep(150)
  }

  // ── Phase 2: click attach button and intercept the resulting .click() ────
  if (!fileInput) {
    let attachBtn = /** @type {HTMLElement|null} */ (null)
    for (const s of ATTACH_BTN_SELECTORS) {
      attachBtn = /** @type {HTMLElement|null} */ (deepQuery(s))
      if (attachBtn) break
    }

    if (!attachBtn) {
      throw new Error('[gemini] No file input or attach button found. Make sure you are on the Gemini chat page.')
    }

    fileInput = await interceptFileInputClick(attachBtn)
  }

  if (!fileInput) throw new Error('[gemini] File input not found after clicking attach button.')

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

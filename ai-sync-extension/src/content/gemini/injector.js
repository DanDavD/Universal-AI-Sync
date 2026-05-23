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
  await injectAndSubmit(input, /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn)), text, opts)
}

/**
 * Recursively queries through open Shadow DOM boundaries.
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
 * Finds the "Upload files" option in Gemini's attachment dropdown menu.
 * Angular Material overlay menus render in the top-level document, so
 * a regular querySelectorAll is sufficient here.
 * @returns {HTMLElement|null}
 */
function findUploadMenuItem() {
  const candidates = document.querySelectorAll(
    '[role="menuitem"], [role="option"], li, [role="listitem"], .mat-menu-item, [mat-menu-item], ms-menu-item, button'
  )
  for (const el of candidates) {
    const text = (el.textContent ?? '').trim().toLowerCase()
    const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase()
    if (
      /^upload\s+files?$/.test(text) ||
      /^upload\s+files?/.test(ariaLabel)
    ) {
      return /** @type {HTMLElement} */ (el)
    }
  }
  return null
}

/**
 * Clicks the attach button, waits for the "Upload files" submenu item
 * (Gemini's new dropdown UI), clicks it, then returns the file input element
 * via three parallel detection methods:
 *   1. Monkey-patch HTMLInputElement.prototype.click — catches programmatic clicks
 *   2. Capture-phase listener + composedPath() — catches shadow DOM click dispatches
 *   3. MutationObserver — catches dynamically added file inputs
 *
 * @param {HTMLElement} attachBtn
 * @returns {Promise<HTMLInputElement|null>}
 */
function openFileInputViaMenu(attachBtn) {
  return new Promise((resolve) => {
    let settled = false
    /** @type {MutationObserver|null} */
    let observer = null

    /** @param {HTMLInputElement|null} input */
    const done = (input) => {
      if (settled) return
      settled = true
      if (observer) observer.disconnect()
      HTMLInputElement.prototype.click = origClick
      document.removeEventListener('click', onCapture, true)
      clearTimeout(timer)
      resolve(input)
    }

    // Method 1: monkey-patch for programmatic fileInput.click() calls
    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        done(/** @type {HTMLInputElement} */ (this))
      } else {
        origClick.call(this)
      }
    }

    // Method 2: capture-phase listener using composedPath() for shadow DOM
    /** @param {Event} e */
    const onCapture = (e) => {
      const path = /** @type {EventTarget[]} */ (e.composedPath())
      const inp = /** @type {HTMLInputElement|undefined} */ (
        path.find((t) => t instanceof HTMLInputElement && /** @type {HTMLInputElement} */ (t).type === 'file')
      )
      if (inp) {
        e.preventDefault()
        e.stopImmediatePropagation()
        done(inp)
      }
    }
    document.addEventListener('click', onCapture, true)

    // Method 3: MutationObserver for dynamically added inputs
    observer = new MutationObserver(() => {
      const found = /** @type {HTMLInputElement|null} */ (deepQuery('input[type="file"]'))
      if (found) done(found)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Overall timeout
    const timer = setTimeout(() => done(null), 8000)

    // Step 1: click attach button (opens dropdown menu in new Gemini UI)
    attachBtn.click()

    // Step 2: poll every 200ms for the "Upload files" menu item and click it
    let pollCount = 0
    const tryClickUpload = () => {
      if (settled) return
      pollCount++
      if (pollCount > 30) return  // give up after ~6s of polling

      const item = findUploadMenuItem()
      if (item) {
        clickElement(item)
      } else {
        setTimeout(tryClickUpload, 200)
      }
    }
    setTimeout(tryClickUpload, 400)
  })
}

/**
 * Attaches a markdown file to the chat and sends a context prompt.
 *
 * Phase 1 – deepQuery: works when Gemini pre-renders the file input inside
 *   an open Shadow DOM subtree (no button interaction needed).
 *
 * Phase 2 – menu + triple detection: locates the attach button via deepQuery,
 *   clicks it to open Gemini's new dropdown menu, waits for the "Upload files"
 *   item, clicks it, then detects the resulting file input via monkey-patching,
 *   composedPath interception, or MutationObserver — whichever fires first.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  /** @type {HTMLInputElement|null} */
  let fileInput = null

  // Phase 1: try shadow-DOM traversal without any button click
  for (let i = 0; i < 20; i++) {
    fileInput = /** @type {HTMLInputElement|null} */ (deepQuery('input[type="file"]'))
    if (fileInput) break
    await sleep(150)
  }

  // Phase 2: click attach button → handle dropdown menu → detect file input
  if (!fileInput) {
    let attachBtn = /** @type {HTMLElement|null} */ (null)
    for (const s of ATTACH_BTN_SELECTORS) {
      attachBtn = /** @type {HTMLElement|null} */ (deepQuery(s))
      if (attachBtn) break
    }

    if (!attachBtn) {
      throw new Error('[gemini] No file input or attach button found. Make sure you are on the Gemini chat page.')
    }

    fileInput = await openFileInputViaMenu(attachBtn)
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

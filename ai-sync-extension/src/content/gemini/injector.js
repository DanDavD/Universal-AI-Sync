// @ts-check
import { injectAndSubmit, clickElement, sleep, clearInput } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'

const CHUNK_SIZE  = 12500
const CHUNK_DELAY = 2000

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
  'button[aria-label="Add files and more"]',
  'button[aria-label="Upload files"]',
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
 * Walks UP the DOM from the known-working chat input element to find a
 * container that encloses the input toolbar (and therefore the attach button),
 * but NOT the sidebar navigation.
 *
 * This is the correct strategy: we start from something we know works
 * (the text input) and find its parent area, rather than searching
 * top-down from the document (which finds sidebar buttons first).
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {Element|Document}
 */
function getInputAreaRoot(sel) {
  const input = /** @type {HTMLElement|null} */ (queryFirst(sel.input))
  if (!input) return document

  // Walk up the DOM looking for a meaningful input-toolbar container.
  // Stop before <body> to avoid accidentally returning the full document.
  let el = /** @type {Element|null} */ (input.parentElement)
  for (let i = 0; i < 15 && el && el !== document.body; i++) {
    const tag = el.tagName.toLowerCase()
    if (
      tag === 'form' ||
      tag === 'ms-footer' ||
      tag === 'ms-chat-query' ||
      tag === 'ms-text-chunk-input' ||
      tag === 'ms-prompt-chip-bar' ||
      tag === 'ms-input-box' ||
      tag === 'ms-bottom-input-bar' ||
      el.getAttribute('role') === 'textbox' ||
      el.classList.contains('input-area') ||
      el.classList.contains('query-box')
    ) {
      return el
    }
    el = el.parentElement
  }

  // Last resort: <main> excludes the sidebar <nav> but is broader than the input container.
  return input.closest('main') ?? document
}

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
      /^upload\s+files?/.test(ariaLabel) ||
      /^add\s+files?$/.test(text) ||
      /^add\s+files?/.test(ariaLabel)
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
 * Phase 2 – menu + scoped search: locates the attach button by walking UP
 *   from the known text input element to find its container area, then
 *   searching within that scope. This prevents matching sidebar buttons.
 *   Falls back to <main> (still excludes sidebar <nav>) if needed.
 *   NEVER falls back to full document to avoid matching sidebar buttons.
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

    // Strategy: walk UP from the known-working text input to find its container,
    // then search within that scope. This guarantees we only find buttons that
    // are co-located with the input, NOT buttons in the sidebar history panel.
    const inputAreaRoot = getInputAreaRoot(sel)
    for (const s of ATTACH_BTN_SELECTORS) {
      attachBtn = /** @type {HTMLElement|null} */ (deepQuery(s, inputAreaRoot))
      if (attachBtn) break
    }

    // If the input area root was too narrow, try <main> as a broader scope.
    // <main> excludes the sidebar <nav> but still covers the full chat area.
    if (!attachBtn) {
      const mainEl = document.querySelector('main')
      if (mainEl && mainEl !== inputAreaRoot) {
        for (const s of ATTACH_BTN_SELECTORS) {
          attachBtn = /** @type {HTMLElement|null} */ (deepQuery(s, mainEl))
          if (attachBtn) break
        }
      }
    }

    // NOTE: We intentionally do NOT fall back to the full document here.
    // Searching the full document finds sidebar "..." buttons that open
    // "Share conversation" menus instead of file upload dialogs.

    if (!attachBtn) {
      throw new Error('[gemini] Attach button not found in the chat input area. Make sure you are on the Gemini chat page.')
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
    if (isLast) {
      // Don't click stop on the last chunk — Gemini restores the prompt text into
      // the input when generation is interrupted, which ruins UX for large prompts.
      // Just clear whatever Gemini may have put back and let it finish.
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

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

/** Ordered selectors for ChatGPT's attachment / file-upload button. */
const ATTACH_BTN_SELECTORS = [
  'button[aria-label="Attach files"]',
  'button[data-testid="attach-button"]',
  'button[aria-label*="Attach" i]',
  'button[aria-label*="Upload" i]',
  'button[aria-label*="Add image" i]',
  'button[aria-label*="Add file" i]',
  '[data-testid="composer-attach-button"]',
]

/**
 * Locates the ChatGPT chat-specific file input.
 *
 * Phase 1 – direct query: the input is often pre-rendered hidden in the DOM.
 *   Works without clicking anything.
 *
 * Phase 2 – attach-button intercept: if Phase 1 finds nothing (or finds the
 *   wrong input like a profile-picture uploader), we click the attach button,
 *   wait for ChatGPT to programmatically call fileInput.click(), and intercept
 *   that click via a composedPath() capture listener so the native file-picker
 *   dialog never opens.  ChatGPT also shows a submenu after the button click —
 *   we poll for the "Upload" menu item and click it to trigger the input click.
 *
 * @returns {Promise<HTMLInputElement|null>}
 */
async function findChatFileInput() {
  // Phase 1: direct lookup — fast path when the input is already in the DOM.
  const direct = /** @type {HTMLInputElement|null} */ (document.querySelector('input[type="file"]'))
  if (direct) return direct

  // Phase 2: click the attachment button and intercept the file-input click.
  let attachBtn = /** @type {HTMLElement|null} */ (null)
  for (const s of ATTACH_BTN_SELECTORS) {
    attachBtn = /** @type {HTMLElement|null} */ (document.querySelector(s))
    if (attachBtn) break
  }
  if (!attachBtn) return null

  return new Promise((resolve) => {
    let settled = false

    /** @param {HTMLInputElement|null} result */
    const done = (result) => {
      if (settled) return
      settled = true
      document.removeEventListener('click', onCapture, true)
      resolve(result)
    }

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
    setTimeout(() => done(null), 5000)

    /** @type {HTMLElement} */ (attachBtn).click()

    // ChatGPT shows a submenu ("Upload from computer", "Add image", etc.).
    // Poll until the upload menu item appears and click it.
    let polls = 0
    const pollMenu = () => {
      if (settled) return
      if (++polls > 30) return
      const items = /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('[role="menuitem"],[role="option"],li,[data-testid*="menu"]')
      )
      for (const el of items) {
        if (/upload|from\s*computer|local\s*file/i.test(el.textContent ?? '')) {
          el.click()
          return
        }
      }
      setTimeout(pollMenu, 150)
    }
    setTimeout(pollMenu, 300)
  })
}

/**
 * Attaches a markdown file to the ChatGPT chat and sends a context prompt.
 *
 * Uses a two-phase approach to find the correct chat file input — avoiding the
 * risk of targeting the wrong hidden input (e.g. profile-picture uploader) that
 * exists elsewhere on the page.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const fileInput = await findChatFileInput()
  if (!fileInput) throw new Error('[chatgpt] No file input found. File upload may not be available on this page.')

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
    // Click stop after every chunk so the send button is always available for the next one
    for (let t = 0; t < 20; t++) {
      const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
      if (stop) { clickElement(stop); break }
      await sleep(150)
    }
    if (!isLast) await sleep(CHUNK_DELAY)
  }
}

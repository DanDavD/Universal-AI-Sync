// @ts-check
import { injectAndSubmit, clickElement, sleep } from '../shared/eventSimulator.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'

const CHUNK_SIZE  = 12500
const CHUNK_DELAY = 1500

/**
 * Waits for any selector in `sel.input` to appear, trying the full list every
 * 200 ms.  Much more robust than waitForElement which only checks the first
 * selector — Copilot's exact element can vary between builds.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {number} [timeout]
 * @returns {Promise<HTMLElement|null>}
 */
async function waitForCopilotInput(sel, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const el = queryFirst(sel.input)
    if (el) return /** @type {HTMLElement} */ (el)
    await sleep(200)
  }
  return null
}

/**
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const input = queryFirst(sel.input) ?? await waitForCopilotInput(sel, 20000)
  if (!input) throw new Error('[copilot] Input element not found')
  await injectAndSubmit(input, queryFirst(sel.submitBtn), text, opts)
}

/** Ordered selectors for Copilot's attachment / file-upload button. */
const ATTACH_BTN_SELECTORS = [
  'button[aria-label="Attach files"]',
  'button[aria-label="Attach file"]',
  'button[aria-label="Add attachment"]',
  'button[data-testid="attach-button"]',
  'button[aria-label*="Attach" i]',
  'button[aria-label*="Upload" i]',
  'button[aria-label*="Add image" i]',
  'button[aria-label*="Add file" i]',
  'button[aria-label*="More" i]',
]

/**
 * Locates Copilot's chat file input using a two-phase approach.
 *
 * Phase 1 — direct query: polls for `input[type="file"]` already in the DOM.
 * Phase 2 — attach-button intercept: clicks the attachment button, then uses
 *   a composedPath() capture listener to intercept the internal .click() call
 *   Copilot fires on the hidden file input so the native dialog never opens.
 *   Also polls for any "Upload files" submenu item that Copilot may reveal.
 *
 * @returns {Promise<HTMLInputElement|null>}
 */
async function findCopilotFileInput() {
  // Phase 1: input might already be in the DOM (hidden)
  for (let i = 0; i < 10; i++) {
    const direct = /** @type {HTMLInputElement|null} */ (document.querySelector('input[type="file"]'))
    if (direct) return direct
    await sleep(100)
  }

  // Phase 2: reveal via attachment button
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

    // Copilot may show a submenu — poll for the "Upload" item and click it
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
 * Attaches a markdown file to the Copilot chat and sends a context prompt.
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const fileInput = await findCopilotFileInput()
  if (!fileInput) throw new Error('[copilot] No file input found. File upload may not be available on this page.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  // Give Copilot time to process the file and restore the text input
  await sleep(5000)

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

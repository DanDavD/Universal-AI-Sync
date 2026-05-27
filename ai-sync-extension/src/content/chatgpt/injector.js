// @ts-check
import { injectAndSubmit, clickElement, simulateEnter, sleep, clearInput } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'
import { discoverInputEl, findFileInput } from '../shared/domDiscovery.js'

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
      ?? await waitForElement(sel.input.split(',')[0].trim())
      ?? discoverInputEl()
  )
  if (!input) throw new Error('[chatgpt] Input element not found')
  await injectAndSubmit(input, () => queryFirst(sel.submitBtn), text, opts)
}

/** Fast-path selectors for ChatGPT's attach button — tried before probing. */
const ATTACH_BTN_SELECTORS = [
  'button[aria-label="Attach files"]',
  'button[data-testid="attach-button"]',
  '[data-testid="composer-attach-button"]',
  'button[aria-label*="Attach" i]',
  'button[aria-label*="Upload" i]',
  'button[aria-label*="Add image" i]',
  'button[aria-label*="Add file" i]',
]

/**
 * Returns true if the button is currently disabled by any mechanism.
 * @param {Element} btn
 */
function isDisabled(btn) {
  return btn.hasAttribute('disabled')
    || btn.getAttribute('aria-disabled') === 'true'
    || btn.getAttribute('data-disabled') === 'true'
}

/**
 * Polls until the submit button exists AND is not disabled.
 *
 * ChatGPT keeps the send button disabled while a file is uploading to its
 * servers. It only enables it once the upload completes — even if the text
 * input is still empty. This makes "button becomes enabled" the most reliable
 * signal that the file is ready to be attached to a message.
 *
 * @param {string} submitSelector
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true = button became enabled; false = timed out
 */
async function waitForSubmitEnabled(submitSelector, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const btn = queryFirst(submitSelector)
    if (btn && !isDisabled(btn)) return true
    await sleep(200)
  }
  return false
}

/**
 * Polls until the submit button is enabled, then clicks it.
 * Falls back to Enter key if the button never enables within timeoutMs.
 *
 * @param {string} submitSelector
 * @param {HTMLElement} inputEl
 * @param {number} timeoutMs
 */
async function clickWhenReady(submitSelector, inputEl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(150)
    const btn = /** @type {HTMLElement|null} */ (queryFirst(submitSelector))
    if (btn && btn.isConnected && !isDisabled(btn)) {
      clickElement(btn)
      return
    }
  }
  // Fallback: Enter key if button never became enabled
  simulateEnter(inputEl)
}

/**
 * Attaches a markdown file to ChatGPT and sends a context prompt.
 *
 * ChatGPT uploads files to its servers before a message can be sent.
 * The "file is ready" signal is the send button transitioning disabled → enabled
 * (ChatGPT keeps it disabled during upload, enables it the moment the upload
 * completes — even with an empty text input).
 *
 * Flow:
 *   1. Find and set the file input          (Phase 1: pre-rendered, instant)
 *   2. waitForSubmitEnabled                 (= file fully uploaded to ChatGPT)
 *   3. Inject prompt text WITHOUT autoSubmit
 *   4. clickWhenReady                       (= click send as soon as React re-enables)
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const inputEl = /** @type {HTMLElement} */ (queryFirst(sel.input) ?? discoverInputEl())
  if (!inputEl) throw new Error('[chatgpt] Input not found')

  const fileInput = await findFileInput(
    inputEl,
    /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn)),
    ATTACH_BTN_SELECTORS
  )
  if (!fileInput) throw new Error('[chatgpt] No file input found. File upload may not be available on this page.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  // Wait for the upload to complete — the send button is our signal.
  await waitForSubmitEnabled(sel.submitBtn, 15000)

  // Inject prompt WITHOUT auto-submit so we fully control the click timing.
  const prompt = `I've attached our full conversation history from ${sourcePlatform}. Please read the context file and briefly acknowledge the main topics so we can continue from where we left off.`
  await injectText(prompt, sel, { autoSubmit: false })

  // Click send as soon as React registers the text and re-enables the button.
  await clickWhenReady(sel.submitBtn, inputEl, 8000)
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

// @ts-check
import { injectAndSubmit, setContentEditable, setNativeValue, simulateEnter, clickElement, sleep, clearInput } from '../shared/eventSimulator.js'
import { splitIntoChunks, wrapChunk } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'
import { discoverInputEl, findFileInput, getInputAreaRoot, waitForFileChip } from '../shared/domDiscovery.js'

const CHUNK_SIZE  = 9500
const CHUNK_DELAY = 2000

/**
 * Waits for any selector in `sel.input` to appear, trying the full list every
 * 200 ms. Much more robust than waitForElement which only checks the first
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
  return discoverInputEl()
}

/**
 * Injects text into Copilot's input and submits it.
 *
 * Tries three submit methods on every attempt in order:
 *   1. Click the send button (re-queried fresh — Copilot re-renders it on text change)
 *   2. form.requestSubmit() — works even when the button selector misses
 *   3. Enter keydown on the focused input
 *
 * @param {HTMLElement} input
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
async function copilotInjectAndSubmit(input, text, sel) {
  if (input.getAttribute('contenteditable') === 'true' || input.isContentEditable) {
    await setContentEditable(input, text)
  } else {
    setNativeValue(/** @type {HTMLInputElement} */ (input), text)
  }

  await sleep(500)

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await sleep(600)

    input.focus()
    await sleep(80)

    const btn = /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn))
    if (btn?.isConnected) clickElement(btn)

    await sleep(200)

    const form = /** @type {HTMLFormElement|null} */ (input.closest('form'))
    if (form) {
      try { form.requestSubmit() } catch (_) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      }
    }

    await sleep(200)
    simulateEnter(input)
    await sleep(1000)

    const isEmpty = input.isContentEditable
      ? !(input.textContent ?? '').trim()
      : !(/** @type {HTMLTextAreaElement} */ (input).value ?? '').trim()

    if (isEmpty) return
  }
}

/**
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const input = queryFirst(sel.input) ?? await waitForCopilotInput(sel, 20000)
  if (!input) throw new Error('[copilot] Input element not found')
  await injectAndSubmit(input, () => queryFirst(sel.submitBtn), text, opts)
}

/** Fast-path selectors for Copilot's attach button — tried before probing. */
const ATTACH_BTN_SELECTORS = [
  'button[aria-label="Attach files"]',
  'button[aria-label="Attach file"]',
  'button[aria-label="Add attachment"]',
  'button[data-testid="attach-button"]',
  'button[aria-label*="Attach" i]',
  'button[aria-label*="Upload" i]',
  'button[aria-label*="Add image" i]',
  'button[aria-label*="Add file" i]',
]

/**
 * Attaches a markdown file to Copilot and sends a context prompt.
 * Uses the universal findFileInput() pipeline from domDiscovery.
 *
 * Copilot sometimes pre-renders input[type="file"] (Phase 1 catches it),
 * otherwise the attach button is found via ATTACH_BTN_SELECTORS (Phase 2).
 *
 * @param {string} markdownContent
 * @param {string} sourcePlatform
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectFile(markdownContent, sourcePlatform, sel) {
  const inputEl = /** @type {HTMLElement} */ (queryFirst(sel.input) ?? await waitForCopilotInput(sel))
  if (!inputEl) throw new Error('[copilot] Input not found')

  const fileInput = await findFileInput(inputEl, /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn)), ATTACH_BTN_SELECTORS)
  if (!fileInput) throw new Error('[copilot] No file input found. File upload may not be available on this page.')

  const file = new File([markdownContent], `context-from-${sourcePlatform}.md`, { type: 'text/plain' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new InputEvent('input', { bubbles: true }))

  // Wait for Copilot to show the file chip (DOM settles 300 ms after last mutation)
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

    const input = queryFirst(sel.input) ?? await waitForCopilotInput(sel, 20000)
    if (!input) throw new Error('[copilot] Input not found')

    await copilotInjectAndSubmit(input, wrapChunk(chunks[i], i + 1, chunks.length, isLast), sel)

    if (isLast) {
      await sleep(500)
      const inp = /** @type {HTMLElement|null} */ (queryFirst(sel.input))
      if (inp) await clearInput(inp)
    } else {
      for (let t = 0; t < 30; t++) {
        const stop = /** @type {HTMLElement|null} */ (queryFirst(sel.stopBtn))
        if (stop) { clickElement(stop); break }
        await sleep(150)
      }
      await sleep(CHUNK_DELAY)
    }
  }
}

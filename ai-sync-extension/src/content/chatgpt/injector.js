// @ts-check
import { injectAndSubmit, sleep } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { buildContextPrompt, buildMemoryPrompt } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'

/**
 * Injects `text` into the ChatGPT prompt area.
 *
 * ChatGPT uses a ProseMirror contenteditable div (#prompt-textarea).
 * setContentEditable() drives it through execCommand so ProseMirror's
 * internal transaction stack stays in sync.
 *
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const input = /** @type {HTMLElement|null} */ (
    queryFirst(sel.input) ?? await waitForElement(sel.input.split(',')[0].trim())
  )
  if (!input) throw new Error('[chatgpt] Input element not found')

  const submit = /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn))

  await injectAndSubmit(input, submit, text, opts)
}

/**
 * Export mode: prime the ChatGPT window with full conversation context.
 *
 * @param {import('../shared/parser.js').ConvMsg[]} conversation
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectConversation(conversation, sel) {
  const prompt = buildContextPrompt(conversation)
  await injectText(prompt, sel, { autoSubmit: false })
}

/**
 * Export Memory: extract user-shared facts and inject as a "remember this" prompt.
 * Auto-submits so the target AI immediately processes and confirms the memory.
 *
 * @param {import('../shared/parser.js').ConvMsg[]} conversation
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectMemory(conversation, sel) {
  const prompt = buildMemoryPrompt(conversation)
  if (!prompt) throw new Error('No user messages found to transfer as memory')
  await injectText(prompt, sel, { autoSubmit: true })
}

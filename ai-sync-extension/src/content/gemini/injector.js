// @ts-check
import { injectAndSubmit } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { buildContextPrompt, buildMemoryPrompt } from '../shared/parser.js'
import { queryFirst } from '../shared/selectorConfig.js'

/**
 * Gemini uses a Quill editor (.ql-editor[contenteditable="true"]) inside a
 * <rich-textarea> custom element.  Quill listens for MutationObserver changes
 * and InputEvents on the .ql-editor div, so execCommand('insertText') is the
 * correct injection path — same as ProseMirror.
 *
 * @param {string} text
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectText(text, sel, opts = {}) {
  const selectorStr = sel.input.split(',')[0].trim()
  const input = /** @type {HTMLElement|null} */ (
    queryFirst(sel.input) ?? await waitForElement(selectorStr, 8000)
  )
  if (!input) throw new Error('[gemini] Quill editor not found')

  const submit = /** @type {HTMLElement|null} */ (queryFirst(sel.submitBtn))

  await injectAndSubmit(input, submit, text, opts)
}

/**
 * @param {import('../shared/parser.js').ConvMsg[]} conversation
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectConversation(conversation, sel) {
  const prompt = buildContextPrompt(conversation)
  await injectText(prompt, sel, { autoSubmit: false })
}

/**
 * @param {import('../shared/parser.js').ConvMsg[]} conversation
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectMemory(conversation, sel) {
  const prompt = buildMemoryPrompt(conversation)
  if (!prompt) throw new Error('No user messages found to transfer as memory')
  await injectText(prompt, sel, { autoSubmit: true })
}

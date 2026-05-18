// @ts-check
import { injectAndSubmit, sleep } from '../shared/eventSimulator.js'
import { waitForElement } from '../shared/observer.js'
import { buildContextPrompt } from '../shared/parser.js'
import { queryFirst, queryAll } from '../shared/selectorConfig.js'

// Copilot enforces an ~8000-char limit on the input field.
// We stay well under it to leave room for the prompt wrapper text.
const CHAR_LIMIT = 7000

/**
 * Injects `text` into the Copilot input and optionally submits.
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
  if (!input) throw new Error('[copilot] Input element not found')

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
 * Injects memory into Copilot.
 *
 * If the full prompt exceeds CHAR_LIMIT, it is automatically split into
 * multiple messages. Each chunk is sent and we wait for Copilot to finish
 * responding before sending the next one, so the AI accumulates all facts.
 *
 * @param {import('../shared/parser.js').ConvMsg[]} conversation
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 */
export async function injectMemory(conversation, sel) {
  const userMsgs = conversation
    .filter((m) => m.role === 'user')
    .map((m) => m.text.slice(0, 500)) // per-message cap matches parser.js

  if (!userMsgs.length) throw new Error('No user messages found to transfer as memory')

  const chunks = buildChunks(userMsgs)

  if (chunks.length === 1) {
    // Fits in one message — use the standard single-shot path
    await injectText(buildSinglePrompt(chunks[0]), sel, { autoSubmit: true })
    return
  }

  // Multi-chunk path: send each part and wait for Copilot to respond before next
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const prompt = buildChunkPrompt(chunks[i], i + 1, chunks.length, isLast)

    const beforeCount = queryAll(sel.assistantMessages).length
    await injectText(prompt, sel, { autoSubmit: true })

    if (!isLast) {
      await waitForNewResponse(sel, beforeCount)
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking helpers
// ---------------------------------------------------------------------------

/**
 * Splits numbered user messages into groups that each fit within CHAR_LIMIT,
 * accounting for the wrapper text added by buildChunkPrompt.
 *
 * @param {string[]} msgs
 * @returns {string[][]}
 */
function buildChunks(msgs) {
  const WRAPPER_OVERHEAD = 400 // headroom for the prompt wrapper text
  const budget = CHAR_LIMIT - WRAPPER_OVERHEAD

  /** @type {string[][]} */
  const chunks = []
  let current = []
  let currentLen = 0

  for (let i = 0; i < msgs.length; i++) {
    const line = `${i + 1}. ${msgs[i]}`
    if (currentLen + line.length > budget && current.length > 0) {
      chunks.push(current)
      current = [line]
      currentLen = line.length
    } else {
      current.push(line)
      currentLen += line.length
    }
  }
  if (current.length) chunks.push(current)

  return chunks
}

/** @param {string[]} items */
function buildSinglePrompt(items) {
  return [
    'I need you to remember the following information. I shared this with another AI assistant and I want you to have the same knowledge. Treat each item below as if I had told it to you directly — do not treat this as a conversation to continue.',
    '',
    '--- MEMORY TRANSFER START ---',
    items.join('\n\n'),
    '--- MEMORY TRANSFER END ---',
    '',
    'Please confirm you have read and memorized this information by briefly listing the key facts.',
  ].join('\n')
}

/**
 * @param {string[]} items
 * @param {number} part
 * @param {number} total
 * @param {boolean} isLast
 */
function buildChunkPrompt(items, part, total, isLast) {
  if (part === 1) {
    return [
      `I need to share a large amount of information across ${total} messages because it exceeds the character limit. Please accumulate and remember ALL parts as they arrive. Part 1 of ${total}:`,
      '',
      `--- MEMORY PART 1/${total} ---`,
      items.join('\n\n'),
      `--- END PART 1 — part 2 coming next ---`,
    ].join('\n')
  }

  if (isLast) {
    return [
      `Memory transfer — final part (${part} of ${total}). Please add this to everything I shared in the previous ${part - 1} message(s):`,
      '',
      `--- MEMORY PART ${part}/${total} ---`,
      items.join('\n\n'),
      '--- MEMORY TRANSFER COMPLETE ---',
      '',
      `Please confirm you have received and memorized all information from all ${total} parts by briefly listing the key facts.`,
    ].join('\n')
  }

  return [
    `Memory transfer continuing — part ${part} of ${total}. Please add this to what I shared in the previous message(s):`,
    '',
    `--- MEMORY PART ${part}/${total} ---`,
    items.join('\n\n'),
    `--- END PART ${part} — part ${part + 1} coming next ---`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Response detection
// ---------------------------------------------------------------------------

/**
 * Waits until a new assistant message appears in the DOM (Copilot finished
 * responding), then waits an extra buffer before returning.
 * Falls back to a fixed delay if the count never changes.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @param {number} previousCount
 * @param {number} [timeout]
 */
async function waitForNewResponse(sel, previousCount, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    await sleep(1500)
    const current = queryAll(sel.assistantMessages).length
    if (current > previousCount) {
      // Response appeared — give it 2 extra seconds to finish streaming
      await sleep(2000)
      return
    }
  }
  // Timed out waiting — proceed anyway with a safety buffer
  await sleep(3000)
}

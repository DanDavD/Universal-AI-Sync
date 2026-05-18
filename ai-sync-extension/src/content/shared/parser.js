// @ts-check

/**
 * @typedef {{ role: 'user'|'assistant', text: string, id: string }} ConvMsg
 */

/**
 * Normalises platform-specific DOM nodes into a clean ConvMsg[].
 *
 * @param {Element[]} nodes
 * @param {(node: Element) => 'user'|'assistant'} getRoleFromNode
 * @param {(node: Element) => string} getTextFromNode
 * @returns {ConvMsg[]}
 */
export function parseNodes(nodes, getRoleFromNode, getTextFromNode) {
  /** @type {ConvMsg[]} */
  const msgs = []
  for (const node of nodes) {
    const role = getRoleFromNode(node)
    const text = getTextFromNode(node).trim()
    if (!text) continue
    msgs.push({ role, text, id: msgId(role, text) })
  }
  return msgs
}

/**
 * Stable, deterministic ID for a message — used for deduplication.
 * @param {string} role
 * @param {string} text
 */
export function msgId(role, text) {
  const sample = role + text.slice(0, 120)
  let h = 5381
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) + h) ^ sample.charCodeAt(i)
    h |= 0
  }
  return (h >>> 0).toString(36)
}

/**
 * Serialises a ConvMsg[] into a single assistant-priming prompt.
 * Used in Export Conv to give the target LLM full conversation context.
 *
 * @param {ConvMsg[]} conversation
 * @param {{ maxMessages?: number, maxCharsPerMsg?: number }} [opts]
 */
export function buildContextPrompt(conversation, opts = {}) {
  const { maxMessages = 30, maxCharsPerMsg = 3000 } = opts
  const recent = conversation.slice(-maxMessages)

  const lines = recent.map((m) => {
    const label = m.role === 'user' ? 'Human' : 'Assistant'
    const body = m.text.length > maxCharsPerMsg ? m.text.slice(0, maxCharsPerMsg) + '…' : m.text
    return `${label}: ${body}`
  })

  return [
    '[Conversation context — please continue from where this left off]',
    '---',
    ...lines,
    '---',
    'Assistant:',
  ].join('\n')
}

/**
 * Builds a memory-transfer prompt from a conversation.
 *
 * Extracts ONLY the user messages — these contain the facts, data, and
 * instructions the human shared with the source AI.  The target AI is asked
 * to internalize them as if told directly, not to continue a conversation.
 *
 * @param {ConvMsg[]} conversation
 * @param {{ maxMessages?: number }} [opts]
 * @returns {string|null}  null if there are no user messages to transfer
 */
export function buildMemoryPrompt(conversation, opts = {}) {
  const { maxMessages = 60 } = opts

  const userMsgs = conversation
    .filter((m) => m.role === 'user')
    .slice(-maxMessages)

  if (!userMsgs.length) return null

  const numbered = userMsgs
    .map((m, i) => `${i + 1}. ${m.text}`)
    .join('\n\n')

  return [
    'I need you to remember the following information. I shared this with another AI assistant and I want you to have the same knowledge. Treat each item below as if I had told it to you directly — do not treat this as a conversation to continue.',
    '',
    '--- MEMORY TRANSFER START ---',
    numbered,
    '--- MEMORY TRANSFER END ---',
    '',
    'Please confirm you have read and memorized this information by briefly listing the key facts.',
  ].join('\n')
}

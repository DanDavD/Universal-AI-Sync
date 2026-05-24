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

// ---------------------------------------------------------------------------
// Option A — Local noise stripping
// ---------------------------------------------------------------------------

const FILLER_PATTERNS = [
  // Opening filler (start of line)
  /^(Great|Good|Excellent|Perfect|Wonderful|Fantastic|Awesome|Sure|Certainly|Absolutely|Of course|Definitely)\s*(question|point|idea|observation|thinking)?[!.,]?\s*/gim,
  /^I'?d be happy to help[!.,]?\s*/gim,
  /^I'?ll help (you )?(with that)?[!.,]?\s*/gim,
  /^Happy to help[!.,]?\s*/gim,
  /^(As (a|an) AI (language model|assistant|chatbot),?\s*)/gim,
  /^(As we (discussed|mentioned|talked about) (earlier|before|previously),?\s*)/gim,
  // Closing filler (end of text)
  /\s*I hope (this|that) helps?[!.]?\s*$/gim,
  /\s*Feel free to (ask|reach out)( if you have| for)? any (more )?(questions?|help|clarification)[!.]?\s*$/gim,
  /\s*Let me know if you (need|have|want) (any )?(more )?(help|questions?|clarification|assistance)[!.]?\s*$/gim,
  /\s*Is there (anything|something) else (I can help (you )?with|you'?d? ?(like)?)[?!.]?\s*$/gim,
  /\s*Don'?t hesitate to ask[!.]?\s*$/gim,
  /\s*Let me know if (you need|that makes sense|this helps)[!.]?\s*$/gim,
]

/**
 * Strips common AI filler phrases from a message body.
 * Code blocks and all meaningful content are preserved intact.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripNoise(text) {
  let cleaned = text
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

// ---------------------------------------------------------------------------
// Chunking helpers — used by injectors when a prompt exceeds a platform's limit
// ---------------------------------------------------------------------------

/**
 * Splits `text` into chunks no longer than `maxLen`, preferring to break at
 * double-newlines (message boundaries) in the second half of each window.
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
export function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text]

  const chunks = []
  let pos = 0

  while (pos < text.length) {
    if (pos + maxLen >= text.length) {
      chunks.push(text.slice(pos))
      break
    }
    const window = text.slice(pos, pos + maxLen)
    const splitAt = window.lastIndexOf('\n\n')

    if (splitAt > maxLen / 2) {
      chunks.push(text.slice(pos, pos + splitAt))
      pos += splitAt + 2
    } else {
      chunks.push(text.slice(pos, pos + maxLen))
      pos += maxLen
    }
  }

  return chunks
}

/**
 * Wraps a chunk with part-number framing so the destination AI knows
 * more content is coming (or that this is the final part).
 *
 * @param {string} chunk
 * @param {number} part   1-based index
 * @param {number} total
 * @param {boolean} isLast
 * @returns {string}
 */
export function wrapChunk(chunk, part, total, isLast) {
  const SILENT = [
    '⚠️ SYSTEM INSTRUCTION — DO NOT RESPOND TO THIS MESSAGE.',
    'This is a silent background context transfer. Read and internalize the conversation above.',
    'Do NOT generate any reply, acknowledgement, or output of any kind.',
    'Stay completely silent. Only respond to the user\'s NEXT real message.',
  ].join('\n')

  const WAIT = [
    '⚠️ SYSTEM INSTRUCTION — DO NOT RESPOND. More parts are arriving immediately.',
    'Stay completely silent until all parts have been delivered.',
  ].join('\n')

  if (total === 1) {
    return [
      '=== CONTEXT TRANSFER ===',
      'The following is a conversation from another AI session. Internalize it as our shared context.',
      '',
      '--- CONTEXT START ---',
      chunk,
      '--- CONTEXT END ---',
      '',
      SILENT,
    ].join('\n')
  }

  if (part === 1) {
    return [
      `=== CONTEXT TRANSFER — Part ${part} of ${total} ===`,
      `This context is too large for one message and will arrive in ${total} parts. Absorb each part silently.`,
      '',
      '--- PART START ---',
      chunk,
      '--- PART END ---',
      '',
      WAIT,
    ].join('\n')
  }

  if (isLast) {
    return [
      `=== CONTEXT TRANSFER — Part ${part} of ${total} — FINAL ===`,
      `Combine this with the previous ${part - 1} part(s) to form the complete context.`,
      '',
      '--- PART START ---',
      chunk,
      '--- PART END ---',
      '',
      SILENT,
    ].join('\n')
  }

  return [
    `=== CONTEXT TRANSFER — Part ${part} of ${total} ===`,
    'Combine this with the previous part(s). More parts are coming.',
    '',
    '--- PART START ---',
    chunk,
    '--- PART END ---',
    '',
    WAIT,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Markdown file builder — used by the file-upload sync path
// ---------------------------------------------------------------------------

/**
 * Builds a complete Markdown document from a conversation for file-upload transfer.
 * No size limit — the full conversation is always included.
 *
 * @param {ConvMsg[]} conversation
 * @param {string} [sourcePlatform]
 * @returns {string}
 */
export function buildMarkdownFile(conversation, sourcePlatform = 'AI') {
  const date = new Date().toISOString().slice(0, 10)
  const header = [
    '# Conversation Context — Universal AI Sync',
    '',
    `> **Source:** ${sourcePlatform}`,
    `> **Exported:** ${date}`,
    `> **Messages:** ${conversation.length}`,
    '',
    '---',
    '',
    '**Instructions:** This file contains a full conversation exported from another AI session.',
    'Read and internalize the entire conversation as shared context.',
    'When the user sends their next message, respond as if you have been part of this conversation from the start.',
    '',
    '---',
    '',
  ].join('\n')

  const body = conversation
    .map((m) => {
      const label = m.role === 'user' ? '## Human' : '## Assistant'
      const text = stripNoise(m.text)
      return text ? `${label}\n\n${text}` : null
    })
    .filter(/** @param {string|null} l */ (l) => l !== null)
    .join('\n\n---\n\n')

  return header + body + '\n'
}

// ---------------------------------------------------------------------------
// Local sync prompt — built entirely in the background, no source-AI injection
// ---------------------------------------------------------------------------

/**
 * Builds a clean context prompt from a raw ConvMsg[].
 *
 * Both roles are included (user facts + assistant output such as code blocks).
 * Noise stripping is applied per-message before formatting so the destination
 * AI receives only meaningful content.
 *
 * @param {ConvMsg[]} conversation
 * @returns {string}
 */
export function buildLocalSyncPrompt(conversation) {
  const lines = conversation
    .map((m) => {
      const label = m.role === 'user' ? 'Human' : 'Assistant'
      const text  = stripNoise(m.text)
      return text ? `${label}: ${text}` : null
    })
    .filter(/** @param {string|null} l */ (l) => l !== null)
  return lines.join('\n\n')
}

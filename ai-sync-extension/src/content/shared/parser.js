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
  const FINAL_INSTRUCTION = [
    'IMPORTANT: Do NOT reproduce any code. Do NOT write lengthy explanations.',
    'Reply ONLY with:',
    '1. A one-line confirmation that you received the full context.',
    '2. A short bullet list of the key topics/facts you now have.',
    'Nothing else.',
  ].join('\n')

  const ACK_INSTRUCTION = 'IMPORTANT: Reply with ONLY "Part ' + part + '/' + total + ' received." — nothing else. More parts are coming immediately.'

  if (total === 1) {
    return [
      '[Context Transfer]',
      '',
      chunk,
      '',
      FINAL_INSTRUCTION,
    ].join('\n')
  }

  if (part === 1) {
    return [
      `[Context Transfer — Part ${part}/${total}]`,
      `This context exceeds the message limit and will arrive in ${total} parts.`,
      '',
      chunk,
      '',
      ACK_INSTRUCTION,
    ].join('\n')
  }

  if (isLast) {
    return [
      `[Context Transfer — Part ${part}/${total} — FINAL]`,
      `Please add this to the previous ${part - 1} part(s):`,
      '',
      chunk,
      '',
      FINAL_INSTRUCTION,
    ].join('\n')
  }

  return [
    `[Context Transfer — Part ${part}/${total}]`,
    'Please add this to the previous part(s):',
    '',
    chunk,
    '',
    ACK_INSTRUCTION,
  ].join('\n')
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

  return [
    '[Context Transfer] The following is a full conversation from another AI assistant session. Please read and internalize this as our shared context going forward:',
    '',
    '--- CONTEXT START ---',
    lines.join('\n\n'),
    '--- CONTEXT END ---',
    '',
    'Please confirm you have received this context by briefly acknowledging the main topics covered.',
  ].join('\n')
}

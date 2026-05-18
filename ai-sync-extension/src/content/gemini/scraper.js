// @ts-check
import { msgId } from '../shared/parser.js'
import { queryAll } from '../shared/selectorConfig.js'

/**
 * Gemini scraper.
 *
 * Uses the same pre-tagging strategy as the Claude scraper: role is determined
 * by which selector list captured the node, not by element attributes.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
export function scrapeConversation(sel) {
  const userNodes      = queryAll(sel.userMessages)
  const assistantNodes = queryAll(sel.assistantMessages)

  /** @type {{ node: Element, role: 'user'|'assistant' }[]} */
  const tagged = [
    ...userNodes.map((n) => ({ node: n, role: /** @type {'user'} */ ('user') })),
    ...assistantNodes.map((n) => ({ node: n, role: /** @type {'assistant'} */ ('assistant') })),
  ].sort((a, b) =>
    a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  )

  /** @type {import('../shared/parser.js').ConvMsg[]} */
  const result = []
  for (const { node, role } of tagged) {
    const text = extractText(node, sel.messageText).trim()
    if (text) result.push({ role, text, id: msgId(role, text) })
  }
  return result
}

/**
 * @param {Element} node
 * @param {string} textSelectors
 */
function extractText(node, textSelectors) {
  const parts = []
  for (const sel of textSelectors.split(',').map((s) => s.trim())) {
    try {
      for (const child of node.querySelectorAll(sel)) {
        const t = child.textContent?.trim()
        if (t) parts.push(t)
      }
    } catch { /* skip invalid selector */ }
  }
  return parts.length ? parts.join('\n') : (node.textContent ?? '').trim()
}

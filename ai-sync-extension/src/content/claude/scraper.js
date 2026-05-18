// @ts-check
import { msgId } from '../shared/parser.js'
import { queryAll } from '../shared/selectorConfig.js'

/**
 * Claude.ai scraper.
 *
 * Role is determined by WHICH selector list captured the node — not by any
 * attribute on the node — because Claude's data-testid values change frequently
 * and the fallback class selectors don't carry role information in attributes.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
export function scrapeConversation(sel) {
  const userNodes      = queryAll(sel.userMessages)
  const assistantNodes = queryAll(sel.assistantMessages)

  // Pre-tag each node with its role, then sort by DOM order
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
    const text = extractText(node).trim()
    if (text) result.push({ role, text, id: msgId(role, text) })
  }
  return result
}

/** @param {Element} node */
function extractText(node) {
  return node instanceof HTMLElement ? node.innerText : (node.textContent ?? '')
}

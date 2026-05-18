// @ts-check
import { msgId } from '../shared/parser.js'
import { queryAll } from '../shared/selectorConfig.js'

/**
 * ChatGPT scraper.
 *
 * Role is read from the reliable data-message-author-role attribute.
 * Text is extracted via innerText on the whole turn node — this captures
 * everything the user sees: paragraphs, bullet lists, AND code blocks (the
 * "copy boxes"), without needing to chase class names that change each deploy.
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
    const text = extractText(node).trim()
    if (text) result.push({ role, text, id: msgId(role, text) })
  }
  return result
}

/**
 * Uses innerText so the browser resolves all nested elements — paragraphs,
 * list items, pre/code blocks — into a single human-readable string, exactly
 * as the user sees it, without requiring selectors that break on DOM changes.
 *
 * @param {Element} node
 */
function extractText(node) {
  return node instanceof HTMLElement
    ? node.innerText
    : (node.textContent ?? '')
}

// @ts-check
import { parseNodes } from '../shared/parser.js'
import { queryAll } from '../shared/selectorConfig.js'

/**
 * Extracts the full conversation from the ChatGPT DOM.
 *
 * ChatGPT renders each turn as a div with [data-message-author-role="user"|"assistant"].
 * Message text lives in .whitespace-pre-wrap (user) or .markdown.prose (assistant).
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
export function scrapeConversation(sel) {
  const userNodes     = queryAll(sel.userMessages)
  const assistantNodes = queryAll(sel.assistantMessages)

  // Merge and sort by DOM order so the conversation is chronological.
  const allNodes = [...userNodes, ...assistantNodes].sort(
    (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  )

  return parseNodes(
    allNodes,
    (node) => node.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant',
    (node) => extractText(node, sel.messageText),
  )
}

/**
 * @param {Element} node
 * @param {string} textSelectors
 */
function extractText(node, textSelectors) {
  const parts = []
  for (const child of queryAll(textSelectors, node)) {
    const t = child.textContent?.trim()
    if (t) parts.push(t)
  }
  return parts.length ? parts.join('\n') : (node.textContent ?? '').trim()
}

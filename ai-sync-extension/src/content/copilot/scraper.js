// @ts-check
import { msgId } from '../shared/parser.js'
import { queryAll, queryFirst } from '../shared/selectorConfig.js'

/**
 * Copilot scraper.
 *
 * Primary path: query user/assistant nodes separately by selector and sort by
 * DOM order.  Fallback: if no assistant nodes are found (Copilot's class names
 * change often), walk the chat container and infer roles by alternation — the
 * first substantive block is treated as the user turn, the second as the
 * assistant turn, etc.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
export function scrapeConversation(sel) {
  const userNodes      = queryAll(sel.userMessages)
  const assistantNodes = queryAll(sel.assistantMessages)

  // Primary path — both selectors found something
  if (userNodes.length > 0 && assistantNodes.length > 0) {
    return buildFromTagged(userNodes, assistantNodes)
  }

  // Fallback — assistant selector matched nothing; infer roles by DOM position
  if (userNodes.length > 0 && assistantNodes.length === 0) {
    return inferByAlternation(userNodes, sel)
  }

  // Nothing found at all
  return buildFromTagged(userNodes, assistantNodes)
}

/**
 * @param {Element[]} userNodes
 * @param {Element[]} assistantNodes
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
function buildFromTagged(userNodes, assistantNodes) {
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
 * For each user message node, walk up the DOM until we find a "turn" container
 * (the topmost ancestor that is a direct child of the chat container or a sibling
 * of another turn).  The NEXT sibling of that container that contains substantial
 * text is the assistant turn.
 *
 * @param {Element[]} userNodes
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
function inferByAlternation(userNodes, sel) {
  const container = queryFirst(sel.chatContainer)
  if (!container) return buildFromTagged(userNodes, [])

  const userSet = new Set(userNodes)
  /** @type {{ node: Element, role: 'user'|'assistant' }[]} */
  const tagged = []

  for (const userNode of userNodes) {
    tagged.push({ node: userNode, role: 'user' })

    // Walk up to find the direct child of the chat container (the "turn" wrapper)
    let turn = /** @type {Element} */ (userNode)
    while (turn.parentElement && turn.parentElement !== container) {
      turn = turn.parentElement
    }

    // The next sibling turn is the assistant response
    let next = turn.nextElementSibling
    while (next) {
      const text = extractText(next).trim()
      // Skip empties; skip if it contains a known user node (it's another user turn)
      if (text.length > 20 && !userSet.has(next) && !next.querySelector('[data-testid="user-message"]')) {
        tagged.push({ node: next, role: 'assistant' })
        break
      }
      next = next.nextElementSibling
    }
  }

  tagged.sort((a, b) =>
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

// @ts-check
import { msgId } from '../shared/parser.js'
import { queryAll, queryFirst } from '../shared/selectorConfig.js'

/**
 * Claude.ai scraper — multi-strategy, picks the result with the most messages.
 *
 * Strategy 1 — configured selectors (data-testid / class names).
 * Strategy 2 — broad data-testid scan: ANY element whose testid contains a
 *              role keyword ("human", "user", "ai-turn", "assistant", "claude").
 * Strategy 3 — class-name scan: same keyword matching but on className.
 * Strategy 4 — container depth walk: find the shallowest DOM level inside the
 *              conversation container where 3+ siblings have substantial text,
 *              assign roles by detected keywords or strict alternation.
 * Strategy 5 — nuclear: return the raw text of the whole conversation as a
 *              single assistant message so the destination AI gets SOMETHING.
 *
 * @param {import('../shared/selectorConfig.js').PlatformSelectors} sel
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
export function scrapeConversation(sel) {
  const candidates = [
    () => strategySelectors(sel),
    () => strategyTestidScan(),
    () => strategyClassScan(),
    () => strategyContainerWalk(sel),
  ]

  let best = /** @type {import('../shared/parser.js').ConvMsg[]} */ ([])
  for (const run of candidates) {
    try {
      const result = run()
      if (result.length > best.length) best = result
      if (best.length >= 4) break // good enough — stop early
    } catch { /* ignore strategy errors */ }
  }

  if (best.length > 0) return best

  // Strategy 5 — raw fallback: grab all visible text from the conversation
  return strategyRawText(sel)
}

// ---------------------------------------------------------------------------
// Strategy 1 — configured selectors
// ---------------------------------------------------------------------------
function strategySelectors(sel) {
  const userNodes      = queryAll(sel.userMessages)
  const assistantNodes = queryAll(sel.assistantMessages)
  return buildFromTagged(userNodes, assistantNodes)
}

// ---------------------------------------------------------------------------
// Strategy 2 — data-testid keyword scan
// ---------------------------------------------------------------------------
function strategyTestidScan() {
  /** @type {{ el: Element, role: 'user'|'assistant' }[]} */
  const found = []

  for (const el of document.querySelectorAll('[data-testid]')) {
    const testid = (el.getAttribute('data-testid') ?? '').toLowerCase()
    const role = roleFromKeyword(testid)
    if (!role) continue
    const text = getText(el)
    if (text.length < 15) continue
    // Skip if already have an ancestor — keep the outermost matching node
    if (found.some(f => f.el.contains(el))) continue
    // Replace any descendants already collected with this ancestor
    for (let i = found.length - 1; i >= 0; i--) {
      if (el.contains(found[i].el)) found.splice(i, 1)
    }
    found.push({ el, role })
  }

  return toConvMsgs(found)
}

// ---------------------------------------------------------------------------
// Strategy 3 — className keyword scan
// ---------------------------------------------------------------------------
function strategyClassScan() {
  /** @type {{ el: Element, role: 'user'|'assistant' }[]} */
  const found = []

  for (const el of document.querySelectorAll('[class]')) {
    const cls  = (typeof el.className === 'string' ? el.className : '').toLowerCase()
    const role = roleFromKeyword(cls)
    if (!role) continue
    const text = getText(el)
    if (text.length < 15) continue
    if (found.some(f => f.el.contains(el))) continue
    for (let i = found.length - 1; i >= 0; i--) {
      if (el.contains(found[i].el)) found.splice(i, 1)
    }
    found.push({ el, role })
  }

  return toConvMsgs(found)
}

// ---------------------------------------------------------------------------
// Strategy 4 — conversation container depth walk
// ---------------------------------------------------------------------------
function strategyContainerWalk(sel) {
  const container = queryFirst(sel.chatContainer)
  if (!container) return []

  // Try up to 6 levels deep, looking for a level with ≥3 children with text
  /** @type {Element[]} */
  let level = [container]
  for (let depth = 0; depth < 6; depth++) {
    /** @type {Element[]} */
    const children = []
    for (const node of level) {
      for (const child of Array.from(node.children)) {
        if (getText(child).length >= 15) children.push(child)
      }
    }
    if (children.length >= 3) {
      return labelAndBuild(children)
    }
    if (children.length === 0) break
    level = children
  }

  return labelAndBuild(level)
}

/**
 * Assigns roles to a flat list of elements by keyword detection + alternation.
 * @param {Element[]} els
 */
function labelAndBuild(els) {
  /** @type {{ el: Element, role: 'user'|'assistant' }[]} */
  const tagged = []
  let altRole = /** @type {'user'|'assistant'} */ ('user')

  for (const el of els) {
    const hint = (el.getAttribute('data-testid') ?? '') + ' ' +
                 (typeof el.className === 'string' ? el.className : '')
    const role = roleFromKeyword(hint.toLowerCase()) ?? altRole
    altRole = role === 'user' ? 'assistant' : 'user'
    tagged.push({ el, role })
  }

  return toConvMsgs(tagged)
}

// ---------------------------------------------------------------------------
// Strategy 5 — raw text nuclear fallback
// ---------------------------------------------------------------------------
function strategyRawText(sel) {
  const container = queryFirst(sel.chatContainer) ?? document.querySelector('main')
  if (!container) return []
  const text = getText(container).trim()
  if (!text) return []
  return [{ role: /** @type {'assistant'} */ ('assistant'), text, id: msgId('assistant', text) }]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Determines user/assistant role from a string containing keywords.
 * Returns null if no keyword matches.
 * @param {string} s
 * @returns {'user'|'assistant'|null}
 */
function roleFromKeyword(s) {
  if (/human[\-_]?turn|user[\-_]?turn|human[\-_]?message|user[\-_]?message/.test(s)) return 'user'
  if (/ai[\-_]?turn|assistant[\-_]?turn|claude[\-_]?turn|ai[\-_]?message|assistant[\-_]?message/.test(s)) return 'assistant'
  // Looser matches — only if the tighter ones above didn't fire
  if (/\bhuman\b|\buser\b/.test(s) && !/copilot|chat|input|button|icon|header|nav|side/.test(s)) return 'user'
  if (/\bai\b|\bassistant\b|\bclaude\b/.test(s) && !/copilot|chat|input|button|icon|header|nav|side/.test(s)) return 'assistant'
  return null
}

/**
 * @param {Element[]} userNodes
 * @param {Element[]} assistantNodes
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
function buildFromTagged(userNodes, assistantNodes) {
  return toConvMsgs([
    ...userNodes.map((el) => ({ el, role: /** @type {'user'} */ ('user') })),
    ...assistantNodes.map((el) => ({ el, role: /** @type {'assistant'} */ ('assistant') })),
  ])
}

/**
 * Sorts by DOM order and converts to ConvMsg[].
 * @param {{ el: Element, role: 'user'|'assistant' }[]} tagged
 * @returns {import('../shared/parser.js').ConvMsg[]}
 */
function toConvMsgs(tagged) {
  tagged.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  )
  /** @type {import('../shared/parser.js').ConvMsg[]} */
  const result = []
  for (const { el, role } of tagged) {
    const text = getText(el).trim()
    if (text.length >= 5) result.push({ role, text, id: msgId(role, text) })
  }
  return result
}

/**
 * Gets the full text of an element.  Tries innerText first (respects layout);
 * falls back to textContent so hidden/off-screen content isn't silently dropped.
 * @param {Element} el
 * @returns {string}
 */
function getText(el) {
  if (!(el instanceof HTMLElement)) return el.textContent ?? ''
  const inner = el.innerText
  if (inner && inner.trim()) return inner
  // innerText returned empty — element may be hidden; use textContent
  return (el.textContent ?? '').replace(/[ \t]{2,}/g, ' ').trim()
}

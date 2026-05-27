// @ts-check
/**
 * Behavioral DOM discovery — shared across all 4 platform injectors.
 *
 * Elements are found by visual position and interaction outcome, NOT by
 * CSS class names, aria-labels, or component tag names. This makes the
 * extension resilient to DOM updates by any platform without code changes.
 */

import { sleep, clickElement } from './eventSimulator.js'

// ─── Shadow DOM traversal ─────────────────────────────────────────────────────

/**
 * Recursively queries through open Shadow DOM boundaries — first match.
 * @param {string} selector
 * @param {Document|Element|ShadowRoot} root
 * @returns {Element|null}
 */
export function deepQuery(selector, root = document) {
  const hit = root.querySelector(selector)
  if (hit) return hit
  for (const el of root.querySelectorAll('*')) {
    const sr = /** @type {any} */ (el).shadowRoot
    if (sr) {
      const found = deepQuery(selector, sr)
      if (found) return found
    }
  }
  return null
}

/**
 * Recursively collects ALL elements matching a selector across Shadow DOM.
 * @param {string} selector
 * @param {Document|Element|ShadowRoot} root
 * @param {Element[]} [acc]
 * @returns {Element[]}
 */
export function deepQueryAll(selector, root = document, acc = []) {
  acc.push(...root.querySelectorAll(selector))
  for (const el of root.querySelectorAll('*')) {
    const sr = /** @type {any} */ (el).shadowRoot
    if (sr) deepQueryAll(selector, sr, acc)
  }
  return acc
}

// ─── Input area scoping ───────────────────────────────────────────────────────

/**
 * Walks UP the DOM from the text input element to find its toolbar container.
 *
 * Universal heuristic — a chat input toolbar is:
 *   • a <form> element, OR
 *   • wide  (> 45 % of viewport width)
 *   • short (< 40 % of viewport height)
 *   • in the bottom half of the viewport (top > 40 % of vh)
 *
 * Starting from the *known* input (not from document) guarantees we never
 * drift into the sidebar or header — we only go UP, never sideways.
 *
 * @param {Element} inputEl
 * @returns {Element}
 */
export function getInputAreaRoot(inputEl) {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let el = /** @type {Element|null} */ (inputEl.parentElement)
  while (el && el !== document.body) {
    if (el.tagName.toLowerCase() === 'form') return el
    const r = el.getBoundingClientRect()
    if (r.width > vw * 0.45 && r.height > 0 && r.height < vh * 0.4 && r.top > vh * 0.4) {
      return el
    }
    el = el.parentElement
  }
  // <main> excludes sidebar <nav> but still covers the full chat area
  return document.querySelector('main') ?? document.body
}

// ─── Text input discovery ─────────────────────────────────────────────────────

/**
 * Behavioral fallback to find the text input when CSS selectors fail.
 *
 * The chat input is the BOTTOM-MOST visible contenteditable / textarea in
 * the main content area that is sized like an input box (not a sent message).
 *
 * @returns {HTMLElement|null}
 */
export function discoverInputEl() {
  const scope = document.querySelector('main, [role="main"]') ?? document.body
  const vh = window.innerHeight

  const candidates = /** @type {HTMLElement[]} */ (
    [...scope.querySelectorAll('[contenteditable="true"], textarea')]
  ).filter(el => {
    const r = el.getBoundingClientRect()
    // Visible, reasonable input-box dimensions, in the lower part of the screen
    return r.width > 80 && r.height > 15 && r.height < 350 && r.bottom > vh * 0.3
  })

  if (!candidates.length) return null
  // Bottom-most element = closest to page bottom = the active input
  candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)
  return candidates[0]
}

// ─── File attachment ──────────────────────────────────────────────────────────

/** Matches upload-related menu item text — intentionally broad to survive wording changes. */
const UPLOAD_ITEM_PATTERN = /upload|add\s+file|attach|from\s+device|local\s+file/i

/**
 * Aria-label patterns that identify NON-attach icon buttons near the input.
 * These are excluded when probing so we never accidentally click send/mic/etc.
 */
const SKIP_BTN_PATTERN = /send|submit|microphone|mic\b|camera|screenshot|search|stop|clear|delete|remove|emoji|reaction/i

/**
 * Finds an upload-related item inside any currently open dropdown/popup menu.
 * @returns {HTMLElement|null}
 */
export function findUploadMenuItem() {
  const nodes = document.querySelectorAll(
    '[role="menuitem"],[role="option"],.mat-menu-item,[mat-menu-item],ms-menu-item,li[role="presentation"] button'
  )
  for (const el of nodes) {
    if (UPLOAD_ITEM_PATTERN.test((el.textContent ?? '') + (el.getAttribute('aria-label') ?? ''))) {
      return /** @type {HTMLElement} */ (el)
    }
  }
  return null
}

/** Closes any open popup / dropdown silently. */
export async function dismissPopup() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await sleep(150)
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(150)
}

/**
 * Clicks a button and resolves with the file input it triggers, or null.
 *
 * Three parallel detection methods provide full coverage regardless of how
 * each platform internally triggers its file picker:
 *   A. Monkey-patch HTMLInputElement.prototype.click  → programmatic .click()
 *   B. Capture-phase composedPath listener            → shadow DOM dispatches
 *   C. MutationObserver                               → dynamic adds + menu nav
 *
 * @param {HTMLElement} btn
 * @param {number} [timeoutMs]  800ms for probing candidates; 5000ms for known buttons
 * @returns {Promise<HTMLInputElement|null>}
 */
export function openFileInputViaBtn(btn, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false
    /** @type {MutationObserver|null} */
    let mo = null

    /** @param {HTMLInputElement|null} inp */
    const done = (inp) => {
      if (settled) return
      settled = true
      mo?.disconnect()
      HTMLInputElement.prototype.click = origClick
      document.removeEventListener('click', onCapture, true)
      clearTimeout(timer)
      resolve(inp)
    }

    // A — programmatic .click() on a hidden file input
    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') done(/** @type {HTMLInputElement} */ (this))
      else origClick.call(this)
    }

    // B — shadow DOM click dispatch via composedPath
    const onCapture = (/** @type {Event} */ e) => {
      const path = /** @type {EventTarget[]} */ (e.composedPath())
      const inp = /** @type {HTMLInputElement|undefined} */ (
        path.find(t => t instanceof HTMLInputElement && /** @type {HTMLInputElement} */ (t).type === 'file')
      )
      if (inp) { e.preventDefault(); e.stopImmediatePropagation(); done(inp) }
    }
    document.addEventListener('click', onCapture, true)

    // C — MutationObserver: catches dynamically added inputs AND auto-clicks upload menu items
    mo = new MutationObserver(() => {
      if (settled) return
      const fi = /** @type {HTMLInputElement|null} */ (deepQuery('input[type="file"]'))
      if (fi) { done(fi); return }
      const item = findUploadMenuItem()
      if (item) clickElement(item)
    })
    mo.observe(document.body, { childList: true, subtree: true })

    const timer = setTimeout(() => done(null), timeoutMs)
    clickElement(btn)

    // Poll for slow-animated menus (covers Angular Material menu transitions)
    let polls = 0
    const poll = () => {
      if (settled || ++polls > 25) return
      const item = findUploadMenuItem()
      if (item) clickElement(item)
      else setTimeout(poll, 200)
    }
    setTimeout(poll, 300)
  })
}

/**
 * Universal file-input discovery pipeline — works for all 4 platforms.
 *
 * ┌─ Phase 1 – pre-rendered check (instant, no clicking) ──────────────────┐
 * │ Claude and ChatGPT keep a hidden file input in the DOM at all times.   │
 * │ We find it in < 150 ms without any button interaction.                 │
 * │ Scoped to exclude profile / avatar uploaders in nav / header.          │
 * └────────────────────────────────────────────────────────────────────────┘
 * ┌─ Phase 2 – known selectors (one click, fast) ───────────────────────────┐
 * │ Platform-supplied selectors scoped to the input area root.             │
 * │ Covers normal operation for Gemini, Copilot, and when Phase 1 misses.  │
 * │ A single clean click → menu navigation → file input resolved.          │
 * └────────────────────────────────────────────────────────────────────────┘
 * ┌─ Phase 3 – proximity-sorted probing (selector-free safety net) ─────────┐
 * │ Only runs after a major DOM redesign that broke both phases above.     │
 * │ Collects ALL small buttons near the input, sorted by physical distance.│
 * │ The correct button is almost always #1 (it's right next to the input). │
 * │ Each probe: 800 ms timeout — fast enough to be invisible in practice.  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * @param {HTMLElement} inputEl
 * @param {HTMLElement|null} submitEl
 * @param {string[]} [knownSelectors]
 * @returns {Promise<HTMLInputElement|null>}
 */
export async function findFileInput(inputEl, submitEl, knownSelectors = []) {
  const inputAreaRoot = getInputAreaRoot(inputEl)

  // Phase 1a — scoped to input area (tightest scope, safest)
  for (let i = 0; i < 3; i++) {
    const fi = /** @type {HTMLInputElement|null} */ (deepQuery('input[type="file"]', inputAreaRoot))
    if (fi) return fi
    await sleep(50)
  }

  // Phase 1b — page-wide but skip nav / header (catches pre-rendered inputs
  //            that live outside the toolbar, e.g. Claude's hidden file input)
  for (const el of document.querySelectorAll('input[type="file"]')) {
    if (!el.closest('nav, header, [role="banner"], [role="navigation"]')) {
      return /** @type {HTMLInputElement} */ (el)
    }
  }

  // Phase 2 — known selectors → single click on the identified button
  if (knownSelectors.length > 0) {
    let btn = /** @type {HTMLElement|null} */ (null)
    for (const s of knownSelectors) {
      btn = /** @type {HTMLElement|null} */ (deepQuery(s, inputAreaRoot))
      if (btn) break
    }
    // One broader fallback: <main> (still excludes sidebar)
    if (!btn) {
      const main = document.querySelector('main')
      if (main) {
        for (const s of knownSelectors) {
          btn = /** @type {HTMLElement|null} */ (deepQuery(s, main))
          if (btn) break
        }
      }
    }
    if (btn) {
      const fi = await openFileInputViaBtn(btn, 5000)
      if (fi) return fi
    }
  }

  // Phase 3 — probe buttons near the input (no selector knowledge needed)
  const allBtns = /** @type {HTMLElement[]} */ (deepQueryAll('button,[role="button"]', inputAreaRoot))
  const candidates = allBtns.filter(el => {
    if (el === inputEl || el === submitEl) return false
    if ((el.textContent ?? '').trim().length > 20) return false     // text button
    if (SKIP_BTN_PATTERN.test(el.getAttribute('aria-label') ?? '')) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })

  if (!candidates.length) return null

  // Sort by physical proximity to the input — closest button first
  const ir = inputEl.getBoundingClientRect()
  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect()
    return Math.hypot(ar.left - ir.left, ar.top - ir.top) -
           Math.hypot(br.left - ir.left, br.top - ir.top)
  })

  for (const btn of candidates.slice(0, 8)) {
    const fi = await openFileInputViaBtn(btn, 800)
    if (fi) return fi
    await dismissPopup()
  }

  return null
}

// ─── File chip detection ──────────────────────────────────────────────────────

/**
 * Waits until the platform shows a file attachment chip in the input area,
 * which signals that the file has been fully processed and is ready to send.
 *
 * Uses a MutationObserver with a 300 ms debounce so we resolve only after the
 * DOM stops changing — this handles cases where the chip is added in multiple
 * mutations (e.g. ChatGPT adding the chip element + its children + its styles).
 *
 * Falls back after timeoutMs regardless, so the prompt is always sent even
 * if the chip never appears (e.g. the platform skips the chip UI).
 *
 * @param {Element} inputAreaRoot  - The input toolbar container from getInputAreaRoot()
 * @param {number}  [timeoutMs]    - Max wait before proceeding anyway (default 10 s)
 * @returns {Promise<void>}
 */
export function waitForFileChip(inputAreaRoot, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let finished = false
    /** @type {ReturnType<typeof setTimeout>|null} */
    let debounce = null

    const finish = () => {
      if (finished) return
      finished = true
      if (debounce) clearTimeout(debounce)
      mo.disconnect()
      clearTimeout(hardLimit)
      resolve()
    }

    // Each time the DOM inside the input area changes, reset a 300 ms debounce.
    // We resolve 300 ms after the LAST mutation — the chip is fully rendered by then.
    const mo = new MutationObserver(() => {
      if (finished) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(finish, 300)
    })
    mo.observe(inputAreaRoot, { childList: true, subtree: true })

    // Hard timeout — proceed even if no chip ever appears
    const hardLimit = setTimeout(finish, timeoutMs)
  })
}

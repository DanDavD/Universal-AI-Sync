// @ts-check

/**
 * React-safe event simulation for AI chat input fields.
 *
 * The core problem: React tracks input values through its synthetic event
 * system and its internal fiber reconciler.  Simply writing `el.value = "..."`
 * is silently overwritten by React on the next render because React's internal
 * `_valueTracker` still holds the old value, so it believes no change occurred.
 *
 * Fix: use the native HTMLInputElement.prototype value descriptor's setter,
 * which bypasses React's own setter wrapper, then dispatch a native InputEvent
 * so React's delegated listener at the root fires and reconciles state.
 *
 * For contenteditable elements (ProseMirror in ChatGPT/Claude, Quill in Gemini)
 * the strategy differs: ProseMirror owns the DOM and rebuilds it on every state
 * update, so we must drive it through its own transaction API when possible, or
 * fall back to execCommand('insertText') which fires the correct DOM events.
 */

// Cache native setters before any framework can override them.
const _inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
const _textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

/**
 * Sets value on a React/Vue-controlled <input> or <textarea> and fires the
 * synthetic events needed to trigger framework state updates.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 * @param {string} value
 */
export function setNativeValue(el, value) {
  if (el instanceof HTMLInputElement && _inputSetter) {
    _inputSetter.call(el, value)
  } else if (el instanceof HTMLTextAreaElement && _textareaSetter) {
    _textareaSetter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }))
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
}

/**
 * Sets text in a contenteditable div used by ProseMirror, Quill, or Draft.js.
 *
 * Strategy:
 *   1. Focus the element so the editor activates.
 *   2. Select all existing content.
 *   3. Use execCommand('insertText') which fires a trusted InputEvent that
 *      ProseMirror and Quill both intercept to update their internal state.
 *   4. Dispatch additional synthetic events for frameworks that listen at
 *      the element level rather than document level.
 *
 * @param {HTMLElement} el  A div[contenteditable="true"]
 * @param {string} text
 */
export async function setContentEditable(el, text) {
  el.focus()

  // Yield to the event loop before the heavy execCommand call so the browser
  // can finish any pending layout/paint and not appear frozen mid-injection.
  await new Promise((r) => setTimeout(r, 0))

  // Select everything so insertText replaces rather than appends.
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // execCommand fires a trusted InputEvent with inputType='insertText' which
  // ProseMirror and Quill handle natively, keeping their internal state in sync.
  const inserted = document.execCommand('insertText', false, text)

  if (!inserted) {
    // execCommand may be a no-op in some browsers/sandboxes — fallback path.
    el.textContent = text
    placeCursorAtEnd(el)
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      })
    )
  }

  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Moves the text cursor to the end of a contenteditable element.
 * @param {HTMLElement} el
 */
function placeCursorAtEnd(el) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Simulates pressing Enter — fires keydown/keypress/keyup in sequence.
 * Many chat inputs submit on Shift-free Enter keydown.
 *
 * @param {HTMLElement} el
 */
export function simulateEnter(el) {
  const opts = {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    composed: true,
  }
  el.dispatchEvent(new KeyboardEvent('keydown',  opts))
  el.dispatchEvent(new KeyboardEvent('keypress', opts))
  el.dispatchEvent(new KeyboardEvent('keyup',    opts))
}

/**
 * Fires a synthetic mouse click sequence on a button.
 * Using dispatchEvent(mousedown/up) + click() covers both
 * native-click listeners and React's synthetic onClick.
 *
 * @param {HTMLElement} btn
 */
export function clickElement(btn) {
  const opts = { bubbles: true, cancelable: true, composed: true }
  btn.dispatchEvent(new MouseEvent('mousedown', opts))
  btn.dispatchEvent(new MouseEvent('mouseup',   opts))
  btn.click()
}

/**
 * Full inject-and-optionally-submit sequence.
 *
 * submitElOrFn can be an element or a zero-arg function that returns a fresh
 * element reference — pass a function so retries re-query the DOM after the
 * platform re-renders (e.g. ChatGPT swaps send↔stop buttons mid-generation).
 *
 * @param {HTMLElement} inputEl
 * @param {HTMLElement|null|(() => HTMLElement|null)} submitElOrFn
 * @param {string} text
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectAndSubmit(inputEl, submitElOrFn, text, opts = {}) {
  const { autoSubmit = false } = opts
  const getBtn = typeof submitElOrFn === 'function' ? submitElOrFn : () => submitElOrFn

  inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  inputEl.focus()
  await sleep(60)

  if (inputEl.getAttribute('contenteditable') === 'true' ||
      inputEl.isContentEditable) {
    await setContentEditable(inputEl, text)
  } else {
    setNativeValue(/** @type {HTMLInputElement} */ (inputEl), text)
  }

  await sleep(120)

  if (!autoSubmit) return

  // Retry up to 3 times with a fresh button reference each attempt.
  // ChatGPT hides the send button while generating — re-querying lets us wait
  // until it reappears. Fall back to Enter on the final attempt.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      inputEl.focus()
      await sleep(150)
    }

    const btn = getBtn()
    if (btn?.isConnected) {
      clickElement(btn)
    } else {
      simulateEnter(inputEl)
    }

    await sleep(500)

    const empty = inputEl.isContentEditable
      ? !(inputEl.textContent ?? '').trim()
      : !(/** @type {HTMLInputElement} */ (inputEl).value ?? '').trim()

    if (empty) return
  }
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Finds an existing `input[type="file"]` or reveals one by clicking the
 * platform's attachment button, intercepting the `.click()` that would
 * otherwise open the native file-picker dialog.
 *
 * @param {string} [extraBtnSelector]  Extra CSS selectors prepended when
 *                                     searching for the attachment button.
 * @returns {Promise<HTMLInputElement|null>}
 */
export async function revealFileInput(extraBtnSelector = '') {
  const direct = /** @type {HTMLInputElement|null} */ (document.querySelector('input[type="file"]'))
  if (direct) return direct

  return new Promise((resolve) => {
    let settled = false
    /** @param {HTMLInputElement|null} input */
    const done = (input) => {
      if (settled) return
      settled = true
      observer.disconnect()
      HTMLInputElement.prototype.click = origClick
      clearTimeout(timer)
      resolve(input)
    }

    const observer = new MutationObserver(() => {
      const found = /** @type {HTMLInputElement|null} */ (document.querySelector('input[type="file"]'))
      if (found) done(found)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') done(/** @type {HTMLInputElement} */ (this))
      else origClick.call(this)
    }

    const timer = setTimeout(() => done(null), 4000)

    const baseSel = 'button[aria-label="Attach files"],button[aria-label="Attach file"],button[aria-label="Add attachment"],button[data-testid="attach-button"]'
    const btnSel  = extraBtnSelector ? `${extraBtnSelector},${baseSel}` : baseSel
    const btn     = /** @type {HTMLElement|null} */ (document.querySelector(btnSel))
    if (!btn) { done(null); return }
    btn.click()

    // ChatGPT shows a "+" menu — click the Upload/file item once it renders
    setTimeout(() => {
      if (settled) return
      const items = Array.from(document.querySelectorAll('[role="menuitem"],[role="option"]'))
      const upload = /** @type {HTMLElement|undefined} */ (
        items.find((el) => /upload|file/i.test(el.textContent ?? ''))
      )
      upload?.click()
    }, 400)
  })
}

/**
 * Tries to read the platform's hard character limit directly from the input
 * element. Works for <textarea maxlength="N"> (some Copilot builds).
 * Returns null when the limit isn't exposed in the DOM.
 *
 * @param {HTMLElement} el
 * @returns {number|null}
 */
export function detectInputLimit(el) {
  if (el instanceof HTMLTextAreaElement && el.maxLength > 0 && el.maxLength < 100000) {
    return el.maxLength
  }
  for (const attr of ['data-max-length', 'data-maxlength', 'maxlength']) {
    const val = el.getAttribute(attr)
    if (val) {
      const n = parseInt(val, 10)
      if (n > 0 && n < 100000) return n
    }
  }
  return null
}

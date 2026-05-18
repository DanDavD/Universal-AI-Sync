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
 * @param {HTMLElement} inputEl
 * @param {HTMLElement|null} submitEl  Pass null to use simulateEnter instead.
 * @param {string} text
 * @param {{ autoSubmit?: boolean }} [opts]
 */
export async function injectAndSubmit(inputEl, submitEl, text, opts = {}) {
  const { autoSubmit = false } = opts

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

  if (autoSubmit) {
    if (submitEl) {
      clickElement(submitEl)
    } else {
      simulateEnter(inputEl)
    }
  }
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

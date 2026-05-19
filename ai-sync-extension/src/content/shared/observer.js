// @ts-check

/**
 * Low-overhead MutationObserver factory for watching AI chat streams.
 *
 * @param {Element} container - The element to observe (chat turn list).
 * @param {MutationCallback} callback
 * @param {MutationObserverInit} [options]
 * @returns {{ start(): void, stop(): void, isRunning(): boolean }}
 */
export function createChatObserver(container, callback, options = {}) {
  /** @type {MutationObserver|null} */
  let mo = null
  let running = false

  const opts = {
    childList: true,
    subtree: true,
    characterData: true, // needed to detect streaming token appends
    ...options,
  }

  return {
    start() {
      if (running) return
      mo = new MutationObserver(callback)
      mo.observe(container, opts)
      running = true
    },
    stop() {
      mo?.disconnect()
      mo = null
      running = false
    },
    isRunning: () => running,
  }
}

/**
 * Polls the DOM + uses a short-lived MutationObserver to resolve when
 * `selector` first appears. Rejects after `timeout` ms.
 *
 * @param {string} selector
 * @param {number} [timeout]
 * @returns {Promise<Element>}
 */
export function waitForElement(selector, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector)
    if (el) return resolve(el)

    let timer = 0
    const mo = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (!found) return
      clearTimeout(timer)
      mo.disconnect()
      resolve(found)
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })

    timer = window.setTimeout(() => {
      mo.disconnect()
      reject(new Error(`waitForElement: "${selector}" timed out after ${timeout}ms`))
    }, timeout)
  })
}

/**
 * Resolves when the DOM has been quiet (no mutations) for `quietMs` ms,
 * or after `timeout` ms regardless.
 *
 * @param {number} [quietMs]
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export function waitForDomQuiet(quietMs = 1500, timeout = 25000) {
  return new Promise((resolve) => {
    let quietTimer = window.setTimeout(done, quietMs)
    const failTimer = window.setTimeout(done, timeout)

    const mo = new MutationObserver(() => {
      clearTimeout(quietTimer)
      quietTimer = window.setTimeout(done, quietMs)
    })
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true })

    function done() {
      clearTimeout(quietTimer)
      clearTimeout(failTimer)
      mo.disconnect()
      resolve()
    }
  })
}

/**
 * Waits for a new assistant message to appear (count > prevCount), then waits
 * for streaming to finish (DOM quiet for 1.5 s).
 *
 * @param {string} assistantSelector  Comma-separated CSS selectors for assistant turns
 * @param {number} prevCount          Number of assistant messages before injection
 * @param {number} [timeout]          Max total wait in ms
 * @returns {Promise<void>}
 */
export async function waitForResponseComplete(assistantSelector, prevCount, timeout = 45000) {
  const deadline = Date.now() + timeout
  const selList = assistantSelector.split(',').map((s) => s.trim())

  const countMessages = () => {
    let n = 0
    for (const sel of selList) {
      try { n = Math.max(n, document.querySelectorAll(sel).length) } catch {}
    }
    return n
  }

  // Phase 1: wait for a new message node to appear
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600))
    if (countMessages() > prevCount) break
  }

  // Phase 2: wait for streaming to finish (DOM quiet for 1.5 s)
  await waitForDomQuiet(1500, Math.max(3000, deadline - Date.now()))
}

/**
 * Polls `selector` until the matched element's text/value is empty (cleared
 * after a submit), then resolves. Falls back after `timeout` ms so the loop
 * never stalls completely.
 *
 * @param {string} selector  CSS selector for the input element
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export async function waitForInputClear(selector, timeout = 6000) {
  const sel = selector.split(',')[0].trim()
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const el = /** @type {HTMLElement|null} */ (document.querySelector(sel))
    if (!el) return
    const val = el.isContentEditable ? el.textContent?.trim() : /** @type {any} */ (el).value?.trim()
    if (!val) return
    await new Promise((r) => setTimeout(r, 80))
  }
}

/**
 * Phase 1 of the two-phase chunk-pacing gate.
 *
 * Waits until the submit button disappears or becomes disabled — which means
 * the platform has accepted the previous submission and the AI has started
 * generating its acknowledgment response.
 *
 * Short timeout: if the button never goes disabled (rare), we bail and let
 * phase 2 handle it.
 *
 * @param {string} selector
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export async function waitForSubmitDisabled(selector, timeout = 3000) {
  const deadline = Date.now() + timeout
  const sels = selector.split(',').map((s) => s.trim())
  while (Date.now() < deadline) {
    let buttonEnabled = false
    for (const s of sels) {
      try {
        const btn = /** @type {HTMLButtonElement|null} */ (document.querySelector(s))
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          buttonEnabled = true
          break
        }
      } catch {}
    }
    if (!buttonEnabled) return // gone or disabled — AI is generating
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Phase 2 of the two-phase chunk-pacing gate.
 *
 * Waits until a matching submit button is back in the DOM and is enabled —
 * meaning the AI has finished its response and the platform is ready to
 * accept a new message.
 *
 * Note: offsetParent is intentionally NOT checked here because buttons inside
 * position:fixed containers return null for offsetParent even when fully
 * interactive (e.g. ChatGPT's input area).
 *
 * @param {string} selector
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export async function waitForSubmitReady(selector, timeout = 30000) {
  const deadline = Date.now() + timeout
  const sels = selector.split(',').map((s) => s.trim())
  while (Date.now() < deadline) {
    for (const s of sels) {
      try {
        const btn = /** @type {HTMLButtonElement|null} */ (document.querySelector(s))
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

/**
 * Returns a debounced version of `fn`.  Useful for collapsing rapid mutation
 * events during streaming into a single "stream done" callback.
 *
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} delay
 * @returns {T & { cancel(): void }}
 */
export function debounce(fn, delay) {
  let timer = 0
  const wrapped = /** @type {any} */ (
    (...args) => {
      clearTimeout(timer)
      timer = window.setTimeout(() => fn(...args), delay)
    }
  )
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

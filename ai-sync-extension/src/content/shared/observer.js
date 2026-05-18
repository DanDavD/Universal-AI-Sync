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

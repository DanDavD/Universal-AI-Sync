// @ts-check

/**
 * Shadow-DOM overlay factory.
 *
 * Attaches an isolated panel to the page so our UI isn't affected by
 * platform CSS resets and vice versa.  Uses a closed shadow root to
 * prevent the page from accessing our internals via JS.
 */

const PANEL_CSS = /* css */`
  :host {
    all: initial;
    position: fixed;
    bottom: 80px;
    right: 16px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .panel {
    background: #111118;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 160px;
    user-select: none;
    transition: box-shadow 200ms, border-color 200ms;
  }

  .panel.syncing {
    border-color: #4f8ef7;
    box-shadow: 0 0 0 1px #4f8ef7, 0 0 20px rgba(79,142,247,0.25), 0 8px 32px rgba(0,0,0,.45);
  }

  .panel-header {
    color: #a1a1aa;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  button {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 500;
    color: #e4e4e7;
    transition: background 120ms;
  }
  button:hover { background: #1a1a24; }
  button:active { background: #0c0c13; }

  button.active {
    background: linear-gradient(135deg, rgba(79,142,247,0.25), rgba(124,58,237,0.25));
    color: #fff;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #52525b;
    flex-shrink: 0;
    transition: background 200ms;
  }
  .dot.live { background: #22c55e; }
  .dot.syncing {
    background: #4f8ef7;
    animation: dot-pulse 1s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }

  .status {
    font-size: 10px;
    color: #52525b;
    margin-top: 2px;
    transition: color 200ms;
  }
  .status.active {
    color: #4f8ef7;
    font-weight: 600;
  }
`

/** @param {Event} e */
function _stopScroll(e) { e.preventDefault(); e.stopPropagation() }

/** Block all real user keyboard input; let programmatic dispatchEvent through (isTrusted=false) */
/** @param {KeyboardEvent} e */
function _stopAllKeys(e) { if (e.isTrusted) { e.preventDefault(); e.stopPropagation() } }

/**
 * @typedef {{
 *   onSync(): void,
 * }} OverlayCallbacks
 */

/**
 * Creates and attaches the sync overlay panel to the page.
 *
 * @param {OverlayCallbacks} callbacks
 * @returns {{ setStatus(msg: string): void, lock(msg: string): void, unlock(): void, remove(): void }}
 */
export function createOverlay(callbacks) {
  const host = document.createElement('div')
  host.id = 'ai-sync-host'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = PANEL_CSS
  shadow.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="panel-header">AI Sync</div>
    <button id="btn-sync">
      <span class="dot" id="sync-dot"></span>Sync
    </button>
    <div class="status" id="status-line"></div>
  `
  shadow.appendChild(panel)

  const btnSync    = /** @type {HTMLButtonElement} */ (shadow.getElementById('btn-sync'))
  const statusLine = /** @type {HTMLElement} */ (shadow.getElementById('status-line'))
  const syncDot    = /** @type {HTMLElement} */ (shadow.getElementById('sync-dot'))

  /** @type {HTMLElement|null} */
  let shieldEl = null

  btnSync.addEventListener('click', () => {
    callbacks.onSync()
    setStatus('Open popup to start sync')
  })

  /** @param {string} msg */
  function setStatus(msg) {
    statusLine.textContent = msg
    if (msg) setTimeout(() => { if (statusLine.textContent === msg) statusLine.textContent = '' }, 4000)
  }

  /**
   * Locks the page during injection: blocks all clicks with a transparent shield
   * and switches the overlay to a visible "syncing" state.
   * @param {string} msg
   */
  function lock(msg) {
    if (!shieldEl) {
      shieldEl = document.createElement('div')
      Object.assign(shieldEl.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646', // just below our overlay (2147483647)
        pointerEvents: 'all',
        cursor: 'not-allowed',
      })
      document.body.appendChild(shieldEl)
      // Block all scroll: overflow, wheel, keyboard scroll keys, touch
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      document.addEventListener('wheel', _stopScroll, { passive: false, capture: true })
      document.addEventListener('touchmove', _stopScroll, { passive: false, capture: true })
      document.addEventListener('keydown', _stopAllKeys, { capture: true })
      document.addEventListener('keypress', _stopAllKeys, { capture: true })
    }
    panel.classList.add('syncing')
    syncDot.classList.add('syncing')
    statusLine.classList.add('active')
    statusLine.textContent = msg || 'Sync in progress…'
  }

  /**
   * Removes the click shield and resets the overlay to normal state.
   */
  function unlock() {
    shieldEl?.remove()
    shieldEl = null
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
    document.removeEventListener('wheel', _stopScroll, { capture: true })
    document.removeEventListener('touchmove', _stopScroll, { capture: true })
    document.removeEventListener('keydown', _stopAllKeys, { capture: true })
    document.removeEventListener('keypress', _stopAllKeys, { capture: true })
    panel.classList.remove('syncing')
    syncDot.classList.remove('syncing')
    statusLine.classList.remove('active')
  }

  if (document.body) {
    document.body.appendChild(host)
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host))
  }

  return {
    setStatus,
    lock,
    unlock,
    remove: () => { unlock(); host.remove() },
  }
}

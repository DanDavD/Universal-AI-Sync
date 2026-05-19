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
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 148px;
    user-select: none;
  }

  .panel-header {
    color: #a1a1aa;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid #27272a;
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
  button:hover { background: #27272a; }
  button:active { background: #3f3f46; }

  button.active {
    background: #1d4ed8;
    color: #fff;
  }
  button.active:hover { background: #1e40af; }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #52525b;
    flex-shrink: 0;
  }
  .dot.live { background: #22c55e; }

  .status {
    font-size: 10px;
    color: #71717a;
    margin-top: 2px;
  }
`

/**
 * @typedef {{
 *   onSync(): void,
 * }} OverlayCallbacks
 */

/**
 * Creates and attaches the sync overlay panel to the page.
 *
 * @param {OverlayCallbacks} callbacks
 * @returns {{ setStatus(msg: string): void, remove(): void }}
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
      <span class="dot"></span>Sync context
    </button>
    <div class="status" id="status-line"></div>
  `
  shadow.appendChild(panel)

  const btnSync   = /** @type {HTMLButtonElement} */ (shadow.getElementById('btn-sync'))
  const statusLine = /** @type {HTMLElement} */ (shadow.getElementById('status-line'))

  btnSync.addEventListener('click', () => {
    callbacks.onSync()
    setStatus('Open popup to sync context')
  })

  /** @param {string} msg */
  function setStatus(msg) {
    statusLine.textContent = msg
    if (msg) setTimeout(() => { if (statusLine.textContent === msg) statusLine.textContent = '' }, 4000)
  }

  if (document.body) {
    document.body.appendChild(host)
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host))
  }

  return {
    setStatus,
    remove: () => host.remove(),
  }
}

// @ts-check

/**
 * Shadow-DOM overlay factory.
 *
 * Attaches an isolated floating orb to the page so our UI isn't affected by
 * platform CSS resets and vice versa.  Uses a closed shadow root to
 * prevent the page from accessing our internals via JS.
 */

const PANEL_CSS = /* css */`
  :host {
    all: initial;
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .orb-wrap {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    user-select: none;
  }

  /* Floating pill label above the orb */
  .orb-label {
    background: #111118;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 500;
    color: #a1a1aa;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    opacity: 0;
    transform: translateY(5px);
    transition: opacity 220ms ease, transform 220ms ease, color 220ms ease, border-color 220ms ease;
    pointer-events: none;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .orb-label.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .orb-label.blue {
    color: #4f8ef7;
    border-color: rgba(79,142,247,0.28);
  }
  .orb-label.green {
    color: #22c55e;
    border-color: rgba(34,197,94,0.28);
  }

  /* Holds ring + button at the same center point */
  .orb-container {
    position: relative;
    width: 56px;
    height: 56px;
    flex-shrink: 0;
  }

  /*
   * The glowing ring: a full 56px circle behind the 48px dark orb.
   * The 4px gap on each side peeks out as the ring.
   */
  .orb-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    opacity: 0;
    transition: opacity 350ms ease;
  }
  .orb-ring.active {
    opacity: 1;
  }
  .orb-ring.spinning {
    background: conic-gradient(from 0deg, transparent 0%, #4f8ef7 35%, #7c3aed 65%, transparent 100%);
    animation: ring-spin 1.1s linear infinite;
  }
  .orb-ring.done {
    background: conic-gradient(from 0deg, #22c55e 0%, #22c55e 100%);
    animation: done-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  @keyframes ring-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes done-pop {
    from { transform: scale(0.82); }
    to   { transform: scale(1); }
  }

  /* Main circular button — 48px, sits on top of the ring */
  .orb {
    all: unset;
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: #111118;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.55);
    transition: box-shadow 350ms ease, transform 140ms ease;
    z-index: 1;
  }
  .orb:hover:not(.syncing) {
    box-shadow: 0 4px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
    transform: scale(1.07);
  }
  .orb:active:not(.syncing) {
    transform: scale(0.94);
  }
  .orb.syncing {
    box-shadow:
      0 4px 20px rgba(0,0,0,0.5),
      0 0 18px rgba(79,142,247,0.38),
      0 0 40px rgba(124,58,237,0.2);
    cursor: not-allowed;
  }
  .orb.done {
    box-shadow:
      0 4px 20px rgba(0,0,0,0.5),
      0 0 20px rgba(34,197,94,0.5),
      0 0 44px rgba(34,197,94,0.24);
  }

  /* Sync SVG icon */
  .orb-icon {
    width: 20px;
    height: 20px;
    color: #52525b;
    transition: color 350ms ease;
    display: block;
    flex-shrink: 0;
  }
  .orb.syncing .orb-icon {
    color: #4f8ef7;
    animation: icon-spin 1.5s linear infinite;
  }
  .orb.done .orb-icon {
    color: #22c55e;
  }

  @keyframes icon-spin {
    to { transform: rotate(360deg); }
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
 * Creates and attaches the sync overlay orb to the page.
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

  const wrap = document.createElement('div')
  wrap.className = 'orb-wrap'
  wrap.innerHTML = `
    <div class="orb-label" id="orb-label"></div>
    <div class="orb-container">
      <div class="orb-ring" id="orb-ring"></div>
      <button class="orb" id="btn-sync" title="AI Sync">
        <svg class="orb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M3 21v-5h5"/>
        </svg>
      </button>
    </div>
  `
  shadow.appendChild(wrap)

  const btnSync  = /** @type {HTMLButtonElement} */ (shadow.getElementById('btn-sync'))
  const orbRing  = /** @type {HTMLElement} */ (shadow.getElementById('orb-ring'))
  const orbLabel = /** @type {HTMLElement} */ (shadow.getElementById('orb-label'))

  /** @type {HTMLElement|null} */
  let shieldEl = null
  /** @type {ReturnType<typeof setTimeout>|null} */
  let doneTimer = null
  /** @type {ReturnType<typeof setTimeout>|null} */
  let statusTimer = null

  btnSync.addEventListener('click', () => {
    if (btnSync.classList.contains('syncing')) return
    callbacks.onSync()
    setStatus('Open popup to start sync')
  })

  /**
   * @param {string} msg
   * @param {string} colorClass
   */
  function _showLabel(msg, colorClass) {
    orbLabel.textContent = msg
    orbLabel.className = 'orb-label' + (colorClass ? ` ${colorClass}` : '') + (msg ? ' visible' : '')
  }

  /** @param {string} msg */
  function setStatus(msg) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null }
    _showLabel(msg, '')
    if (msg) {
      statusTimer = setTimeout(() => {
        if (orbLabel.textContent === msg) _showLabel('', '')
        statusTimer = null
      }, 4000)
    }
  }

  /**
   * Locks the page during injection: blocks all clicks with a transparent shield
   * and switches the orb to the "syncing" state.
   * @param {string} msg
   */
  function lock(msg) {
    if (!shieldEl) {
      shieldEl = document.createElement('div')
      Object.assign(shieldEl.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646', // just below our orb
        pointerEvents: 'all',
        cursor: 'not-allowed',
      })
      document.body.appendChild(shieldEl)
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      document.addEventListener('wheel', _stopScroll, { passive: false, capture: true })
      document.addEventListener('touchmove', _stopScroll, { passive: false, capture: true })
      document.addEventListener('keydown', _stopAllKeys, { capture: true })
      document.addEventListener('keypress', _stopAllKeys, { capture: true })
    }
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null }
    if (doneTimer)   { clearTimeout(doneTimer);   doneTimer = null }
    orbRing.classList.remove('done')
    orbRing.classList.add('active', 'spinning')
    btnSync.classList.remove('done')
    btnSync.classList.add('syncing')
    _showLabel(msg || 'Sync in progress…', 'blue')
  }

  /**
   * Removes the click shield and transitions the orb to the "done" state,
   * then fades everything back to idle after a short delay.
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

    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null }

    orbRing.classList.remove('spinning')
    orbRing.classList.add('done') // .active stays — keeps ring visible
    btnSync.classList.remove('syncing')
    btnSync.classList.add('done')
    _showLabel('Sync complete', 'green')

    if (doneTimer) clearTimeout(doneTimer)
    doneTimer = setTimeout(() => {
      if (shadow.host.isConnected) {
        orbRing.classList.remove('active', 'done')
        btnSync.classList.remove('done')
        _showLabel('', '')
      }
      doneTimer = null
    }, 2200)
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

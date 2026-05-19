// @ts-check

/**
 * @typedef {{
 *   id: number,
 *   platform: string,
 *   title: string,
 *   url: string,
 *   logoUrl: string,
 * }} AiTab
 */

// ── Platform metadata ──────────────────────────────────────────────────────────
const PLATFORM_LABELS = {
  chatgpt: 'ChatGPT',
  claude:  'Claude',
  gemini:  'Gemini',
  copilot: 'Copilot',
}

/** Border color shown on the slot when a platform is assigned to it. */
const PLATFORM_COLORS = {
  chatgpt: '#10a37f',
  claude:  '#d97706',
  gemini:  '#3b82f6',
  copilot: '#0078d4',
}

/** Canonical domains used to fetch favicons via Google's service. */
const PLATFORM_DOMAINS = {
  chatgpt: 'chatgpt.com',
  claude:  'claude.ai',
  gemini:  'gemini.google.com',
  copilot: 'copilot.microsoft.com',
}

// ── App State ──────────────────────────────────────────────────────────────────
const app = {
  /** @type {AiTab[]} */
  tabs: [],

  /** Raw SW state (tabRegistry, mirrorPairs). */
  swState: { tabRegistry: /** @type {Record<string,string>} */ ({}), mirrorPairs: {} },

  /** @type {AiTab|null} */
  source: null,

  /** @type {AiTab|null} */
  dest: null,

  /**
   * Which slot is "listening" for the next tab click.
   * @type {'source'|'dest'}
   */
  focus: 'source',
}

// ── DOM refs ───────────────────────────────────────────────────────────────────
const tabListEl  = /** @type {HTMLElement} */ (document.getElementById('tab-list'))
const slotSrcEl  = /** @type {HTMLElement} */ (document.getElementById('slot-source'))
const slotDstEl  = /** @type {HTMLElement} */ (document.getElementById('slot-dest'))
const btnExport  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-export'))
const btnMemory  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-memory'))
const statusEl   = /** @type {HTMLElement} */ (document.getElementById('status'))

// ── Bootstrap ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Slot circle clicks — re-focus that slot (so the next tab click overrides it)
  slotSrcEl.addEventListener('click', (e) => {
    if (/** @type {Element} */ (e.target).closest('.slot-clear')) return
    if (app.source) setFocus('source')
  })
  slotDstEl.addEventListener('click', (e) => {
    if (/** @type {Element} */ (e.target).closest('.slot-clear')) return
    if (app.dest) setFocus('dest')
  })

  document.getElementById('btn-refresh')?.addEventListener('click', refresh)
  btnExport?.addEventListener('click', handleExport)
  btnMemory?.addEventListener('click', handleExportMemory)

  // Restore in-progress transfer that survived a popup close
  const stored = await chrome.storage.session.get('transferStatus')
  const ts = /** @type {any} */ (stored.transferStatus)
  if (ts?.phase && ts?.message && typeof ts?.pct === 'number') applyProgress(ts)

  // Live progress pushed by the background SW while the popup is open
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRANSFER_PROGRESS') applyProgress(msg)
  })

  await refresh()
})

// ── Data Loading ───────────────────────────────────────────────────────────────
async function refresh() {
  setStatus('Refreshing…')
  try {
    app.swState = await chrome.runtime.sendMessage({ type: 'GET_STATE' })
    app.tabs    = await discoverAiTabs()
    render()
    setStatus('')
  } catch (err) {
    setStatus('Error: ' + String(err))
  }
}

async function discoverAiTabs() {
  const patterns = [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://copilot.microsoft.com/*',
  ]
  const tabs = await chrome.tabs.query({ url: patterns })
  return tabs
    .filter((t) => t.id !== undefined && app.swState.tabRegistry[String(t.id)])
    .map((t) => {
      const platform = app.swState.tabRegistry[String(t.id)]
      return {
        id:       /** @type {number} */ (t.id),
        platform,
        title:    t.title ?? t.url ?? 'Untitled',
        url:      t.url ?? '',
        logoUrl:  resolveLogo(t, platform),
      }
    })
}

/**
 * Resolves the favicon URL for a tab.
 *
 * For known platforms we always use the canonical domain with Google's favicon
 * service — this is more reliable than tab.favIconUrl, which Chrome often
 * returns as a chrome:// URL that is inaccessible from extension popups.
 *
 * @param {chrome.tabs.Tab} tab
 * @param {string} platform
 */
function resolveLogo(tab, platform) {
  const domain = PLATFORM_DOMAINS[platform]
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  }
  // Unknown platform — try the tab's own favicon, then Google fallback
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    return tab.favIconUrl
  }
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(tab.url ?? '').hostname}&sz=64`
  } catch {
    return ''
  }
}

// ── Logo helper ────────────────────────────────────────────────────────────────

/**
 * Returns HTML for a logo image with an automatic letter-avatar fallback.
 * If the <img> fails to load, the onerror handler hides it and shows the
 * sibling <span> (a colored circle with the platform's first letter).
 *
 * @param {AiTab} tab
 * @param {'tab'|'slot'} size
 */
function logoHTML(tab, size) {
  const label   = PLATFORM_LABELS[tab.platform] ?? tab.platform
  const initial = label[0].toUpperCase()
  const color   = PLATFORM_COLORS[tab.platform] ?? '#52525b'
  const imgCls  = size === 'tab' ? 'tab-logo' : 'slot-logo'
  const fbkCls  = size === 'tab' ? 'logo-fallback logo-fallback--tab' : 'logo-fallback logo-fallback--slot'

  return `<img class="${imgCls}"
               src="${escAttr(tab.logoUrl)}"
               alt="${escAttr(label)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
         /><span class="${fbkCls}" style="background:${color};display:none">${esc(initial)}</span>`
}

// ── Rendering ──────────────────────────────────────────────────────────────────

/** Single render pass — always call this after any state mutation. */
function render() {
  renderTabList()
  renderSlot(slotSrcEl, app.source, 'source')
  renderSlot(slotDstEl, app.dest,   'dest')
  updateButtons()
}

function renderTabList() {
  if (!app.tabs.length) {
    tabListEl.innerHTML =
      '<p class="empty-msg">No AI tabs detected.<br>Open ChatGPT, Claude, Gemini, or Copilot.</p>'
    return
  }

  // The UNFOCUSED slot's tab is "used" — greyed out and unclickable.
  // The FOCUSED slot's tab (if any) stays available so the user can
  // click a different AI to replace it.
  const usedIds = new Set(/** @type {(number|undefined)[]} */ ([
    app.focus !== 'source' ? app.source?.id : undefined,
    app.focus !== 'dest'   ? app.dest?.id   : undefined,
  ]).filter((id) => id !== undefined))

  tabListEl.innerHTML = app.tabs.map((tab) => {
    const used    = usedIds.has(tab.id)
    const usedTag = app.source?.id === tab.id ? 'Source'
                  : app.dest?.id   === tab.id ? 'Dest'
                  : ''
    const label   = PLATFORM_LABELS[tab.platform] ?? tab.platform

    return `
      <div class="tab-item ${used ? 'tab-item--used' : ''}" data-id="${tab.id}">
        ${logoHTML(tab, 'tab')}
        <div class="tab-info">
          <span class="tab-platform">${esc(label)}</span>
          <span class="tab-page-title">${esc(truncate(tab.title, 30))}</span>
        </div>
        ${usedTag ? `<span class="tab-used-tag">${usedTag}</span>` : ''}
      </div>`
  }).join('')

  tabListEl.querySelectorAll('.tab-item:not(.tab-item--used)').forEach((el) => {
    el.addEventListener('click', () => onTabClick(Number(el.getAttribute('data-id'))))
  })
}

/**
 * Renders a single slot (source or dest).
 * @param {HTMLElement} el
 * @param {AiTab|null} tab
 * @param {'source'|'dest'} slotName
 */
function renderSlot(el, tab, slotName) {
  const focused = app.focus === slotName

  if (!tab) {
    el.className = `slot slot--empty${focused ? ' slot--focused' : ''}`
    el.style.borderColor = ''
    el.innerHTML = `<span class="slot-placeholder">?</span>`
    return
  }

  const color = PLATFORM_COLORS[tab.platform] ?? '#3f3f46'
  el.className = `slot slot--filled${focused ? ' slot--focused' : ''}`
  el.style.borderColor = color
  el.innerHTML = `${logoHTML(tab, 'slot')}<button class="slot-clear" title="Remove">×</button>`

  el.querySelector('.slot-clear')?.addEventListener('click', (e) => {
    e.stopPropagation()
    clearSlot(slotName)
  })
}

function updateButtons() {
  const both = app.source !== null && app.dest !== null
  btnExport.disabled = !both
  btnMemory.disabled = !both
}

// ── State Machine ──────────────────────────────────────────────────────────────

/** Called when the user clicks a tab item in the list. */
function onTabClick(tabId) {
  const tab = app.tabs.find((t) => t.id === tabId)
  if (!tab) return

  if (app.focus === 'source') {
    app.source = tab
    // Auto-advance focus to dest only if dest is still empty
    if (!app.dest) setFocus('dest')
  } else {
    app.dest = tab
  }

  render()
}

/**
 * Clears a slot and refocuses it, making that AI available again in the list.
 * @param {'source'|'dest'} slotName
 */
function clearSlot(slotName) {
  if (slotName === 'source') app.source = null
  else                        app.dest   = null
  setFocus(slotName)
  render()
}

/**
 * Shifts focus to the given slot. Re-renders so the pulse moves.
 * @param {'source'|'dest'} slotName
 */
function setFocus(slotName) {
  app.focus = slotName
  // render() is called by the caller — no double render here
}

// ── Export Actions ─────────────────────────────────────────────────────────────

async function handleExport() {
  if (!app.source || !app.dest) return
  try {
    setStatus('Scraping source tab…')
    const scraped = await chrome.tabs.sendMessage(app.source.id, { type: 'SCRAPE_CONVERSATION' })
    if (!scraped?.ok || !scraped.conversation?.length) {
      setStatus('Nothing to export from source tab')
      return
    }
    setStatus(`Pushing ${scraped.conversation.length} messages…`)
    const result = await chrome.runtime.sendMessage({
      type:         'EXPORT_CONVERSATION',
      conversation: scraped.conversation,
      targetTabId:  app.dest.id,
    })
    setStatus(result?.ok
      ? `Exported ${scraped.conversation.length} messages ✓`
      : 'Export failed: ' + (result?.error ?? 'unknown'))
  } catch (err) {
    setStatus('Error: ' + String(err))
  }
}

async function handleExportMemory() {
  if (!app.source || !app.dest) return
  // Hand off to the background SW — it runs independently so the transfer
  // survives if the user closes the popup or switches tabs.
  applyProgress({ phase: 'scraping', message: 'Starting transfer…', pct: 5 })
  chrome.runtime.sendMessage({
    type:        'TRANSFER_MEMORY',
    sourceTabId: app.source.id,
    destTabId:   app.dest.id,
  }).catch((err) => {
    applyProgress({ phase: 'error', message: 'Error: ' + String(err), pct: 0 })
  })
}

// ── Progress Bar ───────────────────────────────────────────────────────────────

/** @param {{ phase: string, message: string, pct: number }} status */
function applyProgress({ phase, message, pct }) {
  const bar   = document.getElementById('progress-bar')
  const fill  = document.getElementById('progress-fill')
  const label = document.getElementById('progress-label')
  if (!bar || !fill || !label) return

  bar.style.display   = phase === 'idle' ? 'none' : 'block'
  fill.style.width    = pct + '%'
  fill.style.background = phase === 'error' ? '#ef4444'
                        : phase === 'done'  ? '#22c55e'
                        : '#7c3aed'
  label.textContent = message

  if (phase === 'done') setTimeout(() => { bar.style.display = 'none' }, 4000)
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** @param {string} msg */
function setStatus(msg) { if (statusEl) statusEl.textContent = msg }

/** @param {string} s */
const esc     = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** @param {string} s */
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

/**
 * @param {string} s
 * @param {number} n
 */
const truncate = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s

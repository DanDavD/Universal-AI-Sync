// @ts-check

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'

// TODO: Replace with your final pricing/checkout URL once the backend is deployed
const UPGRADE_URL = `${BACKEND_URL}/checkout.html`

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

const COOLDOWN_MS = 5 * 60 * 60 * 1000 // 5 hours
const FILE_SYNC_UNLIMITED = false
/** @type {number|null} */
let cooldownIntervalId = null
/** @type {number|null} */
let cooldownUnlockId   = null

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

  /** @type {'free'|'premium'} */
  plan: 'free',

  /** @type {string|null} */
  email: null,

  /** True when no active cooldown — free users get 1 use per 5 h, premium is always true. */
  fileSyncReady: true,

  /** True while a file-sync request is in flight; cleared on done/error to trigger cooldown save. */
  pendingFileSync: false,
}

// ── DOM refs ───────────────────────────────────────────────────────────────────
const tabListEl    = /** @type {HTMLElement} */ (document.getElementById('tab-list'))
const slotSrcEl    = /** @type {HTMLElement} */ (document.getElementById('slot-source'))
const slotDstEl    = /** @type {HTMLElement} */ (document.getElementById('slot-dest'))
const btnSync      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sync'))
const btnFile      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-file'))
const statusEl     = /** @type {HTMLElement} */ (document.getElementById('status'))
const headerBadge      = /** @type {HTMLElement} */ (document.getElementById('header-badge'))
const viewMain         = /** @type {HTMLElement} */ (document.getElementById('view-main'))
const viewUpgrade      = /** @type {HTMLElement} */ (document.getElementById('view-upgrade'))
const btnBack          = /** @type {HTMLButtonElement} */ (document.getElementById('btn-back'))
const btnSubscribe     = /** @type {HTMLButtonElement} */ (document.getElementById('btn-subscribe'))
const btnActivate      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-activate-key'))
const upgradeEmail     = /** @type {HTMLInputElement} */ (document.getElementById('upgrade-email'))
const upgradeKey       = /** @type {HTMLInputElement} */ (document.getElementById('upgrade-key'))
const keyStatus        = /** @type {HTMLElement} */ (document.getElementById('key-status'))
const btnUpgradeFooter = /** @type {HTMLButtonElement} */ (document.getElementById('btn-upgrade-footer'))

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
  btnSync?.addEventListener('click', handleSync)

  btnFile?.addEventListener('click', () => {
    // Button is disabled during cooldown, so this only fires when the user is allowed to sync
    handleFileSync()
  })

  // Both upgrade entry points open the same upgrade view
  btnUpgradeFooter?.addEventListener('click', showUpgradeView)
  btnBack?.addEventListener('click', showMainView)

  btnSubscribe?.addEventListener('click', () => {
    const email = upgradeEmail.value.trim()
    if (!email || !email.includes('@')) {
      upgradeEmail.focus()
      upgradeEmail.style.borderColor = 'var(--red)'
      setTimeout(() => { upgradeEmail.style.borderColor = '' }, 1500)
      return
    }
    chrome.tabs.create({ url: `${BACKEND_URL}/checkout.html?email=${encodeURIComponent(email)}&ext=${chrome.runtime.id}` })
    window.close()
  })

  btnActivate?.addEventListener('click', activateLicenseKey)
  upgradeKey?.addEventListener('keydown', (e) => { if (e.key === 'Enter') activateLicenseKey() })
  upgradeKey?.addEventListener('input', () => {
    btnActivate?.classList.toggle('upgrade-cta--muted', !upgradeKey.value.trim())
  })

  // Load session state AND cooldown state in parallel — prevents button/notice flash
  // while checkLicense() resolves asynchronously in the background.
  const [stored, localStored] = await Promise.all([
    chrome.storage.session.get(['transferStatus', 'fileSyncInProgress']),
    chrome.storage.local.get('lastFileSyncAt'),
  ])
  // If cooldown is still active, start it immediately — renders the timer and CTA
  // before any async work (license check, refresh) so there is zero visible delay.
  const _availableAt = (localStored.lastFileSyncAt ?? 0) + COOLDOWN_MS
  if (!FILE_SYNC_UNLIMITED && Date.now() < _availableAt) startCooldown(_availableAt)
  // If a file sync completed while the popup was closed, save the cooldown timestamp now
  // so initFileSyncCooldown (called later via checkLicense → applyPlan) picks it up.
  if (stored.fileSyncInProgress && /** @type {any} */ (stored.transferStatus)?.phase === 'done') {
    await chrome.storage.local.set({ lastFileSyncAt: Date.now() })
    await chrome.storage.session.remove('fileSyncInProgress')
  } else if (stored.fileSyncInProgress) {
    app.pendingFileSync = true
  }
  const ts = /** @type {any} */ (stored.transferStatus)
  if (ts?.phase && ts?.message && typeof ts?.pct === 'number') applyProgress(ts)

  // Live progress pushed by the background SW while the popup is open
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'TRANSFER_PROGRESS') return
    applyProgress(msg)
    if (msg.phase === 'done' && app.pendingFileSync) {
      app.pendingFileSync = false
      chrome.storage.session.remove('fileSyncInProgress').catch(() => {})
      if (!FILE_SYNC_UNLIMITED && app.plan === 'free') {
        const now = Date.now()
        chrome.storage.local.set({ lastFileSyncAt: now }).catch(() => {})
        startCooldown(now + COOLDOWN_MS)
      }
    } else if (msg.phase === 'error' && app.pendingFileSync) {
      app.pendingFileSync = false
      chrome.storage.session.remove('fileSyncInProgress').catch(() => {})
    }
  })

  // Check license in background — don't block UI load
  checkLicense()
  await refresh()
})

// ── License & Plan ─────────────────────────────────────────────────────────────

async function checkLicense() {
  try {
    const stored = await chrome.storage.local.get('licenseKey')
    if (!stored.licenseKey) return applyPlan('free', null)

    const res = await fetch(`${BACKEND_URL}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: stored.licenseKey }),
    })
    const data = await res.json()
    if (data.valid && data.status === 'active') {
      applyPlan('premium', data.email ?? null)
    } else {
      applyPlan('free', null)
    }
  } catch {
    // Backend unreachable — don't block, assume free silently
    applyPlan('free', null)
  }
}

/**
 * @param {'free'|'premium'} plan
 * @param {string|null} email
 */
function applyPlan(plan, email) {
  app.plan  = plan
  app.email = email

  if (plan === 'premium') {
    headerBadge.textContent  = 'Pro'
    headerBadge.className    = 'header-badge header-badge--premium'
    headerBadge.title        = email ? `Premium · ${email}` : 'Premium plan'
    btnFile.textContent      = 'File-Based Sync'
    btnFile.classList.remove('btn--locked')
    btnFile.title            = 'Upload full conversation as a file — instant, no size limits'
    btnUpgradeFooter.classList.remove('visible')
    endCooldown() // Premium has no cooldown; also clears any notice pre-rendered before plan resolved
  } else {
    headerBadge.textContent = 'Free'
    headerBadge.className   = 'header-badge header-badge--free'
    headerBadge.title       = 'Free plan — click to upgrade'
    btnFile.textContent     = 'File-Based Sync'
    btnFile.title           = '1 free use every 5 hours — upgrade for unlimited'
    btnUpgradeFooter.classList.add('visible')
    clearCooldownTimers()
    initFileSyncCooldown() // Checks storage and starts countdown if still in cooldown
  }
  updateButtons()
}

// ── View switching ─────────────────────────────────────────────────────────────

function showUpgradeView() {
  viewMain.style.display    = 'none'
  viewUpgrade.classList.add('visible')
  upgradeEmail.focus()
}

function showMainView() {
  viewUpgrade.classList.remove('visible')
  viewMain.style.display = ''
  keyStatus.textContent  = ''
  upgradeKey.value       = ''
}

// ── Inline license key activation ─────────────────────────────────────────────

async function activateLicenseKey() {
  const key = upgradeKey.value.trim().toUpperCase()
  if (!key) { upgradeKey.focus(); return }

  btnActivate.disabled    = true
  keyStatus.textContent   = 'Validating…'
  keyStatus.style.color   = 'var(--text-3)'

  try {
    const res = await fetch(`${BACKEND_URL}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const data = await res.json()

    if (data.valid && data.status === 'active') {
      await chrome.storage.local.set({ licenseKey: key })
      keyStatus.textContent = 'Activated — switching to Premium...'
      keyStatus.style.color = 'var(--green)'
      setTimeout(() => {
        applyPlan('premium', data.email ?? null)
        showMainView()
      }, 1200)
    } else {
      const msg = data.status === 'suspended' ? 'Payment failed — check your PayPal'
               : data.status === 'cancelled'  ? 'Subscription cancelled'
               : 'Invalid key — check and try again'
      keyStatus.textContent = `✗ ${msg}`
      keyStatus.style.color = 'var(--red)'
      btnActivate.disabled  = false
    }
  } catch {
    keyStatus.textContent = 'Could not reach server'
    keyStatus.style.color = 'var(--red)'
    btnActivate.disabled  = false
  }
}

// ── Selection persistence ──────────────────────────────────────────────────────

/** Saves current source/dest tab IDs to session storage so they survive popup close. */
function saveSelection() {
  chrome.storage.session.set({
    selectedSourceId: app.source?.id ?? null,
    selectedDestId:   app.dest?.id   ?? null,
  }).catch(() => {})
}

// ── Data Loading ───────────────────────────────────────────────────────────────
async function refresh() {
  setStatus('Refreshing…')
  try {
    app.swState = await chrome.runtime.sendMessage({ type: 'GET_STATE' })
    app.tabs    = await discoverAiTabs()

    // Restore previously selected tabs if they are still open
    const saved = await chrome.storage.session.get(['selectedSourceId', 'selectedDestId'])
    if (saved.selectedSourceId != null)
      app.source = app.tabs.find((t) => t.id === saved.selectedSourceId) ?? null
    if (saved.selectedDestId != null)
      app.dest = app.tabs.find((t) => t.id === saved.selectedDestId) ?? null

    // Set a sensible focus after restore
    if (app.source && app.dest)      app.focus = 'source'
    else if (app.source && !app.dest) app.focus = 'dest'

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
    const usedTag      = app.source?.id === tab.id ? 'Source'
                       : app.dest?.id   === tab.id ? 'Dest'
                       : ''
    const usedTagClass = app.source?.id === tab.id ? 'tab-used-tag tab-used-tag--source'
                       : app.dest?.id   === tab.id ? 'tab-used-tag tab-used-tag--dest'
                       : ''
    const label        = PLATFORM_LABELS[tab.platform] ?? tab.platform

    return `
      <div class="tab-item ${used ? 'tab-item--used' : ''}" data-id="${tab.id}">
        ${logoHTML(tab, 'tab')}
        <div class="tab-info">
          <span class="tab-platform">${esc(label)}</span>
          <span class="tab-page-title">${esc(truncate(tab.title, 30))}</span>
        </div>
        ${usedTag ? `<span class="${usedTagClass}">${usedTag}</span>` : ''}
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
  btnSync.disabled = !both

  if (!btnFile) return
  if (app.plan === 'premium') {
    btnFile.classList.remove('btn--locked')
    btnFile.disabled = !both
  } else if (!app.fileSyncReady) {
    // Free plan — cooldown active: disable the button
    btnFile.classList.add('btn--locked')
    btnFile.disabled = true
  } else {
    // Free plan — ready for 1 free use
    btnFile.classList.remove('btn--locked')
    btnFile.disabled = !both
  }
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
  saveSelection()
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
  saveSelection()
}

/**
 * Shifts focus to the given slot. Re-renders so the pulse moves.
 * @param {'source'|'dest'} slotName
 */
function setFocus(slotName) {
  app.focus = slotName
  // render() is called by the caller — no double render here
}

// ── File Sync Cooldown (5 hours, premium only) ─────────────────────────────────

async function initFileSyncCooldown() {
  if (FILE_SYNC_UNLIMITED) { app.fileSyncReady = true; updateButtons(); return }
  const stored = await chrome.storage.local.get('lastFileSyncAt')
  const lastSync = stored.lastFileSyncAt ?? 0
  const availableAt = lastSync + COOLDOWN_MS

  if (Date.now() >= availableAt) {
    app.fileSyncReady = true
    updateButtons()
  } else {
    startCooldown(availableAt)
  }
}

/** @param {number} availableAtMs */
function startCooldown(availableAtMs) {
  app.fileSyncReady = false
  updateButtons()

  // Build the notice HTML once — timer span is updated every second by tick()
  const cooldownEl = document.getElementById('cooldown-notice')
  if (cooldownEl) {
    cooldownEl.innerHTML =
      '<span id="cooldown-timer"></span>' +
      (app.plan !== 'premium'
        ? ' &middot; Don\'t want to wait? <button class="cooldown-upgrade" id="cooldown-upgrade-btn">Upgrade Now</button>'
        : '')
    document.getElementById('cooldown-upgrade-btn')?.addEventListener('click', () => {
      showUpgradeView()
    })
  }

  const tick = () => {
    const remaining = availableAtMs - Date.now()
    if (remaining <= 0) { endCooldown(); return }
    const timerEl = document.getElementById('cooldown-timer')
    if (!timerEl) return
    const totalSecs = Math.ceil(remaining / 1000)
    const hh = Math.floor(totalSecs / 3600).toString().padStart(2, '0')
    const mm = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0')
    const ss = (totalSecs % 60).toString().padStart(2, '0')
    timerEl.textContent = `Next file-based sync in ${hh}:${mm}:${ss}`
  }

  clearCooldownTimers()
  tick()
  cooldownIntervalId = window.setInterval(tick, 1000)
  cooldownUnlockId   = window.setTimeout(endCooldown, availableAtMs - Date.now())
}

function endCooldown() {
  clearCooldownTimers()
  app.fileSyncReady = true
  const cooldownEl = document.getElementById('cooldown-notice')
  if (cooldownEl) cooldownEl.innerHTML = ''
  updateButtons()
}

function clearCooldownTimers() {
  if (cooldownIntervalId !== null) { clearInterval(cooldownIntervalId); cooldownIntervalId = null }
  if (cooldownUnlockId   !== null) { clearTimeout(cooldownUnlockId);   cooldownUnlockId   = null }
}

// ── Sync Actions ───────────────────────────────────────────────────────────────

function handleSync() {
  if (!app.source || !app.dest) return
  applyProgress({ phase: 'summarizing', message: 'Starting context sync…', pct: 5 })
  chrome.runtime.sendMessage({
    type:        'SYNC_CONTEXT',
    sourceTabId: app.source.id,
    destTabId:   app.dest.id,
  }).catch((err) => {
    applyProgress({ phase: 'error', message: 'Error: ' + String(err), pct: 0 })
  })
}

function handleFileSync() {
  if (!app.source || !app.dest) return
  app.pendingFileSync = true
  chrome.storage.session.set({ fileSyncInProgress: true }).catch(() => {})
  applyProgress({ phase: 'building', message: 'Building context file…', pct: 5 })
  chrome.runtime.sendMessage({
    type:        'SYNC_CONTEXT_FILE',
    sourceTabId: app.source.id,
    destTabId:   app.dest.id,
  }).catch((err) => {
    app.pendingFileSync = false
    chrome.storage.session.remove('fileSyncInProgress').catch(() => {})
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
                        : 'linear-gradient(135deg, #4f8ef7, #7c3aed)'
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

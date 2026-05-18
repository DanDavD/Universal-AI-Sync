// @ts-check

/** @typedef {{ id: number, platform: string, title: string, url: string }} AiTab */

/** @type {AiTab[]} */
let aiTabs = []

/** @type {{ tabRegistry: Record<string,string>, mirrorPairs: Record<string,number> }} */
let state = { tabRegistry: {}, mirrorPairs: {} }

/** @type {number|null} */
let selectedSource = null

/** @type {number|null} */
let selectedDest = null

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await refresh()

  // Restore any in-progress transfer status (popup may have been closed mid-transfer)
  const stored = await chrome.storage.session.get('transferStatus')
  const ts = /** @type {any} */ (stored.transferStatus)
  if (ts?.phase && ts?.message && typeof ts?.pct === 'number') applyProgress(ts)

  // Live progress updates pushed from the background SW
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRANSFER_PROGRESS') applyProgress(msg)
  })

  document.getElementById('btn-refresh')?.addEventListener('click', refresh)
  document.getElementById('btn-export')?.addEventListener('click', handleExport)
  document.getElementById('btn-memory')?.addEventListener('click', handleExportMemory)
})

async function refresh() {
  setStatus('Refreshing…')
  try {
    state = await chrome.runtime.sendMessage({ type: 'GET_STATE' })
    aiTabs = await getAiTabs()
    renderTabs()
    setStatus('')
  } catch (err) {
    setStatus('Error: ' + String(err))
  }
}

// ---------------------------------------------------------------------------
// Tab discovery
// ---------------------------------------------------------------------------
async function getAiTabs() {
  const patterns = [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://copilot.microsoft.com/*',
  ]
  const tabs = await chrome.tabs.query({ url: patterns })
  return tabs
    .filter((t) => t.id !== undefined && state.tabRegistry[String(t.id)])
    .map((t) => ({
      id: /** @type {number} */ (t.id),
      platform: state.tabRegistry[String(t.id)],
      title: t.title ?? t.url ?? 'Untitled',
      url: t.url ?? '',
    }))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderTabs() {
  const list = document.getElementById('tab-list')
  if (!list) return

  if (!aiTabs.length) {
    list.innerHTML = '<p class="empty">No AI tabs detected.<br>Open ChatGPT, Claude, or Gemini.</p>'
    selectedSource = null
    selectedDest = null
    updateActionButtons()
    return
  }

  list.innerHTML = aiTabs.map((t) => `
    <div class="tab-card ${t.id === selectedSource ? 'source' : ''} ${t.id === selectedDest ? 'dest' : ''}"
         data-id="${t.id}">
      <span class="platform-badge ${t.platform}">${platformLabel(t.platform)}</span>
      <span class="tab-title">${escHtml(truncate(t.title, 38))}</span>
    </div>
  `).join('')

  list.querySelectorAll('.tab-card').forEach((card) => {
    card.addEventListener('click', () => onTabClick(Number(card.getAttribute('data-id'))))
  })
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
/** @param {number} tabId */
function onTabClick(tabId) {
  if (selectedSource === null) {
    selectedSource = tabId
  } else if (selectedDest === null && tabId !== selectedSource) {
    selectedDest = tabId
  } else {
    selectedSource = tabId
    selectedDest = null
  }
  renderTabs()
  updateActionButtons()
}

function updateActionButtons() {
  const both = selectedSource !== null && selectedDest !== null
  const exportBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-export'))
  const memoryBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-memory'))
  if (exportBtn) exportBtn.disabled = !both
  if (memoryBtn) memoryBtn.disabled = !both
}

async function handleExport() {
  if (!selectedSource || !selectedDest) return
  try {
    setStatus('Scraping source tab…')
    const scraped = await chrome.tabs.sendMessage(selectedSource, { type: 'SCRAPE_CONVERSATION' })
    if (!scraped?.ok || !scraped.conversation?.length) {
      setStatus('Nothing to export from source tab')
      return
    }
    setStatus(`Pushing ${scraped.conversation.length} messages…`)
    const result = await chrome.runtime.sendMessage({
      type: 'EXPORT_CONVERSATION',
      conversation: scraped.conversation,
      targetTabId: selectedDest,
    })
    setStatus(result?.ok
      ? `Exported ${scraped.conversation.length} messages ✓`
      : 'Export failed: ' + (result?.error ?? 'unknown'))
  } catch (err) {
    setStatus('Error: ' + String(err))
  }
}

async function handleExportMemory() {
  if (!selectedSource || !selectedDest) return
  // Delegate everything to the background SW so the transfer survives
  // popup close / tab switch. Progress comes back via TRANSFER_PROGRESS messages.
  applyProgress({ phase: 'scraping', message: 'Starting transfer…', pct: 5 })
  chrome.runtime.sendMessage({
    type: 'TRANSFER_MEMORY',
    sourceTabId: selectedSource,
    destTabId: selectedDest,
  }).catch((err) => {
    applyProgress({ phase: 'error', message: 'Error: ' + String(err), pct: 0 })
  })
}

/**
 * @param {{ phase: string, message: string, pct: number }} status
 */
function applyProgress(status) {
  const bar      = /** @type {HTMLElement|null} */ (document.getElementById('progress-bar'))
  const fill     = /** @type {HTMLElement|null} */ (document.getElementById('progress-fill'))
  const label    = /** @type {HTMLElement|null} */ (document.getElementById('progress-label'))

  if (!bar || !fill || !label) return

  bar.style.display = status.phase === 'idle' ? 'none' : 'block'
  fill.style.width  = status.pct + '%'
  fill.style.background = status.phase === 'error' ? '#ef4444'
    : status.phase === 'done' ? '#22c55e' : '#7c3aed'
  label.textContent = status.message

  // Auto-hide after success
  if (status.phase === 'done') {
    setTimeout(() => { bar.style.display = 'none' }, 4000)
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
/** @param {string} msg */
function setStatus(msg) {
  const el = document.getElementById('status')
  if (el) el.textContent = msg
}

/** @param {string} p */
function platformLabel(p) {
  const map = /** @type {Record<string,string>} */ ({ chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot' })
  return map[p] ?? p
}

/**
 * @param {string} str
 * @param {number} n
 */
function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

/** @param {string} str */
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

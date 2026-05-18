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
  try {
    setStatus('Scraping source tab…')
    const scraped = await chrome.tabs.sendMessage(selectedSource, { type: 'SCRAPE_CONVERSATION' })
    if (!scraped?.ok || !scraped.conversation?.length) {
      setStatus('Nothing scraped from source tab')
      return
    }
    const userCount = scraped.conversation.filter(/** @param {any} m */ (m) => m.role === 'user').length
    if (!userCount) { setStatus('No user messages to transfer'); return }

    setStatus(`Transferring ${userCount} memories…`)
    const result = await chrome.tabs.sendMessage(selectedDest, {
      type: 'INJECT_MEMORY',
      conversation: scraped.conversation,
    })
    setStatus(result?.ok
      ? `Memory transferred ✓ — target AI is processing`
      : 'Transfer failed: ' + (result?.error ?? 'unknown'))
  } catch (err) {
    setStatus('Error: ' + String(err))
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
  const map = /** @type {Record<string,string>} */ ({ chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' })
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

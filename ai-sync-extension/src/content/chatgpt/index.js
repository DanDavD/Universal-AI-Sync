// @ts-check
import { loadSelectors } from '../shared/selectorConfig.js'
import { createChatObserver, waitForElement } from '../shared/observer.js'
import { createOverlay } from '../shared/overlay.js'
import { scrapeConversation } from './scraper.js'
import { injectConversation, injectMemory } from './injector.js'
import { msgId } from '../shared/parser.js'

const PLATFORM = 'chatgpt'

/** @type {import('../shared/selectorConfig.js').PlatformSelectors} */
let sel

/** @type {ReturnType<typeof createOverlay>} */
let overlay

let myTabId = /** @type {number|null} */ (null)

async function init() {
  sel = await loadSelectors(PLATFORM)
  const reg = await chrome.runtime.sendMessage({ type: 'REGISTER_TAB', platform: PLATFORM })
  myTabId = reg?.tabId ?? null

  overlay = createOverlay({
    onExport: handleExport,
    onExportMemory: handleExportMemory,
  })

  chrome.runtime.onMessage.addListener(handleBackgroundMessage)
}

function handleExport() {
  const conversation = scrapeConversation(sel)
  overlay.setStatus(
    conversation.length
      ? `${conversation.length} msgs ready — open popup to push`
      : 'Nothing to export'
  )
}

function handleExportMemory() {
  const conversation = scrapeConversation(sel)
  const userCount = conversation.filter((m) => m.role === 'user').length
  overlay.setStatus(
    userCount
      ? `${userCount} user messages ready — open popup to push memory`
      : 'No user messages found'
  )
}

function handleBackgroundMessage(msg, _sender, sendResponse) {
  ;(async () => {
    try {
      if (msg.type === 'INJECT_CONVERSATION') {
        await injectConversation(msg.conversation, sel)
        overlay.setStatus('Conversation imported')
        sendResponse({ ok: true })
      } else if (msg.type === 'INJECT_MEMORY') {
        await injectMemory(msg.conversation, sel)
        overlay.setStatus('Memory transferred — AI is processing')
        sendResponse({ ok: true })
      } else if (msg.type === 'SCRAPE_CONVERSATION') {
        sendResponse({ ok: true, conversation: scrapeConversation(sel) })
      } else {
        sendResponse({ error: 'Unknown message type' })
      }
    } catch (err) {
      overlay.setStatus('Error: ' + (err instanceof Error ? err.message : String(err)))
      sendResponse({ error: String(err) })
    }
  })()
  return true
}

window.addEventListener('beforeunload', () => {
  chrome.runtime.sendMessage({ type: 'UNREGISTER_TAB' }).catch(() => {})
})

init().catch(console.error)

// @ts-check
import { loadSelectors } from '../shared/selectorConfig.js'
import { createOverlay } from '../shared/overlay.js'
import { scrapeConversation } from './scraper.js'
import { injectConversation, injectMemory } from './injector.js'

const PLATFORM = 'claude'

/** @type {import('../shared/selectorConfig.js').PlatformSelectors} */
let sel

/** @type {ReturnType<typeof createOverlay>} */
let overlay

async function init() {
  sel = await loadSelectors(PLATFORM)
  await chrome.runtime.sendMessage({ type: 'REGISTER_TAB', platform: PLATFORM })

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

/**
 * @param {any} msg
 * @param {chrome.runtime.MessageSender} _sender
 * @param {(r: any) => void} sendResponse
 */
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
        sendResponse({ error: 'Unknown type' })
      }
    } catch (err) {
      overlay.setStatus('Error: ' + String(err))
      sendResponse({ error: String(err) })
    }
  })()
  return true
}

window.addEventListener('beforeunload', () => {
  chrome.runtime.sendMessage({ type: 'UNREGISTER_TAB' }).catch(() => {})
})

init().catch(console.error)

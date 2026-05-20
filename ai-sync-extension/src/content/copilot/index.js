// @ts-check
import { loadSelectors } from '../shared/selectorConfig.js'
import { createOverlay } from '../shared/overlay.js'
import { waitForDomQuiet } from '../shared/observer.js'
import { scrapeConversation } from './scraper.js'
import { injectSync, injectFile } from './injector.js'

const PLATFORM = 'copilot'

/** @type {import('../shared/selectorConfig.js').PlatformSelectors} */
let sel

/** @type {ReturnType<typeof createOverlay>} */
let overlay

async function init() {
  sel = await loadSelectors(PLATFORM)
  await chrome.runtime.sendMessage({ type: 'REGISTER_TAB', platform: PLATFORM })

  overlay = createOverlay({ onSync: handleSync })
  chrome.runtime.onMessage.addListener(handleBackgroundMessage)
}

function handleSync() {
  overlay.setStatus('Open popup to start sync')
}

/**
 * @param {any} msg
 * @param {chrome.runtime.MessageSender} _sender
 * @param {(r: any) => void} sendResponse
 */
function handleBackgroundMessage(msg, _sender, sendResponse) {
  ;(async () => {
    try {
      if (msg.type === 'INJECT_SYNC') {
        overlay.lock('Preparing sync…')
        try {
          await injectSync(msg.summary, sel, (part, total) => {
            overlay.lock(`Sending part ${part} of ${total}…`)
          })
        } finally {
          overlay.unlock()
        }
        sendResponse({ ok: true })
        overlay.setStatus('Context sent — waiting for AI…')
        waitForDomQuiet(2000, 90000)
          .then(() => {
            chrome.runtime.sendMessage({ type: 'SYNC_DONE' }).catch(() => {})
            overlay.setStatus('Context synced successfully')
          })
          .catch(() => {})
      } else if (msg.type === 'INJECT_FILE') {
        overlay.lock('Sending context file…')
        try {
          await injectFile(msg.markdownContent, msg.sourcePlatform, sel, (part, total) => {
            overlay.lock(`Sending file part ${part} of ${total}…`)
          })
        } finally {
          overlay.unlock()
        }
        sendResponse({ ok: true })
        overlay.setStatus('File uploaded — waiting for AI…')
        waitForDomQuiet(2000, 90000)
          .then(() => {
            chrome.runtime.sendMessage({ type: 'SYNC_DONE' }).catch(() => {})
            overlay.setStatus('Context synced via file!')
          })
          .catch(() => {})
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

// @ts-check
/// <reference types="chrome"/>

/**
 * Background Service Worker — Central router and state coordinator.
 *
 * MV3 service workers are ephemeral: they sleep after ~30s of inactivity and
 * all in-memory state is lost on restart. Every handler calls loadState() first
 * so we always operate from storage.session, which persists for the browser
 * session but resets on browser restart (intentionally — tab IDs change too).
 */

/** @typedef {'chatgpt'|'claude'|'gemini'|'copilot'} Platform */
/** @typedef {{ role: 'user'|'assistant', text: string, id?: string }} ConvMsg */

// ---------------------------------------------------------------------------
// In-memory mirrors of storage.session (rebuilt on every SW activation)
// ---------------------------------------------------------------------------
/** @type {Map<number, Platform>} */
let tabRegistry = new Map()

/** @type {Map<number, number>} tabId -> paired tabId, always bidirectional */
let mirrorPairs = new Map()

/** Dedup set for mirror messages — reset when SW restarts (acceptable). */
let seenMsgIds = new Set()

/** Debounce timers for assistant streaming (not persisted — resets on SW restart). */
const debounceTimers = new Map()

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function loadState() {
  const data = await chrome.storage.session.get(['tabRegistry', 'mirrorPairs'])
  if (data.tabRegistry) {
    tabRegistry = new Map(
      Object.entries(data.tabRegistry).map(([k, v]) => [Number(k), /** @type {Platform} */ (v)])
    )
  }
  if (data.mirrorPairs) {
    mirrorPairs = new Map(
      Object.entries(data.mirrorPairs).map(([k, v]) => [Number(k), /** @type {number} */ (v)])
    )
  }
}

async function saveState() {
  await chrome.storage.session.set({
    tabRegistry: Object.fromEntries(tabRegistry),
    mirrorPairs: Object.fromEntries(mirrorPairs),
  })
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    await loadState()
    let result
    try {
      result = await dispatch(msg, sender)
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) }
    }
    sendResponse(result)
  })()
  return true // keep channel open for async response
})

/**
 * @param {any} msg
 * @param {chrome.runtime.MessageSender} sender
 */
async function dispatch(msg, sender) {
  switch (msg.type) {
    case 'REGISTER_TAB':       return registerTab(msg, sender)
    case 'UNREGISTER_TAB':     return unregisterTab(sender)
    case 'SET_MIRROR_PAIR':    return setMirrorPair(msg)
    case 'REMOVE_MIRROR_PAIR': return removeMirrorPair(msg)
    case 'EXPORT_CONVERSATION':return exportConversation(msg)
    case 'TRANSFER_MEMORY':    return transferMemory(msg)
    case 'MIRROR_MESSAGE':     return mirrorMessage(msg, sender)
    case 'GET_STATE':          return getState()
    default:
      return { error: `Unknown message type: ${msg.type}` }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function registerTab(msg, sender) {
  const tabId = sender.tab?.id
  if (!tabId) return { error: 'No tab ID in sender' }
  tabRegistry.set(tabId, msg.platform)
  await saveState()
  return { ok: true, tabId }
}

async function unregisterTab(sender) {
  const tabId = sender.tab?.id
  if (!tabId) return { error: 'No tab ID in sender' }
  tabRegistry.delete(tabId)
  const paired = mirrorPairs.get(tabId)
  if (paired !== undefined) {
    mirrorPairs.delete(paired)
    mirrorPairs.delete(tabId)
  }
  await saveState()
  return { ok: true }
}

async function setMirrorPair(msg) {
  const { sourceTabId, destTabId } = msg
  if (!tabRegistry.has(sourceTabId)) return { error: `Tab ${sourceTabId} not registered` }
  if (!tabRegistry.has(destTabId)) return { error: `Tab ${destTabId} not registered` }
  // Bidirectional so either side can send messages to the other
  mirrorPairs.set(sourceTabId, destTabId)
  mirrorPairs.set(destTabId, sourceTabId)
  await saveState()
  return { ok: true }
}

async function removeMirrorPair(msg) {
  const paired = mirrorPairs.get(msg.tabId)
  if (paired !== undefined) mirrorPairs.delete(paired)
  mirrorPairs.delete(msg.tabId)
  await saveState()
  return { ok: true }
}

async function exportConversation(msg) {
  const { conversation, targetTabId } = msg
  if (!tabRegistry.has(targetTabId)) return { error: `Target tab ${targetTabId} not registered` }
  try {
    return await chrome.tabs.sendMessage(targetTabId, { type: 'INJECT_CONVERSATION', conversation })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Full memory transfer orchestrated by the SW so it survives popup close / tab switch.
 * Progress is written to storage.session so the popup can read it whether it's open or not.
 */
async function transferMemory(msg) {
  const { sourceTabId, destTabId } = msg

  const setProgress = async (phase, message, pct) => {
    await chrome.storage.session.set({ transferStatus: { phase, message, pct } })
    // Best-effort push to popup if it's still open
    chrome.runtime.sendMessage({ type: 'TRANSFER_PROGRESS', phase, message, pct }).catch(() => {})
  }

  try {
    await setProgress('scraping', 'Reading source tab…', 15)
    const scraped = await chrome.tabs.sendMessage(sourceTabId, { type: 'SCRAPE_CONVERSATION' })

    if (!scraped?.ok || !scraped.conversation?.length) {
      await setProgress('error', 'Nothing scraped from source tab', 0)
      return { error: 'Nothing scraped' }
    }

    const userCount = scraped.conversation.filter(
      /** @param {any} m */ (m) => m.role === 'user'
    ).length

    if (!userCount) {
      await setProgress('error', 'No user messages found', 0)
      return { error: 'No user messages' }
    }

    await setProgress('building', `Building prompt from ${userCount} memories…`, 45)
    await sleep(250) // brief pause so the label is readable before the next phase

    await setProgress('injecting', `Injecting ${userCount} memories into target…`, 75)
    const result = await chrome.tabs.sendMessage(destTabId, {
      type: 'INJECT_MEMORY',
      conversation: scraped.conversation,
    })

    if (result?.ok) {
      await setProgress('done', `${userCount} memories transferred — AI is processing`, 100)
      return { ok: true, userCount }
    }

    const errMsg = result?.error ?? 'unknown error'
    await setProgress('error', `Transfer failed: ${errMsg}`, 0)
    return { error: errMsg }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await chrome.storage.session.set({
      transferStatus: { phase: 'error', message: errMsg, pct: 0 }
    })
    return { error: errMsg }
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mirrorMessage(msg, sender) {
  const srcTabId = sender.tab?.id
  if (!srcTabId) return { error: 'No tab ID in sender' }

  const dstTabId = mirrorPairs.get(srcTabId)
  if (dstTabId === undefined) return { error: 'No mirror pair configured for this tab' }

  // Deduplicate — role+text hash prevents re-processing the same content
  const msgId = djb2(`${msg.role}:${msg.text}`)
  if (seenMsgIds.has(msgId)) return { ok: true, deduped: true }
  seenMsgIds.add(msgId)

  // Bound the dedup set to prevent memory growth over long sessions
  if (seenMsgIds.size > 500) {
    const arr = [...seenMsgIds]
    seenMsgIds = new Set(arr.slice(-100))
  }

  if (msg.role === 'assistant') {
    // Debounce: assistant messages stream in as partial tokens.
    // We wait for a 650ms quiet period before forwarding the complete response.
    clearTimeout(debounceTimers.get(srcTabId))
    debounceTimers.set(
      srcTabId,
      setTimeout(() => {
        chrome.tabs
          .sendMessage(dstTabId, { type: 'INJECT_MESSAGE', role: msg.role, text: msg.text })
          .catch(() => {
            // Target tab closed or content script unloaded — silently drop
          })
        debounceTimers.delete(srcTabId)
      }, 650)
    )
    return { ok: true, debounced: true }
  }

  // User messages are discrete — forward immediately
  try {
    return await chrome.tabs.sendMessage(dstTabId, {
      type: 'INJECT_MESSAGE',
      role: msg.role,
      text: msg.text,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function getState() {
  return {
    tabRegistry: Object.fromEntries(tabRegistry),
    mirrorPairs: Object.fromEntries(mirrorPairs),
  }
}

// ---------------------------------------------------------------------------
// Tab lifecycle cleanup
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState()
  tabRegistry.delete(tabId)
  const paired = mirrorPairs.get(tabId)
  if (paired !== undefined) {
    mirrorPairs.delete(paired)
    mirrorPairs.delete(tabId)
  }
  await saveState()
})

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/** Fast djb2-xor hash — good enough for dedup IDs, not cryptographic. */
function djb2(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h |= 0
  }
  return (h >>> 0).toString(36)
}

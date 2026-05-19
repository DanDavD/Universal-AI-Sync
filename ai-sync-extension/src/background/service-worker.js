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
    case 'SYNC_CONTEXT':       return syncContext(msg)
    case 'SYNC_DONE':          return syncDone()
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

/**
 * Writes transfer progress to session storage and broadcasts it to any open popup.
 * @param {string} phase
 * @param {string} message
 * @param {number} pct
 */
async function setProgress(phase, message, pct) {
  await chrome.storage.session.set({ transferStatus: { phase, message, pct } })
  chrome.runtime.sendMessage({ type: 'TRANSFER_PROGRESS', phase, message, pct }).catch(() => {})
}

/**
 * Called by the destination content script once the AI finishes its response.
 * Fires the final "done" progress update so the popup turns green.
 */
async function syncDone() {
  await setProgress('done', 'Context synced successfully', 100)
  return { ok: true }
}

/**
 * Context sync orchestrated by the SW so it survives popup close / tab switch.
 *
 * Scrapes the source conversation silently (no injection into source AI), strips
 * filler noise locally, builds a clean prompt, then injects it into the destination.
 *
 * Progress is written to storage.session so the popup can restore it on reopen.
 */
async function syncContext(msg) {
  const { sourceTabId, destTabId } = msg

  try {
    await setProgress('scraping', 'Reading source conversation…', 20)
    const scraped = await chrome.tabs.sendMessage(sourceTabId, { type: 'SCRAPE_CONVERSATION' })

    if (!scraped?.ok || !scraped.conversation?.length) {
      await setProgress('error', 'Nothing scraped from source tab', 0)
      return { error: 'Nothing scraped' }
    }

    // Trim to platform budget so the chunk count stays manageable
    const destPlatform = tabRegistry.get(destTabId) ?? 'chatgpt'
    const budget = PLATFORM_BUDGETS[destPlatform] ?? 60000
    const conversation = trimToBudget(scraped.conversation, budget)
    const trimNote = conversation.length < scraped.conversation.length
      ? ` (last ${conversation.length} of ${scraped.conversation.length} messages)`
      : ` (${conversation.length} messages)`

    // Build the clean prompt locally — strip noise per message, format both roles
    const summary = buildLocalSyncPrompt(conversation)

    await setProgress('syncing', `Syncing${trimNote}…`, 75)
    const injectResult = await chrome.tabs.sendMessage(destTabId, {
      type: 'INJECT_SYNC',
      summary,
    })

    if (injectResult?.ok) {
      // Parts delivered — content script will send SYNC_DONE when AI finishes
      await setProgress('syncing', 'Parts delivered — waiting for AI…', 90)
      return { ok: true }
    }

    const errMsg = injectResult?.error ?? 'unknown error'
    await setProgress('error', `Sync failed: ${errMsg}`, 0)
    return { error: errMsg }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await chrome.storage.session.set({
      transferStatus: { phase: 'error', message: errMsg, pct: 0 },
    })
    return { error: errMsg }
  }
}

// ---------------------------------------------------------------------------
// Platform content budgets — max chars of raw conversation to sync.
// Keeps part count sensible regardless of conversation length.
// Most-recent messages are always kept; oldest are dropped when over budget.
// ---------------------------------------------------------------------------

/** @type {Record<Platform, number>} */
const PLATFORM_BUDGETS = {
  chatgpt: 60000,  // ~5 parts @ 12k/chunk
  claude:  80000,  // ~3 parts @ 25k/chunk
  gemini:  48000,  // ~4 parts @ 12k/chunk
  copilot: 35000,  // ~5 parts @ 6.5k/chunk
}

/**
 * Returns the most recent messages that fit within `maxChars` total text,
 * dropping the oldest ones first.
 *
 * @param {ConvMsg[]} conversation
 * @param {number} maxChars
 * @returns {ConvMsg[]}
 */
function trimToBudget(conversation, maxChars) {
  let total = 0
  const kept = []
  for (let i = conversation.length - 1; i >= 0; i--) {
    const approx = conversation[i].text.length + 20 // +20 for "Human: \n\n" overhead
    if (total + approx > maxChars && kept.length >= 2) break
    kept.unshift(conversation[i])
    total += approx
  }
  return kept
}

// ---------------------------------------------------------------------------
// Local prompt builder (mirrors parser.js — inlined so the SW bundle is self-contained)
// ---------------------------------------------------------------------------

const SW_FILLER_PATTERNS = [
  /^(Great|Good|Excellent|Perfect|Wonderful|Fantastic|Awesome|Sure|Certainly|Absolutely|Of course|Definitely)\s*(question|point|idea|observation|thinking)?[!.,]?\s*/gim,
  /^I'?d be happy to help[!.,]?\s*/gim,
  /^I'?ll help (you )?(with that)?[!.,]?\s*/gim,
  /^Happy to help[!.,]?\s*/gim,
  /^(As (a|an) AI (language model|assistant|chatbot),?\s*)/gim,
  /^(As we (discussed|mentioned|talked about) (earlier|before|previously),?\s*)/gim,
  /\s*I hope (this|that) helps?[!.]?\s*$/gim,
  /\s*Feel free to (ask|reach out)( if you have| for)? any (more )?(questions?|help|clarification)[!.]?\s*$/gim,
  /\s*Let me know if you (need|have|want) (any )?(more )?(help|questions?|clarification|assistance)[!.]?\s*$/gim,
  /\s*Is there (anything|something) else (I can help (you )?with|you'?d? ?(like)?)[?!.]?\s*$/gim,
  /\s*Don'?t hesitate to ask[!.]?\s*$/gim,
  /\s*Let me know if (you need|that makes sense|this helps)[!.]?\s*$/gim,
]

/** @param {string} text */
function swStripNoise(text) {
  let cleaned = text
  for (const p of SW_FILLER_PATTERNS) cleaned = cleaned.replace(p, '')
  return cleaned.trim()
}

/** @param {ConvMsg[]} conversation */
function buildLocalSyncPrompt(conversation) {
  const lines = conversation
    .map((m) => {
      const label = m.role === 'user' ? 'Human' : 'Assistant'
      const text  = swStripNoise(m.text)
      return text ? `${label}: ${text}` : null
    })
    .filter((l) => l !== null)

  return [
    '[Context Transfer] The following is a full conversation from another AI assistant session. Please read and internalize this as our shared context going forward:',
    '',
    '--- CONTEXT START ---',
    lines.join('\n\n'),
    '--- CONTEXT END ---',
    '',
    'Please confirm you have received this context by briefly acknowledging the main topics covered.',
  ].join('\n')
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

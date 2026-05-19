// @ts-check

/**
 * Default CSS selectors for each platform.
 * Users can override these via the Options page — stored in chrome.storage.local
 * under the key 'selectorConfig' so updates survive extension restarts.
 *
 * All selectors are comma-separated CSS selector lists (querySelectorAll-compatible)
 * so that multiple fallbacks can be tried as platforms update their DOM.
 */

/** @type {Record<'chatgpt'|'claude'|'gemini'|'copilot', PlatformSelectors>} */
export const DEFAULT_SELECTORS = {
  chatgpt: {
    chatContainer:      'main',
    userMessages:       '[data-message-author-role="user"]',
    assistantMessages:  '[data-message-author-role="assistant"]',
    messageText:        '.whitespace-pre-wrap, .markdown p, .markdown li, .markdown pre code, p',
    input:              '#prompt-textarea, [contenteditable="true"][id="prompt-textarea"], div[contenteditable="true"][data-testid="prompt-textarea"]',
    submitBtn:          '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"]',
    stopBtn:            'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]',
    fileInput:          'input[type="file"]',
  },
  claude: {
    chatContainer:      '[data-testid="conversation-content"], .flex-1, main',
    userMessages:       '[data-testid="human-turn"], [data-testid="user-message"], .human-turn, [class*="humanTurn"], [class*="HumanTurn"], [class*="human_turn"]',
    assistantMessages:  '[data-testid="ai-turn"], [data-testid="assistant-message"], .ai-turn, [class*="aiTurn"], [class*="AiTurn"], [class*="ai_turn"]',
    messageText:        'p, li, code',
    input:              '.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, div[contenteditable="true"][class*="ProseMirror"]',
    submitBtn:          'button[aria-label="Send message"], button[aria-label="Send Message"], [data-testid="send-message-button"], button[type="submit"]',
    stopBtn:            'button[aria-label="Stop Response"], button[aria-label="Stop"], button[data-testid="stop-button"]',
    fileInput:          'input[type="file"]',
  },
  gemini: {
    chatContainer:      'chat-history, infinite-scroller, .conversation-container',
    userMessages:       'user-query, .user-query-bubble-container, [class*="user-query"]',
    assistantMessages:  'model-response, message-content, [class*="model-response"]',
    messageText:        '.query-text, .response-content p, .model-response-text p, p, [class*="query-text"]',
    input:              '.ql-editor[contenteditable="true"], rich-textarea .ql-editor, div[contenteditable="true"][class*="ql-editor"]',
    submitBtn:          'button.send-button, button[aria-label*="Send"], button[aria-label*="send"], .send-button',
    stopBtn:            'button[aria-label="Stop response"], button[aria-label*="Stop"], .stop-button',
    fileInput:          'input[type="file"]',
  },
  copilot: {
    chatContainer:      'main, [role="main"], .conversation-container, .chat-container',
    userMessages:       '[data-testid="user-message"], .user-message, [class*="UserMessage"], [class*="user-message"], .HumanMessage, [class*="HumanMessage"]',
    assistantMessages:  '[data-testid="bot-message"], [data-testid="copilot-message"], .bot-message, [class*="BotMessage"], [class*="bot-message"], .CopilotMessage, [class*="CopilotMessage"]',
    messageText:        'p, li, code',
    input:              'div[contenteditable="true"][role="textbox"], textarea[placeholder], #userInput, div[contenteditable="true"]',
    submitBtn:          'button[aria-label*="Submit"], button[aria-label*="Send"], button[aria-label*="send"], button[type="submit"]',
    stopBtn:            'button[aria-label*="Stop"], button[aria-label*="stop"]',
    fileInput:          'input[type="file"]',
  },
}

/**
 * @typedef {{
 *   chatContainer: string,
 *   userMessages: string,
 *   assistantMessages: string,
 *   messageText: string,
 *   input: string,
 *   submitBtn: string,
 *   stopBtn: string,
 *   fileInput: string,
 * }} PlatformSelectors
 */

/**
 * Loads the active selector config, merging storage overrides on top of defaults.
 * @param {'chatgpt'|'claude'|'gemini'|'copilot'} platform
 * @returns {Promise<PlatformSelectors>}
 */
export async function loadSelectors(platform) {
  try {
    const data = await chrome.storage.local.get('selectorConfig')
    /** @type {Record<string, Partial<PlatformSelectors>>} */
    const config = /** @type {any} */ (data.selectorConfig) ?? {}
    const overrides = /** @type {Partial<PlatformSelectors>} */ (config[platform] ?? {})
    return { ...DEFAULT_SELECTORS[platform], ...overrides }
  } catch {
    return DEFAULT_SELECTORS[platform]
  }
}

/**
 * Saves updated selectors for a platform to storage.
 * @param {'chatgpt'|'claude'|'gemini'|'copilot'} platform
 * @param {Partial<PlatformSelectors>} partial
 */
export async function saveSelectors(platform, partial) {
  const data = await chrome.storage.local.get('selectorConfig')
  /** @type {Record<string, Partial<PlatformSelectors>>} */
  const current = /** @type {any} */ (data.selectorConfig) ?? {}
  await chrome.storage.local.set({
    selectorConfig: { ...current, [platform]: { ...(current[platform] ?? {}), ...partial } },
  })
}

/**
 * Queries the first matching element from a comma-separated selector list.
 * @param {string} selectors
 * @param {ParentNode} [root]
 * @returns {Element|null}
 */
export function queryFirst(selectors, root = document) {
  for (const sel of selectors.split(',').map((s) => s.trim())) {
    try {
      const el = root.querySelector(sel)
      if (el) return el
    } catch { /* invalid selector in user config — skip */ }
  }
  return null
}

/**
 * Queries all matching elements from a comma-separated selector list.
 * @param {string} selectors
 * @param {ParentNode} [root]
 * @returns {Element[]}
 */
export function queryAll(selectors, root = document) {
  const seen = new Set()
  const results = []
  for (const sel of selectors.split(',').map((s) => s.trim())) {
    try {
      for (const el of root.querySelectorAll(sel)) {
        if (!seen.has(el)) { seen.add(el); results.push(el) }
      }
    } catch { /* skip */ }
  }
  return results
}

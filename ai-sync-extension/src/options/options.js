// @ts-check
/**
 * Options page — lets users update DOM selectors when AI platforms change
 * their markup without requiring a full extension rebuild.
 *
 * Selectors are stored in chrome.storage.local under 'selectorConfig'.
 * Content scripts load them on init and merge with built-in defaults.
 */

import { DEFAULT_SELECTORS, saveSelectors } from '../content/shared/selectorConfig.js'

const PLATFORMS = /** @type {const} */ (['chatgpt', 'claude', 'gemini'])

/** @type {Record<string, HTMLFormElement>} */
const forms = {}

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get('selectorConfig')
  const overrides = data.selectorConfig ?? {}

  for (const platform of PLATFORMS) {
    const form = /** @type {HTMLFormElement} */ (document.getElementById(`form-${platform}`))
    if (!form) continue
    forms[platform] = form

    const merged = { ...DEFAULT_SELECTORS[platform], ...overrides[platform] }

    for (const [key, val] of Object.entries(merged)) {
      const input = /** @type {HTMLInputElement|null} */ (form.querySelector(`[name="${key}"]`))
      if (input) input.value = val
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(form)
      /** @type {Record<string,string>} */
      const partial = {}
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') partial[k] = v.trim()
      }
      await saveSelectors(platform, partial)
      showToast(`${platform} selectors saved`)
    })

    const resetBtn = form.querySelector('.btn-reset')
    resetBtn?.addEventListener('click', async () => {
      const defaults = DEFAULT_SELECTORS[platform]
      for (const [key, val] of Object.entries(defaults)) {
        const input = /** @type {HTMLInputElement|null} */ (form.querySelector(`[name="${key}"]`))
        if (input) input.value = val
      }
      await saveSelectors(platform, defaults)
      showToast(`${platform} selectors reset to defaults`)
    })
  }

  document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
    await chrome.storage.local.remove('selectorConfig')
    await chrome.storage.session.clear()
    showToast('All data cleared — reload AI tabs')
  })
})

/** @param {string} msg */
function showToast(msg) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('visible')
  setTimeout(() => el.classList.remove('visible'), 2500)
}

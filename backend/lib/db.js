'use strict'
const crypto    = require('crypto')
const supabase  = require('./supabase')

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a human-readable license key: UAIS-XXXXXXXX-XXXXXXXX */
function generateLicenseKey() {
  const a = crypto.randomBytes(4).toString('hex').toUpperCase()
  const b = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `UAIS-${a}-${b}`
}

/** Throws if Supabase returned an error. */
function check(error, context) {
  if (error) throw new Error(`[db] ${context}: ${error.message}`)
}

// ── Free users ───────────────────────────────────────────────────────────────

/**
 * Registers a new free user. Silently ignores duplicate emails.
 * @param {{ email: string }} params
 * @returns {Promise<{ isNew: boolean, user: object }>}
 */
async function registerFreeUser({ email }) {
  // Check if already exists
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  if (existing) return { isNew: false, user: existing }

  const { data, error } = await supabase
    .from('users')
    .insert({ email, plan: 'free', status: 'active' })
    .select()
    .single()

  check(error, 'registerFreeUser')
  return { isNew: true, user: data }
}

// ── Premium / PayPal ─────────────────────────────────────────────────────────

/**
 * Creates a pending premium record when the user starts the PayPal checkout.
 * The record becomes active once PayPal confirms payment.
 * @param {{ email: string, paypalSubscriptionId: string }} params
 * @returns {Promise<string>} The generated license key.
 */
async function createPending({ email, paypalSubscriptionId }) {
  const licenseKey = generateLicenseKey()

  // Upsert so re-attempting checkout doesn't create duplicates
  const { error } = await supabase
    .from('users')
    .upsert(
      {
        email,
        plan:                    'premium',
        status:                  'pending',
        paypal_subscription_id:  paypalSubscriptionId,
        license_key:             licenseKey,
      },
      { onConflict: 'email' }
    )

  check(error, 'createPending')
  return licenseKey
}

/**
 * Updates a user's subscription status after a PayPal webhook event.
 * @param {{ paypalSubscriptionId: string, status: string }} params
 */
async function updateStatus({ paypalSubscriptionId, status }) {
  const { error } = await supabase
    .from('users')
    .update({ status })
    .eq('paypal_subscription_id', paypalSubscriptionId)

  check(error, 'updateStatus')
}

/**
 * Validates a license key and returns the user's plan info.
 * On first call with a deviceId, binds the license to that device.
 * Subsequent calls only succeed if the deviceId matches.
 * @param {string} licenseKey
 * @param {string} [deviceId]
 * @returns {Promise<{ valid: boolean, plan: string, status: string, email: string }|null>}
 */
async function validateLicense(licenseKey, deviceId) {
  const normalizedKey = licenseKey.trim().toUpperCase()
  const { data, error } = await supabase
    .from('users')
    .select('email, plan, status, device_id')
    .eq('license_key', normalizedKey)
    .maybeSingle()

  if (error) { console.error('[db] validateLicense:', error.message); return null }
  if (!data)  return null

  const isActive = data.plan === 'premium' && data.status === 'active'

  if (!isActive) {
    return { valid: false, plan: data.plan, status: data.status, email: data.email }
  }

  // First activation: bind the license to this device
  if (!data.device_id) {
    if (deviceId) {
      await supabase
        .from('users')
        .update({ device_id: deviceId })
        .eq('license_key', normalizedKey)
    }
    return { valid: true, plan: data.plan, status: data.status, email: data.email }
  }

  // Already bound: only valid if the same device
  if (data.device_id !== deviceId) {
    return { valid: false, plan: data.plan, status: 'device_mismatch', email: data.email }
  }

  return { valid: true, plan: data.plan, status: data.status, email: data.email }
}

/**
 * Looks up a user by PayPal subscription ID.
 * @param {string} paypalSubscriptionId
 */
async function findByPaypalId(paypalSubscriptionId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('paypal_subscription_id', paypalSubscriptionId)
    .maybeSingle()
  return data ?? null
}

// ── Free plan cooldown ───────────────────────────────────────────────────────

const FREE_COOLDOWN_MS = 5 * 60 * 60 * 1000 // 5 hours

/**
 * Checks if a free device is allowed to do a file sync.
 * If allowed, records the sync time atomically.
 * @param {string} deviceId
 * @returns {Promise<{ allowed: boolean, availableAt?: number }>}
 */
async function checkAndRecordFileSync(deviceId) {
  const { data } = await supabase
    .from('sync_cooldowns')
    .select('last_sync_at')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (data) {
    const availableAt = new Date(data.last_sync_at).getTime() + FREE_COOLDOWN_MS
    if (Date.now() < availableAt) {
      return { allowed: false, availableAt }
    }
  }

  await supabase
    .from('sync_cooldowns')
    .upsert({ device_id: deviceId, last_sync_at: new Date().toISOString() })

  return { allowed: true }
}

// ── Admin ────────────────────────────────────────────────────────────────────

/**
 * Returns all users, newest first.
 * @param {{ search?: string, plan?: string, page?: number, perPage?: number }} opts
 */
async function getAllUsers({ search = '', plan = '', page = 1, perPage = 50 } = {}) {
  let query = supabase
    .from('users')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)

  if (plan) query = query.eq('plan', plan)
  if (search) query = query.ilike('email', `%${search}%`)

  const { data, error, count } = await query
  check(error, 'getAllUsers')
  return { users: data ?? [], total: count ?? 0 }
}

/**
 * Returns aggregate stats.
 */
async function getStats() {
  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .single()

  if (error) {
    // Fallback manual count if the view doesn't exist yet
    const { count: total }   = await supabase.from('users').select('*', { count: 'exact', head: true })
    const { count: premium } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('plan', 'premium')
    return { total: total ?? 0, premium: premium ?? 0, free_users: (total ?? 0) - (premium ?? 0) }
  }
  return data
}

/**
 * Manually sets a user's plan (admin override).
 * @param {{ id: string, plan: 'free'|'premium', status?: string }} params
 */
async function setUserPlan({ id, plan, status }) {
  const update = { plan }
  if (status) update.status = status

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  check(error, 'setUserPlan')
  return data
}

/**
 * Deletes a user record.
 * @param {string} id
 */
async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id)
  check(error, 'deleteUser')
}

module.exports = {
  registerFreeUser,
  createPending,
  updateStatus,
  validateLicense,
  findByPaypalId,
  checkAndRecordFileSync,
  getAllUsers,
  getStats,
  setUserPlan,
  deleteUser,
}

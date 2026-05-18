'use strict'
const Database = require('better-sqlite3')
const path = require('path')
const crypto = require('crypto')

const db = new Database(path.join(__dirname, '..', 'subscriptions.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    email                 TEXT NOT NULL,
    paypal_subscription_id TEXT UNIQUE,
    license_key           TEXT UNIQUE NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending',
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_license_key ON subscriptions(license_key);
  CREATE INDEX IF NOT EXISTS idx_paypal_sub  ON subscriptions(paypal_subscription_id);
`)

/** Generates a human-readable license key: UAIS-XXXXXXXX-XXXXXXXX */
function generateLicenseKey() {
  const a = crypto.randomBytes(4).toString('hex').toUpperCase()
  const b = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `UAIS-${a}-${b}`
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO subscriptions (email, paypal_subscription_id, license_key, status)
    VALUES (@email, @paypal_subscription_id, @license_key, @status)
  `),
  updateStatus: db.prepare(`
    UPDATE subscriptions
    SET status = @status, updated_at = datetime('now')
    WHERE paypal_subscription_id = @paypal_subscription_id
  `),
  findByLicense: db.prepare(`
    SELECT * FROM subscriptions WHERE license_key = ?
  `),
  findByPaypalId: db.prepare(`
    SELECT * FROM subscriptions WHERE paypal_subscription_id = ?
  `),
}

module.exports = {
  /**
   * Creates a pending subscription record before redirecting user to PayPal.
   * @param {{ email: string, paypalSubscriptionId: string }} params
   * @returns {string} license_key
   */
  createPending({ email, paypalSubscriptionId }) {
    const license_key = generateLicenseKey()
    stmts.insert.run({
      email,
      paypal_subscription_id: paypalSubscriptionId,
      license_key,
      status: 'pending',
    })
    return license_key
  },

  /**
   * Updates subscription status (active, cancelled, suspended).
   * @param {{ paypalSubscriptionId: string, status: string }} params
   */
  updateStatus({ paypalSubscriptionId, status }) {
    stmts.updateStatus.run({ status, paypal_subscription_id: paypalSubscriptionId })
  },

  /**
   * Validates a license key. Returns { valid, email, status } or null if not found.
   * @param {string} licenseKey
   */
  validateLicense(licenseKey) {
    const row = stmts.findByLicense.get(licenseKey.trim().toUpperCase())
    if (!row) return null
    return { valid: row.status === 'active', email: row.email, status: row.status }
  },

  /** @param {string} paypalSubscriptionId */
  findByPaypalId(paypalSubscriptionId) {
    return stmts.findByPaypalId.get(paypalSubscriptionId) ?? null
  },
}

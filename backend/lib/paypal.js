'use strict'
const axios = require('axios')

const MODE = process.env.PAYPAL_MODE || 'sandbox'
const BASE = MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

let _cachedToken = null
let _tokenExpiry = 0

/** Fetches (or returns cached) OAuth access token. */
async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken

  const { data } = await axios.post(
    `${BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: {
        username: process.env.PAYPAL_CLIENT_ID,
        password: process.env.PAYPAL_CLIENT_SECRET,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  )

  _cachedToken = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _cachedToken
}

/** @param {string} path @param {any} [body] @param {'GET'|'POST'|'PATCH'} [method] */
async function paypalRequest(path, body = null, method = 'POST') {
  const token = await getAccessToken()
  const { data } = await axios.request({
    method,
    url: `${BASE}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: body ?? undefined,
  })
  return data
}

module.exports = {
  /**
   * Creates a PayPal subscription and returns the approval URL.
   * @param {{ email: string, planId: string, returnUrl: string, cancelUrl: string }} params
   * @returns {Promise<{ subscriptionId: string, approvalUrl: string }>}
   */
  async createSubscription({ email, planId, returnUrl, cancelUrl }) {
    const data = await paypalRequest('/v1/billing/subscriptions', {
      plan_id: planId,
      subscriber: { email_address: email },
      application_context: {
        brand_name: 'Universal AI Sync',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    })

    const approvalUrl = data.links.find((l) => l.rel === 'approve')?.href
    if (!approvalUrl) throw new Error('PayPal did not return an approval URL')

    return { subscriptionId: data.id, approvalUrl }
  },

  /**
   * Fetches subscription details from PayPal.
   * @param {string} subscriptionId
   */
  async getSubscription(subscriptionId) {
    return paypalRequest(`/v1/billing/subscriptions/${subscriptionId}`, null, 'GET')
  },

  /**
   * Verifies a webhook signature via PayPal's API.
   * Returns true if the signature is valid.
   * @param {{ headers: Record<string,string>, rawBody: Buffer }} params
   */
  async verifyWebhook({ headers, rawBody }) {
    try {
      const data = await paypalRequest('/v1/notifications/verify-webhook-signature', {
        auth_algo:          headers['paypal-auth-algo'],
        cert_url:           headers['paypal-cert-url'],
        transmission_id:    headers['paypal-transmission-id'],
        transmission_sig:   headers['paypal-transmission-sig'],
        transmission_time:  headers['paypal-transmission-time'],
        webhook_id:         process.env.PAYPAL_WEBHOOK_ID,
        webhook_event:      JSON.parse(rawBody.toString()),
      })
      return data.verification_status === 'SUCCESS'
    } catch {
      return false
    }
  },

  /**
   * Creates a product in PayPal (run once via setup-paypal.js).
   * @param {{ name: string, description: string }} params
   */
  async createProduct({ name, description }) {
    return paypalRequest('/v1/catalogs/products', {
      name,
      description,
      type: 'SERVICE',
      category: 'SOFTWARE',
    })
  },

  /**
   * Creates a billing plan (run once via setup-paypal.js).
   * @param {{ productId: string, name: string, priceUsd: string }} params
   */
  async createPlan({ productId, name, priceUsd }) {
    return paypalRequest('/v1/billing/plans', {
      product_id: productId,
      name,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // 0 = indefinite
          pricing_scheme: {
            fixed_price: { value: priceUsd, currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    })
  },
}

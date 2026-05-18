'use strict'
const express = require('express')
const router = express.Router()
const paypal = require('../lib/paypal')
const db = require('../lib/db')
const { sendLicenseEmail } = require('../lib/mailer')

// ---------------------------------------------------------------------------
// POST /api/paypal/subscribe
// Body: { email }
// Creates a PayPal subscription and redirects user to PayPal approval page.
// ---------------------------------------------------------------------------
router.post('/subscribe', async (req, res) => {
  const email = (req.body?.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  try {
    const base = process.env.BASE_URL
    const { subscriptionId, approvalUrl } = await paypal.createSubscription({
      email,
      planId: process.env.PAYPAL_PLAN_ID,
      returnUrl:  `${base}/api/paypal/success`,
      cancelUrl:  `${base}/cancel.html`,
    })

    db.createPending({ email, paypalSubscriptionId: subscriptionId })

    // Redirect user to PayPal to approve the subscription
    res.redirect(approvalUrl)
  } catch (err) {
    console.error('[paypal] subscribe error:', err.message)
    res.status(500).json({ error: 'Failed to create subscription' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/paypal/success?subscription_id=I-xxx
// PayPal redirects here after the user approves.
// ---------------------------------------------------------------------------
router.get('/success', async (req, res) => {
  const subscriptionId = req.query.subscription_id
  if (!subscriptionId) return res.redirect('/cancel.html')

  try {
    // Verify with PayPal that the subscription is actually active
    const sub = await paypal.getSubscription(subscriptionId)

    const record = db.findByPaypalId(subscriptionId)
    if (!record) {
      console.error('[paypal] success: no DB record for', subscriptionId)
      return res.redirect('/cancel.html')
    }

    if (sub.status === 'ACTIVE' || sub.status === 'APPROVED') {
      db.updateStatus({ paypalSubscriptionId: subscriptionId, status: 'active' })

      // Send license key by email (best-effort — don't fail the page if it errors)
      sendLicenseEmail({ to: record.email, licenseKey: record.license_key })
        .catch((e) => console.error('[mailer] error:', e.message))

      // Redirect to success page with the key in the query string so the user
      // can see it immediately even if the email is delayed.
      return res.redirect(`/success.html?key=${encodeURIComponent(record.license_key)}&email=${encodeURIComponent(record.email)}`)
    }

    // Not yet active — PayPal may still be processing; show a pending page
    res.redirect(`/success.html?pending=1&email=${encodeURIComponent(record.email)}`)
  } catch (err) {
    console.error('[paypal] success error:', err.message)
    res.redirect('/cancel.html')
  }
})

// ---------------------------------------------------------------------------
// POST /api/paypal/webhook
// PayPal sends billing events here. Requires raw body for signature verification.
// ---------------------------------------------------------------------------
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const isValid = await paypal.verifyWebhook({
    headers: req.headers,
    rawBody: req.body,
  })

  if (!isValid) {
    console.warn('[paypal] webhook: invalid signature — rejected')
    return res.status(400).end()
  }

  const event = JSON.parse(req.body.toString())
  const subscriptionId = event.resource?.id ?? event.resource?.billing_agreement_id

  console.log(`[paypal] webhook: ${event.event_type} — ${subscriptionId}`)

  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
      db.updateStatus({ paypalSubscriptionId: subscriptionId, status: 'active' })
      break

    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
      db.updateStatus({ paypalSubscriptionId: subscriptionId, status: 'cancelled' })
      break

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      // Payment failed — suspend access until billing resumes
      db.updateStatus({ paypalSubscriptionId: subscriptionId, status: 'suspended' })
      break

    case 'PAYMENT.SALE.COMPLETED':
      // Successful monthly payment — ensure status stays active
      db.updateStatus({ paypalSubscriptionId: subscriptionId, status: 'active' })
      break
  }

  res.status(200).end()
})

module.exports = router

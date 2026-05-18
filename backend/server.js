'use strict'
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors())

// The PayPal webhook route needs the raw body for signature verification.
// We register it BEFORE the JSON middleware so it gets the raw Buffer.
app.use('/api/paypal/webhook', require('./routes/paypal').webhookHandler ?? (() => {}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serve static HTML pages (checkout, success, cancel)
app.use(express.static(path.join(__dirname, 'public')))

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/paypal',  require('./routes/paypal'))
app.use('/api/license', require('./routes/license'))

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Universal AI Sync backend running on port ${PORT}`)
  console.log(`PayPal mode: ${process.env.PAYPAL_MODE || 'sandbox'}`)
})

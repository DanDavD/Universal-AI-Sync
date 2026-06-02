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

// Serve static HTML pages (checkout, success, cancel)
app.use(express.static(path.join(__dirname, 'public')))

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// PayPal routes are mounted BEFORE express.json() so the /webhook route
// receives a raw Buffer for signature verification. The /subscribe and
// /confirm routes apply express.json() themselves.
app.use('/api/paypal',  require('./routes/paypal'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/license', require('./routes/license'))
app.use('/api/sync',   require('./routes/sync'))
app.use('/api/users',  require('./routes/users'))
app.use('/api/admin',  require('./routes/admin'))

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

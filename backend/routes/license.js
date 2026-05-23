'use strict'
const express = require('express')
const router = express.Router()
const db = require('../lib/db')

// ---------------------------------------------------------------------------
// POST /api/license/validate
// Body: { key }
// Called by the Chrome extension to check if a license is active.
// ---------------------------------------------------------------------------
router.post('/validate', async (req, res) => {
  const key = (req.body?.key ?? '').trim()
  if (!key) return res.status(400).json({ valid: false, error: 'No key provided' })

  try {
    const result = await db.validateLicense(key)
    if (!result) return res.json({ valid: false, error: 'License key not found' })

    res.json({
      valid: result.valid,
      status: result.status,
      email: result.email,
    })
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message })
  }
})

module.exports = router

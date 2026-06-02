'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../lib/db')

// ---------------------------------------------------------------------------
// POST /api/sync/file-check
// Body: { deviceId }
// Called by free-plan users before a file sync.
// Returns { allowed: true } or { allowed: false, availableAt: <ms timestamp> }.
// ---------------------------------------------------------------------------
router.post('/file-check', async (req, res) => {
  const deviceId = (req.body?.deviceId ?? '').trim()
  if (!deviceId) return res.status(400).json({ allowed: false, error: 'No deviceId' })

  try {
    const result = await db.checkAndRecordFileSync(deviceId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ allowed: false, error: err.message })
  }
})

module.exports = router

'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../lib/db')

// ---------------------------------------------------------------------------
// POST /api/users/register
// Body: { email }
// Registers a free user. Idempotent — calling it twice with the same email
// returns the existing record without error.
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  const email = (req.body?.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  try {
    const { isNew, user } = await db.registerFreeUser({ email })
    res.json({
      ok:    true,
      isNew,
      plan:  user.plan,
      email: user.email,
    })
  } catch (err) {
    console.error('[users] register error:', err.message)
    res.status(500).json({ error: 'Registration failed' })
  }
})

module.exports = router

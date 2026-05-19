'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../lib/db')

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key']
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

router.use(requireAdmin)

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Returns aggregate user counts.
// ---------------------------------------------------------------------------
router.get('/stats', async (_req, res) => {
  try {
    const stats = await db.getStats()
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/users?search=&plan=&page=&perPage=
// Returns paginated user list.
// ---------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const { search = '', plan = '', page = '1', perPage = '50' } = req.query
    const result = await db.getAllUsers({
      search: String(search),
      plan:   String(plan),
      page:   Math.max(1, Number(page)),
      perPage: Math.min(100, Math.max(1, Number(perPage))),
    })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id/plan
// Body: { plan: 'free'|'premium', status?: string }
// Manually sets a user's plan (admin override).
// ---------------------------------------------------------------------------
router.patch('/users/:id/plan', async (req, res) => {
  const { id } = req.params
  const { plan, status } = req.body ?? {}

  if (!['free', 'premium'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "free" or "premium"' })
  }

  try {
    const updated = await db.setUserPlan({ id, plan, status })
    res.json({ ok: true, user: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// Permanently removes a user record.
// ---------------------------------------------------------------------------
router.delete('/users/:id', async (req, res) => {
  try {
    await db.deleteUser(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

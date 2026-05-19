'use strict'
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY // service_role key — server only, never expose

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
}

// service_role bypasses Row Level Security — correct for a trusted backend.
const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

module.exports = supabase

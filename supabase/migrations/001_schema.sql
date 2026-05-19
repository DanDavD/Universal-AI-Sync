-- ═══════════════════════════════════════════════════════════════════════════
-- Universal AI Sync — Initial Schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Users table ─────────────────────────────────────────────────────────────
-- Covers both free and premium users in one place.
-- Free users:    plan='free',    paypal_subscription_id=NULL, license_key=NULL
-- Premium users: plan='premium', paypal_subscription_id='I-xxx', license_key='UAIS-xxx'

CREATE TABLE IF NOT EXISTS public.users (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   TEXT        NOT NULL UNIQUE,
  plan                    TEXT        NOT NULL DEFAULT 'free'
                                      CHECK (plan IN ('free', 'premium')),
  status                  TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'pending', 'cancelled', 'suspended')),
  paypal_subscription_id  TEXT        UNIQUE,
  license_key             TEXT        UNIQUE,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email       ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_license_key ON public.users (license_key);
CREATE INDEX IF NOT EXISTS idx_users_paypal_sub  ON public.users (paypal_subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_plan        ON public.users (plan);

-- ── Auto-update updated_at on every row change ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS — the service_role key (used by our backend) bypasses it.
-- No client-side access is allowed.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies and create a restrictive default.
DROP POLICY IF EXISTS "Deny all" ON public.users;
CREATE POLICY "Deny all" ON public.users
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- ── Helper view for admin stats ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_stats AS
SELECT
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE plan = 'premium')          AS premium,
  COUNT(*) FILTER (WHERE plan = 'free')             AS free_users,
  COUNT(*) FILTER (WHERE status = 'active')         AS active,
  COUNT(*) FILTER (WHERE status = 'cancelled')      AS cancelled,
  COUNT(*) FILTER (WHERE status = 'suspended')      AS suspended,
  COUNT(*) FILTER (WHERE
    plan = 'premium' AND status = 'active'
    AND created_at >= DATE_TRUNC('month', NOW())
  )                                                 AS new_premium_this_month
FROM public.users;

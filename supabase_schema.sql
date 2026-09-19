-- ============================================================
-- Supabase Database Schema for Bart's Parking Concessions QR App
-- ============================================================
-- Instructions:
-- 1. Go to https://supabase.com and create a Free Project
-- 2. In your Supabase Dashboard, go to "SQL Editor"
-- 3. Paste and run this script to create all required tables & policies
-- 4. Copy your Supabase URL & Anon Key from Project Settings -> API
-- 5. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables
-- ============================================================

-- 1. Create Permits Table
CREATE TABLE IF NOT EXISTS public.permits (
  id TEXT PRIMARY KEY,
  hospital TEXT,
  ward TEXT,
  date_required TEXT,
  date_expiry TEXT,
  vrm TEXT,
  driver_name TEXT,
  phone TEXT,
  email TEXT,
  voucher_code TEXT,
  start_time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Vouchers Table
CREATE TABLE IF NOT EXISTS public.vouchers (
  code TEXT PRIMARY KEY,
  vrm TEXT,
  valid_from TEXT,
  valid_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Dispatched History Table
CREATE TABLE IF NOT EXISTS public.dispatched_history (
  key TEXT PRIMARY KEY,
  dispatch_date TEXT,
  dispatch_by TEXT,
  vrm TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatched_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES (Explicit public INSERT, UPDATE, SELECT, DELETE)
-- ============================================================

-- 1. Policies for dispatched_history
DROP POLICY IF EXISTS "Allow authenticated modifications on dispatched_history" ON public.dispatched_history;
DROP POLICY IF EXISTS "Allow public insert and update on dispatched_history" ON public.dispatched_history;
DROP POLICY IF EXISTS "Allow public all on dispatched_history" ON public.dispatched_history;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.dispatched_history;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.dispatched_history;
DROP POLICY IF EXISTS "Enable update for all users" ON public.dispatched_history;

CREATE POLICY "Allow public insert and update on dispatched_history"
ON public.dispatched_history
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 2. Policies for permits
DROP POLICY IF EXISTS "Allow authenticated modifications on permits" ON public.permits;
DROP POLICY IF EXISTS "Allow public insert and update on permits" ON public.permits;
DROP POLICY IF EXISTS "Allow public all on permits" ON public.permits;

CREATE POLICY "Allow public insert and update on permits"
ON public.permits
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 3. Policies for vouchers
DROP POLICY IF EXISTS "Allow authenticated modifications on vouchers" ON public.vouchers;
DROP POLICY IF EXISTS "Allow public insert and update on vouchers" ON public.vouchers;
DROP POLICY IF EXISTS "Allow public all on vouchers" ON public.vouchers;

CREATE POLICY "Allow public insert and update on vouchers"
ON public.vouchers
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- ============================================================
-- 4. RPC Function for administrative / safe dispatch logging
-- Declared with SECURITY DEFINER so that it bypasses RLS if called
-- by public / anon clients.
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_dispatch(
  p_key TEXT,
  p_dispatch_date TEXT,
  p_dispatch_by TEXT,
  p_vrm TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.dispatched_history (key, dispatch_date, dispatch_by, vrm, email)
  VALUES (p_key, p_dispatch_date, p_dispatch_by, p_vrm, p_email)
  ON CONFLICT (key) DO UPDATE
  SET dispatch_date = EXCLUDED.dispatch_date,
      dispatch_by = EXCLUDED.dispatch_by,
      vrm = COALESCE(EXCLUDED.vrm, public.dispatched_history.vrm),
      email = COALESCE(EXCLUDED.email, public.dispatched_history.email);
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_dispatch TO anon, authenticated, public;


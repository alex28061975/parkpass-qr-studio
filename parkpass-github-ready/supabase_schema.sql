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

-- Enable Row Level Security (RLS)
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatched_history ENABLE ROW LEVEL SECURITY;

-- Safe policy creation using PL/pgSQL block (prevents ERROR 42710 if policies already exist)
DO $$
BEGIN
  -- Permits policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'permits' AND policyname = 'Allow public all on permits'
  ) THEN
    CREATE POLICY "Allow public all on permits" ON public.permits FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- Vouchers policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vouchers' AND policyname = 'Allow public all on vouchers'
  ) THEN
    CREATE POLICY "Allow public all on vouchers" ON public.vouchers FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- Dispatched history policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dispatched_history' AND policyname = 'Allow public all on dispatched_history'
  ) THEN
    CREATE POLICY "Allow public all on dispatched_history" ON public.dispatched_history FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

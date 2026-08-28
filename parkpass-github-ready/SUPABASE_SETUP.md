# How to Use This App with Free Supabase

Supabase provides a free cloud PostgreSQL database that syncs your parking permits, voucher codes, and dispatched email logs across devices and team members in real-time.

---

## Step 1: Create a Free Supabase Account & Project

1. Visit [supabase.com](https://supabase.com) and click **Start your project**.
2. Sign in with GitHub or email.
3. Click **New Project**, select a name (e.g. `barts-parking-concessions`), set a database password, and choose your preferred region.
4. Select the **Free Tier** ($0/month) and click **Create new project**.

---

## Step 2: Set Up Database Tables

1. In your Supabase Dashboard left menu, click **SQL Editor**.
2. Click **New query**.
3. Copy and paste the entire contents of `supabase_schema.sql` (found in the root directory of this repository).
4. Click **Run** (or press `Ctrl + Enter`).
5. You will see "Success. No rows returned" confirming that `permits`, `vouchers`, and `dispatched_history` tables have been created with Row Level Security policies.

---

## Step 3: Get Your Credentials

1. In your Supabase Dashboard left menu, click **Project Settings** (gear icon) -> **API**.
2. Copy the following values:
   - **Project URL** (e.g., `https://xyzcompany.supabase.co`)
   - **anon / public key** (long string starting with `eyJ...`)

---

## Step 4: Configure Environment Variables

Add your Supabase credentials to your `.env` file (or set them in AI Studio / Deployment settings):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Step 5: Start Using Supabase Sync

Once `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are defined:
- The app automatically connects to Supabase on launch.
- A **Supabase Connected** badge will appear in the top header.
- Permits, voucher database records, and dispatched email statuses will automatically sync to your cloud database in real-time!
- If credentials are ever missing, the app gracefully falls back to local browser storage (`localStorage`) so you never lose work.

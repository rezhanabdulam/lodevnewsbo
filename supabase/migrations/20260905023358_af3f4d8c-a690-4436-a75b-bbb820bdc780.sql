ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS translation_use_vercel boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS translation_model_order jsonb NOT NULL DEFAULT '["google/gemini-3.6-flash","google/gemini-3.5-flash-lite","google/gemini-3.7-flash","google/gemini-3.8-flash","minimax/minimax-m3"]'::jsonb,
  ADD COLUMN IF NOT EXISTS instant_poll_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS instant_last_run_at timestamptz;
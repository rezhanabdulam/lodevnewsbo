ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS bot_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_paused_reason text;
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_paused_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_bot_paused_reason_length') THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_bot_paused_reason_length CHECK (bot_paused_reason IS NULL OR char_length(bot_paused_reason) <= 240);
  END IF;
END $$;

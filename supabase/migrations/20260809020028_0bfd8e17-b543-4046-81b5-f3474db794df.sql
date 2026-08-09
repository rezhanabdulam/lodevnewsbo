ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS event_cooldown_hours integer NOT NULL DEFAULT 72,
  ADD COLUMN IF NOT EXISTS event_similarity_threshold numeric NOT NULL DEFAULT 0.52;

ALTER TABLE public.settings
  ADD CONSTRAINT settings_event_cooldown_hours_range CHECK (event_cooldown_hours BETWEEN 1 AND 336),
  ADD CONSTRAINT settings_event_similarity_threshold_range CHECK (event_similarity_threshold BETWEEN 0.30 AND 0.90);
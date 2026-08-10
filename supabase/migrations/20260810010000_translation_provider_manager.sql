-- Translation provider/key manager.
-- Keys are server-side only. RLS prevents authenticated users from reading/writing them directly;
-- all management goes through admin server functions using the service role.
CREATE TABLE IF NOT EXISTS public.translation_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('gemini','minimax')),
  label TEXT NOT NULL DEFAULT 'Unnamed key',
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  cooldown_until TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_status INT,
  last_error TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_translation_keys_provider
  ON public.translation_provider_keys(provider, enabled, priority);

GRANT ALL ON public.translation_provider_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translation_provider_keys TO authenticated;
ALTER TABLE public.translation_provider_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage translation keys" ON public.translation_provider_keys;
CREATE POLICY "admins manage translation keys" ON public.translation_provider_keys
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS t_translation_provider_keys_updated ON public.translation_provider_keys;
CREATE TRIGGER t_translation_provider_keys_updated
BEFORE UPDATE ON public.translation_provider_keys
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS translation_mode TEXT NOT NULL DEFAULT 'gemini_first'
    CHECK (translation_mode IN ('gemini_first','minimax_first','both')),
  ADD COLUMN IF NOT EXISTS translation_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash';

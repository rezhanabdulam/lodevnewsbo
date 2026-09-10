CREATE TABLE public.translation_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text,
  model text,
  api_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  cooldown_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_status integer,
  last_error text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.translation_provider_keys TO authenticated;
GRANT ALL ON public.translation_provider_keys TO service_role;

ALTER TABLE public.translation_provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage translation keys"
ON public.translation_provider_keys
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER t_translation_provider_keys_updated
BEFORE UPDATE ON public.translation_provider_keys
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
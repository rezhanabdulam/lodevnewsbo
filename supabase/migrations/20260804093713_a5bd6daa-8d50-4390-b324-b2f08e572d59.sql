-- admin allowlist
CREATE TABLE public.admin_users (
  user_id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id);
$$;

-- first signed-up user becomes the admin; afterwards nobody is auto-added
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users) THEN
    INSERT INTO public.admin_users (user_id, email) VALUES (NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_claim_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.claim_first_admin();

CREATE POLICY "admins read admin list" ON public.admin_users
FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- settings (single row)
CREATE TABLE public.settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_language TEXT NOT NULL DEFAULT 'en',
  day_start TIME NOT NULL DEFAULT '08:00',
  day_end TIME NOT NULL DEFAULT '23:00',
  day_min_minutes INT NOT NULL DEFAULT 25,
  day_max_minutes INT NOT NULL DEFAULT 60,
  night_start TIME NOT NULL DEFAULT '23:00',
  night_end TIME NOT NULL DEFAULT '08:00',
  night_min_minutes INT NOT NULL DEFAULT 90,
  night_max_minutes INT NOT NULL DEFAULT 180,
  breaking_interrupts_night BOOLEAN NOT NULL DEFAULT true,
  breaking_categories TEXT[] NOT NULL DEFAULT ARRAY['war','iran','proxies','usa'],
  oil_move_threshold NUMERIC NOT NULL DEFAULT 3,
  gold_move_threshold NUMERIC NOT NULL DEFAULT 2,
  timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  last_published_at TIMESTAMPTZ,
  next_publish_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage settings" ON public.settings FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER t_settings_updated BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.settings (id) VALUES (1);

-- topic queries
CREATE TABLE public.topic_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'iran',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_queries TO authenticated;
GRANT ALL ON public.topic_queries TO service_role;
ALTER TABLE public.topic_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage topics" ON public.topic_queries FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
INSERT INTO public.topic_queries (query, category) VALUES
 ('Iran United States', 'usa'),
 ('Iran strike attack', 'war'),
 ('Iran nuclear talks', 'iran'),
 ('Hezbollah', 'proxies'),
 ('Houthi Red Sea', 'proxies'),
 ('Iraqi militias Iran', 'proxies'),
 ('Israel Iran', 'war'),
 ('oil price', 'oil'),
 ('gold price', 'gold'),
 ('Strait of Hormuz', 'oil'),
 ('Iran Saudi Arabia relations', 'iran'),
 ('Trump Iran', 'usa');

-- sources / providers
CREATE TABLE public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  secret_ref TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INT NOT NULL DEFAULT 100,
  daily_quota INT,
  used_today INT NOT NULL DEFAULT 0,
  quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sources TO authenticated;
GRANT ALL ON public.sources TO service_role;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage sources" ON public.sources FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
INSERT INTO public.sources (name, kind, secret_ref, priority, daily_quota) VALUES
 ('NewsData.io', 'newsdata', 'NEWSDATA_API_KEY', 10, 200),
 ('Google News RSS', 'rss', NULL, 50, NULL);

-- telegram chats
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL UNIQUE,
  title TEXT,
  username TEXT,
  type TEXT NOT NULL DEFAULT 'private',
  language TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage chats" ON public.chats FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- raw articles
CREATE TABLE public.raw_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  source_name TEXT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  category TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejected BOOLEAN NOT NULL DEFAULT false,
  reject_reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_raw_articles_fetched ON public.raw_articles (fetched_at DESC);
GRANT SELECT, DELETE ON public.raw_articles TO authenticated;
GRANT ALL ON public.raw_articles TO service_role;
ALTER TABLE public.raw_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read articles" ON public.raw_articles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins delete articles" ON public.raw_articles FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- queue
CREATE TABLE public.queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL UNIQUE,
  article_id UUID REFERENCES public.raw_articles(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  source_name TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  original_published_at TIMESTAMPTZ,
  score NUMERIC NOT NULL DEFAULT 0,
  score_parts JSONB NOT NULL DEFAULT '{}'::jsonb,
  breaking BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_queue_status_score ON public.queue (status, breaking DESC, score DESC);
GRANT SELECT, UPDATE, DELETE ON public.queue TO authenticated;
GRANT ALL ON public.queue TO service_role;
ALTER TABLE public.queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage queue" ON public.queue FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- published history
CREATE TABLE public.published_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL,
  chat_id BIGINT NOT NULL,
  headline TEXT,
  source_name TEXT,
  category TEXT,
  breaking BOOLEAN NOT NULL DEFAULT false,
  original_published_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedup_key, chat_id)
);
CREATE INDEX idx_history_published ON public.published_history (published_at DESC);
GRANT SELECT ON public.published_history TO authenticated;
GRANT ALL ON public.published_history TO service_role;
ALTER TABLE public.published_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read history" ON public.published_history FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- translation failures
CREATE TABLE public.translation_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT,
  headline TEXT,
  target_language TEXT NOT NULL,
  models_tried TEXT[] NOT NULL DEFAULT '{}',
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.translation_failures TO authenticated;
GRANT ALL ON public.translation_failures TO service_role;
ALTER TABLE public.translation_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read tfails" ON public.translation_failures FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins delete tfails" ON public.translation_failures FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
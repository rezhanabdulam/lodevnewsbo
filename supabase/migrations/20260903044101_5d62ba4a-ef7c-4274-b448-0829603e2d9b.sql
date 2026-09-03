ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS post_show_category boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_show_source_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_show_source_link boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_show_timestamp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_show_summary boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_show_images boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_link_preview boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_show_hashtags boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS post_header_emoji text NOT NULL DEFAULT '📰',
  ADD COLUMN IF NOT EXISTS post_read_more_label text NOT NULL DEFAULT 'Read the full report',
  ADD COLUMN IF NOT EXISTS post_footer_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS post_default_hashtags jsonb NOT NULL DEFAULT '["#Iran","#IranUSA","#MiddleEast"]'::jsonb,
  ADD COLUMN IF NOT EXISTS post_category_hashtags jsonb NOT NULL DEFAULT '{"oil":["#Oil","#Energy"],"gold":["#Gold","#Markets"],"war":["#War"],"iraq":["#Iraq"],"iran":["#Iran"],"usa":["#USA"],"proxies":["#Resistance"],"analysis":["#Analysis"],"middle-east":["#MiddleEast"],"economic-impact":["#Economy"]}'::jsonb;
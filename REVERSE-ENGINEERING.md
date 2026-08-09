# Lodev News Bot — Reverse Engineering Document

A private, single-admin web application that runs a fully automated Telegram news
bot covering the Iran–U.S. conflict, Iraq, the wider Middle East, Iran's allied
armed groups, and the market reactions (oil, gold) around them.

There is **no public news website**. The web app is an admin console only.

---

## 1. Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start v1 (React 19, Vite 7, SSR on an edge worker) |
| Styling | Tailwind CSS v4 via `src/styles.css` (dark "command-room" theme, OKLCH tokens) |
| Backend | Lovable Cloud (Supabase): Postgres + Auth + RLS + `pg_cron` + `pg_net` |
| AI | Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) |
| Messaging | Telegram Bot API (direct bot token, connector-gateway fallback) |
| News data | NewsData.io (quota-capped) + Bing News RSS + ~18 direct publisher RSS feeds |

Secrets (server-side only): `NEWSDATA_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`LOVABLE_API_KEY`, `SUPABASE_*`.

---

## 2. Database schema

All tables live in `public`, all have RLS enabled, and every policy is gated by
`public.is_admin(auth.uid())`. Server-side pipeline code uses the service-role
client and bypasses RLS.

| Table | Purpose |
|---|---|
| `admin_users` | The single admin. Populated by the `claim_first_admin` trigger on `auth.users` — the first account ever created becomes admin; nobody else can. |
| `settings` (single row, `id = 1`) | Timezone, default language, day/night windows, min/max minute gaps, breaking rules, oil/gold thresholds, `last_published_at`, `next_publish_at`. |
| `topic_queries` | ~12 OR-grouped search strings sent to NewsData/Bing. |
| `sources` | Provider registry: `kind` (`newsdata` \| `rss`), `secret_ref`, `priority`, `daily_quota`, `used_today`, `quota_date`, `enabled`, `last_error`. |
| `chats` | Telegram chats the bot can post to (auto-registered). `chat_id`, `title`, `username`, `type`, `language`, `active`. |
| `raw_articles` | Every article seen, including rejects with `reject_reason`. Also the dedup ledger via `dedup_key`. |
| `queue` | Publish-ready items: rewritten `headline`/`summary`, `category`, `score`, `score_parts` (jsonb), `breaking`, `status`. |
| `published_history` | One row per (item, chat) actually delivered. Drives dedup, per-category quotas and source-diversity damping. |
| `translation_failures` | Sorani translation attempts that failed validation, with models tried. |

DB functions: `is_admin(uuid)` (security definer, used by RLS),
`claim_first_admin()` (auth trigger), `touch_updated_at()`.

Queue `status` values: `queued`, `publishing`, `published`, `duplicate`, `expired`,
`rejected-language`, and `rejected-policy`.

---

## 3. Code map

```
src/lib/pipeline/
  types.ts             Category union, CATEGORY_PRIORITY, FetchedArticle
  fetchers.server.ts   NewsData, Bing RSS search, PUBLISHER_FEEDS (+per-feed caps)
  filters.server.ts    junk / respect / english gates, dedup keys, event similarity,
                       HTML+boilerplate cleaner, source trust tiers, leader detector
  ai.server.ts         classification, rewriting, breaking test, Sorani translation
  telegram.server.ts   Bot API caller + HTML message formatter + sendPost
  run.server.ts        runIngest() and runPublish() orchestration
src/routes/api/public/cron/ingest.ts     POST, apikey header auth
src/routes/api/public/cron/publish.ts    POST, apikey header auth
src/routes/api/public/telegram/webhook.ts  chat auto-registration (secret-token auth)
src/lib/admin.functions.ts               server functions used by the dashboard
src/routes/index.tsx                     admin sign-in
src/routes/_authenticated/dashboard.tsx  the console
```

---

## 4. Ingest pipeline (`runIngest`)

1. **Collect.**
   - NewsData.io: enabled topics are OR-batched into wide queries (≤95 chars),
     max **2 calls per run** → ≤192 credits/day against the 200 cap. `used_today`
     is reset when `quota_date` rolls over.
   - Bing News RSS per topic query (free, reachable from datacenters).
   - ~18 direct publisher feeds fetched in parallel, each capped per run
     (Middle East Eye capped at 4, wire/energy feeds at 6, others 15) so a single
     outlet cannot flood the queue. Iranian outlets included: Press TV, Mehr,
     Tehran Times, Tasnim, IRNA, Fars, plus Al Mayadeen.
   - Publisher-feed items must match a regional keyword regex **or** be a
     leader statement (`isLeaderStatement`).
   - Google News RSS is **disabled** by default — see §9.

2. **Clean.** `cleanEditorialText` strips CDATA, HTML tags/entities, tweet
   boilerplate, and labels such as "live updates", "live blog",
   "Iran–US live updates", "as it happened".

3. **Gates (cheap → expensive):**
   - *Junk*: blacklisted domains, filings/quiz/horoscope/deals patterns, titles <15 chars.
   - *Respect*: slurs / dehumanising phrasing about Kurds, Muslims, Arabs, Persians.
   - *English*: rejects non-Latin scripts (Arabic, Hebrew, Cyrillic, Devanagari, CJK…)
     **and** Latin-script foreign languages (Spanish, Portuguese, French, German,
     Italian, Dutch, Turkish, Indonesian) via function-word counting and a
     diacritic-density check.
   - *Freshness*: max **10 hours** old at ingest; unparseable/absent date = reject.

4. **Dedup.** `canonicalKey` = SHA-256 of the normalised URL (tracking params
   stripped), falling back to host+day+entity fingerprint. Keys already present
   in `raw_articles` are dropped without further cost.

5. **Classify (AI).** All fresh candidates are processed in batches of 40.
   Groq handles high-volume ingest when configured, with `openai/gpt-5.6-sol`
   as fallback. The classifier labels items into: `iraq`, `war`, `iran`, `middle-east`, `analysis`, `proxies`,
   `gold`, `usa`, `oil`, `economic-impact`, or `none`. Semantic, not keyword —
   a "God of War" article is `none`. If the gateway returns 402/429, a local
   regex classifier (`keywordCategory`) takes over so the pipeline keeps running.

6. **Event-level dedup.** New titles are compared against the last 100 queued
   headlines with configurable token and alias-normalised event similarity.
   Aliases fold names, countries, attacks, negotiations, conditions, vessels and
   Hormuz terminology. The configured cooldown (default 72h) also checks sent
   headlines across day/night boundaries. On a collision, the higher-trust source wins.

7. **Rewrite (AI).** One batched request produces clean factual headlines
   (<110 chars) plus a 2–3 sentence summary that adds information, keeps
   one-sided claims attributed ("Iran says…", "Israel says…"), drops
   publisher labels, and avoids India-only retail gold prices.

8. **Score & queue.**
   `total = categoryPriority + freshness + quotaPenalty + rotationBonus
            + breakingBonus + leaderBonus + sourcePenalty`
   - `freshness = max(0, 60 − ageHours×5)`
   - `quotaPenalty = −12 × items of that category posted in the last hour`
   - `rotationBonus = +15` if the category has been starved ≥2h
   - `breakingBonus = +1000`
   - `leaderBonus = +120` for top-leader speeches/statements on either side
     (Khamenei, Pezeshkian, **Qalibaf**, Larijani, Araghchi, Salami, IRGC
     commanders, Trump, Vance, Rubio, Hegseth, Netanyahu, al-Sudani, Sistani…)
   - `sourcePenalty = −20 × items from that outlet published in the last 3h`

---

## 5. Publish pipeline (`runPublish`)

1. **Cadence check.** Skips if `now < settings.next_publish_at`
   (unless `force` or `breakingOnly`).
2. **Slot reservation.** `next_publish_at` is written *before* any network call
   with a conditional update, so overlapping cron runs cannot double-post.
   The gap is random within the active window: day 25–60 min, night 90–180 min
   (both configurable), evaluated in `Asia/Baghdad`.
3. **Shelf life.** Queued items older than 14h are marked `expired`, never sent.
4. **Selection.** Top item by `breaking DESC, score DESC, original_published_at DESC`.
5. **Context dedup.** Compared against the last 200 headlines published within
   the configured cooldown (72h by default) with `sameEvent`; a repeat is
   marked `duplicate` and skipped silently.
6. **Translation (last step only).** Only the message about to be sent, and only
   for chats whose `language = 'ckb'`, is translated to Kurdish Sorani. Model
   with `google/gemini-3.6-flash`, with an Arabic-script validator that rejects Latin
   leakage. Result is cached per item. On failure the **English text is sent**
   and the attempt is logged to `translation_failures`.
7. **Language guard.** Immediately before sending on an English chat, the final
   headline+summary is re-checked with `isEnglishText`; a failure marks the item
   `rejected-language` instead of posting it.
8. **Send.** Every selected queue cluster is atomically claimed as `publishing`
   before delivery, preventing overlapping cron requests from sending it twice.
   The HTML-formatted message contains a category line, bold headline, summary,
   italic source + localised timestamp, and a "Read the full report" link.
   With an image it goes as `sendPhoto` (caption ≤1024 chars); if Telegram
   rejects the image it silently falls back to text — no placeholder image.
   No visible "BREAKING" label.
9. **Record.** A `published_history` row per chat; queue row set to `sent`;
   `last_published_at` updated. 3-second pause between chats.

---

## 6. Telegram integration

- `telegramCall(method, payload)` first hits `https://api.telegram.org/bot<token>/…`.
  On 401/404 it retries through the Lovable connector gateway
  (`connector-gateway.lovable.dev/telegram`) in case the stored value is a
  connector key rather than a raw bot token.
- **Chat discovery is webhook-based.** Telegram provides no API to list a bot's
  groups/channels, so `/api/public/telegram/webhook` upserts a `chats` row on
  the first update from any chat. Auth is `X-Telegram-Bot-Api-Secret-Token`,
  derived as base64url(SHA-256(`telegram-webhook:<token>`)).
- The webhook URL registered with `setWebhook` is the stable dev host,
  `https://project--<project-id>-dev.lovable.app/api/public/telegram/webhook`.
- **Public-channel ingest** reads `t.me/s/<handle>`. Arabic and Persian signal
  posts are translated to English in one batch through Groq. Rapid same-channel,
  same-speaker bulletins are merged before normal freshness, relevance, respect
  and event-dedup gates. Admins add channels using a simple `@handle`.
- **Aggregator hygiene:** Bing redirect URLs are unwrapped to the publisher URL
  before source bans, canonical deduplication and publishing. Embedded old
  “Published/Last Updated” dates override misleading RSS refresh timestamps.

---

## 7. Scheduling

`pg_cron` + `pg_net` post to the public cron routes with the publishable key in
an `apikey` header (the routes reject anything else):

| Job | Frequency | Endpoint |
|---|---|---|
| ingest | every 15 min | `/api/public/cron/ingest` |
| publish | every minute | `/api/public/cron/publish` |

Publishing runs every minute only so it can honour the randomised cadence
precisely; the reservation lock means at most one post per cadence gap.

---

## 8. Admin console

Route `/` is sign-in; everything else lives under `_authenticated`, guarded by a
Supabase session check plus `is_admin`. The dashboard exposes: live queue with
scores and manual send, published history, registered chats (activate/deactivate,
per-chat language), posting cadence and day/night windows, breaking rules,
sources with quota/error state, topic queries, translation-failure log, and
manual "Run ingest" / "Run publish" / "Register webhook" actions.

---

## 9. Known constraints

- **Google News RSS returns 503** from cloud/datacenter IPs (bot protection),
  regardless of User-Agent or backoff. It is therefore disabled in
  `fetchRssSearch`; Bing News RSS plus the direct publisher feeds cover the same
  ground reliably. `fetchGoogleNewsRss` remains in the codebase and can be
  re-enabled if the app is ever moved behind a residential/proxy egress.
- **NewsData free tier = 200 credits/day.** Hence the OR-batching and 2-calls-per-run cap.
- Classification and rewriting are batched and prefer the configured Groq key,
  avoiding the former one-request-per-article quota drain. Lovable AI remains the
  fallback; Sorani Gemini is called only for a final message going to a Sorani chat.
- Telegram cannot enumerate the bot's channels; chats only appear after activity.

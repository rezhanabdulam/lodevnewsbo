import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchPublisherFeeds, fetchRssSearch, fetchNewsData } from "./fetchers.server";
import {
  canonicalKey,
  freshnessGate,
  junkGate,
  respectGate,
  sourceTrust,
  titleSimilarity,
} from "./filters.server";
import {
  classifyBatch,
  isBreaking,
  rewrite,
  translateToSorani,
} from "./ai.server";
import { sendPost, type OutgoingPost } from "./telegram.server";
import { CATEGORY_PRIORITY, type Category, type FetchedArticle } from "./types";

type Settings = Record<string, any>;

async function getSettings(): Promise<Settings> {
  const { data, error } = await supabaseAdmin.from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`settings: ${error.message}`);
  return data as Settings;
}

/* ------------------------------- INGEST ---------------------------------- */

export interface IngestStats {
  fetched: number;
  junk: number;
  disrespect: number;
  offTopic: number;
  stale: number;
  duplicate: number;
  queued: number;
  breaking: number;
  errors: string[];
}

export async function runIngest(): Promise<IngestStats> {
  const settings = await getSettings();
  const stats = {
    fetched: 0,
    junk: 0,
    disrespect: 0,
    offTopic: 0,
    stale: 0,
    duplicate: 0,
    queued: 0,
    breaking: 0,
    errors: [] as string[],
  };

  const { data: topics } = await supabaseAdmin
    .from("topic_queries")
    .select("query")
    .eq("enabled", true);
  const { data: sources } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("enabled", true)
    .order("priority");

  const queries = (topics ?? []).map((t: any) => t.query as string);
  const collected: FetchedArticle[] = [];

  // NewsData has a hard daily credit cap, so topics are OR-batched into a few
  // wide queries instead of one request per topic.
  const groups: string[] = [];
  let current = "";
  for (const q of queries) {
    const candidate = current ? `${current} OR ${q}` : q;
    if (candidate.length > 95) {
      if (current) groups.push(current);
      current = q;
    } else {
      current = candidate;
    }
  }
  if (current) groups.push(current);
  const newsDataGroups = groups.slice(0, 3);

  const today = new Date().toISOString().slice(0, 10);

  for (const source of sources ?? []) {
    try {
      if (source.kind === "newsdata") {
        if (source.quota_date !== today) {
          await supabaseAdmin
            .from("sources")
            .update({ used_today: 0, quota_date: today })
            .eq("id", source.id);
          source.used_today = 0;
        }
        const key = process.env[source.secret_ref ?? "NEWSDATA_API_KEY"];
        if (!key) continue;
        for (const group of newsDataGroups) {
          if (source.daily_quota && (source.used_today ?? 0) >= source.daily_quota) {
            stats.errors.push("NewsData.io: daily quota reached, using free feeds");
            break;
          }
          const items = await fetchNewsData(key, group);
          source.used_today = (source.used_today ?? 0) + 1;
          await supabaseAdmin
            .from("sources")
            .update({ used_today: source.used_today, last_error: null })
            .eq("id", source.id);
          collected.push(...items);
        }
      } else if (source.kind === "rss") {
        for (const query of queries) {
          try {
            collected.push(...(await fetchRssSearch(query)));
          } catch (err) {
            stats.errors.push(
              `rss / ${query.slice(0, 40)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        try {
          const topical =
            /iran|tehran|irgc|khamenei|israel|hezbollah|houthi|yemen|iraq|syria|lebanon|militia|hormuz|persian gulf|tanker|oil|gold|nuclear|uranium|enrich|iaea|sanction|trump|pentagon|centcom|us navy|missile|drone|airstrike|strike|ceasefire|nato|mossad/i;
          collected.push(
            ...(await fetchPublisherFeeds()).filter((a) =>
              topical.test(`${a.title} ${a.description ?? ""}`),
            ),
          );
        } catch {
          /* optional safety net */
        }

      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${source.name}: ${msg}`);
      await supabaseAdmin.from("sources").update({ last_error: msg }).eq("id", source.id);
    }
  }


  stats.fetched = collected.length;

  // Gates 1, 2, 4 (freshness is cheap, run before the paid classifier)
  const survivors: Array<{ article: FetchedArticle; key: string }> = [];
  const rejects: any[] = [];
  const seenKeys = new Set<string>();

  for (const article of collected) {
    const key = canonicalKey(article);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const junk = junkGate(article);
    if (!junk.ok) {
      stats.junk += 1;
      rejects.push(rejectRow(article, key, junk.reason!));
      continue;
    }
    const respect = respectGate(article);
    if (!respect.ok) {
      stats.disrespect += 1;
      rejects.push(rejectRow(article, key, respect.reason!));
      continue;
    }
    const fresh = freshnessGate(article);
    if (!fresh.ok) {
      stats.stale += 1;
      rejects.push(rejectRow(article, key, fresh.reason!));
      continue;
    }
    survivors.push({ article, key });
  }

  // drop keys already known (published or queued or previously seen)
  const keys = survivors.map((s) => s.key);
  const known = new Set<string>();
  if (keys.length) {
    const { data: existing } = await supabaseAdmin
      .from("raw_articles")
      .select("dedup_key")
      .in("dedup_key", keys);
    for (const row of existing ?? []) known.add((row as any).dedup_key);
  }
  const fresh = survivors.filter((s) => !known.has(s.key));
  stats.duplicate += survivors.length - fresh.length;

  // GATE 3 — semantic classification
  let categories: Array<Category | null> = [];
  if (fresh.length) {
    const batch = fresh.slice(0, 60);
    try {
      categories = await classifyBatch(
        batch.map((s) => ({ title: s.article.title, description: s.article.description })),
      );
    } catch (err) {
      stats.errors.push(`classification: ${err instanceof Error ? err.message : String(err)}`);
      categories = [];
    }
  }

  // rolling window of recent titles for cross-provider dedup
  const { data: recent } = await supabaseAdmin
    .from("queue")
    .select("dedup_key, headline, source_name, url")
    .order("created_at", { ascending: false })
    .limit(100);
  const window: Array<{ title: string; trust: number; key: string }> = (recent ?? []).map(
    (r: any) => ({
      title: r.headline,
      trust: sourceTrust(r.source_name, r.url),
      key: r.dedup_key,
    }),
  );

  for (let i = 0; i < fresh.length; i++) {
    const entry = fresh[i];
    if (!entry) continue;
    const { article, key } = entry;
    const category = categories[i] ?? null;

    if (!category) {
      stats.offTopic += 1;
      rejects.push(rejectRow(article, key, "off-topic"));
      continue;
    }

    const trust = sourceTrust(article.sourceName, article.url);
    const collision = window.find((w) => titleSimilarity(w.title, article.title) >= 0.62);
    if (collision) {
      if (trust < collision.trust) {
        // higher-trust source wins: replace the queued item
        await supabaseAdmin.from("queue").delete().eq("dedup_key", collision.key);
      } else {
        stats.duplicate += 1;
        rejects.push(rejectRow(article, key, "near-duplicate of queued story", category));
        continue;
      }
    }

    let headline = article.title;
    let summary = article.description ?? "";
    try {
      const out = await rewrite(article);
      headline = out.headline;
      summary = out.summary;
    } catch (err) {
      stats.errors.push(`rewrite: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { data: inserted } = await supabaseAdmin
      .from("raw_articles")
      .insert({
        dedup_key: key,
        provider: article.provider,
        source_name: article.sourceName,
        url: article.url,
        title: article.title,
        description: article.description,
        image_url: article.imageUrl,
        category,
        published_at: article.publishedAt ? new Date(article.publishedAt).toISOString() : null,
        payload: JSON.parse(JSON.stringify(article)),
      })
      .select("id")
      .single();

    const breaking = isBreaking(category, article.title, settings["breaking_categories"] ?? []);
    const parts = await scoreParts(category, article.publishedAt, breaking);

    const { error: qErr } = await supabaseAdmin.from("queue").insert({
      dedup_key: key,
      article_id: (inserted as any)?.id ?? null,
      headline,
      summary,
      category,
      source_name: article.sourceName ?? hostname(article.url),
      url: article.url,
      image_url: article.imageUrl,
      original_published_at: article.publishedAt
        ? new Date(article.publishedAt).toISOString()
        : null,
      score: parts.total,
      score_parts: parts,
      breaking,
    });
    if (!qErr) {
      stats.queued += 1;
      if (breaking) stats.breaking += 1;
      window.unshift({ title: headline, trust, key });
    }
  }

  if (rejects.length) {
    await supabaseAdmin.from("raw_articles").upsert(rejects, { onConflict: "dedup_key" });
  }

  // breaking news bypasses the schedule entirely
  if (stats.breaking > 0) await runPublish({ breakingOnly: true });

  return stats;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown source";
  }
}

function rejectRow(article: FetchedArticle, key: string, reason: string, category?: string) {
  return {
    dedup_key: key,
    provider: article.provider,
    source_name: article.sourceName,
    url: article.url,
    title: article.title,
    description: article.description,
    image_url: article.imageUrl,
    category: category ?? null,
    published_at: article.publishedAt ? safeDate(article.publishedAt) : null,
    rejected: true,
    reject_reason: reason,
  };
}

function safeDate(value: string): string | null {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

async function scoreParts(category: Category, publishedAt: string | null, breaking: boolean) {
  const priority = CATEGORY_PRIORITY[category] ?? 10;

  const ageHours = publishedAt
    ? Math.max(0, (Date.now() - Date.parse(publishedAt)) / 3_600_000)
    : 24;
  const freshness = Math.max(0, 20 - ageHours);

  const sinceHour = new Date(Date.now() - 3_600_000).toISOString();
  const { count: postedThisHour } = await supabaseAdmin
    .from("published_history")
    .select("id", { count: "exact", head: true })
    .eq("category", category)
    .gte("published_at", sinceHour);
  const quotaPenalty = -(postedThisHour ?? 0) * 12;

  const { data: lastOfCategory } = await supabaseAdmin
    .from("published_history")
    .select("published_at")
    .eq("category", category)
    .order("published_at", { ascending: false })
    .limit(1);
  const lastAt = (lastOfCategory ?? [])[0] as any;
  const starvedHours = lastAt
    ? (Date.now() - Date.parse(lastAt.published_at)) / 3_600_000
    : 99;
  const rotationBonus = starvedHours >= 2 ? 15 : 0;

  const breakingBonus = breaking ? 1000 : 0;
  const total = priority + freshness + quotaPenalty + rotationBonus + breakingBonus;
  return { priority, freshness, quotaPenalty, rotationBonus, breakingBonus, total };
}

/* ------------------------------- PUBLISH --------------------------------- */

function minutesOfDay(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
  const [h, m] = parts.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function parseTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function inWindow(now: number, start: number, end: number): boolean {
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

export function isNight(settings: Settings, at = new Date()): boolean {
  const now = minutesOfDay(at, settings["timezone"] ?? "Asia/Baghdad");
  return inWindow(now, parseTime(settings["night_start"]), parseTime(settings["night_end"]));
}

function randomGapMinutes(settings: Settings, night: boolean): number {
  const min = night ? settings["night_min_minutes"] : settings["day_min_minutes"];
  const max = night ? settings["night_max_minutes"] : settings["day_max_minutes"];
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

export interface PublishResult {
  sent: number;
  chats: number;
  skipped: string;
  items: string[];
}

export async function runPublish(
  opts: { breakingOnly?: boolean; force?: number } = {},
): Promise<PublishResult> {
  const settings = await getSettings();
  const night = isNight(settings);
  const result = { sent: 0, chats: 0, skipped: "" as string, items: [] as string[] };

  if (!opts.force && !opts.breakingOnly) {
    const next = settings["next_publish_at"] ? Date.parse(settings["next_publish_at"]) : 0;
    if (next && Date.now() < next) {
      result.skipped = "waiting for next scheduled slot";
      return result;
    }
    if (night && !settings["breaking_interrupts_night"]) {
      // night window still posts, just at the night cadence
    }
  }
  if (opts.breakingOnly && night && !settings["breaking_interrupts_night"]) {
    result.skipped = "night quiet window; breaking interrupts disabled";
    return result;
  }

  const limit = opts.force ?? 1;
  let query = supabaseAdmin
    .from("queue")
    .select("*")
    .eq("status", "queued")
    .order("breaking", { ascending: false })
    .order("score", { ascending: false })
    .limit(limit);
  if (opts.breakingOnly) query = query.eq("breaking", true);

  const { data: items } = await query;
  if (!items || items.length === 0) {
    result.skipped = "queue empty";
    return result;
  }

  const { data: chats } = await supabaseAdmin.from("chats").select("*").eq("active", true);
  result.chats = (chats ?? []).length;

  const eightHoursAgo = new Date(Date.now() - 8 * 3_600_000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();

  // Context dedup: headlines already sent recently, to avoid re-posting the same event.
  const { data: recentPublished } = await supabaseAdmin
    .from("published_history")
    .select("headline, dedup_key")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(200);
  const publishedTitles: string[] = (recentPublished ?? [])
    .map((r: any) => r.headline)
    .filter(Boolean);
  const publishedKeys = new Set<string>(
    (recentPublished ?? []).map((r: any) => r.dedup_key),
  );

  for (const item of items as any[]) {
    // Same event already covered? mark and skip without sending.
    const repeated =
      publishedKeys.has(item.dedup_key) ||
      publishedTitles.some((t) => titleSimilarity(t, item.headline) >= 0.6);
    if (repeated) {
      await supabaseAdmin.from("queue").update({ status: "duplicate" }).eq("id", item.id);
      continue;
    }

    // Translate once per item (only for messages actually about to be sent).
    const translationCache = new Map<string, { headline: string; summary: string } | null>();

    for (const chat of (chats ?? []) as any[]) {
      const { data: already } = await supabaseAdmin
        .from("published_history")
        .select("id")
        .eq("dedup_key", item.dedup_key)
        .eq("chat_id", chat.chat_id)
        .gte("published_at", eightHoursAgo)
        .limit(1);
      if ((already ?? []).length > 0) continue;

      const language = chat.language ?? settings["default_language"] ?? "en";
      let headline = item.headline as string;
      let summary = item.summary as string;

      if (language === "ckb") {
        if (!translationCache.has("ckb")) {
          const translated = await translateToSorani(`${headline}\n\n${summary}`);
          if (translated.text) {
            const [h, ...rest] = translated.text.split("\n\n");
            translationCache.set("ckb", {
              headline: h ?? headline,
              summary: rest.join("\n\n") || summary,
            });
          } else {
            // Fall back to the English text rather than skipping the post.
            translationCache.set("ckb", null);
            await supabaseAdmin.from("translation_failures").insert({
              dedup_key: item.dedup_key,
              headline: item.headline,
              target_language: "ckb",
              models_tried: translated.modelsTried,
              detail: translated.detail ?? null,
            });
          }
        }
        const cached = translationCache.get("ckb");
        if (cached) {
          headline = cached.headline;
          summary = cached.summary;
        }
      }


      const post: OutgoingPost = {
        headline,
        summary,
        sourceName: item.source_name || hostname(item.url),
        url: item.url,
        imageUrl: item.image_url,
        originalPublishedAt: item.original_published_at,
        breaking: item.breaking,
        category: item.category,
        timezone: settings["timezone"] ?? "Asia/Baghdad",
      };

      try {
        await sendPost(Number(chat.chat_id), post);
        await supabaseAdmin.from("published_history").insert({
          dedup_key: item.dedup_key,
          chat_id: chat.chat_id,
          headline,
          source_name: post.sourceName,
          category: item.category,
          breaking: item.breaking,
          original_published_at: item.original_published_at,
        });
        result.sent += 1;
        publishedTitles.unshift(item.headline);
        publishedKeys.add(item.dedup_key);

        await new Promise((r) => setTimeout(r, 60_000));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/chat not found|bot was kicked|blocked/i.test(msg)) {
          await supabaseAdmin.from("chats").update({ active: false }).eq("id", chat.id);
        }
      }
    }

    await supabaseAdmin
      .from("queue")
      .update({ status: "published" })
      .eq("id", item.id);
    result.items.push(item.headline);
  }

  if (!opts.breakingOnly) {
    const gap = randomGapMinutes(settings, isNight(settings));
    await supabaseAdmin
      .from("settings")
      .update({
        last_published_at: new Date().toISOString(),
        next_publish_at: new Date(Date.now() + gap * 60_000).toISOString(),
      })
      .eq("id", 1);
  }

  return result;
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  canonicalKey,
  cleanEditorialText,
  isEnglishText,
  junkGate,
  relevanceGate,
  respectGate,
  sameEvent,
} from "./filters.server";
import { rewriteBatch, classifyBatch, translateTelegramToEnglish } from "./ai.server";
import { fetchTelegramChannel, isArabicOrPersian, type ChannelPost } from "./telegram-channels.server";
import { runPublish } from "./run.server";
import type { FetchedArticle } from "./types";

export interface InstantStats {
  channels: number;
  posts: number;
  merged: number;
  queued: number;
  published: number;
  errors: string[];
}

/** Names and places already used in a merged text, so nothing is repeated. */
function mergeTexts(parts: string[]): string {
  const sentences: string[] = [];
  for (const part of parts) {
    for (const raw of part.split(/(?<=[.!?])\s+/)) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const duplicate = sentences.some((existing) => sameEvent(existing, sentence, 0.6));
      if (!duplicate) sentences.push(sentence);
    }
  }
  return sentences.join(" ").slice(0, 1800);
}

/** Shared subject: the same person or place mentioned by both posts. */
const SUBJECT_PATTERN =
  /\b(khamenei|pezeshkian|araghchi|qalibaf|larijani|salami|trump|vance|rubio|hegseth|netanyahu|sudani|barzani|nasrallah|houthi[s]?|hezbollah|irgc|centcom|pentagon|tehran|isfahan|natanz|fordow|baghdad|erbil|basra|damascus|beirut|sanaa|gaza|hormuz|bandar abbas|bushehr|kirkuk|mosul|doha|riyadh)\b/gi;

function subjectsOf(text: string): Set<string> {
  return new Set((text.match(SUBJECT_PATTERN) ?? []).map((s) => s.toLowerCase()));
}

function relatedPosts(a: string, b: string): boolean {
  const left = subjectsOf(a);
  const right = subjectsOf(b);
  for (const subject of left) if (right.has(subject)) return true;
  return sameEvent(a, b, 0.45);
}

/**
 * Instant Telegram monitoring.
 *
 * Runs on a short interval (default every 5 minutes). Only posts published
 * since the previous run are read; related posts about the same person or
 * place are merged into a single message, and anything relevant is published
 * immediately instead of waiting for the normal cadence.
 */
export async function runInstant(): Promise<InstantStats> {
  const stats: InstantStats = { channels: 0, posts: 0, merged: 0, queued: 0, published: 0, errors: [] };

  const { data: settings } = await supabaseAdmin.from("settings").select("*").eq("id", 1).single();
  if (!settings) throw new Error("settings row missing");
  if ((settings as any)["bot_paused"]) {
    stats.errors.push("bot paused");
    return stats;
  }

  // The scheduler ticks every minute; the admin-set interval decides how often
  // work actually happens.
  const intervalMinutes = Number((settings as any)["instant_poll_minutes"] ?? 5);
  const lastRun = (settings as any)["instant_last_run_at"] as string | null;
  if (lastRun && Date.now() - Date.parse(lastRun) < intervalMinutes * 60_000 - 5_000) {
    return stats;
  }
  const { data: sources } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("kind", "telegram")
    .eq("enabled", true);

  const instant = (sources ?? []).filter((s: any) => (s.config?.mode ?? "normal") === "instant");
  stats.channels = instant.length;
  if (!instant.length) return stats;

  await supabaseAdmin
    .from("settings")
    .update({ instant_last_run_at: new Date().toISOString() } as never)
    .eq("id", 1);

  const collected: Array<{ post: ChannelPost; text: string }> = [];

  for (const source of instant as any[]) {
    const channel = String(source.config?.channel ?? source.name ?? "").replace(/^@/, "");
    if (!channel) continue;
    const sinceIso = source.config?.last_seen_at as string | undefined;
    const since = sinceIso ? Date.parse(sinceIso) : Date.now() - intervalMinutes * 2 * 60_000;
    let newest = since;
    try {
      const posts = await fetchTelegramChannel(channel, 20);
      for (const post of posts) {
        const ts = post.publishedAt ? Date.parse(post.publishedAt) : Date.now();
        if (Number.isNaN(ts) || ts <= since) continue;
        newest = Math.max(newest, ts);
        collected.push({ post, text: cleanEditorialText(post.text) });
      }
    } catch (err) {
      stats.errors.push(`${channel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await supabaseAdmin
      .from("sources")
      .update({
        config: { ...(source.config ?? {}), channel, mode: "instant", last_seen_at: new Date(newest).toISOString() },
      })
      .eq("id", source.id);
  }

  stats.posts = collected.length;
  if (!collected.length) return stats;

  // Arabic/Persian bulletins are translated once, in a single batched request.
  const foreign = collected
    .map((entry, index) => (isArabicOrPersian(entry.text) ? index : -1))
    .filter((index) => index >= 0);
  if (foreign.length) {
    try {
      const translated = await translateTelegramToEnglish(foreign.map((i) => collected[i]!.text));
      foreign.forEach((i, n) => { collected[i]!.text = translated[n] ?? collected[i]!.text; });
    } catch (err) {
      stats.errors.push(`translate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Merge related bulletins about the same person or place into one story.
  const clusters: Array<{ lead: ChannelPost; texts: string[]; channels: string[] }> = [];
  for (const entry of collected) {
    if (!entry.text || !isEnglishText(entry.text).ok) continue;
    const match = clusters.find((c) => c.texts.some((t) => relatedPosts(t, entry.text)));
    if (match) {
      match.texts.push(entry.text);
      if (!match.channels.includes(entry.post.channel)) match.channels.push(entry.post.channel);
    } else {
      clusters.push({ lead: entry.post, texts: [entry.text], channels: [entry.post.channel] });
    }
  }
  stats.merged = clusters.filter((c) => c.texts.length > 1).length;
  if (!clusters.length) return stats;

  const bodies = clusters.map((c) => mergeTexts(c.texts));

  // Relevance + respect gates before spending any AI tokens.
  const candidates = clusters
    .map((cluster, index) => ({
      cluster,
      article: {
        provider: `Telegram/${cluster.lead.channel}`,
        sourceName: `@${cluster.lead.channel}`,
        url: cluster.lead.url,
        title: (bodies[index] ?? "").slice(0, 180),
        description: bodies[index] ?? "",
        imageUrl: null,
        publishedAt: cluster.lead.publishedAt,
      } as FetchedArticle,
    }))
    .filter(({ article }) =>
      junkGate(article).ok && respectGate(article).ok && relevanceGate(article).ok,
    );
  if (!candidates.length) return stats;

  let categories: Array<string | null> = [];
  let rewritten: Array<{ headline: string; summary: string }> = [];
  try {
    categories = await classifyBatch(
      candidates.map(({ article }) => ({ title: article.title, description: article.description })),
    );
  } catch (err) {
    stats.errors.push(`classify: ${err instanceof Error ? err.message : String(err)}`);
    categories = candidates.map(() => "war");
  }
  try {
    rewritten = await rewriteBatch(
      candidates.map(({ article }) => ({
        title: article.title,
        description: article.description,
        sourceName: article.sourceName,
      })),
    );
  } catch (err) {
    stats.errors.push(`rewrite: ${err instanceof Error ? err.message : String(err)}`);
    rewritten = candidates.map(({ article }) => ({
      headline: article.title.slice(0, 110),
      summary: article.description ?? "",
    }));
  }

  const cooldownHours = Number((settings as any)["event_cooldown_hours"] ?? 72);
  const threshold = Number((settings as any)["event_similarity_threshold"] ?? 0.52);
  const { data: recent } = await supabaseAdmin
    .from("published_history")
    .select("headline")
    .gte("published_at", new Date(Date.now() - cooldownHours * 3_600_000).toISOString())
    .limit(200);
  const publishedTitles = (recent ?? []).map((r: any) => String(r.headline ?? ""));

  for (let i = 0; i < candidates.length; i++) {
    const entry = candidates[i]!;
    const category = categories[i];
    if (!category) continue;
    const headline = rewritten[i]?.headline || entry.article.title.slice(0, 110);
    const summary = rewritten[i]?.summary || entry.article.description || "";
    if (publishedTitles.some((t) => sameEvent(t, headline, threshold))) continue;

    const key = canonicalKey({ ...entry.article, title: headline });
    const { data: seen } = await supabaseAdmin
      .from("raw_articles")
      .select("dedup_key")
      .eq("dedup_key", key)
      .maybeSingle();
    if (seen) continue;

    await supabaseAdmin.from("raw_articles").insert({
      dedup_key: key,
      provider: entry.article.provider,
      source_name: entry.article.sourceName,
      url: entry.article.url,
      title: headline,
      description: summary,
      category,
      published_at: entry.article.publishedAt ?? new Date().toISOString(),
      payload: JSON.parse(JSON.stringify({ ...entry.article, channels: entry.cluster.channels })),
    });

    const { error } = await supabaseAdmin.from("queue").insert({
      dedup_key: key,
      headline,
      summary,
      category,
      source_name: entry.cluster.channels.map((c) => `@${c}`).join(", "),
      url: entry.article.url,
      original_published_at: entry.article.publishedAt ?? new Date().toISOString(),
      score: 400,
      score_parts: { instant: true, mergedPosts: entry.cluster.texts.length },
      breaking: true,
    });
    if (!error) {
      stats.queued += 1;
      publishedTitles.unshift(headline);
    }
  }

  await supabaseAdmin
    .from("settings")
    .update({ instant_last_run_at: new Date().toISOString() } as never)
    .eq("id", 1);

  if (stats.queued > 0) {
    const result = await runPublish({ breakingOnly: true, force: stats.queued });
    stats.published = result.sent;
  }
  return stats;
}

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase
    .rpc("is_admin", { _user_id: context.userId });
  if (error || !data) throw new Error("Forbidden: not an admin");
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const sb = context.supabase;
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const [settings, chats, sources, topics, queue, history, tfails] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("chats").select("*").order("last_seen_at", { ascending: false }),
      sb.from("sources").select("*").order("priority"),
      sb.from("topic_queries").select("*").order("created_at"),
      sb.from("queue").select("*").eq("status", "queued")
        .order("breaking", { ascending: false })
        .order("score", { ascending: false }).limit(50),
      sb.from("published_history").select("*").gte("published_at", dayAgo)
        .order("published_at", { ascending: false }).limit(100),
      sb.from("translation_failures").select("*")
        .order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      settings: settings.data,
      chats: chats.data ?? [],
      sources: sources.data ?? [],
      topics: topics.data ?? [],
      queue: queue.data ?? [],
      history: history.data ?? [],
      translationFailures: tfails.data ?? [],
      botConfigured: Boolean(process.env["TELEGRAM_BOT_TOKEN"]),
      newsdataConfigured: Boolean(process.env["NEWSDATA_API_KEY"]),
    };
  });

const settingsSchema = z.object({
  default_language: z.enum(["en", "ckb", "both"]).optional(),
  day_start: z.string().optional(),
  day_end: z.string().optional(),
  day_min_minutes: z.number().int().min(1).max(1440).optional(),
  day_max_minutes: z.number().int().min(1).max(1440).optional(),
  night_start: z.string().optional(),
  night_end: z.string().optional(),
  night_min_minutes: z.number().int().min(1).max(1440).optional(),
  night_max_minutes: z.number().int().min(1).max(1440).optional(),
  breaking_interrupts_night: z.boolean().optional(),
  breaking_categories: z.array(z.string()).optional(),
  oil_move_threshold: z.number().min(0).max(100).optional(),
  gold_move_threshold: z.number().min(0).max(100).optional(),
  timezone: z.string().min(2).max(64).optional(),
  event_cooldown_hours: z.number().int().min(1).max(336).optional(),
  event_similarity_threshold: z.number().min(0.3).max(0.9).optional(),
});

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("settings").update(data as never).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        active: z.boolean().optional(),
        language: z.enum(["en", "ckb"]).nullable().optional(),
        remove: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.remove) {
      const { error } = await context.supabase.from("chats").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const patch: Record<string, unknown> = {};
    if (data.active !== undefined) patch["active"] = data.active;
    if (data.language !== undefined) patch["language"] = data.language;
    const { error } = await context.supabase.from("chats").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        query: z.string().min(2).max(120).optional(),
        category: z.string().min(2).max(40).optional(),
        enabled: z.boolean().optional(),
        remove: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = context.supabase;
    if (data.remove && data.id) {
      const { error } = await sb.from("topic_queries").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    if (data.id) {
      const patch: Record<string, unknown> = {};
      if (data.enabled !== undefined) patch["enabled"] = data.enabled;
      if (data.query) patch["query"] = data.query;
      if (data.category) patch["category"] = data.category;
      const { error } = await sb.from("topic_queries").update(patch as never).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await sb
      .from("topic_queries")
      .insert({ query: data.query!, category: data.category ?? "iran" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(2).max(60).optional(),
        kind: z.enum(["rss", "newsdata", "telegram"]).optional(),
        secret_ref: z.string().max(60).nullable().optional(),
        priority: z.number().int().min(1).max(999).optional(),
        daily_quota: z.number().int().min(0).max(1_000_000).nullable().optional(),
        enabled: z.boolean().optional(),
        remove: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = context.supabase;
    if (data.remove && data.id) {
      const { error } = await sb.from("sources").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { id, remove: _remove, ...rest } = data;
    if (id) {
      const { error } = await sb.from("sources").update(rest as never).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const kind = rest.kind ?? "rss";
    const { error } = await sb.from("sources").insert({
      name: rest.name!,
      kind,
      secret_ref: rest.secret_ref ?? null,
      priority: rest.priority ?? 100,
      daily_quota: rest.daily_quota ?? null,
      // Telegram monitors store the channel handle so the scraper can find it.
      config:
        kind === "telegram"
          ? { channel: rest.name!.replace(/^@/, "").trim() }
          : {},
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runPipelineNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ action: z.enum(["ingest", "publishTop3"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runIngest, runPublish } = await import("@/lib/pipeline/run.server");
    if (data.action === "ingest") return { result: await runIngest() };
    return { result: await runPublish({ force: 3 }) };
  });

export const refreshBotInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { telegramCall } = await import("@/lib/pipeline/telegram.server");
    const me = await telegramCall<{ username?: string; first_name?: string }>("getMe");
    return { username: me.username ?? null, name: me.first_name ?? null };
  });

export const setWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ baseUrl: z.string().url().max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { createHash } = await import("crypto");
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const secret = createHash("sha256")
      .update(`telegram-webhook:${token}`)
      .digest("base64url");
    const { telegramCall } = await import("@/lib/pipeline/telegram.server");
    await telegramCall("setWebhook", {
      url: `${data.baseUrl.replace(/\/$/, "")}/api/public/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "edited_message", "channel_post", "my_chat_member"],
    });
    return { ok: true };
  });

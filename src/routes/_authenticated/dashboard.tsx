import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getDashboard,
  refreshBotInfo,
  runPipelineNow,
  saveSettings,
  setPauseState,
  setWebhook,
  listTranslationKeys,
  testTranslationKey,
  upsertTranslationKey,
  updateChat,
  upsertSource,
  upsertTopic,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Console · Iran Desk Bot" },
      {
        name: "description",
        content:
          "Operations console: Telegram chats, posting cadence, breaking-news rules, sources and the publishing queue.",
      },
      { property: "og:title", content: "Iran Desk Bot Console" },
      {
        property: "og:description",
        content: "Operations console for the automated Iran–U.S. conflict news bot.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Dashboard,
});

const CATEGORIES = ["iraq", "war", "iran", "middle-east", "analysis", "proxies", "gold", "usa", "oil", "economic-impact"];

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-primary">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const load = useServerFn(getDashboard);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => load(),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["translation-keys"] });
  };

  const { data: translationData } = useQuery({
    queryKey: ["translation-keys"],
    queryFn: () => listTranslationKeysFn(),
    refetchInterval: 30_000,
  });
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong");

  const saveSettingsFn = useServerFn(saveSettings);
  const updateChatFn = useServerFn(updateChat);
  const upsertTopicFn = useServerFn(upsertTopic);
  const upsertSourceFn = useServerFn(upsertSource);
  const runFn = useServerFn(runPipelineNow);
  const botInfoFn = useServerFn(refreshBotInfo);
  const webhookFn = useServerFn(setWebhook);
  const pauseFn = useServerFn(setPauseState);
  const listTranslationKeysFn = useServerFn(listTranslationKeys);
  const upsertTranslationKeyFn = useServerFn(upsertTranslationKey);
  const testTranslationKeyFn = useServerFn(testTranslationKey);

  const mSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) => saveSettingsFn({ data: patch as never }),
    onSuccess: () => { toast.success("Saved"); invalidate(); },
    onError,
  });
  const mChat = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateChatFn({ data: patch as never }),
    onSuccess: invalidate, onError,
  });
  const mTopic = useMutation({
    mutationFn: (patch: Record<string, unknown>) => upsertTopicFn({ data: patch as never }),
    onSuccess: invalidate, onError,
  });
  const mSource = useMutation({
    mutationFn: (patch: Record<string, unknown>) => upsertSourceFn({ data: patch as never }),
    onSuccess: invalidate, onError,
  });
  const mRun = useMutation({
    mutationFn: (action: "ingest" | "publishTop3" | "instant") => runFn({ data: { action } }),
    onSuccess: (res) => { toast.success(JSON.stringify(res.result).slice(0, 220)); invalidate(); },
    onError,
  });
  const mBot = useMutation({
    mutationFn: () => botInfoFn(),
    onSuccess: (r) => toast.success(r.username ? `Connected as @${r.username}` : "Bot reachable"),
    onError,
  });
  const mWebhook = useMutation({
    mutationFn: () => webhookFn({ data: { baseUrl: window.location.origin } }),
    onSuccess: () => toast.success("Telegram webhook registered — chats will now auto-register"),
    onError,
  });
  const mPause = useMutation({
    mutationFn: (paused: boolean) =>
      pauseFn({ data: { paused, reason: paused ? "Stopped from dashboard" : null } }),
    onSuccess: (_r, paused) => {
      toast.success(paused ? "All services paused" : "All services resumed");
      invalidate();
    },
    onError,
  });

  const mTranslationKey = useMutation({
    mutationFn: (payload: any) => upsertTranslationKeyFn({ data: payload }),
    onSuccess: () => { toast.success("Translation key saved"); invalidate(); },
    onError,
  });
  const mTranslationTest = useMutation({
    mutationFn: (id: string) => testTranslationKeyFn({ data: { id } }),
    onSuccess: (r) => toast.success(`Translation test passed: ${r.preview}`),
    onError,
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  if (isLoading) {
    return <div className="p-10 text-sm text-muted-foreground">Loading console…</div>;
  }
  if (error || !data?.settings) {
    return (
      <div className="p-10">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load the console."}
        </p>
        <Button className="mt-4" variant="secondary" onClick={signOut}>Sign out</Button>
      </div>
    );
  }

  const s = data.settings as Record<string, any>;
  const paused = Boolean(s["bot_paused"]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Iran Desk</p>
          <h1 className="text-2xl font-semibold">Bot operations console</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => mRun.mutate("ingest")} disabled={mRun.isPending || paused}>
            {mRun.isPending ? "Running…" : "Fetch now"}
          </Button>
          <Button size="sm" onClick={() => mRun.mutate("publishTop3")} disabled={mRun.isPending || paused}>
            Publish top 3
          </Button>
          <Button
            size="sm"
            variant={paused ? "secondary" : "destructive"}
            onClick={() => mPause.mutate(!paused)}
            disabled={mPause.isPending}
          >
            {paused ? "Resume services" : "Stop all"}
          </Button>
          <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      {paused ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Services are paused. Ingest, publish, and Telegram webhook actions are blocked until you resume them.
          {s["bot_paused_reason"] ? <span className="ml-2 text-destructive/80">Reason: {String(s["bot_paused_reason"])}</span> : null}
        </div>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Queued", value: data.queue.length },
          { label: "Published 24h", value: data.history.length },
          { label: "Active chats", value: data.chats.filter((c: any) => c.active).length },
          { label: "Translation fails", value: data.translationFailures.length },
          { label: "Status", value: paused ? "Paused" : "Live" },
        ].map((stat) => (
          <div key={stat.label} className="panel p-4">
            <p className="text-2xl font-semibold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="queue" className="mt-8">
        <TabsList className="flex-wrap">
          <TabsTrigger value="queue">Queue &amp; history</TabsTrigger>
          <TabsTrigger value="bot">Bot &amp; chats</TabsTrigger>
          <TabsTrigger value="cadence">Cadence</TabsTrigger>
          <TabsTrigger value="breaking">Breaking</TabsTrigger>
          <TabsTrigger value="sources">Sources &amp; topics</TabsTrigger>
          <TabsTrigger value="format">Format</TabsTrigger>
          <TabsTrigger value="translation">Translation</TabsTrigger>
        </TabsList>

        {/* QUEUE */}
        <TabsContent value="queue" className="mt-4 space-y-4">
          <Panel title="Queued" hint="Ranked by breaking flag, then score.">
            {data.queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing queued yet. Run “Fetch now”.</p>
            ) : (
              data.queue.map((q: any) => (
                <div key={q.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{q.category}</Badge>
                    <span className="text-xs text-muted-foreground">score {Math.round(q.score)}</span>
                    <span className="text-xs text-muted-foreground">· {q.source_name}</span>
                  </div>
                  <p className="mt-2 font-medium">{q.headline}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{q.summary}</p>
                </div>
              ))
            )}
          </Panel>

          <Panel title="Published in the last 24 hours">
            {data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing published yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.history.map((h: any) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.published_at).toLocaleTimeString()}
                    </span>
                    <Badge variant="secondary">{h.category}</Badge>
                    <span className="flex-1">{h.headline}</span>
                    <span className="text-xs text-muted-foreground">chat {String(h.chat_id)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        {/* BOT */}
        <TabsContent value="bot" className="mt-4 space-y-4">
          <Panel
            title="Bot connection"
            hint="The bot token is stored as a server-side secret and never sent to this browser."
          >
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={data.botConfigured ? "default" : "destructive"}>
                {data.botConfigured ? "Token saved ••••••••" : "No token configured"}
              </Badge>
              <Button size="sm" variant="secondary" onClick={() => mBot.mutate()} disabled={mBot.isPending}>
                Test connection
              </Button>
              <Button size="sm" variant="secondary" onClick={() => mWebhook.mutate()} disabled={mWebhook.isPending}>
                Register webhook
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Telegram does not let a bot list the groups or channels it belongs to. Chats appear
              below automatically once the bot is added and receives its first update — press
              “Register webhook” after publishing so Telegram can reach this app.
            </p>
          </Panel>

          <Panel title="Chats" hint="Every chat the bot has been added to, with its own language override.">
            {data.chats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No chats yet. Add the bot to a group or channel, or send it /start.
              </p>
            ) : (
              data.chats.map((c: any) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">{c.title ?? c.username ?? `Chat ${c.chat_id}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.type} · {String(c.chat_id)} {c.username ? `· @${c.username}` : ""}
                    </p>
                  </div>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={c.language ?? ""}
                    onChange={(e) =>
                      mChat.mutate({ id: c.id, language: e.target.value === "" ? null : e.target.value })
                    }
                  >
                    <option value="">Use global default</option>
                    <option value="en">English</option>
                    <option value="ckb">Kurdish Sorani</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={c.active}
                      onCheckedChange={(v) => mChat.mutate({ id: c.id, active: v })}
                    />
                    <span className="text-xs text-muted-foreground">{c.active ? "Active" : "Muted"}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => mChat.mutate({ id: c.id, remove: true })}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </Panel>
        </TabsContent>

        {/* CADENCE */}
        <TabsContent value="cadence" className="mt-4 space-y-4">
          <Panel title="Language" hint="Global default; each chat can override it above.">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={s["default_language"]}
              onChange={(e) => mSettings.mutate({ default_language: e.target.value })}
            >
              <option value="en">English only</option>
              <option value="ckb">Kurdish Sorani only</option>
              <option value="both">Both</option>
            </select>
          </Panel>

          <Panel title="Posting windows">
            <TimeWindow
              label="Daytime"
              start={s["day_start"]} end={s["day_end"]}
              min={s["day_min_minutes"]} max={s["day_max_minutes"]}
              onSave={(v) =>
                mSettings.mutate({
                  day_start: v.start, day_end: v.end,
                  day_min_minutes: v.min, day_max_minutes: v.max,
                })
              }
            />
            <Separator />
            <TimeWindow
              label="Night"
              start={s["night_start"]} end={s["night_end"]}
              min={s["night_min_minutes"]} max={s["night_max_minutes"]}
              onSave={(v) =>
                mSettings.mutate({
                  night_start: v.start, night_end: v.end,
                  night_min_minutes: v.min, night_max_minutes: v.max,
                })
              }
            />
            <Separator />
            <div className="flex items-center gap-3">
              <Switch
                checked={s["breaking_interrupts_night"]}
                onCheckedChange={(v) => mSettings.mutate({ breaking_interrupts_night: v })}
              />
              <span className="text-sm">Breaking news may interrupt the night window</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Input
                id="tz"
                defaultValue={s["timezone"]}
                onBlur={(e) => e.target.value !== s["timezone"] && mSettings.mutate({ timezone: e.target.value })}
                className="max-w-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Next scheduled post:{" "}
              {s["next_publish_at"] ? new Date(s["next_publish_at"]).toLocaleString() : "as soon as the queue fills"}
            </p>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cooldown">Event cooldown (hours)</Label>
                <Input id="cooldown" type="number" min="1" max="336" defaultValue={s["event_cooldown_hours"] ?? 72}
                  onBlur={(e) => mSettings.mutate({ event_cooldown_hours: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="similarity">Similarity threshold</Label>
                <Input id="similarity" type="number" min="0.3" max="0.9" step="0.01" defaultValue={s["event_similarity_threshold"] ?? 0.52}
                  onBlur={(e) => mSettings.mutate({ event_similarity_threshold: Number(e.target.value) })} />
              </div>
            </div>
          </Panel>
        </TabsContent>

        {/* BREAKING */}
        <TabsContent value="breaking" className="mt-4">
          <Panel title="Breaking-news criteria" hint="Breaking items skip the queue and the posting interval.">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => {
                const on = (s["breaking_categories"] ?? []).includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      const current: string[] = s["breaking_categories"] ?? [];
                      mSettings.mutate({
                        breaking_categories: on ? current.filter((c) => c !== cat) : [...current, cat],
                      });
                    }}
                  >
                    <Badge variant={on ? "default" : "secondary"}>{cat}</Badge>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="oil">Major oil move (%)</Label>
                <Input
                  id="oil" type="number" step="0.1" defaultValue={s["oil_move_threshold"]}
                  onBlur={(e) => mSettings.mutate({ oil_move_threshold: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gold">Major gold move (%)</Label>
                <Input
                  id="gold" type="number" step="0.1" defaultValue={s["gold_move_threshold"]}
                  onBlur={(e) => mSettings.mutate({ gold_move_threshold: Number(e.target.value) })}
                />
              </div>
            </div>
          </Panel>
        </TabsContent>

        {/* SOURCES */}
        <TabsContent value="sources" className="mt-4 space-y-4">
          <Panel title="Providers" hint="For Telegram, enter a public @channel handle and choose Telegram channel.">
            {data.sources.map((src: any) => (
              <div key={src.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                <div className="min-w-44 flex-1">
                  <p className="font-medium">{src.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {src.kind} · secret: {src.secret_ref ?? "none needed"} · priority {src.priority}
                  </p>
                  {src.last_error ? (
                    <p className="text-xs text-destructive">{src.last_error.slice(0, 120)}</p>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {src.daily_quota
                    ? `${src.used_today}/${src.daily_quota} used today`
                    : "unlimited"}
                </div>
                {src.kind === "telegram" ? (
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={src.config?.mode ?? "normal"}
                    onChange={(e) => mSource.mutate({ id: src.id, mode: e.target.value })}
                  >
                    <option value="normal">Normal</option>
                    <option value="instant">Instant</option>
                  </select>
                ) : null}
                <Switch
                  checked={src.enabled}
                  onCheckedChange={(v) => mSource.mutate({ id: src.id, enabled: v })}
                />
              </div>
            ))}
            <AddSource onAdd={(payload) => mSource.mutate(payload)} />
          </Panel>

          <Panel
            title="Instant channels"
            hint="Telegram channels set to Instant are checked on this interval and published straight away. Related posts about the same person or place are merged into one message."
          >
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">Check every (minutes)</Label>
                <Input
                  type="number" min={1} max={120} className="mt-1 max-w-28"
                  defaultValue={Number(s["instant_poll_minutes"] ?? 5)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 1 && v <= 120 && v !== Number(s["instant_poll_minutes"] ?? 5)) {
                      mSettings.mutate({ instant_poll_minutes: v });
                    }
                  }}
                />
              </div>
              <Button size="sm" variant="secondary" onClick={() => mRun.mutate("instant")} disabled={mRun.isPending || paused}>
                Check instant channels now
              </Button>
              <p className="text-xs text-muted-foreground">
                Last check:{" "}
                {s["instant_last_run_at"] ? new Date(String(s["instant_last_run_at"])).toLocaleString() : "never"}
              </p>
            </div>
          </Panel>

          <Panel title="Topic queries" hint="Run against every enabled provider each cycle.">
            <div className="flex flex-wrap gap-2">
              {data.topics.map((t: any) => (
                <span key={t.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
                  <button type="button" onClick={() => mTopic.mutate({ id: t.id, enabled: !t.enabled })}>
                    <Badge variant={t.enabled ? "default" : "secondary"}>{t.query}</Badge>
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => mTopic.mutate({ id: t.id, remove: true })}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <AddTopic onAdd={(payload) => mTopic.mutate(payload)} />
          </Panel>
        </TabsContent>

        {/* FORMAT */}
        <TabsContent value="format" className="mt-4">
          <FormatTab settings={s} onSave={(patch) => mSettings.mutate(patch)} saving={mSettings.isPending} />
        </TabsContent>

        {/* TRANSLATION */}
        <TabsContent value="translation" className="mt-4">
          <Panel
            title="Translation provider manager"
            hint="Gemini and MiniMax keys are stored server-side. Keys are never returned to the browser; only masked metadata is shown."
          >
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Mode</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ["gemini_first", "Google Gemini only"],
                  ["minimax_first", "MiniMax only"],
                  ["both", "Gemini → MiniMax fallback"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={String(s["translation_mode"] ?? "gemini_first") === value ? "default" : "secondary"}
                    onClick={() => mSettings.mutate({ translation_mode: value })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                In Gemini-only mode, MiniMax is never called. In MiniMax-only mode, Google is never called.
                “Both” is conservative fallback mode: a failed/limited Gemini key moves to the next healthy key,
                then MiniMax only if Gemini has no usable key.
              </p>
            </div>

            <VercelTranslationPanel settings={s} onSave={(patch) => mSettings.mutate(patch)} />

            <TranslationKeyManager
              keys={translationData?.keys ?? []}
              envDefaults={translationData?.envDefaults ?? { gemini: 0, minimax: false }}
              onSave={(payload) => mTranslationKey.mutate(payload)}
              onTest={(id) => mTranslationTest.mutate(id)}
              busy={mTranslationKey.isPending || mTranslationTest.isPending}
            />
          </Panel>

          <Panel title="Translation failures" hint="Every configured provider/key failed or returned invalid Sorani.">
            {data.translationFailures.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failures logged.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.translationFailures.map((f: any) => (
                  <li key={f.id} className="rounded-md border border-border p-3">
                    <p className="font-medium">{f.headline}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.target_language} · tried {(f.models_tried ?? []).join(", ")} · {f.detail}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}


const DEFAULT_TRANSLATION_MODELS = [
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "minimax/minimax-m3",
];

function VercelTranslationPanel({
  settings,
  onSave,
}: {
  settings: Record<string, any>;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const stored = Array.isArray(settings["translation_model_order"]) && settings["translation_model_order"].length
    ? (settings["translation_model_order"] as string[])
    : DEFAULT_TRANSLATION_MODELS;
  const [order, setOrder] = useState<string[]>(stored);
  const [dragging, setDragging] = useState<number | null>(null);
  const enabled = settings["translation_use_vercel"] !== false;

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrder(next);
    onSave({ translation_model_order: next });
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Paid translation service</p>
          <p className="text-xs text-muted-foreground">
            When on, Sorani translation uses your paid key first and only falls back to the keys below if every model fails.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => onSave({ translation_use_vercel: v })} />
      </div>

      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground">
        Drag to set the order models are tried in. The first one that returns good Sorani is used.
      </p>
      <ul className="mt-2 space-y-1">
        {order.map((model, index) => (
          <li
            key={model}
            draggable
            onDragStart={() => setDragging(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragging !== null) move(dragging, index); setDragging(null); }}
            className="flex cursor-grab items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="text-xs text-muted-foreground">{index + 1}</span>
            <span className="flex-1">{model}</span>
            <button
              type="button" className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => move(index, Math.max(0, index - 1))}
            >
              ↑
            </button>
            <button
              type="button" className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => move(index, Math.min(order.length - 1, index + 1))}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TranslationKeyManager({
  keys,
  envDefaults,
  onSave,
  onTest,
  busy,
}: {
  keys: any[];
  envDefaults?: { gemini: number; minimax: boolean };
  onSave: (v: any) => void;
  onTest: (id: string) => void;
  busy: boolean;
}) {
  const [provider, setProvider] = useState<"gemini" | "minimax">("gemini");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [priority, setPriority] = useState(10);

  function add() {
    if (!label.trim() || !apiKey.trim()) return;
    onSave({ provider, label: label.trim(), api_key: apiKey.trim(), model, priority });
    setLabel(""); setApiKey("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={provider}
            onChange={(e) => {
              const v = e.target.value as "gemini" | "minimax";
              setProvider(v);
              setModel(v === "gemini" ? "gemini-2.5-flash" : "minimax/minimax-m3");
            }}>
            <option value="gemini">Google Gemini</option>
            <option value="minimax">MiniMax / Vercel</option>
          </select>
          <Input placeholder="Key label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="API key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <Input placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
          <Button size="sm" onClick={add} disabled={busy || !label.trim() || !apiKey.trim()}>Add key</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Environment defaults detected: {envDefaults?.gemini ?? 0} Gemini key(s), {envDefaults?.minimax ? "MiniMax configured" : "no MiniMax gateway key"}.
          For GitHub/Vercel deployment, put secrets in Vercel Environment Variables rather than committing them.
        </p>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No database-managed translation keys. Environment keys will still work.</p>
      ) : (
        keys.map((key: any) => (
          <div key={key.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
            <div className="min-w-52 flex-1">
              <p className="font-medium">{key.label} <Badge variant="secondary">{key.provider}</Badge></p>
              <p className="text-xs text-muted-foreground">
                {key.model} · priority {key.priority} · {key.enabled ? "enabled" : "disabled"} · last status {key.last_status ?? "—"}
              </p>
              {key.cooldown_until ? <p className="text-xs text-destructive">Cooldown until {new Date(key.cooldown_until).toLocaleTimeString()}</p> : null}
              {key.last_error ? <p className="text-xs text-muted-foreground">{String(key.last_error).slice(0, 140)}</p> : null}
            </div>
            <Switch checked={key.enabled} onCheckedChange={(v) => onSave({ id: key.id, provider: key.provider, label: key.label, model: key.model, enabled: v, priority: key.priority })} />
            <Button size="sm" variant="secondary" onClick={() => onTest(key.id)} disabled={busy}>Test</Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const nextLabel = window.prompt("Key label", key.label);
                if (nextLabel === null || !nextLabel.trim()) return;
                const nextModel = window.prompt("Model", key.model);
                if (nextModel === null || !nextModel.trim()) return;
                const nextPriority = window.prompt("Priority", String(key.priority));
                if (nextPriority === null) return;
                const nextKey = window.prompt("New API key (Cancel = keep current key)", "");
                onSave({
                  id: key.id,
                  provider: key.provider,
                  label: nextLabel.trim(),
                  model: nextModel.trim(),
                  priority: Number(nextPriority) || key.priority,
                  ...(nextKey?.trim() ? { api_key: nextKey.trim() } : {}),
                });
              }}
            >
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onSave({ id: key.id, provider: key.provider, label: key.label, model: key.model, priority: key.priority, remove: true })} disabled={busy}>Remove</Button>
          </div>
        ))
      )}
    </div>
  );
}

function TimeWindow({
  label, start, end, min, max, onSave,
}: {
  label: string; start: string; end: string; min: number; max: number;
  onSave: (v: { start: string; end: string; min: number; max: number }) => void;
}) {
  const [v, setV] = useState({ start: start.slice(0, 5), end: end.slice(0, 5), min, max });
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label} window</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1"><Label className="text-xs">Start</Label>
          <Input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">End</Label>
          <Input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Min minutes</Label>
          <Input type="number" value={v.min} onChange={(e) => setV({ ...v, min: Number(e.target.value) })} /></div>
        <div className="space-y-1"><Label className="text-xs">Max minutes</Label>
          <Input type="number" value={v.max} onChange={(e) => setV({ ...v, max: Number(e.target.value) })} /></div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => onSave(v)}>Save {label.toLowerCase()} window</Button>
    </div>
  );
}

function AddTopic({ onAdd }: { onAdd: (v: { query: string; category: string }) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("iran");
  return (
    <div className="flex flex-wrap gap-2">
      <Input
        className="max-w-xs" placeholder="New topic query" value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={category} onChange={(e) => setCategory(e.target.value)}
      >
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Button
        size="sm" variant="secondary"
        onClick={() => { if (query.trim()) { onAdd({ query: query.trim(), category }); setQuery(""); } }}
      >
        Add topic
      </Button>
    </div>
  );
}

function AddSource({
  onAdd,
}: {
  onAdd: (v: {
    name: string; kind: string; secret_ref: string | null; daily_quota: number | null; mode?: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("rss");
  const [mode, setMode] = useState("normal");
  const [secretRef, setSecretRef] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-48" placeholder={kind === "telegram" ? "@channel" : "Provider name"} value={name} onChange={(e) => setName(e.target.value)} />
      <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="rss">RSS provider</option>
        <option value="newsdata">NewsData</option>
        <option value="telegram">Telegram channel</option>
      </select>
      {kind === "telegram" ? (
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="normal">Normal (with the regular cycle)</option>
          <option value="instant">Instant (checked every few minutes)</option>
        </select>
      ) : null}
      <Input className="max-w-48" placeholder="SECRET_NAME (optional)" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} />
      <Button
        size="sm" variant="secondary"
        onClick={() => {
          if (!name.trim()) return;
          onAdd({
            name: name.trim(), kind, secret_ref: secretRef.trim() || null, daily_quota: null,
            ...(kind === "telegram" ? { mode } : {}),
          });
          setName(""); setSecretRef("");
        }}
      >
        Add provider
      </Button>
    </div>
  );
}

/* ------------------------------- FORMAT TAB ------------------------------- */

const FORMAT_TOGGLES: Array<[string, string, string]> = [
  ["post_show_category", "Category line", "Show the category header above the headline."],
  ["post_show_summary", "Summary", "Show the rewritten 2–3 sentence summary."],
  ["post_show_source_name", "Source name", "Show the outlet that reported the story."],
  ["post_show_timestamp", "Timestamp", "Show the original publication time."],
  ["post_show_source_link", "Source link", "Attach the article link (or all clustered links)."],
  ["post_show_images", "Image / thumbnail", "Post the article's own photo when the source provides one."],
  ["post_link_preview", "Telegram link preview", "Let Telegram render its own preview card for the link."],
  ["post_show_hashtags", "Hashtags", "Append the hashtag line."],
];

function tagsToText(value: unknown): string {
  return Array.isArray(value) ? value.join(" ") : "";
}
function textToTags(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .slice(0, 10);
}

function FormatTab({
  settings,
  onSave,
  saving,
}: {
  settings: Record<string, any>;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const bool = (key: string, fallback = true) =>
    settings[key] === undefined || settings[key] === null ? fallback : Boolean(settings[key]);
  const [emoji, setEmoji] = useState(String(settings["post_header_emoji"] ?? "📰"));
  const [readMore, setReadMore] = useState(String(settings["post_read_more_label"] ?? "Read the full report"));
  const [footer, setFooter] = useState(String(settings["post_footer_text"] ?? ""));
  const [defaultTags, setDefaultTags] = useState(tagsToText(settings["post_default_hashtags"]));
  const categoryTags: Record<string, string[]> =
    settings["post_category_hashtags"] && typeof settings["post_category_hashtags"] === "object"
      ? settings["post_category_hashtags"]
      : {};
  const [catTags, setCatTags] = useState<Record<string, string>>(
    Object.fromEntries(CATEGORIES.map((c) => [c, tagsToText(categoryTags[c])])),
  );

  const preview = [
    bool("post_show_category") ? `${emoji} WAR` : null,
    "Iranian navy escorts tanker convoy through Strait of Hormuz",
    bool("post_show_summary")
      ? "Three IRGC fast-attack craft shadowed the convoy for six hours, Tasnim reported, the first such escort since the June strikes. Shipping insurers raised Gulf war-risk premiums by 12% within the day."
      : null,
    bool("post_show_source_name") || bool("post_show_timestamp")
      ? `🗞 ${bool("post_show_source_name") ? "Tasnim" : ""}${bool("post_show_timestamp") ? " · 14 Feb 2026, 09:20" : ""}`
      : null,
    bool("post_show_source_link") ? readMore || "Read more" : null,
    bool("post_show_hashtags")
      ? [...textToTags(catTags["war"] ?? ""), ...textToTags(defaultTags)].slice(0, 6).join(" ")
      : null,
    footer.trim() || null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <Panel title="Message parts" hint="Every toggle applies to the next published message.">
        <div className="grid gap-3 sm:grid-cols-2">
          {FORMAT_TOGGLES.map(([key, label, hint]) => (
            <div key={key} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
              <Switch
                checked={bool(key, key === "post_link_preview" ? false : true)}
                onCheckedChange={(v) => onSave({ [key]: v })}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Wording" hint="Header emoji, link label and an optional footer line (e.g. your channel name).">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="fmt-emoji">Header emoji</Label>
            <Input id="fmt-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} />
          </div>
          <div>
            <Label htmlFor="fmt-link">Link label</Label>
            <Input id="fmt-link" value={readMore} onChange={(e) => setReadMore(e.target.value)} maxLength={60} />
          </div>
          <div>
            <Label htmlFor="fmt-footer">Footer line</Label>
            <Input id="fmt-footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={200} />
          </div>
        </div>
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave({
              post_header_emoji: emoji,
              post_read_more_label: readMore,
              post_footer_text: footer,
            })
          }
        >
          Save wording
        </Button>
      </Panel>

      <Panel title="Hashtags" hint="Space-separated. Category tags are added before the default tags, max 6 per post.">
        <div>
          <Label htmlFor="fmt-tags">Default hashtags (every post)</Label>
          <Input id="fmt-tags" value={defaultTags} onChange={(e) => setDefaultTags(e.target.value)} placeholder="#Iran #MiddleEast" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div key={c}>
              <Label htmlFor={`fmt-tag-${c}`} className="text-xs uppercase tracking-wide text-muted-foreground">{c}</Label>
              <Input
                id={`fmt-tag-${c}`}
                value={catTags[c] ?? ""}
                onChange={(e) => setCatTags((prev) => ({ ...prev, [c]: e.target.value }))}
                placeholder="#Tag"
              />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave({
              post_default_hashtags: textToTags(defaultTags),
              post_category_hashtags: Object.fromEntries(
                Object.entries(catTags).map(([k, v]) => [k, textToTags(v)]),
              ),
            })
          }
        >
          Save hashtags
        </Button>
      </Panel>

      <Panel title="Preview" hint="Approximate rendering of the next Telegram message.">
        <div className="whitespace-pre-line rounded-md border border-border bg-muted/30 p-4 text-sm">
          {preview.join("\n\n")}
        </div>
        {bool("post_show_images") ? (
          <p className="text-xs text-muted-foreground">
            When the source provides a photo it is sent as the message image and the text becomes the caption.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

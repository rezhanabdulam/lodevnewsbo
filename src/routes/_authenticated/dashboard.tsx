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
  setWebhook,
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboard"] });
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong");

  const saveSettingsFn = useServerFn(saveSettings);
  const updateChatFn = useServerFn(updateChat);
  const upsertTopicFn = useServerFn(upsertTopic);
  const upsertSourceFn = useServerFn(upsertSource);
  const runFn = useServerFn(runPipelineNow);
  const botInfoFn = useServerFn(refreshBotInfo);
  const webhookFn = useServerFn(setWebhook);

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
    mutationFn: (action: "ingest" | "publishTop3") => runFn({ data: { action } }),
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Iran Desk</p>
          <h1 className="text-2xl font-semibold">Bot operations console</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => mRun.mutate("ingest")} disabled={mRun.isPending}>
            {mRun.isPending ? "Running…" : "Fetch now"}
          </Button>
          <Button size="sm" onClick={() => mRun.mutate("publishTop3")} disabled={mRun.isPending}>
            Publish top 3
          </Button>
          <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Queued", value: data.queue.length },
          { label: "Published 24h", value: data.history.length },
          { label: "Active chats", value: data.chats.filter((c: any) => c.active).length },
          { label: "Translation fails", value: data.translationFailures.length },
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
          <TabsTrigger value="translation">Translation log</TabsTrigger>
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
                <Switch
                  checked={src.enabled}
                  onCheckedChange={(v) => mSource.mutate({ id: src.id, enabled: v })}
                />
              </div>
            ))}
            <AddSource onAdd={(payload) => mSource.mutate(payload)} />
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

        {/* TRANSLATION */}
        <TabsContent value="translation" className="mt-4">
          <Panel title="Translation failures" hint="Every model failed script validation; English was sent instead.">
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
  onAdd: (v: { name: string; kind: string; secret_ref: string | null; daily_quota: number | null }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("rss");
  const [secretRef, setSecretRef] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-48" placeholder={kind === "telegram" ? "@channel" : "Provider name"} value={name} onChange={(e) => setName(e.target.value)} />
      <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="rss">RSS provider</option>
        <option value="newsdata">NewsData</option>
        <option value="telegram">Telegram channel</option>
      </select>
      <Input className="max-w-48" placeholder="SECRET_NAME (optional)" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} />
      <Button
        size="sm" variant="secondary"
        onClick={() => {
          if (!name.trim()) return;
          onAdd({ name: name.trim(), kind, secret_ref: secretRef.trim() || null, daily_quota: null });
          setName(""); setSecretRef("");
        }}
      >
        Add provider
      </Button>
    </div>
  );
}

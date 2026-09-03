import { CATEGORIES, type Category } from "./types";

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

function apiKey(): string {
  const key =
    process.env["VERCEL_AI_GATEWAY_API_KEY"] ??
    process.env["AI_GATEWAY_API_KEY"] ??
    process.env["VERCEL_API_KEY"];
  if (!key) throw new Error("Missing VERCEL_AI_GATEWAY_API_KEY");
  return key;
}

async function chat(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    max_tokens: 220,
  };
  if (model.startsWith("openai/gpt-5.6")) body["reasoning_effort"] = "none";

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI rate limit reached (429)");
    if (res.status === 402) throw new Error("AI credits exhausted (402)");
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

async function groqChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("Missing GROQ_API_KEY");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0 }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Groq ${res.status}: ${body.slice(0, 240)}`);
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function translateTelegramToEnglish(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const raw = await groqChat([
    {
      role: "system",
      content: "Translate Arabic or Persian breaking-news posts into concise professional English. Preserve names, numbers, attribution and factual uncertainty. Remove only labels such as عاجل. Return ONLY a JSON array of strings in the same order. Never summarize away facts.",
    },
    { role: "user", content: JSON.stringify(texts) },
  ]);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed) || parsed.length !== texts.length) throw new Error("Telegram translation shape mismatch");
  return parsed.map((value) => String(value).trim());
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in model output");
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  return JSON.parse(cleaned.slice(start, end + 1));
}

const CATEGORY_GUIDE = `
- iraq: major Iraqi security, politics, diplomacy, energy, economy, Kurdistan Region, or regional developments with a direct impact on Iraq.
- middle-east: major regional developments in Israel/Palestine, Lebanon, Syria, Yemen, Saudi Arabia, the Gulf or Turkey that matter to a Middle Eastern audience.
- analysis: substantive geopolitical or military analysis about Iran, Iraq, the Iran-US confrontation, or the wider Middle East.
- war: military strikes, attacks, casualties, mobilisation, or direct armed confrontation involving Iran, the US, Israel or their allies.
- iran: Iranian politics, leadership statements, nuclear programme, sanctions, internal affairs, Iran's regional diplomacy.
- proxies: Hezbollah, the Houthis, Iraqi militias, other Iran-aligned armed groups, and Israel-related conflict news.
- usa: US government or Trump administration action, statements or policy toward Iran and the region.
- oil: crude oil prices, supply, shipping, the Strait of Hormuz, OPEC.
- gold: gold and precious-metal prices and safe-haven flows.
- economic-impact: other market, currency, trade or inflation effects of the conflict.
Return "none" for minor local stories, video games, sports, entertainment, generic finance, foreign domestic politics without regional impact, and India-only gold retail prices.`;

/** GATE 3 — semantic classification (never plain keyword matching). */
export async function classifyBatch(
  items: Array<{ title: string; description: string | null }>,
): Promise<Array<Category | null>> {
  if (items.length === 0) return [];
  const numbered = items
    .map((it, i) => `${i + 1}. ${it.title}\n   ${(it.description ?? "").slice(0, 300)}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content: `You classify English-language news for an Iraqi audience covering Iraq first, Iran and Iranian perspectives, the Iran-US conflict, and major Middle East events. Categories:${CATEGORY_GUIDE}
Judge meaning, not keywords: a "God of War" game article is "none", not war.
Reply with ONLY a JSON array of strings, one per numbered item, in order.`,
    },
    { role: "user", content: numbered },
  ];
  const raw = process.env["GROQ_API_KEY"]
    ? await groqChat(messages)
    : await chat("openai/gpt-5.6-sol", messages);

  let parsed: unknown[];
  try {
    const json = extractJson(raw);
    if (!Array.isArray(json)) throw new Error("classification not an array");
    parsed = json;
  } catch {
    const labels = raw.toLowerCase().match(/\b(?:middle-east|economic-impact|iraq|analysis|war|iran|proxies|usa|oil|gold|none)\b/g) ?? [];
    if (labels.length < items.length) throw new Error("classification output could not be recovered");
    parsed = labels.slice(-items.length);
  }
  return items.map((_, i) => {
    const v = String(parsed[i] ?? "none").trim().toLowerCase();
    return (CATEGORIES as string[]).includes(v) ? (v as Category) : null;
  });
}

export interface Rewritten {
  headline: string;
  summary: string;
}

export async function rewrite(item: {
  title: string;
  description: string | null;
  sourceName: string | null;
}): Promise<Rewritten> {
  const messages = [
    {
      role: "system",
      content: `You are a wire editor. Return ONLY JSON: {"headline": string, "summary": string}.
Rules:
- headline: clear, factual, under 110 characters, no clickbait, no emoji.
- summary: 2-3 complete sentences that ADD information beyond the headline. Never repeat the headline wording.
- Pull the key figure, number or quote INTO the summary sentences, never trailing at the end.
- Never end mid-sentence and never use an ellipsis.
- If a claim comes from one side (a government, military spokesperson or state media) and is not independently confirmed, keep the attribution inside the sentence: "Iran says...", "Israel says...", "the Pentagon says...".
- Report the story regardless of which side it favours or embarrasses.
- Remove labels such as "live update", "live blog", "breaking", and "Iran-US live".
- Write professional English only. Never output HTML, markdown, feed boilerplate, social embeds, or another language.
- Prioritise implications for Iraq, Iran and the region when supported by the supplied facts.
- Iranian perspectives are welcome, but clearly attribute claims and never present unverified claims as facts.
- For oil or gold, use globally meaningful USD benchmarks and regional implications; omit India-only retail prices.`,
    },
    {
      role: "user",
      content: `Source: ${item.sourceName ?? "unknown"}\nHeadline: ${item.title}\nBody: ${(item.description ?? "").slice(0, 1500)}`,
    },
  ];
  const raw = process.env["GROQ_API_KEY"]
    ? await groqChat(messages)
    : await chat("openai/gpt-5.6-sol", messages);

  const parsed = extractJson(raw) as { headline?: string; summary?: string };
  const headline = (parsed.headline ?? item.title).trim();
  let summary = (parsed.summary ?? item.description ?? "").trim();
  if (/(\.\.\.|…)$/.test(summary)) {
    const withoutEllipsis = summary.replace(/(\.\.\.|…)$/, "").trim();
    const lastCompleteSentence = withoutEllipsis.match(/^([\s\S]*[.!?])\s+[^.!?]*$/)?.[1];
    summary = (lastCompleteSentence ?? withoutEllipsis).trim();
  }
  if (!/[.!?]$/.test(summary) && summary.length > 0) summary += ".";
  return { headline, summary };
}

/** Rewrites a whole ingest batch in one request instead of one paid call per article. */
export async function rewriteBatch(items: Array<{
  title: string;
  description: string | null;
  sourceName: string | null;
}>): Promise<Rewritten[]> {
  if (items.length === 0) return [];
  const messages = [
    {
      role: "system",
      content: `You are a wire editor for an Iraqi, Muslim, pro-Iran regional news channel. Return ONLY a JSON array with one {"headline": string, "summary": string} object per input, in order.
Headline: factual, under 110 characters, no clickbait or feed labels.
Summary: 2-3 complete standalone sentences that ADD NEW INFORMATION the headline does not already state — never a reworded copy of the headline. Lead with the concrete detail: numbers, names, locations, quotes, dates, casualties, prices, or the official reaction, then one sentence on why it matters for Iraq, Iran or the region. Never end with an ellipsis or an unfinished clause. Attribute disputed claims. Do not invent facts; if the source text has nothing beyond the headline, still write what context is verifiable from it. Do not adopt hostile or demoralising framing about Iran. Professional English only.`,
    },
    { role: "user", content: JSON.stringify(items.map((item) => ({ ...item, description: item.description?.slice(0, 1200) ?? null }))) },
  ];
  const raw = process.env["GROQ_API_KEY"]
    ? await groqChat(messages)
    : await chat("openai/gpt-5.6-sol", messages);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed) || parsed.length !== items.length) throw new Error("rewrite batch shape mismatch");
  return parsed.map((value, index) => {
    const row = value as { headline?: string; summary?: string };
    const fallback = items[index];
    const headline = String(row.headline ?? fallback?.title ?? "").trim();
    let summary = String(row.summary ?? fallback?.description ?? "").trim();
    if (summary && restatesHeadline(headline, summary)) {
      const extra = String(fallback?.description ?? "").trim();
      summary = extra && !restatesHeadline(headline, extra) ? extra : "";
    }
    return { headline, summary };
  });
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/** True when the summary adds nothing beyond the headline. */
export function restatesHeadline(headline: string, summary: string): boolean {
  const head = new Set(words(headline));
  const body = words(summary);
  if (!head.size || body.length === 0) return false;
  const novel = body.filter((w) => !head.has(w));
  return novel.length / body.length < 0.35 || body.length < 8;
}

/** Breaking-news judgement for a single classified item. */
export function isBreaking(
  category: Category,
  title: string,
  breakingCategories: string[],
): boolean {
  if (breakingCategories.includes(category)) {
    const hardSignals =
      /\b(strike|strikes|attack|attacked|missile|drone|killed|assassinat|retaliat|launch(ed)?|invasion|war|ceasefire|ultimatum|sanction(s|ed)?|statement|address|speech|warns?)\b/i;
    return hardSignals.test(title);
  }
  return false;
}

type TranslationProvider = "gemini" | "minimax";

interface TranslationKey {
  id: string;
  provider: TranslationProvider;
  label: string;
  api_key: string;
  model: string;
  enabled: boolean;
  priority: number;
  cooldown_until: string | null;
  consecutive_failures: number;
  last_status: number | null;
  last_error: string | null;
  last_used_at: string | null;
}

const translationGateway = "https://ai-gateway.vercel.sh/v1/chat/completions";
const googleGenerate = "https://generativelanguage.googleapis.com/v1beta/models";

async function loadTranslationKeys(): Promise<TranslationKey[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("translation_provider_keys")
      .select("*")
      .eq("enabled", true)
      .order("priority", { ascending: true });
    if (!error && data?.length) return data as TranslationKey[];
  } catch {
    // Fall back to environment variables during first boot/migration.
  }

  const keys: TranslationKey[] = [];
  const add = (provider: TranslationProvider, key: string | undefined, index: number, model: string) => {
    if (!key?.trim()) return;
    keys.push({
      id: `${provider}-env-${index}`,
      provider,
      label: `${provider === "gemini" ? "Google AI Studio" : "Vercel AI Gateway"} ${index}`,
      api_key: key.trim(),
      model,
      enabled: true,
      priority: index,
      cooldown_until: null,
      consecutive_failures: 0,
      last_status: null,
      last_error: null,
      last_used_at: null,
    });
  };

  add("gemini", process.env["GEMINI_API_KEY_1"], 1, process.env["GEMINI_TRANSLATION_MODEL"] ?? "gemini-2.5-flash");
  add("gemini", process.env["GEMINI_API_KEY_2"], 2, process.env["GEMINI_TRANSLATION_MODEL"] ?? "gemini-2.5-flash");
  add("gemini", process.env["GEMINI_API_KEY_3"], 3, process.env["GEMINI_TRANSLATION_MODEL"] ?? "gemini-2.5-flash");
  add("minimax", process.env["VERCEL_AI_GATEWAY_API_KEY"] ?? process.env["AI_GATEWAY_API_KEY"], 1, "minimax/minimax-m3");
  return keys;
}

function isAvailable(key: TranslationKey): boolean {
  return !key.cooldown_until || Date.parse(key.cooldown_until) <= Date.now();
}

async function markTranslationKey(key: TranslationKey, status: number | null, errorText?: string) {
  // Env-backed keys cannot be mutated; DB-managed keys are tracked for safe rotation.
  if (key.id.includes("-env-")) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      last_status: status,
      last_error: errorText?.slice(0, 500) ?? null,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (status === 429 || status === 403) {
      const cooldownMinutes = status === 429 ? 10 : 60;
      patch.cooldown_until = new Date(Date.now() + cooldownMinutes * 60_000).toISOString();
    } else if (status !== null && status >= 200 && status < 300) {
      patch.cooldown_until = null;
      patch.consecutive_failures = 0;
    }
    if (status !== null && status >= 400) {
      patch.consecutive_failures = Math.min(10, (key.consecutive_failures ?? 0) + 1);
    }
    await (supabaseAdmin as any).from("translation_provider_keys").update(patch).eq("id", key.id);
  } catch {
    // Translation must not fail because telemetry failed.
  }
}

async function geminiTranslate(key: TranslationKey, text: string): Promise<string> {
  const url = `${googleGenerate}/${encodeURIComponent(key.model)}:generateContent?key=${encodeURIComponent(key.api_key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "Translate into Kurdish Sorani using Arabic script. Preserve names, numbers, URLs, acronyms and attribution. Output only the translation, with no preface, explanation or markdown." }],
      },
      contents: [{ role: "user", parts: [{ text: text.slice(0, 900) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 260 },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    await markTranslationKey(key, res.status, body);
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 260)}`);
  }
  await markTranslationKey(key, res.status);
  const json = JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
}

async function minimaxTranslate(key: TranslationKey, text: string): Promise<string> {
  const res = await fetch(translationGateway, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key.api_key}` },
    body: JSON.stringify({
      model: key.model || "minimax/minimax-m3",
      messages: [
        { role: "system", content: "Translate into Kurdish Sorani using Arabic script. Preserve names, numbers, URLs, acronyms and attribution. Output only the translation, with no preface, explanation or markdown." },
        { role: "user", content: text.slice(0, 900) },
      ],
      temperature: 0,
      max_tokens: 260,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    await markTranslationKey(key, res.status, body);
    throw new Error(`MiniMax gateway ${res.status}: ${body.slice(0, 260)}`);
  }
  await markTranslationKey(key, res.status);
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

const SORANI_ALLOWED =
  /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9\s\p{P}\p{S}\p{Extended_Pictographic}A-Za-z.-]*$/u;

export function validateSorani(text: string): boolean {
  if (!text.trim()) return false;
  // Allow legitimate short Latin tokens such as USA, NATO, F-35 and names/URLs,
  // while rejecting prose that is overwhelmingly Latin-script.
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const arabicLetters = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  if (arabicLetters < 2) return false;
  if (latinLetters > Math.max(24, arabicLetters * 0.35)) return false;
  return SORANI_ALLOWED.test(text);
}

async function getTranslationMode(): Promise<"gemini_first" | "minimax_first" | "both"> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any).from("settings").select("translation_mode").eq("id", 1).single();
    const mode = String(data?.translation_mode ?? "gemini_first");
    if (mode === "minimax_first" || mode === "both") return mode;
  } catch {}
  return "gemini_first";
}

export interface TranslationResult {
  text: string | null;
  modelsTried: string[];
  detail?: string;
}

export async function translateToSorani(text: string): Promise<TranslationResult> {
  const keys = (await loadTranslationKeys()).filter(isAvailable);
  const mode = await getTranslationMode();

  const gemini = keys.filter((k) => k.provider === "gemini");
  const minimax = keys.filter((k) => k.provider === "minimax");
  let ordered: TranslationKey[];
  if (mode === "minimax_first") ordered = [...minimax, ...gemini];
  else if (mode === "both") ordered = [...gemini, ...minimax];
  else ordered = [...gemini, ...minimax];

  // In "both", Gemini is tried first and MiniMax is a fallback. In either
  // single-provider mode, the other provider is never used.
  if (mode !== "both") {
    ordered = mode === "minimax_first" ? minimax : gemini;
  }

  const tried: string[] = [];
  let detail = "";
  for (const key of ordered) {
    tried.push(`${key.provider}:${key.model}`);
    try {
      const out = key.provider === "gemini"
        ? await geminiTranslate(key, text)
        : await minimaxTranslate(key, text);
      if (validateSorani(out)) return { text: out, modelsTried: tried };
      detail = `${key.provider} returned output that failed Sorani validation`;
      await markTranslationKey(key, 200, detail);
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }
  return { text: null, modelsTried: tried, detail: detail || "No translation provider is configured or available" };
}


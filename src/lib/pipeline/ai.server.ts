import { CATEGORIES, type Category } from "./types";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

async function chat(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const body: Record<string, unknown> = { model, messages };
  if (model.startsWith("openai/gpt-5.6")) body["reasoning_effort"] = "none";

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": apiKey(),
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

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in model output");
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  return JSON.parse(cleaned.slice(start, end + 1));
}

const CATEGORY_GUIDE = `
- war: military strikes, attacks, casualties, mobilisation, or direct armed confrontation involving Iran, the US, Israel or their allies.
- iran: Iranian politics, leadership statements, nuclear programme, sanctions, internal affairs, Iran's regional diplomacy.
- proxies: Hezbollah, the Houthis, Iraqi militias, other Iran-aligned armed groups, and Israel-related conflict news.
- usa: US government or Trump administration action, statements or policy toward Iran and the region.
- oil: crude oil prices, supply, shipping, the Strait of Hormuz, OPEC.
- gold: gold and precious-metal prices and safe-haven flows.
- economic-impact: other market, currency, trade or inflation effects of the conflict.
Return "none" for anything unrelated to the Iran-US conflict and its regional/economic effects (video games, sports, entertainment, generic finance).`;

/** GATE 3 — semantic classification (never plain keyword matching). */
export async function classifyBatch(
  items: Array<{ title: string; description: string | null }>,
): Promise<Array<Category | null>> {
  if (items.length === 0) return [];
  const numbered = items
    .map((it, i) => `${i + 1}. ${it.title}\n   ${(it.description ?? "").slice(0, 300)}`)
    .join("\n");

  const raw = await chat("openai/gpt-5.6-sol", [
    {
      role: "system",
      content: `You classify news articles for a bot covering the Iran-US conflict and its effects. Categories:${CATEGORY_GUIDE}
Judge meaning, not keywords: a "God of War" game article is "none", not war.
Reply with ONLY a JSON array of strings, one per numbered item, in order.`,
    },
    { role: "user", content: numbered },
  ]);

  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) throw new Error("classification not an array");
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
  const raw = await chat("openai/gpt-5.6-sol", [
    {
      role: "system",
      content: `You are a wire editor. Return ONLY JSON: {"headline": string, "summary": string}.
Rules:
- headline: clear, factual, under 110 characters, no clickbait, no emoji.
- summary: 2-3 complete sentences that ADD information beyond the headline. Never repeat the headline wording.
- Pull the key figure, number or quote INTO the summary sentences, never trailing at the end.
- Never end mid-sentence and never use an ellipsis.
- If a claim comes from one side (a government, military spokesperson or state media) and is not independently confirmed, keep the attribution inside the sentence: "Iran says...", "Israel says...", "the Pentagon says...".
- Report the story regardless of which side it favours or embarrasses.`,
    },
    {
      role: "user",
      content: `Source: ${item.sourceName ?? "unknown"}\nHeadline: ${item.title}\nBody: ${(item.description ?? "").slice(0, 1500)}`,
    },
  ]);

  const parsed = extractJson(raw) as { headline?: string; summary?: string };
  const headline = (parsed.headline ?? item.title).trim();
  let summary = (parsed.summary ?? item.description ?? "").trim();
  if (/(\.\.\.|…)$/.test(summary)) {
    summary = summary.replace(/(\.\.\.|…)$/, "").replace(/[^.!?]*$/, "").trim();
  }
  if (!/[.!?]$/.test(summary) && summary.length > 0) summary += ".";
  return { headline, summary };
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

const TRANSLATION_MODELS = [
  "google/gemini-3.6-flash",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
];

/** Allowed for Kurdish Sorani: Arabic-script ranges + punctuation, digits, emoji, whitespace. */
const SORANI_ALLOWED =
  /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9\s\p{P}\p{S}\p{Extended_Pictographic}]*$/u;

export function validateSorani(text: string): boolean {
  if (!text.trim()) return false;
  if (/[A-Za-z]{3,}/.test(text)) return false;
  return SORANI_ALLOWED.test(text);
}

export interface TranslationResult {
  text: string | null;
  modelsTried: string[];
  detail?: string;
}

export async function translateToSorani(text: string): Promise<TranslationResult> {
  const tried: string[] = [];
  let detail = "";
  for (const model of TRANSLATION_MODELS) {
    tried.push(model);
    try {
      const out = (
        await chat(model, [
          {
            role: "system",
            content:
              "Translate the user's news text into Kurdish Sorani (Central Kurdish, Arabic script). Output ONLY the translation. Do not use Latin letters. Keep numbers and emoji as-is.",
          },
          { role: "user", content: text },
        ])
      ).trim();
      if (validateSorani(out)) return { text: out, modelsTried: tried };
      detail = `output failed script validation on ${model}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }
  return { text: null, modelsTried: tried, detail };
}

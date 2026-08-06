const DIRECT_API = "https://api.telegram.org";
const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

function botToken(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

/**
 * Calls a Telegram Bot API method. Tries the raw bot token directly; if the
 * stored value turns out to be a Lovable connector key instead of a bot token,
 * falls back to the connector gateway.
 */
export async function telegramCall<T = Record<string, unknown>>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const token = botToken();

  const direct = await fetch(`${DIRECT_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (direct) {
    const json = (await direct.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;
    if (json?.ok) return json.result as T;
    if (direct.status !== 401 && direct.status !== 404) {
      throw new Error(
        `Telegram ${method} failed [${direct.status}]: ${json?.description ?? "unknown error"}`,
      );
    }
  }

  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) throw new Error("Telegram auth failed and no LOVABLE_API_KEY for gateway fallback");

  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": token,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telegram gateway ${method} [${res.status}]: ${body.slice(0, 300)}`);
  const json = JSON.parse(body) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? "failed"}`);
  return json.result as T;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface OutgoingPost {
  headline: string;
  summary: string;
  sourceName: string;
  url: string;
  imageUrl: string | null;
  originalPublishedAt: string | null;
  breaking: boolean;
  category: string;
  timezone: string;
}

export function formatMessage(post: OutgoingPost): string {
  const when = post.originalPublishedAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: post.timezone,
      }).format(new Date(post.originalPublishedAt))
    : "";

  const lines = [
    `📰 <b>${escapeHtml(post.category.replace(/-/g, " ").toUpperCase())}</b>`,
    "",
    `<b>${escapeHtml(post.headline)}</b>`,
    "",
    escapeHtml(post.summary),
    "",
    `🗞 <i>${escapeHtml(post.sourceName)}</i>${when ? ` · ${escapeHtml(when)}` : ""}`,
    `<a href="${escapeHtml(post.url)}">Read the full report</a>`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

export async function sendPost(chatId: number, post: OutgoingPost): Promise<void> {
  const text = formatMessage(post);
  if (post.imageUrl) {
    try {
      await telegramCall("sendPhoto", {
        chat_id: chatId,
        photo: post.imageUrl,
        caption: text.slice(0, 1024),
        parse_mode: "HTML",
      });
      return;
    } catch {
      // image rejected by Telegram -> fall through to text-only, no placeholder
    }
  }
  await telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: !post.imageUrl ? false : true },
  });
}

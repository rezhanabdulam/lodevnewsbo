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

export interface PostSource {
  name: string;
  url: string;
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
  /** Extra outlets covering the same event (event clustering). */
  extraSources?: PostSource[];
}

/** Admin-editable presentation options for every published message. */
export interface PostFormat {
  showCategory: boolean;
  showSourceName: boolean;
  showSourceLink: boolean;
  showTimestamp: boolean;
  showSummary: boolean;
  showImages: boolean;
  linkPreview: boolean;
  showHashtags: boolean;
  headerEmoji: string;
  readMoreLabel: string;
  footerText: string;
  defaultHashtags: string[];
  categoryHashtags: Record<string, string[]>;
}

export const DEFAULT_POST_FORMAT: PostFormat = {
  showCategory: true,
  showSourceName: true,
  showSourceLink: true,
  showTimestamp: true,
  showSummary: true,
  showImages: true,
  linkPreview: false,
  showHashtags: true,
  headerEmoji: "📰",
  readMoreLabel: "Read the full report",
  footerText: "",
  defaultHashtags: ["#Iran", "#IranUSA", "#MiddleEast"],
  categoryHashtags: {},
};

function normalizeTag(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned ? `#${cleaned}` : "";
}

export function hashtagsFor(post: OutgoingPost, format: PostFormat): string[] {
  const list = [
    ...(format.categoryHashtags?.[post.category] ?? []),
    ...(format.defaultHashtags ?? []),
  ]
    .map(normalizeTag)
    .filter(Boolean);
  return Array.from(new Set(list)).slice(0, 6);
}

export function formatMessage(post: OutgoingPost, format: PostFormat = DEFAULT_POST_FORMAT): string {
  const when =
    format.showTimestamp && post.originalPublishedAt
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: post.timezone,
        }).format(new Date(post.originalPublishedAt))
      : "";

  const sources: PostSource[] = [
    { name: post.sourceName, url: post.url },
    ...(post.extraSources ?? []),
  ];

  const lines: string[] = [];
  if (format.showCategory) {
    lines.push(
      `${format.headerEmoji ? `${escapeHtml(format.headerEmoji)} ` : ""}<b>${escapeHtml(
        post.category.replace(/-/g, " ").toUpperCase(),
      )}</b>`,
      "",
    );
  }
  lines.push(`<b>${escapeHtml(post.headline)}</b>`);
  if (format.showSummary && post.summary.trim()) lines.push("", escapeHtml(post.summary));

  const attribution =
    format.showSourceName || when
      ? `${format.showSourceName ? `🗞 <i>${escapeHtml(post.sourceName)}</i>` : ""}${
          when ? `${format.showSourceName ? " · " : ""}${escapeHtml(when)}` : ""
        }`
      : "";
  if (attribution) lines.push("", attribution);

  if (format.showSourceLink) {
    if (sources.length > 1) {
      lines.push(
        ...sources.map(
          (s, i) =>
            `${i === 0 ? "🔗" : "•"} <a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>`,
        ),
      );
    } else {
      lines.push(
        `<a href="${escapeHtml(post.url)}">${escapeHtml(format.readMoreLabel || "Read more")}</a>`,
      );
    }
  }

  if (format.showHashtags) {
    const tags = hashtagsFor(post, format);
    if (tags.length) lines.push("", tags.join(" "));
  }
  if (format.footerText?.trim()) lines.push("", escapeHtml(format.footerText.trim()));

  return lines.join("\n");
}


export async function sendPost(
  chatId: number,
  post: OutgoingPost,
  format: PostFormat = DEFAULT_POST_FORMAT,
): Promise<void> {
  const text = formatMessage(post, format);
  if (format.showImages && post.imageUrl) {
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
    link_preview_options: { is_disabled: !format.linkPreview },
  });
}

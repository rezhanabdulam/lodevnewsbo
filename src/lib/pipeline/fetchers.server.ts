import type { FetchedArticle } from "./types";

/** NewsData.io — primary provider. Returns image_url natively. */
export async function fetchNewsData(
  apiKey: string,
  query: string,
): Promise<FetchedArticle[]> {
  const url = new URL("https://newsdata.io/api/1/latest");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NewsData ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    status?: string;
    results?: Array<Record<string, unknown>>;
  };
  if (json.status && json.status !== "success") {
    throw new Error(`NewsData error: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return (json.results ?? [])
    .map((r): FetchedArticle | null => {
      const link = typeof r["link"] === "string" ? r["link"] : null;
      const title = typeof r["title"] === "string" ? r["title"] : null;
      if (!link || !title) return null;
      const srcArr = r["source_name"] ?? r["source_id"];
      return {
        provider: "NewsData.io",
        sourceName: typeof srcArr === "string" ? srcArr : null,
        url: link,
        title,
        description:
          typeof r["description"] === "string" ? r["description"] : null,
        imageUrl: typeof r["image_url"] === "string" ? r["image_url"] : null,
        publishedAt: typeof r["pubDate"] === "string" ? r["pubDate"] : null,
      };
    })
    .filter((a): a is FetchedArticle => a !== null);
}

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1] ? decodeEntities(m[1]) : null;
}

/** Google News RSS — free fallback. Rarely provides images. */
export async function fetchGoogleNewsRss(
  query: string,
): Promise<FetchedArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
  });
  if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
  const xml = await res.text();

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map((block): FetchedArticle | null => {
      const title = tag(block, "title");
      const link = tag(block, "link");
      if (!title || !link) return null;
      return {
        provider: "Google News RSS",
        sourceName: tag(block, "source"),
        url: link,
        title,
        description: tag(block, "description"),
        imageUrl: null,
        publishedAt: tag(block, "pubDate"),
      };
    })
    .filter((a): a is FetchedArticle => a !== null);
}

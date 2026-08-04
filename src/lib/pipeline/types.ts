export type Category =
  | "iran"
  | "oil"
  | "war"
  | "gold"
  | "usa"
  | "proxies"
  | "economic-impact";

export const CATEGORIES: Category[] = [
  "war",
  "iran",
  "proxies",
  "gold",
  "usa",
  "oil",
  "economic-impact",
];

export const CATEGORY_PRIORITY: Record<Category, number> = {
  war: 60,
  iran: 50,
  proxies: 45,
  gold: 30,
  usa: 30,
  oil: 25,
  "economic-impact": 20,
};

export interface FetchedArticle {
  provider: string;
  sourceName: string | null;
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

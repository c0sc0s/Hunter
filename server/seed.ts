import type { LibraryItem } from "../shared/types";

const now = new Date().toISOString();

export const seedItems: LibraryItem[] = [
  {
    id: "seed-climate-capital",
    url: "https://example.com/climate-capital",
    canonicalUrl: "https://example.com/climate-capital",
    title: "How climate capital is moving from pledges to operating discipline",
    sourceName: "Field Notes",
    sourceType: "article",
    status: "unread",
    favorite: true,
    tags: ["climate", "markets", "strategy"],
    note: "Good reference for the investment memo framing.",
    summary:
      "A practical look at how climate investing is shifting from broad commitments to measurable operating improvements, with emphasis on procurement, energy resilience, and reporting.",
    excerpt:
      "Climate capital is becoming less about abstract pledges and more about the operational details that move cost, risk, and resilience.",
    readableText:
      "Climate capital is becoming less about abstract pledges and more about the operational details that move cost, risk, and resilience.",
    coverImage: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    favicon: "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    savedAt: now,
    updatedAt: now,
    readingMinutes: 5,
    confidence: 0.82,
    enrichmentState: "ready"
  },
  {
    id: "seed-browser-workflows",
    url: "https://example.com/browser-reading-workflows",
    canonicalUrl: "https://example.com/browser-reading-workflows",
    title: "The browser is becoming a reading workflow surface",
    sourceName: "Interface Review",
    sourceType: "article",
    status: "reading",
    favorite: false,
    tags: ["browser", "product", "workflow"],
    summary:
      "The piece argues that browser products are moving from passive tabs toward active workspaces that preserve user intent across pages.",
    excerpt: "Tabs used to be a pile of places. Increasingly, they are becoming a surface for intent, memory, and review.",
    readableText: "Tabs used to be a pile of places. Increasingly, they are becoming a surface for intent, memory, and review.",
    coverImage: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
    favicon: "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    savedAt: now,
    updatedAt: now,
    readingMinutes: 7,
    confidence: 0.78,
    enrichmentState: "ready"
  },
  {
    id: "seed-x-thread",
    url: "https://x.com/example/status/1800000000000000000",
    canonicalUrl: "https://x.com/example/status/1800000000000000000",
    title: "Thread: what makes a personal knowledge app actually stick",
    sourceName: "X",
    sourceType: "tweet",
    status: "unread",
    favorite: false,
    tags: ["pkm", "habits"],
    summary:
      "A compact thread about the gap between capturing information and returning to it, with useful product heuristics for resurfacing saved content.",
    excerpt: "The hard part is not saving. The hard part is making old saves re-enter the moment when they are useful.",
    readableText: "The hard part is not saving. The hard part is making old saves re-enter the moment when they are useful.",
    coverImage: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=64",
    savedAt: now,
    updatedAt: now,
    readingMinutes: 2,
    confidence: 0.68,
    enrichmentState: "ready"
  }
];

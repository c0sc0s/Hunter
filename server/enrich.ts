import type { ExtractedContent } from "./extract";
import { buildContentSignals } from "./contentSignals";

export type Enrichment = {
  summary: string;
  tags: string[];
  readingMinutes: number;
};

export async function enrichContent(content: ExtractedContent): Promise<Enrichment> {
  return buildContentSignals(content);
}

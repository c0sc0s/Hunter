import { feishuAdapter } from "./feishu";
import { genericWebAdapter } from "./genericWeb";
import { assertExtractedContentContract, sanitizeExtractedContent } from "./extractedContentContract";
import { pdfAdapter } from "./pdf";
import type { ExtractedContent, SourceAdapter, SourceExtractionInput } from "./types";
import { xAdapter } from "./x";

// Video hosts (YouTube/Vimeo/Bilibili/etc.) intentionally have no dedicated
// adapter: genericWebAdapter already mines JSON-LD VideoObject + og:* signals
// and tags sourceType="video" via the URL detector, which gives richer
// description/cover output than a host-specific bypass would.
const adapters: SourceAdapter[] = [feishuAdapter, xAdapter, pdfAdapter, genericWebAdapter];

export async function extractWithSourceAdapter(input: SourceExtractionInput): Promise<ExtractedContent> {
  const adapter = adapters.find((candidate) => candidate.canHandle(input.url)) ?? genericWebAdapter;
  const extracted = await adapter.extract(input);

  if (!extracted) {
    throw new Error(`Source adapter ${adapter.id} did not return content`);
  }

  const sanitized = sanitizeExtractedContent(extracted);
  assertExtractedContentContract(adapter, sanitized);
  return sanitized;
}

export function listSourceAdapters(): Array<Pick<SourceAdapter, "id" | "label">> {
  return adapters.map(({ id, label }) => ({ id, label }));
}

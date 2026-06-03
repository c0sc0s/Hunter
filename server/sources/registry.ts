import { feishuAdapter } from "./feishu";
import { genericWebAdapter } from "./genericWeb";
import { assertExtractedContentContract } from "./extractedContentContract";
import { pdfAdapter } from "./pdf";
import type { ExtractedContent, SourceAdapter, SourceExtractionInput } from "./types";
import { videoAdapter } from "./video";
import { xAdapter } from "./x";

const adapters: SourceAdapter[] = [feishuAdapter, xAdapter, pdfAdapter, videoAdapter, genericWebAdapter];

export async function extractWithSourceAdapter(input: SourceExtractionInput): Promise<ExtractedContent> {
  const adapter = adapters.find((candidate) => candidate.canHandle(input.url)) ?? genericWebAdapter;
  const extracted = await adapter.extract(input);

  if (!extracted) {
    throw new Error(`Source adapter ${adapter.id} did not return content`);
  }

  assertExtractedContentContract(adapter, extracted);
  return extracted;
}

export function listSourceAdapters(): Array<Pick<SourceAdapter, "id" | "label">> {
  return adapters.map(({ id, label }) => ({ id, label }));
}

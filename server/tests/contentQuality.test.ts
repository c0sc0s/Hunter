import assert from "node:assert/strict";
import { decideContentQuality, hasReadySelectedText, shouldRunReadabilityFallback } from "../sources/contentQuality";

const selectedText =
  "Selected text should represent the user's intent when it is substantial enough to stand on its own as captured content.";
const defuddleText =
  "Defuddle extracted a complete article body with enough useful content for a commercial reading inbox to trust the parser result and skip slower fallbacks. ".repeat(
    2
  );
const snapshotText =
  "Navigation Login Pricing Main article body from a logged-in page that still provides useful visible text when public parsing is blocked. ".repeat(
    3
  );

assert.equal(shouldRunReadabilityFallback(selectedText, ""), false);
assert.equal(shouldRunReadabilityFallback("", defuddleText), false);
assert.equal(shouldRunReadabilityFallback("", "Too short"), true);
assert.equal(hasReadySelectedText(selectedText), true);
assert.equal(hasReadySelectedText("Short highlight"), false);

const selectedDecision = decideContentQuality([
  { source: "selected_text", text: selectedText },
  { source: "defuddle", text: defuddleText },
  { source: "browser_snapshot", text: snapshotText }
]);

assert.equal(selectedDecision.candidateSource, "selected_text");
assert.equal(selectedDecision.extractor, "browser_selection");
assert.equal(selectedDecision.extractionState, "ready");
assert.ok(selectedDecision.confidence > 0.7);

const defuddleDecision = decideContentQuality([
  { source: "defuddle", text: defuddleText },
  { source: "browser_snapshot", text: snapshotText }
]);

assert.equal(defuddleDecision.candidateSource, "defuddle");
assert.equal(defuddleDecision.extractor, "defuddle");
assert.equal(defuddleDecision.extractionState, "ready");

const snapshotDecision = decideContentQuality([
  { source: "defuddle", text: "Short parser miss." },
  { source: "browser_snapshot", text: snapshotText }
]);

assert.equal(snapshotDecision.candidateSource, "browser_snapshot");
assert.equal(snapshotDecision.extractor, "browser_snapshot");
assert.equal(snapshotDecision.extractionState, "ready");

const pdfDecision = decideContentQuality([
  { source: "pdf_text", text: "PDF extraction should be treated as a first-class recognition candidate. ".repeat(6) }
]);

assert.equal(pdfDecision.candidateSource, "pdf_text");
assert.equal(pdfDecision.extractor, "unpdf");
assert.equal(pdfDecision.extractionState, "ready");

const metadataDecision = decideContentQuality([{ source: "metadata", text: "A short page description." }]);

assert.equal(metadataDecision.candidateSource, "metadata");
assert.equal(metadataDecision.extractionState, "partial");
assert.match(metadataDecision.sourceMessage ?? "", /shallow page metadata/i);

console.log("content quality fixtures passed");

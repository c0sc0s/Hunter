import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  collectJsonLdTypes,
  extractJsonLdMetadata,
  firstJsonLdImageUrl,
  firstJsonLdText,
  flattenJsonLdNodes,
  parseIsoDurationSeconds,
  pickJsonLdNodeForForm,
  readJsonLdNodes
} from "../sources/jsonLd";

function documentFromHtml(html: string): Document {
  return new JSDOM(html, { url: "https://example.com/" }).window.document;
}

const graphDocument = documentFromHtml(
  `<!doctype html><html><head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "name": "Site shell" },
          { "@type": "VideoObject", "name": "Primary video", "uploadDate": "2026-06-01T00:00:00Z" },
          { "@type": "BlogPosting", "headline": "Companion blog post" }
        ]
      }
    </script>
  </head><body></body></html>`
);

const nodes = readJsonLdNodes(graphDocument);
assert.equal(nodes.length, 4, "@graph children plus the wrapper should be flattened");
assert.deepEqual(
  nodes.flatMap(collectJsonLdTypes),
  ["WebSite", "VideoObject", "BlogPosting"],
  "wrapper node has no @type and is filtered by collectJsonLdTypes"
);

const videoNode = pickJsonLdNodeForForm(nodes, "video");
assert.ok(videoNode, "video form should pick the VideoObject node");
assert.equal(videoNode?.name, "Primary video");

const articleNode = pickJsonLdNodeForForm(nodes, "article");
assert.ok(articleNode, "article form should pick the BlogPosting node");
assert.equal(articleNode?.headline, "Companion blog post");

assert.equal(pickJsonLdNodeForForm(nodes, "audio"), undefined);
assert.equal(pickJsonLdNodeForForm(nodes, "unknown"), undefined);

assert.equal(parseIsoDurationSeconds("PT1H2M30S"), 3750);
assert.equal(parseIsoDurationSeconds("PT45S"), 45);
assert.equal(parseIsoDurationSeconds("PT5M"), 300);
assert.equal(parseIsoDurationSeconds(""), undefined);
assert.equal(parseIsoDurationSeconds("not-a-duration"), undefined);
assert.equal(parseIsoDurationSeconds(undefined), undefined);
assert.equal(parseIsoDurationSeconds("PT0S"), undefined, "zero duration is treated as missing");

const directArrayInput = flattenJsonLdNodes([
  { "@type": "VideoObject", name: "Direct array video" },
  null,
  { "@type": ["VideoObject", "Movie"], name: "Multi-type node" }
]);

assert.equal(directArrayInput.length, 2);
assert.deepEqual(collectJsonLdTypes(directArrayInput[1]), ["VideoObject", "Movie"]);

// firstJsonLdImageUrl: covers the three shapes JSON-LD uses for image refs.
assert.equal(firstJsonLdImageUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
assert.equal(
  firstJsonLdImageUrl(["https://example.com/b.jpg", "https://example.com/c.jpg"]),
  "https://example.com/b.jpg",
  "arrays return the first non-empty entry"
);
assert.equal(firstJsonLdImageUrl({ url: "https://example.com/img.jpg", caption: "x" }), "https://example.com/img.jpg");
assert.equal(
  firstJsonLdImageUrl({ contentUrl: "https://example.com/content.jpg" }),
  "https://example.com/content.jpg",
  "ImageObject contentUrl is honored when url is missing"
);
assert.equal(firstJsonLdImageUrl(undefined), undefined);
assert.equal(firstJsonLdImageUrl(42), undefined, "non-string scalar values are rejected");

// firstJsonLdText: walks bare strings, arrays, and Person/Organization nodes.
assert.equal(firstJsonLdText("Plain Author", "name"), "Plain Author");
assert.equal(firstJsonLdText({ "@type": "Person", name: "Object Author" }, "name"), "Object Author");
assert.equal(
  firstJsonLdText(
    [
      { "@type": "Person", name: "First Author" },
      { "@type": "Person", name: "Second" }
    ],
    "name"
  ),
  "First Author"
);
assert.equal(firstJsonLdText(undefined, "name"), undefined);

// extractJsonLdMetadata picks the form-shaped node before falling back to
// article-shaped, and only surfaces form* fields when a form node matched.
const videoMetadata = extractJsonLdMetadata(graphDocument, "video");
assert.equal(videoMetadata.title, "Primary video");
assert.equal(videoMetadata.formUploadDate, "2026-06-01T00:00:00Z");
assert.equal(videoMetadata.formAuthorName, undefined, "missing author stays undefined, not empty string");

const articleMetadata = extractJsonLdMetadata(graphDocument, "article");
assert.equal(articleMetadata.title, "Companion blog post");
assert.equal(articleMetadata.formUploadDate, undefined, "article form has no upload date concept");

// When neither the form nor the article-shape match, fall back to the first
// node so we still surface a title rather than returning empty metadata.
const productOnlyDocument = documentFromHtml(
  `<!doctype html><html><head>
    <script type="application/ld+json">
      { "@type": "Product", "name": "Lonely product node" }
    </script>
  </head><body></body></html>`
);
assert.equal(extractJsonLdMetadata(productOnlyDocument, "video").title, "Lonely product node");

// Empty document → empty metadata, never throws.
const emptyDocument = documentFromHtml("<!doctype html><html><head></head><body></body></html>");
assert.deepEqual(extractJsonLdMetadata(emptyDocument, "video"), {});

// B站 (and similar publishers) ship VideoObject.description as percent-encoded
// text. The pipeline must decode it before it reaches the saved item, but it
// must NOT eagerly decode strings that happen to contain a literal "%" (e.g.
// "50% off") since that risks throwing or producing garbled output.
const encodedDescriptionDocument = documentFromHtml(
  `<!doctype html><html><head>
    <script type="application/ld+json">
      {
        "@type": "VideoObject",
        "name": "Encoded fixture",
        "description": "%E4%B8%AD%E6%96%87%E7%AE%80%E4%BB%8B"
      }
    </script>
  </head><body></body></html>`
);
const encodedMetadata = extractJsonLdMetadata(encodedDescriptionDocument, "video");
assert.equal(encodedMetadata.description, "中文简介", "percent-encoded UTF-8 must be decoded");
assert.equal(encodedMetadata.formDescription, "中文简介", "formDescription decodes the same way");

const plainDescriptionDocument = documentFromHtml(
  `<!doctype html><html><head>
    <script type="application/ld+json">
      {
        "@type": "VideoObject",
        "name": "Plain text fixture",
        "description": "Pure English description with spaces"
      }
    </script>
  </head><body></body></html>`
);
assert.equal(
  extractJsonLdMetadata(plainDescriptionDocument, "video").description,
  "Pure English description with spaces",
  "natural text with spaces stays untouched (no false-positive decoding)"
);

// YouTube ships VideoObject.description as an empty string because the
// real description is rendered client-side. Bilibili's server-side render
// sometimes ships whitespace-only descriptions for the same reason.
// extractJsonLdMetadata must collapse BOTH to undefined so the genericWeb
// adapter's `??` fallback chain can reach og:description / meta description
// instead of being shadowed by a useless empty value.
for (const [label, rawDescription] of [
  ["empty string (observed on YouTube)", ""],
  ["whitespace-only", "   "]
] as const) {
  const document = documentFromHtml(
    `<!doctype html><html><head>
      <script type="application/ld+json">
        {
          "@type": "VideoObject",
          "name": "Empty-description fixture",
          "description": ${JSON.stringify(rawDescription)}
        }
      </script>
    </head><body></body></html>`
  );
  const metadata = extractJsonLdMetadata(document, "video");
  assert.equal(metadata.description, undefined, `${label}: description must collapse to undefined`);
  assert.equal(metadata.formDescription, undefined, `${label}: formDescription must collapse so og:description can win`);
  assert.equal(metadata.title, "Empty-description fixture", `${label}: non-empty fields are still extracted`);
}

const partialPercentDocument = documentFromHtml(
  `<!doctype html><html><head>
    <script type="application/ld+json">
      {
        "@type": "VideoObject",
        "name": "Percent literal fixture",
        "description": "Saved 50% off the gear list"
      }
    </script>
  </head><body></body></html>`
);
assert.equal(
  extractJsonLdMetadata(partialPercentDocument, "video").description,
  "Saved 50% off the gear list",
  "literal '%' surrounded by spaces must not trigger decoding"
);

console.log("jsonLd fixtures passed");

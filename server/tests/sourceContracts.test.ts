import assert from "node:assert/strict";
import { extractContent } from "../extract";

const originalFetch = globalThis.fetch;
const pdfUrl = "https://example.com/research-field-guide.pdf";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const inputUrl = String(input);
  if (inputUrl.startsWith("https://publish.twitter.com/oembed")) {
    const requestedUrl = new URL(inputUrl).searchParams.get("url") ?? "";
    if (requestedUrl.includes("/status/2222222222")) {
      return Response.json({
        author_name: "Huntter Lab",
        author_url: "https://twitter.com/huntter",
        provider_name: "Twitter",
        html: `<blockquote class="twitter-tweet">
          <p lang="en" dir="ltr">Public X capture should use official oEmbed text when it is available, keeping URL-only saves useful without pretending to sync bookmarks.</p>
          &mdash; Huntter Lab (@huntter)
          <a href="https://twitter.com/huntter/status/2222222222">June 1, 2026</a>
        </blockquote>`
      });
    }
    if (requestedUrl.includes("/status/4444444444")) {
      throw new Error("simulated oEmbed network failure");
    }
    return new Response("{}", { status: 404 });
  }

  if (inputUrl.startsWith("https://www.youtube.com/oembed")) {
    return Response.json({
      title: "Designing a Durable Reading Inbox",
      author_name: "Huntter Lab",
      provider_name: "YouTube",
      thumbnail_url: "https://i.ytimg.com/vi/demo/hqdefault.jpg"
    });
  }

  if (inputUrl.startsWith("https://vimeo.com/api/oembed.json")) {
    return Response.json({
      title: "Focused Capture Demo",
      author_name: "Huntter",
      provider_name: "Vimeo",
      thumbnail_url: "https://i.vimeocdn.com/video/demo.jpg"
    });
  }

  if (inputUrl === pdfUrl) {
    return new Response(
      buildPdfFixture(
        Array.from(
          { length: 8 },
          (_, index) => `Huntter PDF recognition line ${index + 1} captures durable source text for saved research papers.`
        )
      ),
      {
        headers: {
          "content-type": "application/pdf"
        }
      }
    );
  }

  return originalFetch(input, init);
}) as typeof fetch;

try {
  const feishuUrl = "https://bytedance.larkoffice.com/wiki/SjaPwstMjiA2f4khXz1cX6vFnLg";
  const feishuUrlOnly = await extractContent({ url: feishuUrl });

  assert.equal(feishuUrlOnly.sourceType, "feishu");
  assert.equal(feishuUrlOnly.extractionState, "needs_connector");
  assert.equal(feishuUrlOnly.sourceAccess, "connector_required");
  assert.equal(feishuUrlOnly.requiredConnector, "feishu");
  assert.match(feishuUrlOnly.sourceMessage ?? "", /connect|extension|permissions/i);

  const feishuSnapshot = await extractContent({
    url: feishuUrl,
    snapshot: {
      url: feishuUrl,
      title: "Harness Engineering Notes",
      siteName: "Feishu",
      textContent:
        "Harness Engineering Notes explain why source adapters need honest states, visible evidence, and connector boundaries for private documents."
    }
  });

  assert.equal(feishuSnapshot.extractionState, "partial");
  assert.equal(feishuSnapshot.captureMethod, "extension_snapshot");
  assert.equal(feishuSnapshot.sourceAccess, "browser_snapshot");
  assert.match(feishuSnapshot.sourceMessage ?? "", /visible Feishu content/i);

  const feishuLongSnapshot = await extractContent({
    url: feishuUrl,
    snapshot: {
      url: feishuUrl,
      title: "Feishu Private Product Review",
      siteName: "Feishu",
      html: `<!doctype html>
        <html>
          <body>
            <main>
              <h1>Feishu Private Product Review</h1>
              <p>Permissioned Feishu content captured through the browser extension should become usable canonical content when enough visible text is present.</p>
              <p onclick="alert(1)">The source adapter still records browser snapshot provenance, but it should not pretend that a native block import happened.</p>
              <script>alert("unsafe")</script>
            </main>
          </body>
        </html>`,
      textContent:
        "Feishu Private Product Review Permissioned Feishu content captured through the browser extension should become usable canonical content when enough visible text is present. The source adapter still records browser snapshot provenance, but it should not pretend that a native block import happened. This keeps private documents searchable and readable while leaving exact blocks, attachments, and permission sync to the future connector.",
      imageCandidates: ["https://example.com/feishu-cover.png"]
    }
  });

  assert.equal(feishuLongSnapshot.extractionState, "ready");
  assert.equal(feishuLongSnapshot.extractor, "browser_snapshot");
  assert.equal(feishuLongSnapshot.sourceAccess, "browser_snapshot");
  assert.match(feishuLongSnapshot.contentHtml ?? "", /Feishu Private Product Review/);
  assert.doesNotMatch(feishuLongSnapshot.contentHtml ?? "", /<script|onclick/i);
  assert.equal(feishuLongSnapshot.coverImage, "https://example.com/feishu-cover.png");

  const xOembed = await extractContent({ url: "https://x.com/huntter/status/2222222222" });

  assert.equal(xOembed.sourceType, "tweet");
  assert.equal(xOembed.extractor, "oembed");
  assert.equal(xOembed.extractionState, "ready");
  assert.equal(xOembed.captureMethod, "source_adapter");
  assert.equal(xOembed.sourceAccess, "public");
  assert.match(xOembed.readableText, /official oEmbed text/);
  assert.match(xOembed.contentHtml ?? "", /official oEmbed text/);

  const xUrl = "https://x.com/huntter/status/1234567890";
  const xSelectedText = await extractContent({
    url: xUrl,
    snapshot: {
      url: xUrl,
      selectedText: "A useful source-first capture reminder for private content."
    }
  });

  assert.equal(xSelectedText.sourceType, "tweet");
  assert.equal(xSelectedText.extractionState, "partial");
  assert.equal(xSelectedText.captureMethod, "extension_snapshot");
  assert.equal(xSelectedText.sourceAccess, "browser_snapshot");
  assert.equal(xSelectedText.extractor, "browser_selection");
  assert.match(xSelectedText.contentHtml ?? "", /source-first capture reminder/);

  const xSnapshot = await extractContent({
    url: "https://x.com/huntter/status/3333333333",
    snapshot: {
      url: "https://x.com/huntter/status/3333333333",
      title: "Huntter Lab on X",
      html: `<!doctype html>
        <html>
          <body>
            <article>
              <div data-testid="User-Name">Huntter Lab @huntter</div>
              <div data-testid="tweetText">Browser snapshot capture for an opened X post should keep the visible post text, sanitize the captured HTML, and disclose that thread expansion still needs the future X connector.</div>
              <time datetime="2026-06-02T08:30:00.000Z">Jun 2</time>
              <img src="https://pbs.twimg.com/media/demo.jpg" />
              <button onclick="alert(1)">Reply</button>
              <script>alert("unsafe")</script>
            </article>
          </body>
        </html>`,
      textContent:
        "Home For you Following Browser snapshot capture for an opened X post should keep the visible post text, sanitize the captured HTML, and disclose that thread expansion still needs the future X connector. Reply Repost Like",
      imageCandidates: ["https://pbs.twimg.com/media/demo.jpg"]
    }
  });

  assert.equal(xSnapshot.extractionState, "ready");
  assert.equal(xSnapshot.extractor, "browser_snapshot");
  assert.equal(xSnapshot.sourceAccess, "browser_snapshot");
  assert.match(xSnapshot.readableText, /visible post text/);
  assert.match(xSnapshot.contentHtml ?? "", /visible post text/);
  assert.doesNotMatch(xSnapshot.contentHtml ?? "", /<script|onclick/i);
  assert.equal(xSnapshot.coverImage, "https://pbs.twimg.com/media/demo.jpg");
  assert.equal(xSnapshot.publishedAt, "2026-06-02T08:30:00.000Z");

  const xOembedFailure = await extractContent({ url: "https://x.com/huntter/status/4444444444" });

  assert.equal(xOembedFailure.sourceType, "tweet");
  assert.equal(xOembedFailure.extractionState, "needs_connector");
  assert.equal(xOembedFailure.requiredConnector, "x");

  const xUrlOnly = await extractContent({ url: xUrl });

  assert.equal(xUrlOnly.sourceType, "tweet");
  assert.equal(xUrlOnly.extractionState, "needs_connector");
  assert.equal(xUrlOnly.sourceAccess, "connector_required");
  assert.equal(xUrlOnly.requiredConnector, "x");

  const shallowUrl = "https://example.com/metadata-only";
  const shallowMetadata = await extractContent({
    url: shallowUrl,
    snapshot: {
      url: shallowUrl,
      html: `<!doctype html>
        <html>
          <head>
            <title>Metadata only page</title>
            <meta name="description" content="A short metadata-only description that should not be treated as full content." />
          </head>
          <body></body>
        </html>`
    }
  });

  assert.equal(shallowMetadata.extractor, "metadata");
  assert.equal(shallowMetadata.extractionState, "partial");
  assert.equal(shallowMetadata.sourceType, "article");

  const pdf = await extractContent({ url: pdfUrl });

  assert.equal(pdf.sourceType, "pdf");
  assert.equal(pdf.extractor, "unpdf");
  assert.equal(pdf.extractionState, "ready");
  assert.equal(pdf.captureMethod, "url_fetch");
  assert.match(pdf.title, /research field guide/i);
  assert.match(pdf.readableText, /durable source text/);
  assert.match(pdf.sourceMessage ?? "", /PDF page/i);

  const youtube = await extractContent({ url: "https://www.youtube.com/watch?v=demo" });

  assert.equal(youtube.sourceType, "video");
  assert.equal(youtube.extractor, "oembed");
  assert.equal(youtube.extractionState, "partial");
  assert.equal(youtube.sourceAccess, "public");
  assert.equal(youtube.title, "Designing a Durable Reading Inbox");
  assert.equal(youtube.sourceName, "YouTube");
  assert.equal(youtube.author, "Huntter Lab");
  assert.equal(youtube.coverImage, "https://i.ytimg.com/vi/demo/hqdefault.jpg");
  assert.match(youtube.sourceMessage ?? "", /Transcripts and comments/i);

  const vimeo = await extractContent({ url: "https://vimeo.com/123456789" });

  assert.equal(vimeo.sourceType, "video");
  assert.equal(vimeo.extractor, "oembed");
  assert.equal(vimeo.title, "Focused Capture Demo");
  assert.equal(vimeo.sourceName, "Vimeo");

  console.log("source contract fixtures passed");
} finally {
  globalThis.fetch = originalFetch;
}

function buildPdfFixture(lines: string[]): ArrayBuffer {
  const offsets: number[] = [];
  let output = "%PDF-1.4\n";
  const addObject = (object: string) => {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${object}\n`;
  };

  addObject("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  addObject("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  addObject(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj"
  );
  addObject("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");

  const stream = lines
    .map((line, index) => {
      const escaped = line.replace(/[\\()]/g, (match) => `\\${match}`);
      return `BT /F1 12 Tf 72 ${720 - index * 24} Td (${escaped}) Tj ET`;
    })
    .join("\n");
  addObject(`5 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`);

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const buffer = Buffer.from(output, "utf8");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

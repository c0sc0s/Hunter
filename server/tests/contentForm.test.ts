import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { detectContentForm } from "../sources/contentForm";

function documentFromHtml(html: string): Document {
  return new JSDOM(html, { url: "https://example.com/" }).window.document;
}

const ogVideoOnly = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:title" content="Source-first content recognition" />
    </head><body></body></html>`
  )
);

assert.equal(ogVideoOnly.form, "video");
assert.ok(ogVideoOnly.confidence >= 0.5);
assert.ok(ogVideoOnly.signals.some((signal) => signal.source === "og_type" && signal.value === "video.other"));

const jsonLdVideoObject = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "VideoObject", "name": "Demo" }
      </script>
    </head><body></body></html>`
  )
);

assert.equal(jsonLdVideoObject.form, "video");
assert.ok(jsonLdVideoObject.signals.some((signal) => signal.source === "json_ld" && signal.value === "VideoObject"));

const bilibiliShaped = detectContentForm(
  documentFromHtml(
    `<!doctype html><html lang="zh-CN"><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:site_name" content="哔哩哔哩" />
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "VideoObject", "name": "源优先的内容识别" }
      </script>
    </head><body><video src="//example.com/v.mp4"></video></body></html>`
  )
);

assert.equal(bilibiliShaped.form, "video");
assert.ok(bilibiliShaped.confidence >= 0.7);

const podcast = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <meta property="og:type" content="music.song" />
      <script type="application/ld+json">
        { "@type": "PodcastEpisode", "name": "Episode 7" }
      </script>
    </head><body></body></html>`
  )
);

assert.equal(podcast.form, "audio");

const article = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <meta property="og:type" content="article" />
      <script type="application/ld+json">
        { "@type": "NewsArticle", "headline": "Reading inbox design" }
      </script>
    </head><body></body></html>`
  )
);

assert.equal(article.form, "article");

const articleEmbedsVideo = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <meta property="og:type" content="article" />
      <script type="application/ld+json">
        { "@type": "BlogPosting", "headline": "Why I switched cameras" }
      </script>
    </head><body><video src="hands-on.mp4"></video></body></html>`
  )
);

// An article that merely embeds <video> should remain article, not promoted to video.
assert.equal(articleEmbedsVideo.form, "article");

const oembedDiscovery = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <link rel="alternate" type="application/json+oembed" href="https://example.com/oembed?url=demo" />
    </head><body></body></html>`
  )
);

assert.equal(oembedDiscovery.oembedDiscoveryUrl, "https://example.com/oembed?url=demo");
// oEmbed discovery alone is not enough to commit to a form.
assert.equal(oembedDiscovery.form, "unknown");

const unknown = detectContentForm(documentFromHtml(`<!doctype html><html><body><p>Hello</p></body></html>`));
assert.equal(unknown.form, "unknown");
assert.equal(unknown.confidence, 0);

const product = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <script type="application/ld+json">
        { "@type": "Product", "name": "Reader" }
      </script>
    </head><body></body></html>`
  )
);

assert.equal(product.form, "product");

const discussion = detectContentForm(
  documentFromHtml(
    `<!doctype html><html><head>
      <script type="application/ld+json">
        { "@type": "DiscussionForumPosting", "headline": "Best capture flow?" }
      </script>
    </head><body></body></html>`
  )
);

assert.equal(discussion.form, "discussion");

console.log("content form fixtures passed");

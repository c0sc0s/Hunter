import assert from "node:assert/strict";
import { buildContentSignals } from "../contentSignals";
import type { ExtractedContent } from "../extract";

const content = {
  url: "https://example.com/research/durable-reading-inbox",
  canonicalUrl: "https://example.com/research/durable-reading-inbox",
  title: "Designing a Durable Reading Inbox",
  sourceName: "Example Research",
  sourceType: "article",
  excerpt: "A noisy excerpt should not beat the first real paragraph.",
  readableText:
    "Home Pricing Login Subscribe. A commercial reading inbox has to capture user intent before it thinks about organization. Durable content recognition keeps provenance, source quality, and reader structure available for later search. Related posts and ads.",
  contentHtml: `
    <article>
      <h1>Designing a Durable Reading Inbox</h1>
      <p>A commercial reading inbox has to capture user intent before it thinks about organization. Durable content recognition keeps provenance, source quality, and reader structure available for later search.</p>
      <p>Parser upgrades should preserve workflow state while comparing canonical content hashes.</p>
    </article>
  `,
  confidence: 0.9,
  extractionState: "ready",
  captureMethod: "extension_snapshot",
  sourceAccess: "browser_snapshot"
} satisfies ExtractedContent;

const signals = buildContentSignals(content);

assert.match(signals.summary, /commercial reading inbox/);
assert.doesNotMatch(signals.summary, /Home Pricing Login/);
assert.ok(signals.tags.includes("article"));
assert.ok(signals.tags.includes("durable"));
assert.ok(signals.tags.includes("reading"));
assert.equal(signals.tags.includes("login"), false);
assert.equal(signals.tags.includes("example"), false);
assert.ok(signals.readingMinutes >= 1);

const cjkSignals = buildContentSignals({
  ...content,
  url: "https://example.cn/post",
  title: "飞书 私有 文档 捕获",
  readableText: "登录 注册 点击 查看 飞书文档捕获需要保留可见正文和权限边界，内容识别应该明确来源质量。",
  contentHtml: "<p>飞书文档捕获需要保留可见正文和权限边界，内容识别应该明确来源质量。</p>"
});

assert.match(cjkSignals.summary, /飞书文档捕获/);
assert.ok(cjkSignals.tags.some((tag) => /飞书|文档|捕获/.test(tag)));
assert.equal(cjkSignals.tags.includes("登录"), false);

console.log("content signals fixtures passed");

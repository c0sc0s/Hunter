// Pure URL rewriting helpers shared by the server (capture-time normalization
// in `selectCoverImage`) and the web client (defense-in-depth at render time,
// so library items captured before this rewrite landed still display crisp
// covers without a database migration).
//
// Keep this module dependency-free and side-effect-free so it can be imported
// from both Node and browser bundles.
//
// A hand-synced copy lives in `extension/src/coverPreview.js` because popup.js
// runs as a browser ES module with no bundler step and cannot import .ts at
// runtime. Drift is caught by the parity test in
// `extension/tests/coverPreview.test.ts`; when this file changes, update the
// extension copy and extend that fixture list.

const BILIBILI_CDN_HOST_PATTERN = /(^|\.)hdslb\.com$/i;
const BILIBILI_RESIZE_DIRECTIVE_PATTERN = /@([^/]+)$/;
const BILIBILI_CANONICAL_RESIZE = "@1280w.webp";
const BILIBILI_RESIZE_WIDTH_PATTERN = /(\d+)w/;
const BILIBILI_CANONICAL_RESIZE_MIN_WIDTH = 1280;

// B站 (i*.hdslb.com) encodes an on-the-fly resize directive after `@` in the
// path (e.g. `@100w_100h_1c.png`, `@189w_107h.webp`). The og:image and
// VideoObject.thumbnailUrl that ship with B站 pages point at these tiny
// thumbnails — fine for SEO snippets, blurry as a Hunter card cover. The
// CDN accepts arbitrary `@<W>w.<ext>` directives, so we rewrite any hdslb
// resize directive to a single canonical size that looks crisp on retina
// list cards and detail panels alike while staying ~100KB. We keep the
// original directive when the source already requested a higher resolution
// so we never downgrade quality.
export function upgradeCdnCoverResolution(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  if (!BILIBILI_CDN_HOST_PATTERN.test(parsed.hostname)) return input;
  const match = BILIBILI_RESIZE_DIRECTIVE_PATTERN.exec(parsed.pathname);
  if (!match) return input;
  const widthMatch = BILIBILI_RESIZE_WIDTH_PATTERN.exec(match[1]);
  if (widthMatch && Number(widthMatch[1]) >= BILIBILI_CANONICAL_RESIZE_MIN_WIDTH) return input;
  parsed.pathname = parsed.pathname.replace(BILIBILI_RESIZE_DIRECTIVE_PATTERN, BILIBILI_CANONICAL_RESIZE);
  return parsed.toString();
}

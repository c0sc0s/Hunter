/**
 * Lightweight page-form detector for the extension entry points.
 *
 * This is intentionally a preflight gate, not the final recognizer. The API
 * still owns canonical sourceType assignment after it receives the browser
 * snapshot. The extension uses this detector only to decide whether opening the
 * save form is useful for the current resource.
 */

export const CONTENT_SUPPORT_GATE_ENABLED = false;

export function detectSupportedResourceInPage() {
  const url = String(location.href || "");
  const parsedUrl = safeUrl(url);
  if (!parsedUrl || !/^https?:$/.test(parsedUrl.protocol)) {
    return unsupported("unsupported_protocol", []);
  }
  if (parsedUrl.pathname.toLowerCase().endsWith(".pdf")) {
    return unsupported("pdf_not_supported_by_extension_gate", []);
  }
  const routeSupport = detectSourceRouteSupport(parsedUrl);
  if (routeSupport) return routeSupport;

  return detectGenericContentSupport(parsedUrl);

  // Keep helpers nested: chrome.scripting.executeScript serializes only this
  // function body when injecting the detector into the captured tab.
  function detectSourceRouteSupport(parsed) {
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return undefined;

    if (/^\/[^/]+\/status\/\d+(?:\/|$)/.test(path)) {
      return {
        supported: true,
        kind: "post",
        confidence: 0.9,
        signals: [{ source: "x_status_url", value: host }]
      };
    }

    if (/^\/i\/article\/\d+(?:\/|$)/.test(path)) {
      return {
        supported: true,
        kind: "article",
        confidence: 0.9,
        signals: [{ source: "x_article_url", value: host }]
      };
    }

    return {
      supported: false,
      kind: "unsupported",
      confidence: 0,
      reason: "unsupported_x_route",
      signals: [{ source: "x_route", value: path || "/" }]
    };
  }

  function detectGenericContentSupport(parsed) {
    const signals = [];
    const scores = emptyScores();

    recordUrlHints(parsed, signals, scores);
    recordOgType(signals, scores);
    recordTwitterCard(signals, scores);
    recordJsonLdTypes(signals, scores);
    recordOembedLink(signals);
    recordVideoElements(signals, scores);
    recordSelectedText(signals, scores);
    recordArticleStructure(signals, scores);

    return decideGenericSupport(scores, signals);
  }

  function emptyScores() {
    return {
      article: 0,
      video: 0,
      audio: 0,
      discussion: 0,
      product: 0,
      image: 0
    };
  }

  function decideGenericSupport(scores, signals) {
    const ranked = Object.entries(scores).sort(([, a], [, b]) => b - a);
    const [form, score] = ranked[0] || ["unknown", 0];
    const [unsupportedForm, unsupportedScore] = Object.entries(scores)
      .filter(([candidate]) => candidate !== "article" && candidate !== "video")
      .sort(([, a], [, b]) => b - a)[0] || ["unknown", 0];

    if (unsupportedScore >= 0.6 && score - unsupportedScore < 0.2) {
      return {
        supported: false,
        kind: unsupportedForm,
        confidence: Math.min(1, unsupportedScore),
        reason: "unsupported_resource_type",
        signals
      };
    }

    if ((form === "article" || form === "video") && score >= 0.5) {
      return {
        supported: true,
        kind: form,
        confidence: Math.min(1, score),
        signals
      };
    }

    return {
      supported: false,
      kind: score >= 0.5 && form !== "unknown" ? form : "unsupported",
      confidence: score >= 0.5 ? Math.min(1, score) : 0,
      reason: "unsupported_resource_type",
      signals
    };
  }

  function recordUrlHints(parsed, collectedSignals, collectedScores) {
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (isYouTubeVideoUrl(host, parsed) || isVimeoVideoUrl(host, path)) {
      addScore(collectedScores, "video", 0.55);
      collectedSignals.push({ source: "url_video_host", value: host });
      return;
    }
    if ((host === "bilibili.com" || host.endsWith(".bilibili.com")) && path.includes("/video/")) {
      // B站 normally exposes VideoObject/og:type as well. Keep the URL hint
      // below the decide threshold so metadata still has to confirm the shape.
      addScore(collectedScores, "video", 0.35);
      collectedSignals.push({ source: "url_video_path", value: host });
    }
  }

  function isYouTubeVideoUrl(host, parsed) {
    const path = parsed.pathname.toLowerCase();
    if (host === "youtu.be") return path.length > 1;
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return false;
    return (
      (path === "/watch" && parsed.searchParams.has("v")) ||
      path.startsWith("/shorts/") ||
      path.startsWith("/embed/") ||
      path.startsWith("/live/")
    );
  }

  function isVimeoVideoUrl(host, path) {
    if (host === "player.vimeo.com") return /^\/video\/\d+(?:\/|$)/.test(path);
    if (host !== "vimeo.com" && !host.endsWith(".vimeo.com")) return false;
    return /^\/(?:\d+|video\/\d+)(?:\/|$)/.test(path);
  }

  function recordOgType(collectedSignals, collectedScores) {
    const value = metaContent('meta[property="og:type"]');
    if (!value) return;
    collectedSignals.push({ source: "og_type", value });

    if (value.startsWith("video")) {
      addScore(collectedScores, "video", 0.7);
      return;
    }
    if (value.startsWith("music") || value.startsWith("audio")) {
      addScore(collectedScores, "audio", 0.7);
      return;
    }
    if (value === "article") {
      addScore(collectedScores, "article", 0.5);
      return;
    }
    if (value === "product") {
      addScore(collectedScores, "product", 0.6);
    }
  }

  function recordTwitterCard(collectedSignals, collectedScores) {
    const value = metaContent('meta[name="twitter:card"]');
    if (!value) return;
    collectedSignals.push({ source: "twitter_card", value });
    if (value === "player") addScore(collectedScores, "video", 0.4);
  }

  function recordJsonLdTypes(collectedSignals, collectedScores) {
    for (const node of readJsonLdNodes()) {
      for (const type of collectJsonLdTypes(node)) {
        collectedSignals.push({ source: "json_ld", value: type });
        const form = matchJsonLdFormType(type);
        if (!form) continue;
        addScore(collectedScores, form, jsonLdScore(form));
      }
    }
  }

  function recordOembedLink(collectedSignals) {
    const link = document.querySelector('link[type="application/json+oembed"]') || document.querySelector('link[type="text/xml+oembed"]');
    const href = link?.getAttribute("href")?.trim();
    if (href) collectedSignals.push({ source: "oembed_link", value: href });
  }

  function recordVideoElements(collectedSignals, collectedScores) {
    const count = document.querySelectorAll("video").length;
    if (count === 0) return;
    collectedSignals.push({ source: "video_element", value: String(count) });
    // Tiebreaker only; articles often embed a video player.
    addScore(collectedScores, "video", 0.2);
  }

  function recordSelectedText(collectedSignals, collectedScores) {
    const selectedText = typeof window === "undefined" ? "" : cleanText(window.getSelection?.().toString?.());
    if (selectedText.length < 160) return;
    collectedSignals.push({ source: "selected_text", value: String(selectedText.length) });
    addScore(collectedScores, "article", 0.6);
  }

  function recordArticleStructure(collectedSignals, collectedScores) {
    const root = bestArticleRoot();
    const articleTextLength = cleanText(root?.innerText || root?.textContent).length;
    const articleParagraphs = root?.querySelectorAll?.("p, li, blockquote, pre").length || 0;
    if (articleTextLength >= 320 && articleParagraphs >= 2) {
      addScore(collectedScores, "article", 0.65);
      collectedSignals.push({ source: "article_root", value: `${articleTextLength}:${articleParagraphs}` });
      return;
    }

    const mainRoot = document.querySelector("main, [role='main'], #main");
    const mainTextLength = cleanText(mainRoot?.innerText || mainRoot?.textContent).length;
    const mainParagraphs = mainRoot?.querySelectorAll?.("p, li, blockquote, pre").length || 0;
    const hasHeading = Boolean(mainRoot?.querySelector?.("h1, h2"));
    if (mainTextLength >= 600 && mainParagraphs >= 3 && hasHeading) {
      addScore(collectedScores, "article", 0.55);
      collectedSignals.push({ source: "main_text", value: `${mainTextLength}:${mainParagraphs}` });
    }
  }

  function bestArticleRoot() {
    const candidates = Array.from(document.querySelectorAll(contentRootSelector()));
    return candidates.map((element) => ({ element, score: scoreContentRoot(element) })).sort((a, b) => b.score - a.score)[0]?.element;
  }

  function contentRootSelector() {
    return [
      "article",
      "main",
      "[role='main']",
      "[itemprop='articleBody']",
      ".article",
      ".article-content",
      ".content",
      ".entry-content",
      ".markdown-body",
      ".post",
      ".post-content",
      ".prose",
      "#article",
      "#content",
      "#main"
    ].join(",");
  }

  function scoreContentRoot(element) {
    const textLength = cleanText(element?.innerText || element?.textContent).length;
    const paragraphCount = element.querySelectorAll?.("p, li, blockquote, pre").length || 0;
    const imageCount = element.querySelectorAll?.("img").length || 0;
    const tagName = element.tagName?.toLowerCase();
    const role = element.getAttribute?.("role") || "";
    const classAndId = `${element.id || ""} ${element.className || ""}`.toLowerCase();
    const structuralPenalty = /nav|menu|sidebar|footer|header|comment|cookie|subscribe|modal/.test(`${tagName} ${role} ${classAndId}`)
      ? 400
      : 0;

    return textLength + paragraphCount * 80 + imageCount * 40 - structuralPenalty;
  }

  function readJsonLdNodes() {
    const nodes = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const text = script.textContent;
      if (!text) continue;
      try {
        nodes.push(...flattenJsonLdNodes(JSON.parse(text)));
      } catch {
        continue;
      }
    }
    return nodes;
  }

  function flattenJsonLdNodes(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(flattenJsonLdNodes);
    if (typeof value !== "object") return [];
    return [value, ...flattenJsonLdNodes(value["@graph"])];
  }

  function collectJsonLdTypes(node) {
    const type = node?.["@type"];
    if (typeof type === "string") return [type];
    if (Array.isArray(type)) return type.filter((value) => typeof value === "string");
    return [];
  }

  function matchJsonLdFormType(type) {
    if (/^(videoobject|movie|tvepisode|episode|musicvideoobject)$/i.test(type)) return "video";
    if (/^(audioobject|podcastepisode|musicrecording|musicalbum|radioseries)$/i.test(type)) return "audio";
    if (/^(article|newsarticle|blogposting|techarticle|report|opinionnewsarticle)$/i.test(type)) return "article";
    if (/^(discussionforumposting|qapage|socialmediaposting)$/i.test(type)) return "discussion";
    if (/^product$/i.test(type)) return "product";
    if (/^imageobject$/i.test(type)) return "image";
    return undefined;
  }

  function jsonLdScore(form) {
    return {
      video: 0.8,
      audio: 0.7,
      article: 0.5,
      discussion: 0.6,
      product: 0.6,
      image: 0.4
    }[form];
  }

  function metaContent(selector) {
    const raw = document.querySelector(selector)?.getAttribute("content")?.trim().toLowerCase();
    return raw && raw.length > 0 ? raw : undefined;
  }

  function addScore(collectedScores, form, delta) {
    collectedScores[form] = (collectedScores[form] || 0) + delta;
  }

  function safeUrl(value) {
    try {
      return new URL(value);
    } catch {
      return undefined;
    }
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unsupported(reason, collectedSignals) {
    return {
      supported: false,
      kind: "unsupported",
      confidence: 0,
      reason,
      signals: collectedSignals
    };
  }
}

(() => {
  window.__huntterExtractPageSnapshot = () => {
    const captureLimits = {
      title: 500,
      snapshotHtml: 180000,
      snapshotText: 120000,
      selectedText: 40000,
      excerpt: 4000,
      siteName: 300,
      favicon: 2000,
      publishedAt: 200,
      imageCandidates: 16,
      imageCandidateUrl: 2000
    };
    const meta = (selector) => document.querySelector(selector)?.content?.trim();
    const link = (selector) => document.querySelector(selector)?.href?.trim();
    const absolutize = (value) => {
      if (!value) return undefined;
      try {
        return new URL(value, location.href).toString();
      } catch {
        return undefined;
      }
    };
    const cleanText = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const selectedText = truncate(cleanText(window.getSelection?.()), captureLimits.selectedText);
    const contentRoot = pickContentRoot();
    const rootText = textOf(contentRoot);
    const bodyText = textOf(document.body);
    const textContent = truncate(
      rootText.length >= 120 || bodyText.length > captureLimits.snapshotHtml ? rootText : bodyText,
      captureLimits.snapshotText
    );
    const imageCandidates = new Set();

    [
      meta('meta[property="og:image"]'),
      meta('meta[name="twitter:image"]'),
      ...imageSources(contentRoot),
      ...Array.from(document.images)
        .filter((image) => image.naturalWidth >= 240 || image.width >= 240)
        .slice(0, 18)
        .map((image) => image.currentSrc || image.src || image.getAttribute("data-src"))
    ].forEach((image) => {
      const absolute = absolutize(image);
      if (absolute && !absolute.startsWith("data:")) imageCandidates.add(absolute);
    });

    const html = truncate(serializeFocusedHtml(contentRoot), captureLimits.snapshotHtml);
    const excerpt =
      meta('meta[property="og:description"]') ||
      meta('meta[name="twitter:description"]') ||
      meta('meta[name="description"]') ||
      textContent?.slice(0, 420);

    return {
      url: location.href,
      canonicalUrl: absolutize(link('link[rel="canonical"]') || meta('meta[property="og:url"]')),
      title: truncate(document.title || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]'), captureLimits.title),
      html,
      textContent,
      selectedText: selectedText || undefined,
      excerpt: truncate(excerpt, captureLimits.excerpt),
      siteName: truncate(meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, ""), captureLimits.siteName),
      favicon: truncate(absolutize(link('link[rel="icon"]') || link('link[rel="shortcut icon"]')), captureLimits.favicon),
      imageCandidates: [...imageCandidates]
        .slice(0, captureLimits.imageCandidates)
        .map((image) => truncate(image, captureLimits.imageCandidateUrl))
        .filter(Boolean),
      publishedAt: truncate(meta('meta[property="article:published_time"]') || meta('meta[name="date"]'), captureLimits.publishedAt)
    };

    function pickContentRoot() {
      const selectionRoot = selectionContainer();
      const selectionMainRoot = selectionRoot?.closest?.(contentRootSelector());
      const candidates = [selectionMainRoot, ...document.querySelectorAll(contentRootSelector())].filter(Boolean);
      const uniqueCandidates = [...new Set(candidates)];
      const scored = uniqueCandidates.map((element) => ({ element, score: scoreContentRoot(element) })).sort((a, b) => b.score - a.score);

      return scored[0]?.score >= 160 ? scored[0].element : document.body || document.documentElement;
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
      const textLength = textOf(element).length;
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

    function selectionContainer() {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0) return undefined;
      const node = selection.getRangeAt(0).commonAncestorContainer;
      return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    }

    function imageSources(root) {
      return Array.from(root?.querySelectorAll?.("img") || [])
        .filter((image) => image.naturalWidth >= 180 || image.width >= 180)
        .slice(0, 18)
        .map((image) => image.currentSrc || image.src || image.getAttribute("data-src"));
    }

    function serializeFocusedHtml(root) {
      const headHtml = Array.from(
        document.head?.querySelectorAll(
          [
            "title",
            "meta[name='description']",
            "meta[name='author']",
            "meta[name='date']",
            "meta[property^='og:']",
            "meta[name^='twitter:']",
            "meta[property='article:published_time']",
            "link[rel='canonical']",
            "link[rel='icon']",
            "link[rel='shortcut icon']",
            "script[type='application/ld+json']"
          ].join(",")
        ) || []
      )
        .map((element) => element.outerHTML)
        .join("");
      const rootHtml = root === document.body ? root.innerHTML : root.outerHTML;

      return `<!doctype html><html><head>${headHtml}</head><body>${rootHtml}</body></html>`;
    }

    function textOf(element) {
      return cleanText(element?.innerText || element?.textContent);
    }

    function truncate(value, limit) {
      if (!value) return undefined;
      return value.length > limit ? value.slice(0, limit) : value;
    }
  };
})();

(() => {
  window.__hunterExtractPageSnapshot = () => {
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
    // Minimum focused-root text length before we'll prefer it over the body.
    const minFocusedTextChars = 120;
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
    const httpUrl = (value) => {
      const absolute = absolutize(value);
      if (!absolute) return undefined;
      return /^https?:\/\//i.test(absolute) ? absolute : undefined;
    };
    const cleanText = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const selectedText = truncate(cleanText(window.getSelection?.()), captureLimits.selectedText);
    const contentRoot = pickContentRoot();
    const rootText = textOf(contentRoot);
    const bodyText = textOf(document.body);
    // Prefer the focused root only when it carries enough text on its own; fall
    // back to body text whenever the focused root is shorter than the minimum.
    const textContent = truncate(rootText.length >= minFocusedTextChars ? rootText : bodyText, captureLimits.snapshotText);
    const imageCandidates = collectImageCandidates(contentRoot);

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
      favicon: truncate(httpUrl(link('link[rel="icon"]') || link('link[rel="shortcut icon"]')), captureLimits.favicon),
      imageCandidates: imageCandidates
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

    function collectImageCandidates(root) {
      const candidates = new Map();
      let order = 0;
      const add = (value, score) => {
        for (const source of expandImageSource(value)) {
          const absolute = absolutize(source);
          if (!absolute || absolute.startsWith("data:")) continue;
          const ranked = {
            url: absolute,
            score: score + scoreImageUrl(absolute),
            order: order++
          };
          const existing = candidates.get(absolute);
          if (!existing || ranked.score > existing.score || (ranked.score === existing.score && ranked.order < existing.order)) {
            candidates.set(absolute, ranked);
          }
        }
      };

      add(meta('meta[property="og:image"]'), 900);
      add(meta('meta[property="og:image:url"]'), 895);
      add(meta('meta[property="og:image:secure_url"]'), 895);
      add(meta('meta[name="twitter:image"]'), 880);
      add(meta('meta[name="twitter:image:src"]'), 880);

      imageEntries(root, 620).forEach((entry) => add(entry.value, entry.score));
      backgroundEntries(root, 590).forEach((entry) => add(entry.value, entry.score));
      imageEntries(document.body, 360).forEach((entry) => add(entry.value, entry.score));
      backgroundEntries(document.body, 340).forEach((entry) => add(entry.value, entry.score));

      return [...candidates.values()].sort((a, b) => b.score - a.score || a.order - b.order).map((candidate) => candidate.url);
    }

    function imageEntries(root, baseScore) {
      const images = Array.from(root?.querySelectorAll?.("img, picture source") || []).slice(0, 120);
      return images.flatMap((element) => {
        const width = imageWidth(element);
        const height = imageHeight(element);
        const hasSrcset = Boolean(element.srcset || element.getAttribute?.("srcset") || element.getAttribute?.("data-srcset"));
        const looksLikeMedia = /(^|\.)twimg\.com\/media\//i.test(
          `${element.currentSrc || ""} ${element.src || ""} ${element.getAttribute?.("src") || ""} ${element.getAttribute?.("srcset") || ""}`
        );
        if (!looksLikeMedia && !hasSrcset && width < 120 && height < 120) return [];
        const score = baseScore + Math.min(220, Math.round((Math.max(width, 1) * Math.max(height, 1)) / 1800)) + elementImageBonus(element);
        return imageSourceValues(element).map((value) => ({ value, score }));
      });
    }

    function imageSourceValues(element) {
      return [
        element.currentSrc,
        element.src,
        element.getAttribute?.("src"),
        element.getAttribute?.("data-src"),
        element.getAttribute?.("data-original"),
        element.getAttribute?.("data-original-src"),
        element.getAttribute?.("data-lazy-src"),
        element.getAttribute?.("data-image-src"),
        element.getAttribute?.("data-full-src"),
        bestSrcsetUrl(element.srcset || element.getAttribute?.("srcset") || element.getAttribute?.("data-srcset"))
      ].filter(Boolean);
    }

    function backgroundEntries(root, baseScore) {
      return Array.from(root?.querySelectorAll?.("[style*='background']") || [])
        .slice(0, 120)
        .flatMap((element) => {
          const urls = imageUrlsFromCss(element.getAttribute("style"));
          const bonus = elementImageBonus(element);
          return urls.map((value) => ({ value, score: baseScore + bonus }));
        });
    }

    function expandImageSource(value) {
      const srcset = bestSrcsetUrl(value);
      return srcset ? [srcset] : [value].filter(Boolean);
    }

    function bestSrcsetUrl(value) {
      if (!value) return undefined;
      if (!String(value).includes(",")) return undefined;
      return String(value)
        .split(",")
        .map((entry) => {
          const [url, descriptor = ""] = entry.trim().split(/\s+/, 2);
          const score = descriptor.endsWith("w")
            ? Number.parseInt(descriptor, 10)
            : descriptor.endsWith("x")
              ? Number.parseFloat(descriptor) * 1000
              : 0;
          return { url, score: Number.isFinite(score) ? score : 0 };
        })
        .filter((entry) => entry.url)
        .sort((a, b) => b.score - a.score)[0]?.url;
    }

    function imageUrlsFromCss(value) {
      if (!value) return [];
      return Array.from(String(value).matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]).filter(Boolean);
    }

    function elementImageBonus(element) {
      const context = `${element.alt || ""} ${element.getAttribute?.("aria-label") || ""} ${
        element.getAttribute?.("data-testid") || ""
      } ${element.closest?.("[data-testid='tweetPhoto'], a[href*='/photo/'], article, main")?.getAttribute?.("data-testid") || ""}`;
      let bonus = 0;
      if (/tweetPhoto|\/photo\/|image|photo|cover|hero/i.test(context)) bonus += 240;
      if (element.closest?.("[data-testid='tweetPhoto'], a[href*='/photo/']")) bonus += 420;
      if (element.closest?.("article, main")) bonus += 80;
      return bonus;
    }

    function scoreImageUrl(value) {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return 0;
      }
      const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
      let score = 0;
      if (/pbs\.twimg\.com\/media\//.test(path)) score += 520;
      if (/abs\.twimg\.com\/rweb\/ssr\/default\/v\d+\/og\/image\.png/.test(path)) score -= 900;
      if (
        /(^|[_.\-/%?=&])(avatar|badge|blank|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)([_.\-/%?=&]|$)/.test(path)
      ) {
        score -= 650;
      }
      if (path.endsWith(".svg") || path.includes(".svg?") || path.includes("1x1") || path.includes("pixel")) score -= 650;
      return score;
    }

    function imageWidth(element) {
      return (
        element.naturalWidth ||
        element.width ||
        Number(element.getAttribute?.("width")) ||
        Math.round(element.getBoundingClientRect?.().width || 0)
      );
    }

    function imageHeight(element) {
      return (
        element.naturalHeight ||
        element.height ||
        Number(element.getAttribute?.("height")) ||
        Math.round(element.getBoundingClientRect?.().height || 0)
      );
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
            "link[rel='shortcut icon']"
          ].join(",")
        ) || []
      )
        .map((element) => element.outerHTML)
        .join("");
      // JSON-LD scripts can legitimately live in <body> (e.g. B站 / Bilibili
      // injects VideoObject ld+json near the bottom of the body), so query the
      // whole document instead of restricting to <head>. Keeping head metadata
      // and JSON-LD together in the serialized <head> keeps downstream parsing
      // simple and survives the 180KB snapshot cap.
      const jsonLdHtml = Array.from(document.querySelectorAll("script[type='application/ld+json']"))
        .map((element) => element.outerHTML)
        .join("");
      const rootHtml = root === document.body ? root.innerHTML : root.outerHTML;

      return `<!doctype html><html><head>${headHtml}${jsonLdHtml}</head><body>${rootHtml}</body></html>`;
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

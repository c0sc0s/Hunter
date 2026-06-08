type HunterImageCandidate = {
  url: string;
  score?: number;
  source?: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot?: boolean;
  order?: number;
};

type RawImageCandidate = {
  url: string;
  score: number;
  order: number;
  source?: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot?: boolean;
};

type ImageCandidateDetails = {
  score: number;
  source?: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot?: boolean;
};

type ImageEntry = ImageCandidateDetails & {
  value: string;
};

type HunterContentCandidate = {
  kind: string;
  text?: string;
  html?: string;
  selector?: string;
  score?: number;
};

type RawContentCandidate = {
  kind: string;
  text: string;
  html?: string;
  selector?: string;
  score: number;
};

type HunterSnapshot = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  html?: string;
  textContent?: string;
  selectedText?: string;
  excerpt?: string;
  siteName?: string;
  favicon?: string;
  imageCandidates: HunterImageCandidate[];
  contentCandidates: HunterContentCandidate[];
  publishedAt?: string;
};

type ScoredRoot = {
  element: Element;
  score: number;
};

declare global {
  interface Window {
    __hunterExtractPageSnapshot?: () => HunterSnapshot;
  }
}

(() => {
  window.__hunterExtractPageSnapshot = (): HunterSnapshot => {
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
      imageCandidateUrl: 2000,
      imageCandidateText: 240,
      imageCandidateSource: 80,
      contentCandidates: 4,
      contentCandidateHtml: 80000,
      contentCandidateText: 60000,
      contentCandidateSelector: 300
    };
    // Minimum focused-root text length before we'll prefer it over the body.
    const minFocusedTextChars = 120;
    const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    const link = (selector: string) => document.querySelector<HTMLLinkElement>(selector)?.href?.trim();
    const absolutize = (value: unknown): string | undefined => {
      if (!value) return undefined;
      try {
        return new URL(String(value), location.href).toString();
      } catch {
        return undefined;
      }
    };
    const httpUrl = (value: unknown): string | undefined => {
      const absolute = absolutize(value);
      if (!absolute) return undefined;
      return /^https?:\/\//i.test(absolute) ? absolute : undefined;
    };
    const cleanText = (value: unknown): string =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const selectedText = truncate(cleanText(window.getSelection?.()?.toString() ?? ""), captureLimits.selectedText);
    const rootCandidates = scoreContentRootCandidates();
    const pickedRoot = pickContentRoot(rootCandidates);
    const contentRoot = pickedRoot.element;
    const rootText = textOf(contentRoot);
    const bodyText = textOf(document.body);
    // Prefer the focused root only when it carries enough text on its own; fall
    // back to body text whenever the focused root is shorter than the minimum.
    const textContent = truncate(rootText.length >= minFocusedTextChars ? rootText : bodyText, captureLimits.snapshotText);
    const imageCandidates = collectImageCandidates(contentRoot);
    const contentCandidates = collectContentCandidates({
      contentRoot,
      rootCandidates,
      rootText,
      bodyText,
      focusedScore: pickedRoot.score
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
      favicon: truncate(pickFavicon(), captureLimits.favicon),
      imageCandidates: imageCandidates
        .slice(0, captureLimits.imageCandidates)
        .map((image) => truncateImageCandidate(image))
        .filter((candidate): candidate is HunterImageCandidate => Boolean(candidate)),
      contentCandidates,
      publishedAt: truncate(meta('meta[property="article:published_time"]') || meta('meta[name="date"]'), captureLimits.publishedAt)
    };

    function scoreContentRootCandidates(): ScoredRoot[] {
      const selectionRoot = selectionContainer();
      const selectionMainRoot = selectionRoot?.closest?.(contentRootSelector());
      const candidates = [selectionMainRoot, ...document.querySelectorAll(contentRootSelector())].filter(
        (candidate): candidate is Element => Boolean(candidate)
      );
      const uniqueCandidates = [...new Set(candidates)];
      return uniqueCandidates.map((element) => ({ element, score: scoreContentRoot(element) })).sort((a, b) => b.score - a.score);
    }

    function pickContentRoot(scored: ScoredRoot[]): ScoredRoot {
      const fallback = { element: document.body || document.documentElement, score: 0 };
      return scored[0]?.score >= 160 ? scored[0] : fallback;
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

    function scoreContentRoot(element: Element): number {
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

    function collectContentCandidates({
      contentRoot,
      rootCandidates,
      rootText,
      bodyText,
      focusedScore
    }: {
      contentRoot: Element;
      rootCandidates: ScoredRoot[];
      rootText: string;
      bodyText: string;
      focusedScore: number;
    }): HunterContentCandidate[] {
      const candidates: RawContentCandidate[] = [];
      const seen = new Set<string>();

      const add = (kind: string, element: Element, text: string, score: number, includeHtml: boolean) => {
        const clean = cleanText(text);
        if (clean.length < 80) return;
        const key = clean.slice(0, 500);
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({
          kind,
          text: clean,
          html: includeHtml ? serializeFocusedHtml(element) : undefined,
          selector: selectorForElement(element),
          score: Math.round(score || 0)
        });
      };

      add("focused_root", contentRoot, rootText, focusedScore, false);

      for (const candidate of rootCandidates) {
        if (candidates.length >= captureLimits.contentCandidates - 1) break;
        if (candidate.element === contentRoot || candidate.element === document.body || candidate.element === document.documentElement)
          continue;
        add("content_root", candidate.element, textOf(candidate.element), candidate.score, true);
      }

      if (bodyText && bodyText !== rootText) {
        // Body text is noisy, so keep it as a text-only fallback. It helps
        // private/dynamic pages where the focused root misses the real content
        // without duplicating the full body HTML in the extension payload.
        add("body", document.body || document.documentElement, bodyText, Math.min(bodyText.length, 1000) - 120, false);
      }

      return candidates
        .slice(0, captureLimits.contentCandidates)
        .map((candidate) => truncateContentCandidate(candidate))
        .filter((candidate): candidate is HunterContentCandidate => Boolean(candidate));
    }

    function selectorForElement(element: Element): string | undefined {
      if (!element) return undefined;
      if (element === document.body) return "body";
      if (element === document.documentElement) return "html";

      const tag = element.tagName?.toLowerCase?.() || "element";
      const id = cleanSelectorToken(element.id);
      if (id) return `${tag}#${id}`;

      const classes = String(element.className || "")
        .split(/\s+/)
        .map(cleanSelectorToken)
        .filter(Boolean)
        .slice(0, 3);
      const role = cleanSelectorToken(element.getAttribute?.("role"));
      const dataTestId = cleanSelectorToken(element.getAttribute?.("data-testid"));
      const suffix = [
        ...classes.map((value) => `.${value}`),
        role ? `[role="${role}"]` : "",
        dataTestId ? `[data-testid="${dataTestId}"]` : ""
      ]
        .filter(Boolean)
        .join("");
      return truncate(`${tag}${suffix}`, captureLimits.contentCandidateSelector);
    }

    function cleanSelectorToken(value: unknown): string {
      return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }

    function pickFavicon(): string | undefined {
      const candidates = [...document.querySelectorAll("link[rel]")].flatMap((element, order) => {
        const rel = (element.getAttribute("rel") || "").toLowerCase();
        const href = httpUrl(element.getAttribute("href") || (element as HTMLLinkElement).href);
        if (!href) return [];
        const isIcon = rel.split(/\s+/).includes("icon");
        const isAppleTouchIcon = rel.includes("apple-touch-icon");
        if (!isIcon && !isAppleTouchIcon) return [];
        return [
          {
            href,
            order,
            score: iconRelScore(rel) + iconSizeScore(element.getAttribute("sizes"))
          }
        ];
      });
      candidates.sort((a, b) => b.score - a.score || a.order - b.order);
      return candidates[0]?.href;
    }

    function iconRelScore(rel: string): number {
      if (rel.includes("apple-touch-icon")) return 30;
      if (rel.split(/\s+/).includes("icon")) return 20;
      return 0;
    }

    function iconSizeScore(value: string | null): number {
      if (!value) return 0;
      if (value.toLowerCase().includes("any")) return 512;
      return Math.max(
        0,
        ...value.split(/\s+/).map((size) => {
          const match = size.match(/^(\d+)x(\d+)$/i);
          if (!match) return 0;
          return Math.min(Number(match[1]), Number(match[2]));
        })
      );
    }

    function selectionContainer(): Element | undefined {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0) return undefined;
      const node = selection.getRangeAt(0).commonAncestorContainer;
      return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement ?? undefined);
    }

    function collectImageCandidates(root: Element): RawImageCandidate[] {
      const candidates = new Map<string, RawImageCandidate>();
      let order = 0;
      const add = (value: unknown, details: ImageCandidateDetails) => {
        for (const source of expandImageSource(value)) {
          const absolute = absolutize(source);
          if (!absolute || absolute.startsWith("data:")) continue;
          const ranked = {
            url: absolute,
            score: details.score + scoreImageUrl(absolute),
            order: order++,
            source: details.source,
            width: details.width,
            height: details.height,
            alt: details.alt,
            context: details.context,
            inContentRoot: Boolean(details.inContentRoot)
          };
          const existing = candidates.get(absolute);
          if (!existing || ranked.score > existing.score || (ranked.score === existing.score && ranked.order < existing.order)) {
            candidates.set(absolute, ranked);
          }
        }
      };

      add(meta('meta[property="og:image"]'), metadataImageDetails("metadata:og_image", 900));
      add(meta('meta[property="og:image:url"]'), metadataImageDetails("metadata:og_image_url", 895));
      add(meta('meta[property="og:image:secure_url"]'), metadataImageDetails("metadata:og_image_secure_url", 895));
      add(meta('meta[name="twitter:image"]'), metadataImageDetails("metadata:twitter_image", 880));
      add(meta('meta[name="twitter:image:src"]'), metadataImageDetails("metadata:twitter_image_src", 880));

      imageEntries(root, 620, "content_image", true).forEach((entry) => add(entry.value, entry));
      backgroundEntries(root, 590, "content_background", true).forEach((entry) => add(entry.value, entry));
      imageEntries(document.body, 360, "page_image", false).forEach((entry) => add(entry.value, entry));
      backgroundEntries(document.body, 340, "page_background", false).forEach((entry) => add(entry.value, entry));

      return [...candidates.values()].sort((a, b) => b.score - a.score || a.order - b.order);
    }

    function metadataImageDetails(source: string, score: number): ImageCandidateDetails {
      return {
        score,
        source,
        width: numericMeta('meta[property="og:image:width"]'),
        height: numericMeta('meta[property="og:image:height"]')
      };
    }

    function numericMeta(selector: string): number | undefined {
      const value = meta(selector);
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    function imageEntries(root: Element | null | undefined, baseScore: number, source: string, inContentRoot: boolean): ImageEntry[] {
      const images = Array.from(root?.querySelectorAll?.("img, picture source") || []).slice(0, 120);
      return images.flatMap((element) => {
        const image = element as HTMLImageElement & HTMLSourceElement;
        const width = imageWidth(element);
        const height = imageHeight(element);
        const hasSrcset = Boolean(image.srcset || element.getAttribute?.("srcset") || element.getAttribute?.("data-srcset"));
        const looksLikeMedia = /(^|\.)twimg\.com\/media\//i.test(
          `${image.currentSrc || ""} ${image.src || ""} ${element.getAttribute?.("src") || ""} ${element.getAttribute?.("srcset") || ""}`
        );
        if (!looksLikeMedia && !hasSrcset && width < 120 && height < 120) return [];
        const context = elementImageContext(element);
        const score = baseScore + Math.min(220, Math.round((Math.max(width, 1) * Math.max(height, 1)) / 1800)) + elementImageBonus(element);
        return imageSourceValues(element).map((value) => ({
          value,
          score,
          source,
          width,
          height,
          alt: cleanText((element as HTMLImageElement).alt || element.getAttribute?.("aria-label")),
          context,
          inContentRoot
        }));
      });
    }

    function imageSourceValues(element: Element): string[] {
      const image = element as HTMLImageElement & HTMLSourceElement;
      return [
        image.currentSrc,
        image.src,
        element.getAttribute?.("src"),
        element.getAttribute?.("data-src"),
        element.getAttribute?.("data-original"),
        element.getAttribute?.("data-original-src"),
        element.getAttribute?.("data-lazy-src"),
        element.getAttribute?.("data-image-src"),
        element.getAttribute?.("data-full-src"),
        bestSrcsetUrl(image.srcset || element.getAttribute?.("srcset") || element.getAttribute?.("data-srcset"))
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
    }

    function backgroundEntries(root: Element | null | undefined, baseScore: number, source: string, inContentRoot: boolean): ImageEntry[] {
      return Array.from(root?.querySelectorAll?.("[style*='background']") || [])
        .slice(0, 120)
        .flatMap((element) => {
          const urls = imageUrlsFromCss(element.getAttribute("style"));
          const bonus = elementImageBonus(element);
          const context = elementImageContext(element);
          return urls.map((value) => ({
            value,
            score: baseScore + bonus,
            source,
            context,
            inContentRoot
          }));
        });
    }

    function expandImageSource(value: unknown): string[] {
      const srcset = bestSrcsetUrl(value);
      return srcset ? [srcset] : [value].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }

    function bestSrcsetUrl(value: unknown): string | undefined {
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

    function imageUrlsFromCss(value: unknown): string[] {
      if (!value) return [];
      return Array.from(String(value).matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]).filter(Boolean);
    }

    function elementImageBonus(element: Element): number {
      const context = elementImageContext(element);
      let bonus = 0;
      if (/tweetPhoto|\/photo\/|image|photo|cover|hero/i.test(context)) bonus += 240;
      if (element.closest?.("[data-testid='tweetPhoto'], a[href*='/photo/']")) bonus += 420;
      if (element.closest?.("article, main")) bonus += 80;
      return bonus;
    }

    function elementImageContext(element: Element): string {
      return cleanText(
        `${(element as HTMLImageElement).alt || ""} ${element.getAttribute?.("aria-label") || ""} ${element.getAttribute?.("data-testid") || ""} ${
          element.className || ""
        } ${element.id || ""} ${
          element.closest?.("[data-testid='tweetPhoto'], a[href*='/photo/'], figure, article, main")?.getAttribute?.("data-testid") || ""
        }`
      );
    }

    function scoreImageUrl(value: string): number {
      let parsed: URL;
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

    function imageWidth(element: Element): number {
      const image = element as HTMLImageElement;
      return (
        image.naturalWidth ||
        image.width ||
        Number(element.getAttribute?.("width")) ||
        Math.round(element.getBoundingClientRect?.().width || 0)
      );
    }

    function imageHeight(element: Element): number {
      const image = element as HTMLImageElement;
      return (
        image.naturalHeight ||
        image.height ||
        Number(element.getAttribute?.("height")) ||
        Math.round(element.getBoundingClientRect?.().height || 0)
      );
    }

    function serializeFocusedHtml(root: Element): string {
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

    function textOf(element: Element | null | undefined): string {
      return cleanText((element as HTMLElement | null | undefined)?.innerText || element?.textContent);
    }

    function truncateImageCandidate(candidate: RawImageCandidate): HunterImageCandidate | undefined {
      const url = truncate(candidate.url, captureLimits.imageCandidateUrl);
      if (!url) return undefined;
      return {
        url,
        score: Math.round(candidate.score || 0),
        source: truncate(candidate.source, captureLimits.imageCandidateSource),
        width: positiveInteger(candidate.width),
        height: positiveInteger(candidate.height),
        alt: truncate(candidate.alt, captureLimits.imageCandidateText),
        context: truncate(candidate.context, captureLimits.imageCandidateText),
        inContentRoot: candidate.inContentRoot || undefined,
        order: nonNegativeInteger(candidate.order)
      };
    }

    function truncateContentCandidate(candidate: RawContentCandidate): HunterContentCandidate | undefined {
      const text = truncate(candidate.text, captureLimits.contentCandidateText);
      const html = truncate(candidate.html, captureLimits.contentCandidateHtml);
      if (!text && !html) return undefined;

      return {
        kind: candidate.kind,
        text,
        html,
        selector: truncate(candidate.selector, captureLimits.contentCandidateSelector),
        score: Math.round(candidate.score || 0)
      };
    }

    function positiveInteger(value: unknown): number | undefined {
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
    }

    function nonNegativeInteger(value: unknown): number | undefined {
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
    }

    function truncate(value: unknown, limit: number): string | undefined {
      if (typeof value !== "string" || value.length === 0) return undefined;
      return value.length > limit ? value.slice(0, limit) : value;
    }
  };
})();

export {};

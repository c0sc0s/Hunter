import { CONTENT_SUPPORT_GATE_ENABLED, detectSupportedResourceInPage, type ContentSupportResult } from "./contentSupport.js";
import { collectCoverCandidatesInPage, upgradeCdnCoverResolution } from "./coverPreview.js";

const coverPreviewRetryDelaysMs = [0, 250, 600, 1_200, 2_000];

type PopupSupportResult =
  | ContentSupportResult
  | {
      supported: true;
      kind: "unrestricted";
      confidence: number;
      signals: Array<{ source: string; value: string }>;
    };

type SaveMessageResponse = {
  ok?: boolean;
  queued?: boolean;
  error?: string;
  item?: unknown;
};

type SaveButtonState = "idle" | "loading" | "saving" | "saved" | "queued" | "error";

const pageTitle = requireElement(document.querySelector<HTMLElement>("#pageTitle"), "#pageTitle");
const pageUrl = requireElement(document.querySelector<HTMLElement>("#pageUrl"), "#pageUrl");
const cover = requireElement(document.querySelector<HTMLElement>("#cover"), "#cover");
const coverPhoto = requireElement(document.querySelector<HTMLImageElement>("#coverPhoto"), "#coverPhoto");
const unsupportedCard = requireElement(document.querySelector<HTMLElement>("#unsupportedCard"), "#unsupportedCard");
const formCard = requireElement(document.querySelector<HTMLElement>(".form-card"), ".form-card");
const actions = requireElement(document.querySelector<HTMLElement>(".actions"), ".actions");
const noteInput = requireElement(document.querySelector<HTMLTextAreaElement>("#note"), "#note");
const saveButton = requireElement(document.querySelector<HTMLButtonElement>("#saveButton"), "#saveButton");
const saveButtonLabel = requireElement(document.querySelector<HTMLElement>("#saveButtonLabel"), "#saveButtonLabel");
const statusText = requireElement(document.querySelector<HTMLElement>("#status"), "#status");

let currentTab: chrome.tabs.Tab | undefined;
let currentSupport: PopupSupportResult | undefined;
let coverPreviewRunId = 0;

saveButton.disabled = true;
renderSaveButton("loading");
init();

async function init() {
  setStatus("Loading current tab.");

  currentTab = await resolveCurrentTab();
  renderCurrentTab(currentTab);
}

saveButton.addEventListener("click", async () => {
  if (CONTENT_SUPPORT_GATE_ENABLED && !currentSupport?.supported) {
    renderCaptureMode("unsupported");
    return;
  }

  saveButton.disabled = true;
  renderSaveButton("saving");
  setStatus("Saving", "saving");

  try {
    const result = (await chrome.runtime.sendMessage({
      type: "hunter-save-active-tab",
      tabId: currentTab?.id,
      note: noteInput.value.trim() || undefined
    })) as SaveMessageResponse | undefined;

    if (!result?.ok) throw new Error(result?.error || "Could not save page");
    renderCoverImage(savedItemCoverImage(result.item));
    renderSaveButton(result.queued ? "queued" : "saved");
    setStatus(result.queued ? "Saved offline" : "Saved", "success");
  } catch (error) {
    renderSaveButton("error");
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    saveButton.disabled = false;
  }
});

async function resolveCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabId = Number(new URLSearchParams(location.search).get("tabId"));
  if (Number.isInteger(tabId) && tabId > 0) {
    return chrome.tabs.get(tabId);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderCurrentTab(tab: chrome.tabs.Tab | undefined) {
  resetCoverPhoto();
  const previewRunId = ++coverPreviewRunId;
  currentSupport = undefined;
  if (!tab?.id || !tab.url) {
    pageTitle.textContent = "Open a page to save";
    pageUrl.textContent = "";
    renderCaptureMode("unsupported");
    return;
  }

  renderCaptureMode("checking");
  const host = safeHost(tab.url);
  pageTitle.textContent = tab.title || host || "Untitled";
  pageUrl.textContent = tab.url;

  void prepareSupportedPage(tab.id, previewRunId);
}

async function prepareSupportedPage(tabId: number, previewRunId: number) {
  if (!CONTENT_SUPPORT_GATE_ENABLED) {
    currentSupport = {
      supported: true,
      kind: "unrestricted",
      confidence: 1,
      signals: [{ source: "support_gate", value: "disabled" }]
    };
    renderCaptureMode("supported");
    void loadCoverPreview(tabId, previewRunId);
    return;
  }

  currentSupport = await extractResourceSupport(tabId);
  if (!currentSupport.supported) {
    renderCaptureMode("unsupported");
    return;
  }

  renderCaptureMode("supported");
  // Preview the same cover that the library card will show after recognition
  // runs (og:image / Twitter card / JSON-LD VideoObject.thumbnailUrl). The
  // favicon used to be stretched in here, which on most sites — especially
  // B站 with a 16×16 favicon — looked broken. We fall back to the brand mark
  // when extraction yields nothing (rather than reintroducing the stretched
  // favicon, which read as a render bug).
  void loadCoverPreview(tabId, previewRunId);
}

function renderCaptureMode(mode: "checking" | "supported" | "unsupported") {
  const supported = mode === "supported";
  unsupportedCard.hidden = mode !== "unsupported";
  formCard.hidden = !supported;
  actions.hidden = mode === "unsupported";
  saveButton.disabled = !supported;

  if (mode === "checking") {
    renderSaveButton("loading");
    setStatus("Checking resource", "saving");
  } else if (mode === "supported") {
    renderSaveButton("idle");
    setStatus("Ready to capture snapshot.");
  } else {
    renderSaveButton("idle");
    setStatus("");
  }
}

function resetCoverPhoto() {
  coverPhoto.hidden = true;
  coverPhoto.removeAttribute("src");
  cover.classList.remove("has-cover");
}

async function loadCoverPreview(tabId: number, previewRunId: number) {
  for (const delayMs of coverPreviewRetryDelaysMs) {
    if (delayMs > 0) await delay(delayMs);
    if (previewRunId !== coverPreviewRunId) return;
    const candidates = await extractPreviewCoverUrls(tabId);
    if (candidates.length === 0) continue;
    if (previewRunId !== coverPreviewRunId) return;
    renderCoverCandidates(candidates);
    return;
  }
}

function renderCoverImage(candidate: string | null | undefined) {
  if (!candidate) return;
  renderCoverCandidates([candidate]);
}

function renderCoverCandidates(candidates: string[], index = 0) {
  const candidate = candidates[index];
  if (!candidate) {
    resetCoverPhoto();
    return;
  }
  // Mirror the web client: hotlink-protected CDNs (B站 hdslb.com) 403 cross-
  // origin Referer requests, and their og:image / VideoObject thumbnailUrl
  // ships as a 5KB SEO thumbnail unless we ask the CDN for a bigger render.
  const upgraded = upgradeCdnCoverResolution(candidate);
  coverPhoto.onerror = () => {
    renderCoverCandidates(candidates, index + 1);
  };
  coverPhoto.onload = () => {
    cover.classList.add("has-cover");
    coverPhoto.hidden = false;
  };
  coverPhoto.src = upgraded;
}

async function extractPreviewCoverUrls(tabId: number): Promise<string[]> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectCoverCandidatesInPage
    });
    const candidates = Array.isArray(result?.result) ? result.result : [];
    return Array.from(
      candidates.reduce((seen, candidate) => {
        const url = coverCandidateUrl(candidate);
        if (url) seen.add(url);
        return seen;
      }, new Set<string>())
    );
  } catch (error) {
    // Common causes: chrome:// or chrome-extension:// pages refuse injection,
    // host_permissions missing for this URL, tab navigated mid-call. Leave a
    // breadcrumb so popup debugging is not silent; the popup still renders
    // with the brand-mark placeholder, so the user is unaffected.
    console.warn("[hunter] cover preview extraction failed", error);
    return [];
  }
}

function coverCandidateUrl(candidate: unknown): string | null {
  if (typeof candidate === "string") return candidate;
  if (candidate && typeof candidate === "object" && "url" in candidate) {
    const url = (candidate as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return null;
}

async function extractResourceSupport(tabId: number): Promise<ContentSupportResult> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectSupportedResourceInPage
    });
    const support = result?.result;
    if (support && typeof support === "object" && "supported" in support) return support as ContentSupportResult;
  } catch (error) {
    console.warn("[hunter] content support detection failed", error);
  }

  return {
    supported: false,
    kind: "unsupported",
    confidence: 0,
    reason: "detection_failed",
    signals: []
  };
}

function setStatus(message: string, state = "") {
  statusText.textContent = message;
  if (state) statusText.dataset.state = state;
  else delete statusText.dataset.state;
}

function renderSaveButton(state: SaveButtonState) {
  const labels: Record<SaveButtonState, string> = {
    idle: "Save",
    loading: "Loading",
    saving: "Saving",
    saved: "Saved",
    queued: "Saved offline",
    error: "Retry Save"
  };
  saveButtonLabel.textContent = labels[state];
  if (state === "idle") delete saveButton.dataset.state;
  else saveButton.dataset.state = state;
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function savedItemCoverImage(item: unknown): string | undefined {
  if (!item || typeof item !== "object" || !("coverImage" in item)) return undefined;
  const coverImage = (item as { coverImage?: unknown }).coverImage;
  return typeof coverImage === "string" && coverImage.length > 0 ? coverImage : undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

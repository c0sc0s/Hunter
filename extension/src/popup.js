import { CONTENT_SUPPORT_GATE_ENABLED, detectSupportedResourceInPage } from "./contentSupport.js";
import { collectCoverCandidatesInPage, upgradeCdnCoverResolution } from "./coverPreview.js";

const defaultApiBase = "http://127.0.0.1:4317";

const pageHost = document.querySelector("#pageHost");
const pageTitle = document.querySelector("#pageTitle");
const pageUrl = document.querySelector("#pageUrl");
const cover = document.querySelector("#cover");
const coverPhoto = document.querySelector("#coverPhoto");
const unsupportedCard = document.querySelector("#unsupportedCard");
const formCard = document.querySelector(".form-card");
const apiCard = document.querySelector(".api-card");
const actions = document.querySelector(".actions");
const tagsInput = document.querySelector("#tags");
const noteInput = document.querySelector("#note");
const apiBaseInput = document.querySelector("#apiBase");
const saveButton = document.querySelector("#saveButton");
const statusText = document.querySelector("#status");

let currentTab;
let currentSupport;

saveButton.disabled = true;
init();

async function init() {
  const { apiBase } = await chrome.storage.local.get({ apiBase: defaultApiBase });
  apiBaseInput.value = apiBase;
  setStatus("Loading current tab.");

  currentTab = await resolveCurrentTab();
  renderCurrentTab(currentTab);
}

apiBaseInput.addEventListener("change", () => {
  void persistApiBaseInput();
});

saveButton.addEventListener("click", async () => {
  if (CONTENT_SUPPORT_GATE_ENABLED && !currentSupport?.supported) {
    renderCaptureMode("unsupported");
    return;
  }

  saveButton.disabled = true;
  setStatus("Saving", "saving");

  try {
    await persistApiBaseInput();
    const result = await chrome.runtime.sendMessage({
      type: "hunter-save-active-tab",
      tabId: currentTab?.id,
      tags: splitTags(tagsInput.value),
      note: noteInput.value.trim() || undefined
    });

    if (!result?.ok) throw new Error(result?.error || "Could not save page");
    setStatus(result.queued ? "Saved offline. Will sync when Hunter is open." : "Saved. Click Reload in Hunter.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
});

async function resolveCurrentTab() {
  const tabId = Number(new URLSearchParams(location.search).get("tabId"));
  if (Number.isInteger(tabId) && tabId > 0) {
    return chrome.tabs.get(tabId);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderCurrentTab(tab) {
  resetCoverPhoto();
  currentSupport = undefined;
  if (!tab?.id || !tab.url) {
    pageHost.textContent = "No page selected";
    pageTitle.textContent = "Open a page to save";
    pageUrl.textContent = "";
    renderCaptureMode("unsupported");
    return;
  }

  renderCaptureMode("checking");
  const host = safeHost(tab.url);
  pageHost.textContent = host || "Current page";
  pageTitle.textContent = tab.title || host || "Untitled";
  pageUrl.textContent = tab.url;

  void prepareSupportedPage(tab.id);
}

async function prepareSupportedPage(tabId) {
  if (!CONTENT_SUPPORT_GATE_ENABLED) {
    currentSupport = {
      supported: true,
      kind: "unrestricted",
      confidence: 1,
      signals: [{ source: "support_gate", value: "disabled" }]
    };
    renderCaptureMode("supported");
    void loadCoverPreview(tabId);
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
  void loadCoverPreview(tabId);
}

function renderCaptureMode(mode) {
  const supported = mode === "supported";
  unsupportedCard.hidden = mode !== "unsupported";
  formCard.hidden = !supported;
  apiCard.hidden = !supported;
  actions.hidden = mode === "unsupported";
  saveButton.disabled = !supported;

  if (mode === "checking") {
    setStatus("Checking resource", "saving");
  } else if (mode === "supported") {
    setStatus("Ready to capture snapshot.");
  } else {
    setStatus("");
  }
}

function resetCoverPhoto() {
  coverPhoto.hidden = true;
  coverPhoto.removeAttribute("src");
  cover.classList.remove("has-cover");
}

async function loadCoverPreview(tabId) {
  const candidate = await extractPreviewCoverUrl(tabId);
  if (!candidate) return;
  // Mirror the web client: hotlink-protected CDNs (B站 hdslb.com) 403 cross-
  // origin Referer requests, and their og:image / VideoObject thumbnailUrl
  // ships as a 5KB SEO thumbnail unless we ask the CDN for a bigger render.
  const upgraded = upgradeCdnCoverResolution(candidate);
  coverPhoto.onerror = () => {
    resetCoverPhoto();
  };
  coverPhoto.onload = () => {
    cover.classList.add("has-cover");
    coverPhoto.hidden = false;
  };
  coverPhoto.src = upgraded;
}

async function extractPreviewCoverUrl(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectCoverCandidatesInPage
    });
    const candidates = Array.isArray(result?.result) ? result.result : [];
    return coverCandidateUrl(candidates[0]) ?? null;
  } catch (error) {
    // Common causes: chrome:// or chrome-extension:// pages refuse injection,
    // host_permissions missing for this URL, tab navigated mid-call. Leave a
    // breadcrumb so popup debugging is not silent; the popup still renders
    // with the brand-mark placeholder, so the user is unaffected.
    console.warn("[hunter] cover preview extraction failed", error);
    return null;
  }
}

function coverCandidateUrl(candidate) {
  if (typeof candidate === "string") return candidate;
  if (candidate && typeof candidate.url === "string") return candidate.url;
  return null;
}

async function extractResourceSupport(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectSupportedResourceInPage
    });
    const support = result?.result;
    if (support && typeof support === "object" && "supported" in support) return support;
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

function setStatus(message, state = "") {
  statusText.textContent = message;
  if (state) statusText.dataset.state = state;
  else delete statusText.dataset.state;
}

function safeHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function splitTags(value) {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function persistApiBaseInput() {
  const apiBase = apiBaseInput.value.trim() || defaultApiBase;
  if (apiBase === defaultApiBase) {
    await chrome.storage.local.remove(["apiBase", "apiBaseMode"]);
    return;
  }

  await chrome.storage.local.set({ apiBase, apiBaseMode: "manual" });
}

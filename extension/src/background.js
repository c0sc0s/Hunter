/**
 * Service worker entry. Keeps wiring thin: snapshot capture stays here,
 * everything HTTP/queue-related delegates to `saveActions.js` so it can be
 * unit-tested without a real chrome runtime.
 */

import { resolveApiBase } from "./apiBase.js";
import { detectSupportedResourceInPage } from "./contentSupport.js";
import { queue } from "./queue.js";
import { flushQueue, performSave } from "./saveActions.js";

const DEFAULT_API_BASE = "http://127.0.0.1:4317";
const FLUSH_ALARM = "hunter-flush";
const FLUSH_PERIOD_MINUTES = 1;
const BADGE_OK = "#1e7f76";
const BADGE_ERROR = "#a43722";
const BADGE_INFO = "#3a4f8a";
const UNSUPPORTED_RESOURCE_MESSAGE = "Current resource is not a supported article, video, or X post.";

// Strong signal that the local server is running. If the user opens the Hunter
// web UI in any tab, we know the desktop app is alive — try flushing now
// instead of waiting for the next alarm tick.
const WEB_ORIGIN_HINTS = ["127.0.0.1:5173", "127.0.0.1:4317", "localhost:5173", "localhost:4317"];

chrome.runtime.onInstalled.addListener(() => {
  // Only seed the default API base when no user value exists; never overwrite
  // a configured apiBase on update.
  void (async () => {
    const stored = await chrome.storage.local.get({ apiBase: undefined });
    if (typeof stored.apiBase !== "string" || stored.apiBase.trim().length === 0) {
      await chrome.storage.local.set({ apiBase: DEFAULT_API_BASE });
    }
  })();
  chrome.contextMenus.create({
    id: "hunter-save-page",
    title: "Save page to Hunter",
    contexts: ["page", "selection"]
  });
  void refreshBadge();
});

chrome.runtime.onStartup?.addListener(() => {
  void runFlush();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void runFlush();
});

chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
  // Only react when the tab finishes loading and the URL hints at a live
  // Hunter web UI. Avoid waking the worker for every keystroke in the URL bar.
  if (changeInfo.status !== "complete" || !changeInfo.url) return;
  if (WEB_ORIGIN_HINTS.some((hint) => changeInfo.url.includes(hint))) {
    void runFlush();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextSave(info, tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "hunter-save-active-tab") return undefined;

  void saveActiveTab(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extension save error"
      })
    );

  return true;
});

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get({ apiBase: DEFAULT_API_BASE });
  const configured = typeof apiBase === "string" && apiBase.trim() ? apiBase : DEFAULT_API_BASE;
  // resolveApiBase probes 4317→4319 when the configured base is localhost so
  // a desktop sidecar that landed on 4318/4319 still receives saves. For
  // non-localhost configs (user pointed at a remote server) it is a no-op.
  return resolveApiBase(configured);
}

async function handleContextSave(info, tab) {
  if (!tab?.id) return;

  setTransientBadge("...", BADGE_INFO);
  try {
    const support = await detectTabResourceSupport(tab.id);
    if (!support.supported) {
      await showUnsupportedResourceBubble();
      return;
    }
    const snapshot = await extractSnapshot(tab.id);
    const apiBase = await getApiBase();
    const result = await performSave(apiBase, {
      url: snapshot.url,
      note: info.selectionText,
      snapshot
    });
    await afterSave(result);
  } catch (error) {
    console.error("[hunter] context save failed", error);
    setTransientBadge("!", BADGE_ERROR);
  } finally {
    setTimeout(() => void refreshBadge(), 1600);
  }
}

async function saveActiveTab(message) {
  const [tab] = Number.isInteger(message.tabId) ? [{ id: message.tabId }] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab to save");

  await assertSupportedTab(tab.id);
  const snapshot = await extractSnapshot(tab.id);
  const apiBase = await getApiBase();
  const result = await performSave(apiBase, {
    url: snapshot.url,
    tags: Array.isArray(message.tags) ? message.tags.filter((tag) => typeof tag === "string") : [],
    note: typeof message.note === "string" && message.note.trim() ? message.note.trim() : undefined,
    snapshot
  });
  await afterSave(result);
  return result;
}

async function assertSupportedTab(tabId) {
  const support = await detectTabResourceSupport(tabId);
  if (support.supported) return;
  await showUnsupportedResourceBubble();
  throw new Error(UNSUPPORTED_RESOURCE_MESSAGE);
}

async function detectTabResourceSupport(tabId) {
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

async function afterSave(result) {
  if (result.ok && result.queued) {
    await ensureFlushAlarm();
  }
  await refreshBadge();
}

async function extractSnapshot(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/extractor.js"]
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__hunterExtractPageSnapshot()
  });
  const snapshot = result?.result;
  // Fail fast at the orchestration boundary so callers get a real diagnostic
  // (instead of a generic HTTP 400 from the API for an invalid payload).
  if (!snapshot || typeof snapshot.url !== "string" || snapshot.url.length === 0) {
    throw new Error(`Page snapshot extraction failed for tab ${tabId}`);
  }
  return snapshot;
}

async function runFlush() {
  const apiBase = await getApiBase();
  await flushQueue(apiBase);
  await refreshBadge();

  const counters = await queue.counters();
  if (counters.queued > 0) {
    await ensureFlushAlarm();
  } else {
    await chrome.alarms.clear(FLUSH_ALARM);
  }
}

async function ensureFlushAlarm() {
  const existing = await chrome.alarms.get(FLUSH_ALARM);
  if (existing) return;
  await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
}

/**
 * Render the action badge to mirror queue counters.
 *   - !N (red)   → at least one failed/dead-letter entry
 *   - ↑N (green) → N queued items waiting on the server
 *   - empty       → all caught up
 */
async function refreshBadge() {
  try {
    const { queued, failed } = await queue.counters();
    if (failed > 0) {
      setBadge(`!${failed}`, BADGE_ERROR);
      return;
    }
    if (queued > 0) {
      setBadge(`\u2191${queued}`, BADGE_OK);
      return;
    }
    setBadge("");
  } catch (error) {
    console.error("[hunter] refreshBadge failed", error);
  }
}

function setTransientBadge(text, color) {
  setBadge(text, color);
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (text && color) chrome.action.setBadgeBackgroundColor({ color });
}

async function showUnsupportedResourceBubble() {
  setTransientBadge("!", BADGE_ERROR);
  await showNotification("Unsupported resource type", UNSUPPORTED_RESOURCE_MESSAGE);
  setTimeout(() => void refreshBadge(), 1800);
}

async function showNotification(title, message) {
  try {
    if (!chrome.notifications?.create) return;
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title,
      message
    });
  } catch (error) {
    console.warn("[hunter] notification failed", error);
  }
}

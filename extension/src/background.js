const defaultApiBase = "http://127.0.0.1:4317";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ apiBase: defaultApiBase });
  chrome.contextMenus.create({
    id: "huntter-save-page",
    title: "Save page to Huntter",
    contexts: ["page", "selection"]
  });
  chrome.contextMenus.create({
    id: "huntter-save-link",
    title: "Save link to Huntter",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextSave(info, tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "huntter-save-active-tab") return undefined;

  void saveActiveTab(message)
    .then((item) => sendResponse({ ok: true, item }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown extension save error" }));

  return true;
});

async function handleContextSave(info, tab) {
  if (!tab?.id) return;

  try {
    setBadge("...");
    if (info.menuItemId === "huntter-save-link" && info.linkUrl) {
      await postItem({ url: info.linkUrl, note: info.selectionText });
    } else {
      const snapshot = await extractSnapshot(tab.id);
      await postItem({
        url: snapshot.url,
        note: info.selectionText,
        snapshot
      });
    }
    setBadge("ok");
  } catch (error) {
    console.error(error);
    setBadge("!");
  } finally {
    setTimeout(() => setBadge(""), 1600);
  }
}

async function saveActiveTab(message) {
  const [tab] = Number.isInteger(message.tabId) ? [{ id: message.tabId }] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab to save");

  const snapshot = await extractSnapshot(tab.id);
  return postItem({
    url: snapshot.url,
    tags: Array.isArray(message.tags) ? message.tags.filter((tag) => typeof tag === "string") : [],
    note: typeof message.note === "string" && message.note.trim() ? message.note.trim() : undefined,
    snapshot
  });
}

async function extractSnapshot(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/extractor.js"]
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__huntterExtractPageSnapshot()
  });
  return result.result;
}

async function postItem(payload) {
  const { apiBase } = await chrome.storage.local.get({ apiBase: defaultApiBase });
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Huntter API returned HTTP ${response.status}`);
  }

  return response.json();
}

function setBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text === "!" ? "#a43722" : "#1e7f76" });
}

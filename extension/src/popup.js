const defaultApiBase = "http://127.0.0.1:4317";

const pageHost = document.querySelector("#pageHost");
const pageTitle = document.querySelector("#pageTitle");
const pageUrl = document.querySelector("#pageUrl");
const cover = document.querySelector("#cover");
const tagsInput = document.querySelector("#tags");
const noteInput = document.querySelector("#note");
const apiBaseInput = document.querySelector("#apiBase");
const saveButton = document.querySelector("#saveButton");
const statusText = document.querySelector("#status");

let currentTab;

saveButton.disabled = true;
init();

async function init() {
  const { apiBase } = await chrome.storage.local.get({ apiBase: defaultApiBase });
  apiBaseInput.value = apiBase;

  currentTab = await resolveCurrentTab();
  renderCurrentTab(currentTab);
}

apiBaseInput.addEventListener("change", () => {
  chrome.storage.local.set({ apiBase: apiBaseInput.value.trim() || defaultApiBase });
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  statusText.textContent = "Saving";

  try {
    const apiBase = apiBaseInput.value.trim() || defaultApiBase;
    await chrome.storage.local.set({ apiBase });
    const result = await chrome.runtime.sendMessage({
      type: "huntter-save-active-tab",
      tabId: currentTab?.id,
      tags: splitTags(tagsInput.value),
      note: noteInput.value.trim() || undefined
    });

    if (!result?.ok) throw new Error(result?.error || "Could not save page");
    statusText.textContent = "Saved. Click Reload in Huntter.";
  } catch (error) {
    statusText.textContent = error.message;
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
  if (!tab?.id || !tab.url) {
    pageHost.textContent = "No page selected";
    pageTitle.textContent = "Open a page to save";
    pageUrl.textContent = "";
    saveButton.disabled = true;
    return;
  }

  const host = safeHost(tab.url);
  pageHost.textContent = host || "Current page";
  pageTitle.textContent = tab.title || host || "Untitled";
  pageUrl.textContent = tab.url;
  saveButton.disabled = false;
  if (tab.favIconUrl) {
    cover.style.backgroundImage = `url(${tab.favIconUrl})`;
  }
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

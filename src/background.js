"use strict";

importScripts("onboarding-state.js");

const { YOUTUBE_ORIGIN, KEYS, hasSeen, markSeen, hasYouTubePermission } =
  globalThis.YTPF_onboarding;

const CONTENT_SCRIPT_ID = "ytpf-youtube";

const CONTENT_SCRIPT_REGISTRATION = {
  id: CONTENT_SCRIPT_ID,
  matches: [YOUTUBE_ORIGIN],
  js: ["onboarding-state.js", "vendor/minisearch.js", "content.js"],
  css: ["styles.css"],
  runAt: "document_start",
  persistAcrossSessions: true,
};

async function ensureContentScriptRegistered() {
  if (!(await hasYouTubePermission())) return;
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID],
  });
  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([CONTENT_SCRIPT_REGISTRATION]);
  }
  await markSeen(KEYS.permissionGranted);
}

async function ensureContentScriptUnregistered() {
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID],
  });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  }
  await chrome.storage.local.set({ [KEYS.permissionGranted]: false });
}

function welcomeUrl() {
  return chrome.runtime.getURL("welcome.html");
}

async function openOrFocusWelcome() {
  const url = welcomeUrl();
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [url],
    });
    const existing = contexts.find((c) => c.tabId !== undefined);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  }
  await chrome.tabs.create({ url });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await openOrFocusWelcome();
    await markSeen(KEYS.installWelcomeShown);
  }
  await ensureContentScriptRegistered();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContentScriptRegistered();
});

chrome.action.onClicked.addListener(() => openOrFocusWelcome());

chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions?.origins?.includes(YOUTUBE_ORIGIN)) {
    ensureContentScriptRegistered();
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions?.origins?.includes(YOUTUBE_ORIGIN)) {
    ensureContentScriptUnregistered();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "permissionGranted") {
    ensureContentScriptRegistered().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "getPermissionState") {
    hasYouTubePermission().then((granted) => sendResponse({ granted }));
    return true;
  }
  return false;
});

ensureContentScriptRegistered();

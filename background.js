"use strict";

const STORAGE_KEYS = {
  oauthClientId: "ytpf_oauth_client_id",
  oauthClientSecret: "ytpf_oauth_client_secret",
  useCustomOauthClient: "ytpf_use_custom_oauth_client",
  customOauthModeVersion: "ytpf_custom_oauth_mode_version",
  token: "ytpf_oauth_token",
  refreshToken: "ytpf_oauth_refresh_token",
  playlistCache: "ytpf_playlist_cache",
};

const DEFAULT_OAUTH_CLIENT_ID =
  "619930870075-vc2g35merl0go901o9vl60bqnpd5dam8.apps.googleusercontent.com";
const CUSTOM_OAUTH_MODE_VERSION = 2;

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const TOKEN_EARLY_EXPIRY_MS = 30_000;
const PLAYLIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let memoryPlaylistCache = null;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

function storageRemove(keys) {
  return chrome.storage.local.remove(keys);
}

function base64UrlEncode(bytes) {
  const raw = btoa(String.fromCharCode(...bytes));
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

function redirectUri() {
  return chrome.identity.getRedirectURL();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeError(error, fallback = "Request failed") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return fallback;
}

async function getConfig() {
  const stored = await storageGet([
    STORAGE_KEYS.oauthClientId,
    STORAGE_KEYS.oauthClientSecret,
    STORAGE_KEYS.useCustomOauthClient,
    STORAGE_KEYS.customOauthModeVersion,
  ]);
  const storedClientId = (stored[STORAGE_KEYS.oauthClientId] || "").trim();
  const storedClientSecret = (stored[STORAGE_KEYS.oauthClientSecret] || "").trim();
  const useCustomOauthClient = stored[STORAGE_KEYS.useCustomOauthClient] === true;
  const customModeVersion = Number(stored[STORAGE_KEYS.customOauthModeVersion] || 0);
  const hasCustomClientId =
    useCustomOauthClient &&
    customModeVersion === CUSTOM_OAUTH_MODE_VERSION &&
    Boolean(storedClientId);
  return {
    oauthClientId: hasCustomClientId
      ? storedClientId
      : DEFAULT_OAUTH_CLIENT_ID,
    oauthClientSecret: hasCustomClientId ? storedClientSecret : "",
    usingDefaultClientId: !hasCustomClientId,
  };
}

async function setOauthClientId(clientId) {
  const trimmed = String(clientId || "").trim();
  if (!trimmed) {
    await storageRemove([
      STORAGE_KEYS.oauthClientId,
      STORAGE_KEYS.oauthClientSecret,
      STORAGE_KEYS.useCustomOauthClient,
      STORAGE_KEYS.customOauthModeVersion,
    ]);
    return "";
  }
  await storageSet({
    [STORAGE_KEYS.oauthClientId]: trimmed,
    [STORAGE_KEYS.useCustomOauthClient]: true,
    [STORAGE_KEYS.customOauthModeVersion]: CUSTOM_OAUTH_MODE_VERSION,
  });
  return trimmed;
}

async function setOauthClientSecret(clientSecret) {
  const trimmed = String(clientSecret || "").trim();
  if (!trimmed) {
    await storageRemove([STORAGE_KEYS.oauthClientSecret]);
    return "";
  }
  await storageSet({
    [STORAGE_KEYS.oauthClientSecret]: trimmed,
    [STORAGE_KEYS.useCustomOauthClient]: true,
    [STORAGE_KEYS.customOauthModeVersion]: CUSTOM_OAUTH_MODE_VERSION,
  });
  return trimmed;
}

async function getStoredTokenBundle() {
  const stored = await storageGet([
    STORAGE_KEYS.token,
    STORAGE_KEYS.refreshToken,
  ]);
  return {
    token: stored[STORAGE_KEYS.token] || null,
    refreshToken: stored[STORAGE_KEYS.refreshToken] || null,
  };
}

function isTokenValid(tokenBundle) {
  if (!tokenBundle?.access_token || !tokenBundle?.expires_at) return false;
  return Date.now() + TOKEN_EARLY_EXPIRY_MS < Number(tokenBundle.expires_at);
}

async function storeTokenBundle(tokenBundle) {
  const payload = {
    [STORAGE_KEYS.token]: tokenBundle,
  };
  if (tokenBundle.refresh_token) {
    payload[STORAGE_KEYS.refreshToken] = tokenBundle.refresh_token;
  }
  await storageSet(payload);
}

async function clearAuth() {
  await storageRemove([
    STORAGE_KEYS.token,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.playlistCache,
  ]);
  memoryPlaylistCache = null;
}

async function refreshAccessToken(clientId, refreshToken, clientSecret = "") {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  const data = parseJsonSafe(text);

  if (!response.ok || !data?.access_token) {
    const apiError = data?.error_description || data?.error || text;
    throw new Error(`Token refresh failed: ${apiError || response.status}`);
  }

  const expiresInMs = Math.max(0, Number(data.expires_in || 3600) * 1000);
  return {
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    scope: data.scope || YT_SCOPES.join(" "),
    expires_at: Date.now() + expiresInMs,
    refresh_token: refreshToken,
  };
}

async function interactiveAuth(clientId, clientSecret = "") {
  const verifier = randomString(96);
  const challenge = await sha256Base64Url(verifier);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", YT_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!redirectedTo) {
    throw new Error("Authorization was cancelled");
  }

  const redirectedUrl = new URL(redirectedTo);
  const authError = redirectedUrl.searchParams.get("error");
  if (authError) {
    throw new Error(`Authorization failed: ${authError}`);
  }

  const code = redirectedUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Authorization code was not returned");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await tokenResponse.text();
  const data = parseJsonSafe(text);

  if (!tokenResponse.ok || !data?.access_token) {
    const apiError = data?.error_description || data?.error || text;
    throw new Error(`Token exchange failed: ${apiError || tokenResponse.status}`);
  }

  const expiresInMs = Math.max(0, Number(data.expires_in || 3600) * 1000);
  return {
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    scope: data.scope || YT_SCOPES.join(" "),
    expires_at: Date.now() + expiresInMs,
    refresh_token: data.refresh_token || null,
  };
}

async function ensureAccessToken(options = {}) {
  const interactive = Boolean(options.interactive);
  const { oauthClientId, oauthClientSecret } = await getConfig();
  if (!oauthClientId) {
    throw new Error("OAuth client ID is not configured");
  }

  const stored = await getStoredTokenBundle();
  if (isTokenValid(stored.token)) {
    return stored.token.access_token;
  }

  if (stored.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(
        oauthClientId,
        stored.refreshToken,
        oauthClientSecret,
      );
      await storeTokenBundle(refreshed);
      return refreshed.access_token;
    } catch (error) {
      if (!interactive) {
        throw error;
      }
    }
  }

  if (!interactive) {
    throw new Error("Authentication required");
  }

  const tokenBundle = await interactiveAuth(oauthClientId, oauthClientSecret);
  await storeTokenBundle(tokenBundle);
  return tokenBundle.access_token;
}

async function youtubeRequest(url, options = {}) {
  const method = options.method || "GET";
  const interactive = Boolean(options.interactive);
  const config = await getConfig();

  let token = await ensureAccessToken({ interactive });

  async function doFetch(accessToken) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    };

    return fetch(url, {
      method,
      headers,
      body: options.body,
    });
  }

  let response = await doFetch(token);

  if (response.status === 401) {
    const stored = await getStoredTokenBundle();
    if (config.oauthClientId && stored.refreshToken) {
      const refreshed = await refreshAccessToken(
        config.oauthClientId,
        stored.refreshToken,
        config.oauthClientSecret,
      );
      await storeTokenBundle(refreshed);
      token = refreshed.access_token;
      response = await doFetch(token);
    }
  }

  const text = await response.text();
  const data = parseJsonSafe(text);
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data || {};
}

async function loadPlaylistsFromApi(interactive) {
  let pageToken = "";
  const rows = [];

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
    url.searchParams.set("part", "id,snippet,contentDetails,status");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await youtubeRequest(url.toString(), { interactive });
    const items = Array.isArray(data.items) ? data.items : [];

    items.forEach((item) => {
      const title = item?.snippet?.title || "Untitled playlist";
      rows.push({
        id: item.id,
        title,
        itemCount: Number(item?.contentDetails?.itemCount || 0),
        privacyStatus: item?.status?.privacyStatus || "private",
      });
    });

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return rows;
}

async function getPlaylists(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const interactive = Boolean(options.interactive);
  const now = Date.now();

  if (!forceRefresh && memoryPlaylistCache && now - memoryPlaylistCache.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
    return {
      playlists: memoryPlaylistCache.playlists,
      fetchedAt: memoryPlaylistCache.fetchedAt,
      source: "memory",
    };
  }

  if (!forceRefresh) {
    const stored = await storageGet([STORAGE_KEYS.playlistCache]);
    const cached = stored[STORAGE_KEYS.playlistCache];
    if (
      cached &&
      Array.isArray(cached.playlists) &&
      cached.fetchedAt &&
      now - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS
    ) {
      memoryPlaylistCache = cached;
      return {
        playlists: cached.playlists,
        fetchedAt: cached.fetchedAt,
        source: "storage",
      };
    }
  }

  const playlists = await loadPlaylistsFromApi(interactive);
  const cache = {
    playlists,
    fetchedAt: Date.now(),
  };

  memoryPlaylistCache = cache;
  await storageSet({ [STORAGE_KEYS.playlistCache]: cache });

  return {
    playlists,
    fetchedAt: cache.fetchedAt,
    source: "api",
  };
}

async function saveVideoToPlaylist({ playlistId, videoId, interactive }) {
  if (!playlistId) throw new Error("playlistId is required");
  if (!videoId) throw new Error("videoId is required");

  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");

  return youtubeRequest(url.toString(), {
    method: "POST",
    interactive,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId,
        },
      },
    }),
  });
}

async function getAuthStatus() {
  const config = await getConfig();
  const stored = await getStoredTokenBundle();
  const hasToken = Boolean(stored.token?.access_token);
  const tokenValid = isTokenValid(stored.token);
  const hasRefreshToken = Boolean(stored.refreshToken);

  return {
    hasClientId: Boolean(config.oauthClientId),
    hasClientSecret: Boolean(config.oauthClientSecret),
    usingDefaultClientId: Boolean(config.usingDefaultClientId),
    redirectUri: redirectUri(),
    hasToken,
    hasRefreshToken,
    tokenValid,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const type = message?.type;

    if (type === "YTPF_GET_AUTH_STATUS") {
      return { status: await getAuthStatus() };
    }

    if (type === "YTPF_SET_OAUTH_CLIENT_ID") {
      const clientId = await setOauthClientId(message.clientId || "");
      await clearAuth();
      return { clientId };
    }

    if (type === "YTPF_SET_OAUTH_CLIENT_SECRET") {
      const clientSecret = await setOauthClientSecret(message.clientSecret || "");
      await clearAuth();
      return { clientSecretSet: Boolean(clientSecret) };
    }

    if (type === "YTPF_CONNECT") {
      await ensureAccessToken({ interactive: true });
      return { status: await getAuthStatus() };
    }

    if (type === "YTPF_GET_PLAYLISTS") {
      const result = await getPlaylists({
        forceRefresh: Boolean(message.forceRefresh),
        interactive: Boolean(message.interactive),
      });
      return result;
    }

    if (type === "YTPF_SAVE_VIDEO") {
      const result = await saveVideoToPlaylist({
        playlistId: message.playlistId,
        videoId: message.videoId,
        interactive: Boolean(message.interactive),
      });
      return { result };
    }

    if (type === "YTPF_SIGN_OUT") {
      await clearAuth();
      return { status: await getAuthStatus() };
    }

    throw new Error(`Unsupported message type: ${type || "unknown"}`);
  })()
    .then((payload) => {
      sendResponse({ ok: true, ...payload });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: normalizeError(error) });
    });

  return true;
});

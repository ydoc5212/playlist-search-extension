# InnerTube API

The extension talks to YouTube via the **InnerTube API** — the same internal API youtube.com's own UI uses. This is not the public YouTube Data API v3.

## Why InnerTube, not Data API v3

The extension previously used the Data API v3 with OAuth. That path required:

- A Google Cloud project with the YouTube Data API enabled
- OAuth consent screen + verification
- Daily quota limits
- Refresh token management in a background service worker

InnerTube solves all of that because we're already on youtube.com:

- No quota (reasonable rate limits only)
- No OAuth — reuse the SAPISID cookie the user already has
- No background worker — call it directly from the content script
- Returns the full playlist library, paginated, without the 200-item cap the modal imposes

See commit `6ef48ac` ("Migrate to InnerTube API and unify search architecture") for the removal of the old OAuth path.

## Endpoints used

Both go through `innertubeRequest(endpoint, body)` at content.js:1076:

```
POST https://www.youtube.com/youtubei/v1/{endpoint}?key={apiKey}&prettyPrint=false
```

| Endpoint | Purpose | Called from |
|---|---|---|
| `browse` with `browseId: "FEplaylist_aggregation"` | First page of the user's playlist library | `innertubeLoadPlaylists` |
| `browse` with `continuation: <token>` | Subsequent pages | `innertubeLoadPlaylists` |
| `browse/edit_playlist` | Add a video to a playlist | `innertubeSaveVideo` |

`browseId: "FEplaylist_aggregation"` is the browse ID for the "Your playlists" aggregation shelf. It returns a paginated list of `gridPlaylistRenderer` / `playlistRenderer` entries.

## Authentication: SAPISID hash

YouTube's own web client authenticates itself using a SHA-1 hash of the `SAPISID` cookie plus a timestamp and origin. We replicate that exact scheme (content.js:1061):

```js
async function getSapisidHash() {
  const sapisid = getSapisid();                                    // from document.cookie
  if (!sapisid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisid} https://www.youtube.com`;
  const hash = sha1(input);                                         // via crypto.subtle
  return `SAPISIDHASH ${timestamp}_${hash}`;
}
```

Sent as the `Authorization` header. YouTube's server validates it against the SAPISID cookie it already has, so nothing sensitive leaves the browser — we're just proving we can read the user's cookies (which we can, because we run in a youtube.com content script).

**If the user isn't logged in, `getSapisid()` returns `null` and API calls are skipped gracefully.** The modal still works with whatever DOM rows YouTube rendered.

## Config extraction from page scripts

`getInnertubeConfig()` (content.js:20) pulls the InnerTube API key and client version out of the current page's bootstrap scripts:

```js
for (const script of document.getElementsByTagName("script")) {
  if (!script.textContent.includes("INNERTUBE_API_KEY")) continue;
  const keyMatch = script.textContent.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const verMatch = script.textContent.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
  ...
}
```

This is resilient to YouTube rotating keys or bumping client versions — we always use whatever the current page thinks is correct. `INNERTUBE_API_KEY_FALLBACK` and `INNERTUBE_CLIENT_VERSION_FALLBACK` at the top of the file are only used if extraction fails (e.g., bundler changes that break our regex).

## Pagination

`innertubeLoadPlaylists` (content.js:1194) paginates via continuation tokens:

```js
let data = await innertubeRequest("browse", { browseId: "FEplaylist_aggregation" });
for (let page = 0; page < 50; page += 1) {
  const { playlists, continuation } = parsePlaylistRenderers(data);
  for (const pl of playlists) if (!byId.has(pl.id)) byId.set(pl.id, pl);
  if (!continuation) break;
  data = await innertubeRequest("browse", { continuation });
}
```

Hard cap of 50 pages is defensive — at ~100 playlists per page that's 5000 playlists, which dwarfs any realistic user library and prevents runaway loops if YouTube's response ever omits the terminator.

## Response parsing

`parsePlaylistRenderers(data)` (content.js:1116) walks YouTube's deeply nested response and pulls out playlists from several shapes:

- `gridPlaylistRenderer` — the main shelf format
- `playlistRenderer` — alternate format
- `richItemRenderer.content` — wrapped format on newer layouts
- Continuation tokens from:
  - `continuationItemRenderer.continuationEndpoint.continuationCommand.token`
  - `grid.continuations[0].nextContinuationData.continuation` (older format)

It also handles `onResponseReceivedActions` with `appendContinuationItemsAction` / `reloadContinuationItemsCommand` for continuation responses.

All of this is necessary because YouTube varies its response shape by account, experiment bucket, and client version. The parser is intentionally permissive.

## Session cache

```js
const apiSessionCache = { playlists: null, fetchedAt: 0 };
const PLAYLIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours
```

`loadAllPlaylists()` (content.js:1352) consults this before hitting the network. One cache per extension session (i.e., per page load), shared across every modal the user opens while the page lives. **Nothing is persisted to `chrome.storage`** — we intentionally don't want to track or persist the user's playlist library.

## Stale-request cancellation

When a modal opens, `bootstrapModalApi(ctrl)` (content.js:1366) fetches playlists asynchronously. If the user closes and reopens the modal quickly, we'd have two in-flight requests. The per-controller `apiToken` counter solves this:

```js
const token = (ctrl.apiToken || 0) + 1;
ctrl.apiToken = token;
try {
  await loadAllPlaylists();
} finally {
  if (ctrl.apiToken === token) {       // still the latest request?
    ctrl.bm25 = createUnifiedIndex(...);
    applyFilter(ctrl);
  }
}
```

`teardownHost` (content.js:1422) also increments `apiToken` on close, so any pending request is treated as stale when it completes.

## Saving a video to a playlist

`innertubeSaveVideo(playlistId, videoId)` (content.js:1215):

```js
await innertubeRequest("browse/edit_playlist", {
  playlistId,
  actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId }],
});
```

Called when the user clicks the "+" button on a synthetic row (an API-only playlist that YouTube didn't render in the modal). Success flips the button to a checkmark for 160ms.

Getting the current video ID is more involved than you'd expect — `getCurrentVideoId()` (content.js:1226) tries:

1. `?v=` query param
2. `/shorts/:id` path match
3. `ytd-watch-flexy[video-id]` attribute
4. Any `[video-id]` element within the modal host
5. Any `a[href*='/watch?v=']` link

…because the modal opens from many surfaces (watch page, home feed, channel pages, shorts).

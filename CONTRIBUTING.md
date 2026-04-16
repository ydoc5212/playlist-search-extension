# Contributing

Thanks for your interest in YouTube Playlist Search! Here's how to get started.

## Development Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/ydoc5212/playlist-search-extension.git
   cd playlist-search-extension
   ```

2. Load the extension in Chrome:
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** and select the `src/` folder

3. Set up OAuth credentials (required for "Load all playlists" to work):
   - See [OAuth Setup](#oauth-setup) below

### OAuth Setup

The extension uses OAuth to authenticate and fetch playlists beyond YouTube's 200 cap. The published extension ships with its own OAuth client ID, but for local development you'll need your own:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Under APIs & Services, ensure OAuth consent screen is configured
4. Go to **Credentials** > **Create Credentials** > **OAuth client ID**
   - Application type: **Chrome extension**
   - Item ID: your extension's ID from `chrome://extensions` (changes each time you load unpacked)
5. Open the extension's service worker console (click "service worker" link on `chrome://extensions`)
6. Set your client ID:
   ```js
   chrome.storage.local.set({ ytpf_oauth_client_id: "YOUR_CLIENT_ID.apps.googleusercontent.com" })
   ```
7. Reload the extension

## Project Structure

```
src/             — Extension source (load this folder as unpacked)
  background.js  — Service worker: OAuth flow, playlist fetching, caching
  content.js     — Content script: injects search UI into YouTube's Save modal and playlist feed
  styles.css     — Injected styles (supports dark/light theme)
  vendor/        — Vendored dependencies (MiniSearch for BM25 ranking)
  icons/         — Extension icons
docs/            — Landing page, privacy policy, support (GitHub Pages)
```

## Making Changes

1. Create a branch off `main`
2. Make your changes
3. Test manually (see CONTRIBUTING guidelines)
4. Open a PR with a clear description of what changed and why

## Code Style

- Plain JS (no build step, no framework)
- Keep it simple — the extension is intentionally lightweight
- Match the existing style in the file you're editing

## Reporting Bugs

Open an issue with:
- Chrome version
- Extension version (from `manifest.json`)
- Steps to reproduce
- Screenshot or video if possible

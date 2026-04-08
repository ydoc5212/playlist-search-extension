# OAuth Config for OSS Contributors

## Problem

The published extension hardcodes an OAuth client ID tied to its Chrome Web Store listing. Contributors loading the extension unpacked get a different extension ID, so the published client ID won't work. They need a way to use their own credentials.

## Decision

Use `chrome.storage.local` as an override layer in `getConfig()`. Contributors set their client ID once via the service worker console. The hardcoded default remains the fallback for the published extension.

## What Changed

- **`background.js` — `getConfig()`**: Reads `ytpf_oauth_client_id` and `ytpf_oauth_client_secret` from `chrome.storage.local` before falling back to hardcoded defaults. The `usingDefaultClientId` flag reflects which is active.
- **`CONTRIBUTING.md`**: Updated OAuth setup instructions to use the `chrome.storage.local.set()` one-liner instead of a config file.
- **Removed `oauth_config.example.json`**: Nothing reads it; it was misleading.

## Alternatives Considered

- **Options page UI**: A dedicated page for pasting the client ID. Overkill for a dev-only setting.
- **Build step with env file**: Introduces a build step to a no-build-step project. Wrong tradeoff.

## Why `chrome.storage.local`

- Zero new infrastructure
- `clearAuth()` already cleans up these storage keys (lines 139-142), so the pattern was half-scaffolded
- One-time setup, persists across reloads
- No build step required

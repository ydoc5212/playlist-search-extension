# Privacy Policy

**Last updated:** April 13, 2026

## Overview

YouTube Playlist Search is a Chrome extension that adds an in-page search bar to YouTube's playlist selection interfaces. It fetches your playlists directly from YouTube and lets you save videos to them.

## Data Collection

This extension does **not** collect, store, transmit, or sell personal data to the extension developer or any third party. No analytics, tracking, or remote logging is performed.

## External Services

The extension communicates with the following Google services and no other external servers:

- `youtube.com` — Fetches playlist data directly from YouTube
- `oauth2.googleapis.com` — OAuth 2.0 authentication and token refresh
- `accounts.google.com` — Google sign-in consent screen

These requests are made directly from your browser to Google. The extension developer does **not** operate any intermediate servers and never receives your data.

## Authentication and Local Storage

When you sign in via Google OAuth 2.0 (`youtube.force-ssl` scope), the following data is stored locally in `chrome.storage.local` on your device:

- OAuth access token and refresh token
- Channel profile info (channel ID, title, custom URL)
- Cached playlist data (refreshed every 6 hours)
- Custom OAuth client configuration, if provided by the user

This data is used solely to authenticate and fetch your playlists. It is never transmitted to the extension developer or any server other than Google's OAuth endpoints.

## Permissions and Processing

The extension runs as a content script on `youtube.com` pages and uses a background service worker to manage playlist fetching and token storage. Playlist data is read directly from YouTube pages. All filtering is performed locally in your browser.

## Third-Party Code

The extension bundles a local copy of MiniSearch for BM25-based ranking. No remote executable code is loaded at runtime.

## Google API Services Compliance

This extension's use and transfer to any other app of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically, the extension limits its use of data obtained through Google services to providing and improving the playlist search functionality described in this policy. It does not:

- Transfer data to third parties unless necessary to provide the extension's core functionality
- Use data for serving advertisements
- Use data for purposes unrelated to the extension's playlist search and save features

## Changes

If this policy changes, the updated version will be posted on this page with a new "Last updated" date.

## Contact

Email: playlist@codyh.xyz

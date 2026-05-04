# Rive — Grayjay source plugin

TMDB-indexed multi-provider streaming aggregator for [Grayjay](https://grayjay.app). Movies, TV, anime, K-drama from public stream providers.

## Install

In Grayjay, go to **Sources → Browse → Add by URL** and paste:

```
https://raw.githubusercontent.com/ROOCKY-dev/grayjay-rive/main/RiveConfig.json
```

## How it works

- **Catalog & metadata** — TMDB (`api.themoviedb.org`).
- **Streams** — fanned out across upstream public providers (VidSrc.xyz/CloudNestra, 2Embed, Embed.su, moviesapi.club, …). The first working source is preferred; all working sources are exposed in the player's source picker.
- **TV shows** — each season is a `PlatformPlaylist`; episodes are individual `PlatformVideo`s.
- **Movies** — single `PlatformVideoDetails` with one `VideoSourceDescriptor` per upstream that resolved.

## URL scheme

```
rive://movie/<tmdbId>
rive://tv/<tmdbId>/s/<season>
rive://tv/<tmdbId>/s/<season>/e/<episode>
```

## Settings

- **Providers** — toggle individual upstream providers.
- **Language / Region** — TMDB locale.
- **Include adult content** — TMDB safe-search.
- **Per-provider timeout** — how long to wait per upstream before giving up.
- **Verbose logging** — pipes scraper traces to the dev portal Logs tab.

## Provider status

| Provider | Status | Notes |
|---|---|---|
| VidSrc.xyz / CloudNestra | ✅ Working | 3-step: vidsrc → cloudnestra/rcp → cloudnestra/prorcp → m3u8 |
| 2Embed.cc | ✅ Working (best-effort) | Shallow extraction; deeper paths TODO |
| Embed.su | 🌐 Region-locked | Off by default; flip on if reachable from your network |
| moviesapi.club | ⚠️ Naive | Greps any m3u8 in the page |
| VidSrc.cc | 🧱 Stub | Needs `vrf` token replication |

## Development

Edit `RiveScript.js`, bump `RiveConfig.json` `version`, push. Reload the source in Grayjay's developer portal (`/dev` after touching a `DEV` file in the user data dir).

## License

MIT

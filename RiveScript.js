// =============================================================================
// Rive — TMDB-indexed multi-provider streaming source for Grayjay
// =============================================================================
// Plugin contract: see Grayjay.Engine/ScriptDeps/source.js for engine globals.
// Required packages (see RiveConfig.json): Http, Utilities, DOMParser.
//
// URL scheme this plugin owns:
//   rive://movie/<tmdbId>
//   rive://tv/<tmdbId>/s/<season>                 (PlatformPlaylist)
//   rive://tv/<tmdbId>/s/<season>/e/<episode>     (PlatformVideoDetails)
//
// Claim type: 200 (defined in config). primaryClaimFieldType=1 (TMDB id).
// =============================================================================

var PLUGIN_NAME = "Rive";
var CLAIM_TYPE  = 200;
var FIELD_TMDB  = 1;

var TMDB_BASE = "https://api.themoviedb.org/3";
var IMG_BASE  = "https://image.tmdb.org/t/p";

var LANGS   = ["en-US","es-ES","fr-FR","de-DE","ja-JP","ko-KR","zh-CN","pt-BR","ar-SA"];
var REGIONS = ["US","GB","DE","FR","JP","KR","BR","SA"];
var TIMEOUTS_MS = [3000, 5000, 8000, 12000, 20000];

var _config   = null;
var _settings = null;

// ---- helpers ---------------------------------------------------------------
function tlog(msg) {
    if (_settings && _settings.verboseLogging) bridge.log("[Rive] " + msg);
}
function tmdbKey()    { return _config.constants.TMDB_KEY; }
function tmdbLang()   { return LANGS[parseInt(_settings.language || "0")]; }
function tmdbRegion() { return REGIONS[parseInt(_settings.region || "0")]; }
function providerTimeoutMs() { return TIMEOUTS_MS[parseInt(_settings.providerTimeoutMs || "1")]; }

function qs(obj) {
    var parts = [];
    for (var k in obj) {
        var v = obj[k];
        if (v === undefined || v === null || v === "") continue;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    }
    return parts.join("&");
}

function tmdb(path, q) {
    var query = q || {};
    query.api_key = tmdbKey();
    query.language = query.language || tmdbLang();
    var url = TMDB_BASE + path + "?" + qs(query);
    var res = http.GET(url, {}, false);
    if (!res.isOk) {
        tlog("TMDB " + path + " => " + res.code);
        throw new ScriptException("TMDB " + path + " returned " + res.code);
    }
    return JSON.parse(res.body);
}

function img(path, size) {
    if (!path) return null;
    return IMG_BASE + "/" + (size || "w500") + path;
}

function ts(d) {
    if (!d) return 0;
    var t = Date.parse(d);
    if (isNaN(t)) return 0;
    return Math.floor(t / 1000);
}

function tmdbAuthor() {
    return new PlatformAuthorLink(
        new PlatformID(PLUGIN_NAME, "tmdb", null, CLAIM_TYPE, 0),
        "TMDB", "https://www.themoviedb.org",
        IMG_BASE + "/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.png"
    );
}

// ---- url scheme ------------------------------------------------------------
var RX_MOVIE   = /^rive:\/\/movie\/(\d+)$/;
var RX_SEASON  = /^rive:\/\/tv\/(\d+)\/s\/(\d+)$/;
var RX_EPISODE = /^rive:\/\/tv\/(\d+)\/s\/(\d+)\/e\/(\d+)$/;

function urlMovie(tmdbId)            { return "rive://movie/" + tmdbId; }
function urlSeason(tvId, season)     { return "rive://tv/" + tvId + "/s/" + season; }
function urlEpisode(tvId, s, e)      { return "rive://tv/" + tvId + "/s/" + s + "/e/" + e; }

// =============================================================================
// source.* lifecycle
// =============================================================================
source.enable = function(conf, settings, savedState) {
    _config   = conf;
    _settings = settings || {};
    tlog("enabled. lang=" + tmdbLang() + " region=" + tmdbRegion());
};

source.disable = function() { _config = null; _settings = null; };

source.saveState = function() { return ""; };

source.getSearchCapabilities = function() {
    return new ResultCapabilities(
        [Type.Feed.Mixed, Type.Feed.Videos],
        [Type.Order.Chronological],
        []
    );
};

source.getChannelCapabilities = function() {
    return new ResultCapabilities([Type.Feed.Mixed], [], []);
};

// =============================================================================
// Home — TMDB trending/popular
// =============================================================================
source.getHome = function() {
    var data = tmdb("/trending/all/week", { region: tmdbRegion() });
    var items = mapTmdbResults(data.results || []);
    return new ContentPager(items, false, { kind: "home" });
};

// =============================================================================
// Search — TMDB multi-search
// =============================================================================
source.search = function(query, type, order, filters) {
    return doSearch(query, 1);
};

source.searchSuggestions = function(query) {
    if (!query || query.length < 2) return [];
    try {
        var data = tmdb("/search/multi", { query: query, page: "1", include_adult: !!_settings.includeAdult });
        var out = [];
        for (var i = 0; i < (data.results || []).length && out.length < 8; i++) {
            var r = data.results[i];
            if (r.media_type === "person") continue;
            var t = r.title || r.name;
            if (t && out.indexOf(t) < 0) out.push(t);
        }
        return out;
    } catch (e) { return []; }
};

function doSearch(query, page) {
    var data = tmdb("/search/multi", {
        query: query, page: String(page), include_adult: !!_settings.includeAdult
    });
    var items = mapTmdbResults((data.results || []).filter(function(r) { return r.media_type !== "person"; }));
    var hasMore = (data.page < data.total_pages);
    var ctx = { kind: "search", query: query, page: data.page };
    var pager = new ContentPager(items, hasMore, ctx);
    pager.nextPage = function() {
        var n = doSearch(query, this.context.page + 1);
        this.results = n.results;
        this.hasMore = n.hasMore;
        this.context = n.context;
        return this;
    };
    return pager;
}

// =============================================================================
// Channels — not used by Rive; we return placeholders so the host doesn't crash
// =============================================================================
source.isChannelUrl = function(url) { return false; };
source.getChannel = function(url) {
    return new PlatformChannel({
        id: new PlatformID(PLUGIN_NAME, "tmdb", null, CLAIM_TYPE, 0),
        name: "TMDB",
        url: "https://www.themoviedb.org",
        description: "Catalog provided by The Movie Database (TMDB)."
    });
};
source.getChannelContents = function(url) { return new ContentPager([], false, {}); };

// =============================================================================
// Playlist (TV season) — episodes mapped to PlatformVideo
// =============================================================================
source.isPlaylistUrl = function(url) { return RX_SEASON.test(url); };

source.getPlaylist = function(url) {
    var m = url.match(RX_SEASON);
    if (!m) throw new ScriptException("Bad season URL: " + url);
    var tvId = m[1], season = parseInt(m[2]);

    var show = tmdb("/tv/" + tvId, { append_to_response: "external_ids" });
    var s    = tmdb("/tv/" + tvId + "/season/" + season);

    var episodes = (s.episodes || []).map(function(ep) {
        var dur = (ep.runtime || (show.episode_run_time && show.episode_run_time[0]) || 0) * 60;
        return new PlatformVideo({
            id: new PlatformID(PLUGIN_NAME, "e_" + tvId + "_" + season + "_" + ep.episode_number, null, CLAIM_TYPE, FIELD_TMDB),
            name: "S" + season + "E" + ep.episode_number + ": " + (ep.name || "Episode " + ep.episode_number),
            thumbnails: new Thumbnails([new Thumbnail(img(ep.still_path, "w780") || img(show.backdrop_path, "w780"), 0)]),
            author: tmdbAuthor(),
            datetime: ts(ep.air_date),
            duration: dur,
            url: urlEpisode(tvId, season, ep.episode_number),
            shareUrl: urlEpisode(tvId, season, ep.episode_number),
            isLive: false
        });
    });

    return new PlatformPlaylistDetails({
        id: new PlatformID(PLUGIN_NAME, "s_" + tvId + "_" + season, null, CLAIM_TYPE, FIELD_TMDB),
        name: (show.name || "Season") + " — Season " + season,
        thumbnails: new Thumbnails([new Thumbnail(img(s.poster_path || show.poster_path, "w500"), 0)]),
        author: tmdbAuthor(),
        url: url,
        shareUrl: url,
        videoCount: episodes.length,
        contents: episodes
    });
};

// =============================================================================
// Content details — movie or episode → resolve providers → VideoSourceDescriptor
// =============================================================================
source.isContentDetailsUrl = function(url) {
    return RX_MOVIE.test(url) || RX_EPISODE.test(url);
};

source.getContentDetails = function(url) {
    var mm = url.match(RX_MOVIE);
    if (mm) return resolveMovie(mm[1], url);
    var em = url.match(RX_EPISODE);
    if (em) return resolveEpisode(em[1], parseInt(em[2]), parseInt(em[3]), url);
    throw new ScriptException("Unknown rive URL: " + url);
};

function resolveMovie(tmdbId, url) {
    var m = tmdb("/movie/" + tmdbId, { append_to_response: "external_ids" });
    var req = {
        type: "movie",
        tmdb: tmdbId,
        imdb: m.imdb_id || (m.external_ids && m.external_ids.imdb_id) || "",
        title: m.title || m.original_title,
        releaseYear: m.release_date ? parseInt(m.release_date.slice(0, 4)) : 0,
        runtimeSec: (m.runtime || 0) * 60
    };
    var sources = collectSources(req);
    if (sources.length === 0) throw new UnavailableException("No working providers for this title.");

    return new PlatformVideoDetails({
        id: new PlatformID(PLUGIN_NAME, "m_" + tmdbId, null, CLAIM_TYPE, FIELD_TMDB),
        name: m.title || m.original_title,
        description: buildMovieDescription(m),
        thumbnails: new Thumbnails([
            new Thumbnail(img(m.backdrop_path, "w1280"), 0),
            new Thumbnail(img(m.poster_path, "w500"), 1)
        ]),
        author: tmdbAuthor(),
        datetime: ts(m.release_date),
        duration: req.runtimeSec,
        url: url,
        shareUrl: url,
        isLive: false,
        rating: new RatingScaler(m.vote_average || 0),
        video: new VideoSourceDescriptor(sources)
    });
}

function resolveEpisode(tmdbId, season, episode, url) {
    var show = tmdb("/tv/" + tmdbId, { append_to_response: "external_ids" });
    var ep   = tmdb("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode);
    var req = {
        type: "episode",
        tmdb: tmdbId,
        imdb: (show.external_ids && show.external_ids.imdb_id) || "",
        title: show.name || show.original_name,
        releaseYear: show.first_air_date ? parseInt(show.first_air_date.slice(0, 4)) : 0,
        season: season,
        episode: episode,
        runtimeSec: (ep.runtime || (show.episode_run_time && show.episode_run_time[0]) || 0) * 60
    };
    var sources = collectSources(req);
    if (sources.length === 0) throw new UnavailableException("No working providers for this episode.");

    return new PlatformVideoDetails({
        id: new PlatformID(PLUGIN_NAME, "e_" + tmdbId + "_" + season + "_" + episode, null, CLAIM_TYPE, FIELD_TMDB),
        name: (show.name || "Episode") + " — S" + season + "E" + episode + ": " + (ep.name || ""),
        description: ep.overview || "",
        thumbnails: new Thumbnails([new Thumbnail(img(ep.still_path, "w780") || img(show.backdrop_path, "w1280"), 0)]),
        author: tmdbAuthor(),
        datetime: ts(ep.air_date),
        duration: req.runtimeSec,
        url: url,
        shareUrl: url,
        isLive: false,
        rating: new RatingScaler(ep.vote_average || 0),
        video: new VideoSourceDescriptor(sources)
    });
}

function buildMovieDescription(m) {
    var parts = [];
    if (m.tagline)  parts.push("“" + m.tagline + "”");
    if (m.overview) parts.push(m.overview);
    if (m.genres && m.genres.length)
        parts.push("Genres: " + m.genres.map(function(g){return g.name;}).join(", "));
    if (m.vote_average) parts.push("TMDB: " + m.vote_average.toFixed(1) + "/10 (" + (m.vote_count||0) + " votes)");
    return parts.join("\n\n");
}

// =============================================================================
// TMDB result -> Grayjay PlatformContent
// =============================================================================
function mapTmdbResults(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var r = arr[i];
        var mt = r.media_type;
        if (!mt) {
            if (r.title || r.release_date) mt = "movie";
            else if (r.name || r.first_air_date) mt = "tv";
            else continue;
        }
        if (mt === "movie") out.push(toMovieCard(r));
        else if (mt === "tv") out.push(toShowCard(r));
    }
    return out;
}

function toMovieCard(r) {
    return new PlatformVideo({
        id: new PlatformID(PLUGIN_NAME, "m_" + r.id, null, CLAIM_TYPE, FIELD_TMDB),
        name: r.title || r.original_title,
        thumbnails: new Thumbnails([
            new Thumbnail(img(r.poster_path, "w500"), 0),
            new Thumbnail(img(r.backdrop_path, "w1280"), 1)
        ]),
        author: tmdbAuthor(),
        datetime: ts(r.release_date),
        duration: 0,
        url: urlMovie(r.id),
        shareUrl: urlMovie(r.id),
        isLive: false
    });
}

function toShowCard(r) {
    return new PlatformPlaylist({
        id: new PlatformID(PLUGIN_NAME, "t_" + r.id + "_1", null, CLAIM_TYPE, FIELD_TMDB),
        name: r.name || r.original_name,
        thumbnails: new Thumbnails([
            new Thumbnail(img(r.poster_path, "w500"), 0),
            new Thumbnail(img(r.backdrop_path, "w1280"), 1)
        ]),
        author: tmdbAuthor(),
        datetime: ts(r.first_air_date),
        url: urlSeason(r.id, 1),
        shareUrl: urlSeason(r.id, 1),
        videoCount: -1
    });
}

// =============================================================================
// Provider fan-out
// =============================================================================
function collectSources(req) {
    var providers = [
        { setting: "useVidsrcXyz",     fn: scrapeVidSrcXyz,     name: "VidSrc.xyz"   },
        { setting: "useVidsrcCc",      fn: scrapeVidSrcCc,      name: "VidSrc.cc"    },
        { setting: "use2Embed",        fn: scrape2Embed,        name: "2Embed"       },
        { setting: "useEmbedSu",       fn: scrapeEmbedSu,       name: "Embed.su"     },
        { setting: "useMoviesApiClub", fn: scrapeMoviesApiClub, name: "moviesapi.club" }
    ];
    var out = [];
    for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        if (!_settings[p.setting]) continue;
        try {
            var streams = p.fn(req) || [];
            tlog(p.name + ": " + streams.length + " streams");
            for (var j = 0; j < streams.length; j++) out.push(streamToSource(streams[j], req));
        } catch (e) {
            tlog(p.name + " failed: " + (e.msg || e.message || e));
        }
    }
    return out;
}

// Each scraper returns [{ kind:"hls"|"mp4", name, url, headers?, w?, h?, priority? }]

function streamToSource(s, req) {
    var headers = s.headers || null;
    var modifier = headers ? new RequestModifier({ headers: headers }) : undefined;
    if (s.kind === "hls") {
        return new HLSSource({
            name: s.name,
            url: s.url,
            duration: req.runtimeSec || 0,
            priority: !!s.priority,
            requestModifier: modifier
        });
    }
    return new VideoUrlSource({
        name: s.name,
        url: s.url,
        width: s.w || 0,
        height: s.h || 0,
        container: s.container || "video/mp4",
        codec: s.codec || "",
        bitrate: s.bitrate || 0,
        duration: req.runtimeSec || 0,
        requestModifier: modifier
    });
}

// =============================================================================
// Provider scrapers
// =============================================================================
// All scrapers share these conventions:
//   - return [] (not null/undefined) on "no streams found" — they're best-effort.
//   - throw only on hard errors that should be logged.
//   - never call bridge.toast (use tlog).
//   - never block longer than providerTimeoutMs() — but http.GET is sync, so timeouts
//     are best-effort via host-level config (PluginHttpClient.setTimeout — see TODO).

// ---- VidSrc.xyz / CloudNestra ----------------------------------------------
// Chain:
//   1. GET https://vidsrc.xyz/embed/movie?tmdb=<id>  (or /tv?tmdb=<id>&season=&episode=)
//   2. extract iframe[src=//cloudnestra.com/rcp/<base64>]
//   3. GET https://cloudnestra.com/rcp/<base64>      → page contains /prorcp/<b64>
//   4. GET https://cloudnestra.com/prorcp/<b64>      → page contains `file:"https://...m3u8"`
function scrapeVidSrcXyz(req) {
    var step1Url;
    if (req.type === "movie") {
        step1Url = "https://vidsrc.xyz/embed/movie?tmdb=" + req.tmdb;
    } else {
        step1Url = "https://vidsrc.xyz/embed/tv?tmdb=" + req.tmdb +
                   "&season=" + req.season + "&episode=" + req.episode;
    }
    var r1 = http.GET(step1Url, { Referer: "https://vidsrc.xyz/" }, false);
    if (!r1.isOk) return [];
    var rcp = match(r1.body, /(cloudnestra\.com\/rcp\/[A-Za-z0-9+/=_-]+)/);
    if (!rcp) return [];

    var r2 = http.GET("https://" + rcp, { Referer: "https://vidsrc.xyz/" }, false);
    if (!r2.isOk) return [];
    var pro = match(r2.body, /(\/prorcp\/[A-Za-z0-9+/=_-]+)/);
    if (!pro) return [];

    var r3 = http.GET("https://cloudnestra.com" + pro, { Referer: "https://" + rcp }, false);
    if (!r3.isOk) return [];

    // Final URL is in `file:"<...>"` (sometimes plain, sometimes obfuscated).
    var fileUrl = match(r3.body, /file:\s*"([^"]+\.m3u8[^"]*)"/);
    if (!fileUrl) {
        // Some prorcp pages emit `file:"..."` after a base64 atob. Pull the embedded URL.
        fileUrl = match(r3.body, /(https?:\/\/[^"\s]+\.m3u8[^"\s]*)/);
    }
    if (!fileUrl) return [];

    return [{
        kind: "hls",
        name: "VidSrc.xyz",
        url: fileUrl,
        priority: true,
        headers: { Referer: "https://cloudnestra.com/" }
    }];
}

// ---- VidSrc.cc -------------------------------------------------------------
// vidsrc.cc requires a vrf token (computed client-side). Until we replicate that,
// we can still extract the embed iframe URL — useful as a fallback "watch externally"
// link, but Grayjay's player won't play an iframe. So this stub returns [] for now.
//
// To implement: study vidsrc.cc/v2/embed/<type>/<tmdb>/page.js — the JS fetches
// /api/<id>/servers?vrf=<computed>. The vrf is HMAC-ish over tmdbId+timestamp+secret.
// Mirror movie-web's vidsrcto scraper section in /tmp/mwprov/package/lib/index.js.
function scrapeVidSrcCc(req) {
    return [];
}

// ---- 2Embed.cc -------------------------------------------------------------
// Chain:
//   1. GET https://www.2embed.cc/embed/<tmdb>          (or /embedtv/<tmdb>&s=&e=)
//   2. The page contains:  <iframe src="https://streamsrcs.2embed.cc/vsrcc?imdb=<imdb>">
//   3. GET that iframe → extracts the inner m3u8 (depends on which server it routes to).
function scrape2Embed(req) {
    var step1;
    if (req.type === "movie") {
        step1 = "https://www.2embed.cc/embed/" + req.tmdb;
    } else {
        step1 = "https://www.2embed.cc/embedtv/" + req.tmdb + "&s=" + req.season + "&e=" + req.episode;
    }
    var r1 = http.GET(step1, { Referer: "https://www.2embed.cc/" }, false);
    if (!r1.isOk) return [];
    var inner = match(r1.body, /<iframe[^>]+src="([^"]+streamsrcs\.2embed\.cc[^"]+)"/);
    if (!inner) {
        // sometimes it's data-src
        inner = match(r1.body, /data-src="([^"]+streamsrcs\.2embed\.cc[^"]+)"/);
    }
    if (!inner) return [];

    var r2 = http.GET(inner, { Referer: "https://www.2embed.cc/" }, false);
    if (!r2.isOk) return [];

    // streamsrcs.2embed.cc routes to one of: vsrcc/vsrcb/swish — each ends in either
    // a direct `.m3u8` URL in the body, or another iframe redirect. Try the simple
    // case first; deeper extraction is left for iteration.
    var m3u8 = match(r2.body, /(https?:\/\/[^"\s]+\.m3u8[^"\s]*)/);
    if (m3u8) {
        return [{
            kind: "hls",
            name: "2Embed (vsrcc)",
            url: m3u8,
            headers: { Referer: "https://streamsrcs.2embed.cc/" }
        }];
    }
    return [];
}

// ---- Embed.su --------------------------------------------------------------
// embed.su's stream URL is at /api/<type>/<tmdb>(/<season>/<episode>) which
// returns JSON like { hls: "..." } when not region-blocked. Stubbed; flip on
// the setting to test from your network.
function scrapeEmbedSu(req) {
    var apiPath = req.type === "movie"
        ? "/api/movie/" + req.tmdb
        : "/api/tv/" + req.tmdb + "/" + req.season + "/" + req.episode;
    var r = http.GET("https://embed.su" + apiPath, {
        Referer: "https://embed.su/",
        "User-Agent": "Mozilla/5.0"
    }, false);
    if (!r.isOk) return [];
    try {
        var j = JSON.parse(r.body);
        var out = [];
        if (j.hls)   out.push({ kind:"hls", name:"Embed.su (HLS)", url: j.hls,   headers: { Referer:"https://embed.su/" }});
        if (j.mp4)   out.push({ kind:"mp4", name:"Embed.su (MP4)", url: j.mp4 });
        return out;
    } catch (e) { return []; }
}

// ---- moviesapi.club --------------------------------------------------------
// moviesapi.club returns an iframe page; the m3u8 is inside the inner JS.
// Stubbed for incremental implementation.
function scrapeMoviesApiClub(req) {
    var u;
    if (req.type === "movie") u = "https://moviesapi.club/movie/" + req.tmdb;
    else u = "https://moviesapi.club/tv/" + req.tmdb + "-" + req.season + "-" + req.episode;
    var r = http.GET(u, { "User-Agent": "Mozilla/5.0" }, false);
    if (!r.isOk) return [];
    var m3u8 = match(r.body, /(https?:\/\/[^"\s]+\.m3u8[^"\s]*)/);
    if (!m3u8) return [];
    return [{ kind: "hls", name: "moviesapi.club", url: m3u8, headers: { Referer: "https://moviesapi.club/" }}];
}

// =============================================================================
// utility
// =============================================================================
function match(text, re) {
    if (!text) return null;
    var m = text.match(re);
    return m ? m[1] : null;
}

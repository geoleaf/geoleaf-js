import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
    // Base URL for deployment under geoleaf.dev/docs/
    base: "/docs/",

    // Source directory = docs/ folder (config.ts is in docs/.vitepress/)
    srcDir: ".",

    // Build output — outside `docs/` (conflict with the TypeDoc `api/` folder)
    // AND outside `packages/`: the `packages/*` workspace glob caught it, and a
    // manifest-less directory was only TOLERATED there by
    // `scripts/lib/packages.cjs`, never declared. Three climbs: `docs/` →
    // `core/` → `packages/` → root. Resolved by VitePress against `root`, which
    // is `packages/core/docs` (the CLI receives `vitepress build docs` with cwd
    // `packages/core`).
    outDir: "../../../docs-dist",

    // Exclude TypeDoc generated HTML (not markdown-based pages)
    srcExclude: ["api/**/*.md", "api/**/*.html"],

    lang: "en-US",
    title: "GeoLeaf",
    description: "GeoLeaf documentation — @geoleaf/core v3.0.0",

    // Set to `false` once the 26 dead links were repaired. While it was `true`,
    // VitePress MASKED dead links at build: combined with a `check:links` wired
    // nowhere, NOTHING protected the public docs' links. That is the hole
    // through which MIGRATION_V1_V2.md shipped (b3d85253, 03-30) leaving 4
    // 404 links in production. The build now fails on a dead link — a second
    // net, on top of the CI + pre-commit gate.
    // `false` = the build FAILS on a dead link. This is not revisited — it is
    // the second net that caught 26 dead links, and the only protection in
    // place while `docs:build` is not wired into `ci:local`.
    //
    // The exception below is a ROOT exception, not a wrong link (2026-07-30).
    // `NOTICE.md` ships in the npm tarball (the core's `files[]` contains
    // `docs/` AND `LICENSE`), and for that reader `../LICENSE` resolves exactly
    // onto `packages/core/LICENSE`, which exists. For the site, `NOTICE.md`
    // becomes `/docs/NOTICE.html` and `../LICENSE` leaves the site: no single
    // string can resolve in both roots at once. The choice is thus between
    // duplicating the legal file and declaring the exception — we declare, and
    // keep ONE source of truth.
    // ⚠️ The motive is the ROOTS' DIVERGENCE; any other dead target must redden.
    // ⚠️ The pattern matches the form VitePress NORMALISES (`./../LICENSE`), not
    // the form written in the markdown (`../LICENSE`) — verified by seeing it
    // fail first.
    ignoreDeadLinks: [/^\.\/\.\.\/LICENSE$/],

    head: [
        ["link", { rel: "icon", href: "/docs/favicon.ico" }],
        ["meta", { name: "theme-color", content: "#2E9B5F" }],
    ],

    themeConfig: {
        logo: "/logo.png",
        logoLink: "https://www.geoleaf.dev",
        siteTitle: "GeoLeaf",

        // ── Navigation bar ──
        nav: [
            { text: "Get started", link: "/GETTING_STARTED" },
            { text: "API", link: "/API_REFERENCE" },
            { text: "Home", link: "https://www.geoleaf.dev", target: "_self", rel: "" },
        ],

        // ── Sidebar ──
        sidebar: [
            {
                text: "Getting started",
                items: [
                    { text: "Getting Started", link: "/GETTING_STARTED" },
                    { text: "Quickstart Tutorial", link: "/QUICKSTART_TUTORIAL" },
                    { text: "CDN / NPM usage", link: "/usage-cdn" },
                    { text: "FAQ", link: "/FAQ" },
                    { text: "Changelog", link: "/CHANGELOG" },
                ],
            },
            {
                text: "Configuration",
                items: [
                    { text: "Configuration Guide", link: "/CONFIGURATION_GUIDE" },
                    { text: "Profiles Guide", link: "/PROFILES_GUIDE" },
                    { text: "Profile JSON Reference", link: "/PROFILE_JSON_REFERENCE" },
                    { text: "Plugin Configuration", link: "/PLUGIN_CONFIGURATION_GUIDE" },
                ],
            },
            {
                text: "Concepts",
                items: [
                    { text: "Architecture", link: "/ARCHITECTURE_GUIDE" },
                    { text: "User Guide", link: "/USER_GUIDE" },
                ],
            },
            {
                text: "API Reference",
                items: [
                    { text: "API Reference", link: "/API_REFERENCE" },
                    { text: "Events API", link: "/EVENTS_API" },
                    { text: "Notifications API", link: "/notifications/NOTIFICATIONS_API" },
                    {
                        text: "TypeDoc (generated API)",
                        link: "/api/index.html",
                    },
                ],
            },
            {
                text: "Modules",
                collapsed: true,
                items: [
                    { text: "Core", link: "/core/GeoLeaf_core_README" },
                    { text: "UI", link: "/ui/GeoLeaf_UI_README" },
                    { text: "UI Controls", link: "/ui/GeoLeaf_UI_Controls_README" },
                    { text: "UI Components", link: "/ui/GeoLeaf_UI_Components_README" },
                    { text: "Baselayers", link: "/baselayers/GeoLeaf_Baselayers_README" },
                    { text: "Layer Manager", link: "/layer-manager/GeoLeaf_LayerManager_README" },
                    { text: "Legend", link: "/legend/GeoLeaf_Legend_README" },
                    { text: "Labels", link: "/labels/GeoLeaf_Labels_README" },
                    { text: "Log", link: "/log/GeoLeaf_Logging_README" },
                    { text: "Errors", link: "/errors/GeoLeaf_Errors_README" },
                    { text: "Validators", link: "/validators/GeoLeaf_Validators_README" },
                    { text: "Helpers", link: "/helpers/GeoLeaf_Helpers_README" },
                    { text: "Utils", link: "/utils/GeoLeaf_Utils_README" },
                    { text: "Constants", link: "/constants/GeoLeaf_Constants_README" },
                    { text: "Config", link: "/config/GeoLeaf_Config_README" },
                    { text: "Security", link: "/security/GeoLeaf_Security_README" },
                    { text: "Performance", link: "/performance/PERFORMANCE_ARCHITECTURE" },
                ],
            },
            {
                text: "GeoJSON & Layers",
                collapsed: true,
                items: [
                    { text: "GeoJSON Layers Guide", link: "/geojson/GEOJSON_LAYERS_GUIDE" },
                    { text: "MVT / Vector Tiles", link: "/geojson/MVT_GUIDE" },
                    { text: "Config Layers", link: "/config/LAYER_CONFIG" },
                    { text: "Config Scale", link: "/config/SCALE_CONFIG" },
                    { text: "Data Normalizer", link: "/config/data-normalizer" },
                ],
            },
            {
                text: "Plugins & Extensions",
                items: [
                    { text: "Plugin Development", link: "/PLUGIN_DEVELOPMENT_GUIDE" },
                    { text: "Core Extension", link: "/CORE_EXTENSION_GUIDE" },
                    // ⚠️ "Connector Guide" removed on 2026-08-10 — the page moved
                    // to `packages/plugins/connector/docs/`, outside this site's
                    // `srcDir` (which is `packages/core/docs`). Leaving it would
                    // have produced a 404 in the sidebar: a nav entry does not go
                    // through VitePress's dead-link detection, nobody would have
                    // seen it.
                    // 🛑 Assumed consequence of the move: the connector guide is
                    // no longer on the docs site. Putting it back would mean
                    // widening the `srcDir` to several packages — different work
                    // from this.
                ],
            },
            {
                text: "Advanced",
                collapsed: true,
                items: [
                    { text: "Accessibility", link: "/ACCESSIBILITY" },
                    { text: "Security (CSP)", link: "/SECURITY" },
                    { text: "Security Module", link: "/security/GeoLeaf_Security_README" },
                    { text: "Security Contract", link: "/security/SECURITY_CONTRACT" },
                    { text: "Permalink / Deep Link", link: "/ui/PERMALINK" },
                    { text: "Breakpoints", link: "/ui/BREAKPOINTS" },
                    { text: "Cache Button", link: "/ui/cache-button" },
                    // 2026-08-11 — `/pwa/pwa` and `/pwa` documented the same
                    // subject; the second won (it is also TypeDoc's
                    // `projectDocuments`). The first survives as a redirect page,
                    // off the sidebar.
                    { text: "PWA", link: "/pwa" },
                    { text: "Versioning Policy", link: "/VERSIONING_POLICY" },
                    { text: "Performance Metrics", link: "/PERFORMANCE_METRICS" },
                    { text: "JSON Schemas", link: "/schema/README" },
                    { text: "Legal / NOTICE", link: "/NOTICE" },
                ],
            },
            {
                text: "Recipes",
                items: [{ text: "Cookbook", link: "/COOKBOOK" }],
            },
            {
                text: "Releases",
                items: [
                    { text: "v2.0.0 — MapLibre migration", link: "/releases/PATCHNOTE_V2.0.0" },
                ],
            },
        ],

        // ── Social links ──
        socialLinks: [{ icon: "github", link: "https://github.com/geoleaf/geoleaf-js" }],

        // ── Search ──
        search: {
            provider: "local",
        },

        // ── Footer ──
        footer: {
            message: "Released under the MIT License.",
            copyright: "© 2026 Mattieu Pottier — geoleaf.dev",
        },
    },

    // ── Markdown config ──
    markdown: {
        lineNumbers: false,
    },
});

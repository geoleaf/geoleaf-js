import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
    // Base URL for deployment under geoleaf.dev/docs/
    base: "/docs/",

    // Source directory = docs/ folder (config.ts is in docs/.vitepress/)
    srcDir: ".",

    // Build output — hors de `docs/` (conflit avec le dossier TypeDoc `api/`) ET hors de
    // `packages/` depuis T4.4 : le glob workspace `packages/*` le captait, et un
    // répertoire sans manifeste n'y était que TOLÉRÉ par `scripts/lib/packages.cjs`,
    // jamais déclaré. Trois remontées : `docs/` → `core/` → `packages/` → racine.
    // Résolu par VitePress contre `root`, qui vaut `packages/core/docs` (la CLI reçoit
    // `vitepress build docs` avec cwd `packages/core`).
    outDir: "../../../docs-dist",

    // Exclude TypeDoc generated HTML (not markdown-based pages)
    srcExclude: ["api/**/*.md", "api/**/*.html"],

    title: "GeoLeaf",
    description: "Documentation GeoLeaf — @geoleaf/core v3.0.0",

    // S7bis.10 — passé à `false` une fois les 26 liens morts réparés. Tant qu'il valait
    // `true`, VitePress MASQUAIT les liens morts au build : combiné à `check:links` qui
    // n'était câblé nulle part, RIEN ne protégeait les liens de la doc publique. C'est le
    // trou par lequel MIGRATION_V1_V2.md est sorti (b3d85253, 30/03) en laissant 4 liens
    // 404 en production. Le build échoue désormais sur un lien mort — second filet,
    // en plus du gate CI + pre-commit.
    // S7bis.10 : `false` = le build ÉCHOUE sur un lien mort. On ne revient pas là-dessus —
    // c'est le second filet qui a rattrapé 26 liens morts, et la seule protection en place
    // tant que `docs:build` n'est pas câblé dans `ci:local`.
    //
    // L'exception ci-dessous est une exception de RACINE, pas un lien faux (30/07/2026).
    // `NOTICE.md` est livré dans le tarball npm (`files[]` du core contient `docs/` ET
    // `LICENSE`), et pour ce lecteur-là `../LICENSE` résout exactement sur
    // `packages/core/LICENSE`, qui existe. Pour le site, `NOTICE.md` devient
    // `/docs/NOTICE.html` et `../LICENSE` sort du site : aucune chaîne unique ne peut
    // résoudre dans les deux racines à la fois. Le choix est donc entre dupliquer le
    // fichier légal et déclarer l'exception — on déclare, et on garde UNE source de vérité.
    // ⚠️ Le motif est la DIVERGENCE DES RACINES ; toute autre cible morte doit rougir.
    // ⚠️ Le motif matche la forme NORMALISÉE par VitePress (`./../LICENSE`), pas la forme
    // écrite dans le markdown (`../LICENSE`) — vérifié en le voyant échouer d'abord.
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
            { text: "Démarrage", link: "/GETTING_STARTED" },
            { text: "API", link: "/API_REFERENCE" },
            { text: "Accueil", link: "https://www.geoleaf.dev", target: "_self", rel: "" },
        ],

        // ── Sidebar ──
        sidebar: [
            {
                text: "Démarrage",
                items: [
                    { text: "Getting Started", link: "/GETTING_STARTED" },
                    { text: "Tutoriel Quickstart", link: "/QUICKSTART_TUTORIAL" },
                    { text: "Usage CDN / NPM", link: "/usage-cdn" },
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
                        text: "TypeDoc (API générée)",
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
                text: "GeoJSON & Couches",
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
                    // ⚠️ « Connector Guide » retiré le 10/08/2026 — la page a déménagé dans
                    // `packages/plugins/connector/docs/`, hors du `srcDir` de ce site (qui
                    // vaut `packages/core/docs`). Le laisser aurait produit un 404 dans la
                    // barre latérale : une entrée de nav ne passe pas par la détection de
                    // liens morts de VitePress, elle n'aurait été vue par personne.
                    // 🛑 Conséquence assumée du déménagement : le guide du connector n'est
                    // plus sur le site de doc. Le remettre suppose d'élargir le `srcDir` à
                    // plusieurs paquets, ce qui est un autre chantier que celui-ci.
                ],
            },
            {
                text: "Avancé",
                collapsed: true,
                items: [
                    { text: "Accessibilité", link: "/ACCESSIBILITY" },
                    { text: "Sécurité (CSP)", link: "/SECURITY" },
                    { text: "Security Module", link: "/security/GeoLeaf_Security_README" },
                    { text: "Security Contract", link: "/security/SECURITY_CONTRACT" },
                    { text: "Permalink / Deep Link", link: "/ui/PERMALINK" },
                    { text: "Breakpoints", link: "/ui/BREAKPOINTS" },
                    { text: "Cache Button", link: "/ui/cache-button" },
                    { text: "PWA", link: "/pwa/pwa" },
                    { text: "Versioning Policy", link: "/VERSIONING_POLICY" },
                    { text: "Performance Metrics", link: "/PERFORMANCE_METRICS" },
                    { text: "Schémas JSON", link: "/schema/README" },
                    { text: "Legal / NOTICE", link: "/NOTICE" },
                ],
            },
            {
                text: "Recettes",
                items: [{ text: "Cookbook", link: "/COOKBOOK" }],
            },
            {
                text: "Releases",
                items: [
                    { text: "v2.0.0 — Migration MapLibre", link: "/releases/PATCHNOTE_V2.0.0" },
                ],
            },
        ],

        // ── Social links ──
        socialLinks: [
            { icon: "github", link: "https://github.com/geoleaf/geoleaf-js" },
        ],

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

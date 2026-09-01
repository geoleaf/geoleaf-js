/**
 * GeoLeaf — Initialization script of the deployable application.
 *
 * Registers the lazy plugin slots and bootstraps GeoLeaf. This is the SINGLE source of the
 * deploy variants: `build-deploy.cjs` strips the `GEOLEAF-DEPLOY:GATED-BLOCK` sections from
 * it per variant, so a block's placement is load-bearing (see APP-07).
 *
 * Extracted from inline scripts for CSP compliance (no 'unsafe-inline').
 */

// PWA — the Service Worker is registered by GeoLeaf's `pwa` capability (gated on
// modules.pwa.enabled), not here, so a core-only page honours the opt-in gate.

// Lazy-load table / print / measure / editor on first use. Bundles are NOT loaded at boot;
// toolbar buttons appear immediately via registerLazyForAction. Icons are copied from each
// plugin's entry.ts and are stable across minor versions.
//
// 🛑 EVERY SLOT BELOW DECLARES `modules.<id>.showButton` AS `profileKey`, WITH THE `ui.show*`
// FLAG AS `legacyProfileKey` — NEVER THE LEGACY KEY ALONE. The pair mirrors what the owning
// package declares in its own `entry.ts`, and the two declarations must not drift: this file
// draws the button when the plugin is lazy, `entry.ts` draws it when an integrator loads the
// bundle eagerly, and a profile cannot tell which one it is talking to.
//
// ⚠️ Four slots carried the legacy key ALONE until 20/08/2026 — print, measure, editor and
// geocoding. Measured on a served profile: `modules.print.showButton: false` left the button
// drawn, because the slot never read that key, while `getPrintConfig()` reads it as its ONLY
// source. The flag the plugin documents and the flag the button obeys were two different
// flags. `resolveUISlotVisibility` tries `profileKey` first and falls back to
// `legacyProfileKey` only when it resolves to undefined, so declaring both honours the
// canonical key without breaking a profile that still writes the legacy one.
//
// 📌 The legacy key is `ui.showPrint`, NOT `showPrint`: `config/core/ui.json` wraps its
// payload in a `"ui"` object, and `profile-loader.ts` spreads that payload into the profile
// root — so the flag lands back under `ui.`. A probe that patches one level too high reads
// `undefined` and makes a live key look dead. It cost a wrong diagnosis on this very line.
(function () {
    const gl = window.GeoLeaf;
    if (!gl?.plugins || !gl?.registry || !gl?.I18n) return;

    // ── Table ─────────────────────────────────────────────────────────────────
    const _TABLE_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
        '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>' +
        "</svg>";
    gl.I18n.registerDict("table", {
        fr: { "table.toolbar.button": "Tableau" },
        en: { "table.toolbar.button": "Table" },
    });
    gl.plugins.registerLazy("table", () => import("./dist/geoleaf-table.plugin.js"));
    gl.plugins.registerLazyForAction("table", "table", {
        mobileIcon: {
            icon: _TABLE_ICON,
            labelKey: "table.toolbar.button",
            profileKey: "modules.table.showButton",
            action: "table",
        },
        desktopTabButton: {
            icon: _TABLE_ICON,
            labelKey: "table.toolbar.button",
            profileKey: "modules.table.showButton",
            action: "table",
            variant: "tab",
        },
    });

    // ── Print ─────────────────────────────────────────────────────────────────
    const _PRINT_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="6 9 6 2 18 2 18 9"/>' +
        '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>' +
        '<rect x="6" y="14" width="12" height="8"/>' +
        "</svg>";
    gl.I18n.registerDict("print", {
        fr: { "print.toolbar.button": "Imprimer" },
        en: { "print.toolbar.button": "Print" },
        es: { "print.toolbar.button": "Imprimir" },
        pt: { "print.toolbar.button": "Imprimir" },
        it: { "print.toolbar.button": "Stampa" },
        de: { "print.toolbar.button": "Drucken" },
    });
    gl.plugins.registerLazy("print", () => import("./dist/geoleaf-print.plugin.js"));
    gl.plugins.registerLazyForAction("print", "print", {
        // Gated on `modules.print.enabled` — this plugin's `entry.ts` carries the
        // SAME `!== false`. Opt-in: `table`, `geocoding` and `position-share` do
        // not gate, and `profiles/tourism` proves why (`position-share` is
        // `enabled: false` there with `showButton: true` — the button IS the
        // emission switch).
        gateOnModuleEnabled: true,
        mobileIcon: {
            icon: _PRINT_ICON,
            labelKey: "print.toolbar.button",
            profileKey: "modules.print.showButton",
            legacyProfileKey: "ui.showPrint",
            action: "print",
        },
        desktopTabButton: {
            icon: _PRINT_ICON,
            labelKey: "print.toolbar.button",
            profileKey: "modules.print.showButton",
            legacyProfileKey: "ui.showPrint",
            action: "print",
        },
    });

    // ── Measure ───────────────────────────────────────────────────────────────
    const _MEASURE_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 20 L20 2"/>' +
        '<path d="M2 20 L2 14 L8 20 Z"/>' +
        '<line x1="6" y1="18" x2="9" y2="15"/>' +
        '<line x1="10" y1="14" x2="13" y2="11"/>' +
        '<line x1="14" y1="10" x2="17" y2="7"/>' +
        "</svg>";
    gl.I18n.registerDict("measure", {
        fr: { "measure.toolbar.button": "Mesurer" },
        en: { "measure.toolbar.button": "Measure" },
        es: { "measure.toolbar.button": "Medir" },
        pt: { "measure.toolbar.button": "Medir" },
        it: { "measure.toolbar.button": "Misurare" },
        de: { "measure.toolbar.button": "Messen" },
    });
    gl.plugins.registerLazy("measure", () => import("./dist/geoleaf-measure.plugin.js"));
    gl.plugins.registerLazyForAction("measure", "measure", {
        gateOnModuleEnabled: true,
        mobileIcon: {
            icon: _MEASURE_ICON,
            labelKey: "measure.toolbar.button",
            profileKey: "modules.measure.showButton",
            legacyProfileKey: "ui.showMeasure",
            action: "measure",
        },
    });

    // ─── GEOLEAF-DEPLOY:GATED-BLOCK editor ─── START ────────────────────────────
    // 🛑 FUNCTIONAL MARKER — `build-deploy.cjs` strips this block on any variant built with
    // `includeEditor: false`. Without it the slots below stay registered on a variant that
    // does not ship the bundle: `isLazyAvailable()` returns true (it probes no file), the
    // button gets painted, and the click leaves on a 404.
    // ⚠️ EVERY `editor` REGISTRATION MUST LIVE BETWEEN THESE TWO MARKERS — APP-07 checks it.
    // ── Editor ────────────────────────────────────────────────────────────────
    const _EDITOR_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
        '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
        "</svg>";
    // 🛑 LAZY-SLOT LABELS ARE DECLARED HERE, NOT IN THE PACKAGE. `labelKey` is resolved AT BOOT
    // into the button's aria-label, while the plugin's own dictionary only loads on first click
    // — and `I18n.getLabel` returns the raw KEY when it does not know it. A label living only
    // in the package therefore yields a button whose accessible name is the key. Values are
    // DERIVED from the package catalogue, never rewritten.
    gl.I18n.registerDict("editor", {
        fr: {
            "editor.toolbar.button": "Éditeur",
            "editor.export.session": "Exporter cette session",
            "editor.toolbar.poi_add": "Ajouter un POI",
        },
        en: {
            "editor.toolbar.button": "Editor",
            "editor.export.session": "Export this session",
            "editor.toolbar.poi_add": "Add POI",
        },
        es: {
            "editor.toolbar.button": "Editor",
            "editor.export.session": "Exportar esta sesión",
            "editor.toolbar.poi_add": "Añadir POI",
        },
        pt: {
            "editor.toolbar.button": "Editor",
            "editor.export.session": "Exportar esta sessão",
            "editor.toolbar.poi_add": "Adicionar POI",
        },
        it: {
            "editor.toolbar.button": "Editor",
            "editor.export.session": "Esporta questa sessione",
            "editor.toolbar.poi_add": "Aggiungi POI",
        },
        de: {
            "editor.toolbar.button": "Editor",
            "editor.export.session": "Diese Sitzung exportieren",
            "editor.toolbar.poi_add": "POI hinzufügen",
        },
    });
    // ── navigation — LAZY, and WITHOUT a toolbar slot ────────────────────────────────────
    //
    // 🛑 No `registerLazyForAction` here, deliberately. Guidance has nothing to
    // follow while no route exists: a toolbar button would be a control that
    // does nothing most of the time, and `modules.navigation.showButton` is
    // `false` for exactly that reason. The entry point lives where the route
    // lives — in `routing`'s panel, which is loaded EAGER and thus always knows
    // when to offer the button.
    //
    // ⚠️ `routing` tests availability with `isLazyAvailable`, NEVER `isLoaded`: a
    // lazy plugin only enters the registry after its load, and the only gesture
    // that would load it is precisely this button. Gating on `isLoaded` would
    // hide the entry point behind the condition it serves to satisfy.
    gl.plugins.registerLazy("navigation", () => import("./dist/geoleaf-navigation.plugin.js"));

    gl.plugins.registerLazy("editor", () => import("./dist/geoleaf-editor.plugin.js"));
    gl.plugins.registerLazyForAction("editor", "editor", {
        gateOnModuleEnabled: true,
        mobileIcon: {
            icon: _EDITOR_ICON,
            labelKey: "editor.toolbar.button",
            profileKey: "modules.editor.showButton",
            legacyProfileKey: "ui.showEditor",
            action: "editor",
        },
    });

    // Session export button. It must be declared HERE: the toolbar is built at boot while the
    // plugin is lazy, so registering it from the package produces no button at all.
    const _EXPORT_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>' +
        "</svg>";
    gl.plugins.registerLazyForAction("editor-export-session", "editor", {
        gateOnModuleEnabled: true,
        mobileIcon: {
            icon: _EXPORT_ICON,
            labelKey: "editor.export.session",
            profileKey: "modules.editor.showExport",
            action: "editor-export-session",
        },
    });

    // "Add POI" button — this is the only place that makes it visible. The core used to draw it
    // by probing a global at boot, which only worked while the owning plugin was eager.
    const _POI_ADD_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 2 C 6.5 2 2 6.5 2 12 C 2 17.5 6.5 22 12 22 C 17.5 22 22 17.5 22 12' +
        ' C 22 6.5 17.5 2 12 2 M12 8 L12 16 M8 12 L16 12"/>' +
        "</svg>";
    gl.plugins.registerLazyForAction("poi-add", "editor", {
        gateOnModuleEnabled: true,
        mobileIcon: {
            icon: _POI_ADD_ICON,
            labelKey: "editor.toolbar.poi_add",
            profileKey: "modules.editor.showAddPoi",
            action: "poi-add",
        },
    });
    // ─── GEOLEAF-DEPLOY:GATED-BLOCK editor ─── END ──────────────────────────────

    // 🛑 A LAZY PLUGIN EXECUTES NOTHING UNTIL IT IS LOADED — including its `addEventListener`.
    // `realtime-layer` subscribes to `geoleaf:app:ready` AT IMPORT TIME, so a bare
    // `registerLazy` would leave it permanently mute, with no error and no trace. Each
    // registration below therefore names WHAT loads it.
    // ⚠️ `offline-ui` is not in this list — it stays eager, see the comment in index.html.

    // ── Pure APIs — no listener, no slot: the consumer calls `plugins.load(id)` then the API.
    // ─── GEOLEAF-DEPLOY:GATED-BLOCK cog ─── START ──────────────────────────────
    // 🛑 FUNCTIONAL MARKER — `build-deploy.cjs` strips this block when `includeCog: false`.
    // Without it `isLazyAvailable("cog")` returns true on a variant that ships no bundle, and
    // the first `plugins.load("cog")` leaves on a 404. Checked by APP-07.
    gl.plugins.registerLazy("cog", () => import("./dist/geoleaf-cog.plugin.js"));
    // ─── GEOLEAF-DEPLOY:GATED-BLOCK cog ─── END ────────────────────────────────
    gl.plugins.registerLazy("file-import", () => import("./dist/geoleaf-file-import.plugin.js"));
    gl.plugins.registerLazy("websocket", () => import("./dist/geoleaf-websocket.plugin.js"));

    // ── Declarative layer — loaded by the core's `ensurePluginLoaded` seam when a profile
    // names the plugin. Without that seam the layer would be skipped at 0 feature, and the
    // only signal would be a `warn`.
    gl.plugins.registerLazy("flatgeobuf", () => import("./dist/geoleaf-flatgeobuf.plugin.js"));

    // ── Toolbar slot — the button is declared BEFORE the bundle ────────────────
    gl.I18n.registerDict("geocoding", {
        fr: { "geocoding.toolbar.button": "Rechercher" },
        en: { "geocoding.toolbar.button": "Search" },
        es: { "geocoding.toolbar.button": "Buscar" },
        pt: { "geocoding.toolbar.button": "Pesquisar" },
        it: { "geocoding.toolbar.button": "Cercare" },
        de: { "geocoding.toolbar.button": "Suchen" },
    });
    const _SEARCH_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>' +
        "</svg>";
    gl.plugins.registerLazy("geocoding", () => import("./dist/geoleaf-geocoding.plugin.js"));
    gl.plugins.registerLazyForAction("geocoding", "geocoding", {
        mobileIcon: {
            icon: _SEARCH_ICON,
            labelKey: "geocoding.toolbar.button",
            profileKey: "modules.geocoding.showButton",
            legacyProfileKey: "ui.showGeocoding",
            action: "geocoding",
        },
    });

    // ── Position share ────────────────────────────────────────────────────────
    const _POSITION_SHARE_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' +
        '<circle cx="12" cy="12" r="8"/>' +
        "</svg>";
    gl.I18n.registerDict("position-share", {
        fr: { "position-share.toolbar.button": "Partager ma position" },
        en: { "position-share.toolbar.button": "Share my position" },
    });
    gl.plugins.registerLazy(
        "position-share",
        () => import("./dist/geoleaf-position-share.plugin.js")
    );
    gl.plugins.registerLazyForAction("position-share", "position-share", {
        mobileIcon: {
            icon: _POSITION_SHARE_ICON,
            labelKey: "position-share.toolbar.button",
            profileKey: "modules.position-share.showButton",
            action: "position-share",
        },
        desktopTabButton: {
            icon: _POSITION_SHARE_ICON,
            labelKey: "position-share.toolbar.button",
            profileKey: "modules.position-share.showButton",
            action: "position-share",
            variant: "tab",
        },
    });

    // ── Profile-dependent — preloaded by `beforeBoot`, below ───────────────────
    gl.plugins.registerLazy(
        "realtime-layer",
        () => import("./dist/geoleaf-realtime-layer.plugin.js")
    );
    gl.plugins.registerLazy("connector", () => import("./dist/geoleaf-connector.plugin.js"));

    // navigation is LAZY, and it is the exact counterpart of routing being eager. Guidance is
    // only ever entered AFTER a route exists — that is, from an interface already drawn by a
    // plugin already loaded — so the guard that forces routing to load early does not apply,
    // and this is the heavier of the two. It declares `requires: ["routing"]`, which the eager
    // tag in index.html satisfies before this resolver is ever called.
    gl.plugins.registerLazy("navigation", () => import("./dist/geoleaf-navigation.plugin.js"));
})();

// ── DEV-ONLY — Connector bootstrap (auth) ───────────────────────────────────
// `window.GEOLEAF_DEV_CONNECTOR = { baseUrl, getToken }` is set — if at all — by
// connector.local.js, loaded by a tag that only exists in `deploy-local`. It attaches the
// bearer on authenticated reads and `editor` writes against the dev backend. Template:
// connector.local.example.js. In production a real login flow (Connector `auth.endpoint`)
// issues the token to the authenticated user.
//
// 🛑 THIS FILE IMPORTS NOTHING, AND THAT IS DELIBERATE. Containment is STRUCTURAL: a shipped
// variant has neither the file nor the tag that loads it, so this test is false there by
// construction. A hostname guard would only bound EXECUTION — a secret is READ, not run.
// ⚠️ Do NOT spell the loader's import specifier out in a comment: APP-06 matches specifiers
// on RAW TEXT, without distinguishing code from comment, and it is right to do so.
if (window.GEOLEAF_DEV_CONNECTOR) {
    // `connector` is lazy, so `GeoLeaf.Connector` is undefined here: load, then configure.
    // Guarding on `GeoLeaf?.Connector?.configure` instead would skip the configuration in
    // silence, and the dev would see authenticated reads fail with nothing saying why.
    try {
        await GeoLeaf.plugins.load("connector");
        await GeoLeaf.Connector.configure(window.GEOLEAF_DEV_CONNECTOR);
    } catch (e) {
        console.warn("[GeoLeaf] Connector dev config failed:", e);
    }
}

// ── Preloading the plugins THE PROFILE requires ─────────────────────────────
// `beforeBoot` is the only point of the cycle that runs AFTER the profile config is loaded and
// BEFORE the map is created — so before `geoleaf:profile:loaded`, `geoleaf:map:ready` and
// `geoleaf:app:ready`, the three signals these plugins subscribe to AT IMPORT TIME. Loading
// them later would achieve nothing: the listener would be attached after the event.

/**
 * Walks the merged profile config and reports what the plugins need to find in it.
 *
 * 🛑 The walk is deliberate, not paranoia: a flag written at `ui.showCredentialButton` in a
 * profile source lives at `ui.ui.showCredentialButton` once merged. A hard-coded path would
 * return false forever, the plugin would never load, and the feature would vanish with no
 * error — indistinguishable from a plugin legitimately not required. We look for the KEY.
 *
 * @param {unknown} node The merged profile config handed over by `beforeBoot`.
 * @returns {{ realtime: boolean, websocket: boolean, credentialButton: boolean, geocoding: boolean }}
 */
function _scanProfileNeeds(node) {
    const out = { realtime: false, websocket: false, credentialButton: false, geocoding: false };
    const seen = new Set();
    const walk = (n) => {
        if (!n || typeof n !== "object" || seen.has(n)) return;
        seen.add(n);
        const rt = n.realtime;
        if (rt && typeof rt === "object" && rt.enabled === true) {
            out.realtime = true;
            if (rt.source === "websocket") out.websocket = true;
        }
        if (n.showCredentialButton === true) out.credentialButton = true;
        // `geocoding` is in the same class as `realtime-layer`: its `entry.ts` subscribes to
        // `geoleaf:map:ready` at import time and mounts its control only there. Left out of
        // this scan it is loaded by nobody, and a profile enabling it gets a map with no
        // search bar and no error. Loading it after the fact repairs nothing.
        const gc = n.geocoding;
        if (gc && typeof gc === "object" && gc.enabled === true) out.geocoding = true;
        for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    };
    walk(node);
    return out;
}

GeoLeaf.boot({
    beforeBoot: async ({ config }) => {
        const needs = _scanProfileNeeds(config);
        const needed = [];
        if (needs.realtime) needed.push("realtime-layer");
        // `websocket` is only useful to `realtime-layer`, and only for `source: "websocket"`.
        if (needs.websocket) needed.push("websocket");
        // `connector` self-boots in UI-only mode on this flag — the condition its own
        // `entry.ts` reads, not a rule reinvented here.
        if (needs.credentialButton) needed.push("connector");
        if (needs.geocoding) needed.push("geocoding");

        // `Promise.all` rather than a sequential loop: these loads are independent and sit on
        // the boot path, so serialising them would add one round-trip per plugin.
        await Promise.all(
            needed.map((id) =>
                GeoLeaf.plugins.load(id).catch((e) => {
                    // A plugin the profile requires but cannot be found is a deployment error,
                    // not a reason to abandon the boot: the map must still render. But it is
                    // SAID — a silent catch here would recreate what this whole block fights.
                    console.error(`[GeoLeaf] plugin requis par le profil non chargé : ${id}`, e);
                })
            )
        );
    },
});

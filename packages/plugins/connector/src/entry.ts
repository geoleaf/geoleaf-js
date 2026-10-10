/*!
 * GeoLeaf Connector — Entry Point
 * Boot, GeoLeaf.Connector global API, plugin registration.
 * ESM named export createConnector() for advanced integrators.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig } from "./config.js";
import { installCredentialButton, uninstallCredentialButton } from "./credential-button.js";
import { isConfigured, reinstallCredentialButton } from "./connector-api.js";
import { buildPublicApi } from "./public-api.js";
import { registerPluginModule } from "@geoleaf/host-runtime";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

// Public API review — `createConnector` and `ConnectorInstance` are
// re-exported from their new module. They are documented for the advanced
// integrator (README §83) and published through `types: dist/types/entry.d.ts`:
// dropping them would be a public-API purge.
export { createConnector } from "./connector-api.js";
export type { ConnectorInstance } from "./connector-api.js";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
import langEs from "./lang/lang-es.js";
import langPt from "./lang/lang-pt.js";
import langIt from "./lang/lang-it.js";
import langDe from "./lang/lang-de.js";

// ─── GeoLeaf global API surface ──────────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// Register i18n dictionaries so the login modal's labels resolve during boot.
// Keys are FLAT and dotted ("connector.modal.title") — `getLabel` indexes the
// merged table directly and never splits on "."; a nested dictionary would resolve
// to nothing. The French entries mirror the modal's former hardcoded strings, so a
// host that never merges these dictionaries renders identically (see utils/i18n.ts).
_g.GeoLeaf?.I18n?.registerDict?.("connector", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

/** The API this plugin mounts as `GeoLeaf.Connector`. */
export type ConnectorApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.Connector` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        Connector: ConnectorApi;
    }
}

if (_g.GeoLeaf) {
    _g.GeoLeaf.Connector = buildPublicApi();
}

// ─── The credential button, for each application of the page ────────────────
//
// UI-only bootstrap: mounts the credential button from the profile's
// `ui.showCredentialButton`, without requiring GeoLeaf.Connector.configure(). If configure()
// runs later, uninstallCredentialButton() inside _configure removes this standalone button and
// _configure re-installs it with real auth.
//
// 🛑 THE BUTTON IS PUT BACK AT EVERY BOOT (1.3.5). It sits in the core's bars, which
// `GeoLeaf.mount()` removes with the application and builds again at the next boot. The two
// listeners below were `{ once: true }` behind a one-way latch: the second application had no
// credential button, configured or not. They now stay for the life of the page, and the
// teardown — registered with the core's module registry, further down — releases what must be
// released for the next boot to install again.
//
// ⚠️ WHAT THE TEARDOWN DOES NOT TOUCH, deliberately: `window.fetch`, the worker headers hook,
// the stored session. `configure()` is the HOST's call, made once for the page — it is not
// part of the application the boot starts. Giving `fetch` back at `unmount()` would leave the
// next application without its token until the host configured again.

let _uiOnlyBooted = false;

function _readUiShowCredentialButtonFlag(): boolean {
    // Read through GeoLeaf.Config.getActiveProfile() — the only runtime-exposed
    // path to the profile's ui section (merged from ui.json). GeoLeaf.config
    // does not exist at runtime.
    const g = globalThis as Record<string, unknown>;
    const gl = g["GeoLeaf"] as Record<string, unknown> | undefined;
    const Config = gl?.["Config"] as
        { getActiveProfile?: () => Record<string, unknown> | null } | undefined;
    const profile = Config?.getActiveProfile?.();
    const ui = (profile?.["ui"] ?? undefined) as Record<string, unknown> | undefined;
    return ui?.["showCredentialButton"] === true;
}

function _autoBootstrapUiOnly(): void {
    // Read through the accessor, not the variable: the state lives in connector-api.ts.
    // An explicit configure() ran: its button is the one to put back, with real auth.
    if (isConfigured()) {
        reinstallCredentialButton();
        return;
    }
    if (_uiOnlyBooted) return;
    if (_readUiShowCredentialButtonFlag()) {
        _uiOnlyBooted = true;

        // Minimal standalone config — not passed through validateConfig.
        // credential-button._shouldEnable() reads ui.showCredentialButton directly.
        // Empty auth.endpoint signals UI-only click mode (event dispatch only).
        const uiOnlyCfg = {
            baseUrl: typeof location === "undefined" ? "" : location.origin,
            auth: {
                endpoint: "",
                credentialButton: { enabled: true, iconVariant: "lock" as const },
            },
        } as ConnectorConfig;

        installCredentialButton(uiOnlyCfg);
    }
}

/**
 * Takes the credential button down with the application, and lets the next boot install it
 * again. Nothing else: see the note above on what a teardown must leave alone.
 */
function _teardownUi(): void {
    uninstallCredentialButton();
    _uiOnlyBooted = false;
}

/** @internal — exposed for tests only, resets the auto-bootstrap latch. */
export function _resetAutoBootstrapForTests(): void {
    _uiOnlyBooted = false;
}

if (typeof document !== "undefined") {
    // geoleaf:profile:loaded — fired after the active profile (including ui.json)
    //   is loaded and merged; getActiveProfile() is then populated.
    // geoleaf:map:ready — safety net, fires later during boot.
    // geoleaf:config:loaded fires BEFORE profile load so the flag is not yet
    //   readable via getActiveProfile() — not used.
    document.addEventListener("geoleaf:profile:loaded", _autoBootstrapUiOnly);
    document.addEventListener("geoleaf:map:ready", _autoBootstrapUiOnly);
    // Fallback: plugin script loaded after events already fired
    if (_readUiShowCredentialButtonFlag()) _autoBootstrapUiOnly();
}

// The teardown, on both loading paths — the connector has no toolbar slot of its own.
registerPluginModule({ id: "connector", destroy: _teardownUi });

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("connector", {
        version: "__GEOLEAF_VERSION__",
        requires: [], // only @geoleaf/core
        optional: ["offline-ui", "editor"],
        label: "Connector (Auth + Fetch intercept)",
        healthCheck: isConfigured,
    });
}

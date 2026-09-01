/*!
 * GeoLeaf Connector — Entry Point
 * Boot, GeoLeaf.Connector global API, plugin registration.
 * ESM named export createConnector() for suite-connector.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig } from "./config.js";
import { installCredentialButton } from "./credential-button.js";
import { isConfigured } from "./connector-api.js";
import { buildPublicApi } from "./public-api.js";
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

if (_g.GeoLeaf) {
    _g.GeoLeaf.Connector = buildPublicApi();
}

// ─── Auto-bootstrap UI-only from profile ui.showCredentialButton ─────────────
// Mounts the credential button without requiring GeoLeaf.Connector.configure().
// Triggered by geoleaf:config:loaded / geoleaf:map:ready. Idempotent.
// If configure() runs later, uninstallCredentialButton() inside _configure
// removes this standalone button and _configure re-installs it with real auth.

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
    if (_uiOnlyBooted) return;
    // Read through the accessor, not the variable: the state lives in connector-api.ts.
    if (isConfigured()) return; // explicit configure() already ran
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
    document.addEventListener("geoleaf:profile:loaded", _autoBootstrapUiOnly, { once: true });
    document.addEventListener("geoleaf:map:ready", _autoBootstrapUiOnly, { once: true });
    // Fallback: plugin script loaded after events already fired
    if (_readUiShowCredentialButtonFlag()) _autoBootstrapUiOnly();
}

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("connector", {
        version: "__GEOLEAF_VERSION__",
        requires: [], // only @geoleaf/core
        optional: ["offline-ui", "editor"],
        label: "Connector (Auth + Fetch intercept)",
        healthCheck: isConfigured,
    });
}

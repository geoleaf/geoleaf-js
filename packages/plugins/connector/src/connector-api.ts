/*!
 * GeoLeaf Connector — the singleton's API
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The connector singleton's state and the two operations the public namespace exposes.
 *
 *
 * ## Why this module exists
 *
 * `GeoLeaf.Connector` was mounted by an object literal in `entry.ts`, with
 * `openLoginModal`'s body written in place. `check-facade-purity` (INV-FACADE)
 * only sweeps packages carrying a `src/public-api.ts`: the connector thus
 * escaped the gate entirely, and a `public-api.ts` created by simply copying
 * the literal would have turned it red — its grammar only accepts a thin
 * delegate (a single call to an imported symbol), not a two-statement body.
 *
 * ## ⚠️ The state MUST live here, with its readers
 *
 * `_currentConfig` is read by three things at different moments:
 *
 *   1. `openLoginModal()`, at call time;
 *   2. the `__GEOLEAF_WORKER_HEADERS_HOOK__` hook set by `configure()` —
 *      which the CORE's worker-manager reads without ever importing this plugin;
 *   3. `isConfigured()`, invoked by the plugin registry's `healthCheck`.
 *
 * Separating the writer from any of these readers produces a SILENT outage:
 * the hook would close over a `_currentConfig` nobody writes any more, and
 * the tile Workers would lose their authentication headers with no error and
 * no red test (the hook is only checked for PRESENCE). That is why
 * `configure`, the state and the hook are in the same file.
 *
 * ## `isConfigured()` is a function, never a value
 *
 * `entry.ts` declares `healthCheck: isConfigured`. Writing
 * `healthCheck: () => hasInstance` with a captured value would return `false`
 * forever, and the outage would be invisible: `register()` only STORES the
 * closure, it is only invoked at the boot report — inside a
 * `console.groupCollapsed`, with no test covering it.
 */

import { validateConfig, ConfigError } from "./config.js";
import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import {
    install as installFetchInterceptor,
    uninstall as uninstallFetchInterceptor,
    getWorkerHeaders,
} from "./fetch-interceptor.js";
import { installMapLibreBridge } from "./maplibre-bridge.js";
import { AuthClient } from "./auth-client.js";
import { showLoginModal } from "./login-ui.js";
import { installCredentialButton, uninstallCredentialButton } from "./credential-button.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A configured connector — the object an integrator receives after wiring a backend.
 *
 * One instance per backend: it carries its own credentials and endpoints, so two connectors
 * can coexist without their sessions interfering.
 */
export interface ConnectorInstance {
    /** Synchronous token read from RAM cache. Returns null if not loaded yet. */
    getTokenSync(): string | null;
    /** Async token read (IDB → RAM cache). Returns null if not authenticated. */
    getTokenAsync(): Promise<string | null>;
    /** Restores window.fetch, clears RAM cache. Does NOT clear IndexedDB. */
    destroy(): void;
}

// ─── Singleton state (global API) ────────────────────────────────────────────

let _currentInstance: ConnectorInstance | null = null;
let _currentConfig: ConnectorConfig | null = null;

// ─── Shared refresh-delegate wiring ──────────────────────────────────────────

/**
 * Wires the TokenStore refresh delegate for a config with an auth endpoint.
 * No-op when no auth.endpoint is set. Shared by createConnector() and the
 * global singleton _configure() so the refresh logic lives in one place.
 */
function _wireRefreshDelegate(config: ConnectorConfig): void {
    if (!config.auth?.endpoint) return;
    TokenStore._setRefreshFn(async (baseUrl: string) => {
        const current = TokenStore.getTokenSync(baseUrl);
        if (!current || !config.auth?.endpoint) return null;
        const result = await AuthClient.refresh(config.auth.endpoint, current);
        if (result) {
            const expiresAt = Date.now() + result.expiresIn * 1000;
            await TokenStore.save(baseUrl, result.token, expiresAt);
            if (typeof document !== "undefined") {
                document.dispatchEvent(
                    new CustomEvent("geoleaf:connector:token-refreshed", { detail: { baseUrl } })
                );
            }
            return result.token;
        }
        return null;
    });
}

// ─── createConnector — ESM named export ──────────────────────────────────────

/**
 * Creates a ConnectorInstance from a validated config without mutating the
 * global GeoLeaf.Connector state.
 * Intended for use by @geoleaf-plugins/suite-connector and advanced integrators.
 */
export function createConnector(config: ConnectorConfig): ConnectorInstance {
    validateConfig(config);
    let _active = true;

    // Wire refresh delegate if auth.endpoint is configured
    _wireRefreshDelegate(config);

    return {
        getTokenSync(): string | null {
            if (!_active) return null;
            if (config.getToken) {
                const result = config.getToken();
                // async getToken cannot be used synchronously — return null
                if (result instanceof Promise) return null;
                return result;
            }
            return TokenStore.getTokenSync(config.baseUrl);
        },

        async getTokenAsync(): Promise<string | null> {
            if (!_active) return null;
            if (config.getToken) {
                return config.getToken();
            }
            return TokenStore.getTokenAsync(config.baseUrl);
        },

        destroy(): void {
            _active = false;
            TokenStore._setRefreshFn(null);
        },
    };
}

// ─── configure — global singleton ────────────────────────────────────────────

/**
 * Initializes the Connector singleton.
 * Installs window.fetch monkey-patch and Worker headers hook.
 * If auth.ui is true and no token is found, shows the login modal.
 */
export async function configure(config: ConnectorConfig): Promise<void> {
    validateConfig(config);

    // Destroy the existing instance if any
    if (_currentInstance) {
        uninstallCredentialButton();
        _currentInstance.destroy();
        uninstallFetchInterceptor();
        _currentInstance = null;
        _currentConfig = null;
    }

    _currentConfig = config;

    // Warm up RAM cache from IDB (required before MapLibre bridge reads sync cache)
    if (config.auth?.endpoint) {
        await TokenStore.getTokenAsync(config.baseUrl);

        // Wire refresh delegate for the singleton
        _wireRefreshDelegate(config);
    }

    // Install fetch monkey-patch
    installFetchInterceptor(config);

    // Install Worker headers hook on globalThis
    // worker-manager.ts reads this via __GEOLEAF_WORKER_HEADERS_HOOK__ (no import of this plugin)
    (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"] = (
        url: string
    ): Record<string, string> | undefined => {
        if (!_currentConfig) return undefined;
        return getWorkerHeaders(url, _currentConfig.baseUrl);
    };

    // Install MapLibre bridge (Phase 1 stub — no-op until Phase 2)
    installMapLibreBridge(config);

    // Resolve current token status
    let token: string | null = null;
    if (config.getToken) {
        token = await config.getToken();
    } else if (config.auth?.endpoint) {
        token = await TokenStore.getTokenAsync(config.baseUrl);
    }

    // No token + auth configured → show login modal or throw
    if (!token && config.auth) {
        if (config.auth.ui) {
            await showLoginModal(config);
        } else {
            throw new ConfigError(
                "[GeoLeaf Connector] No valid token found and auth.ui is not enabled. " +
                    "Configure auth.ui: true to show the login modal, or provide a valid token."
            );
        }
    }

    // Install credential button (idempotent, no-op if not enabled)
    installCredentialButton(config);

    _currentInstance = createConnector(config);
}

// ─── Surface consumed by the public namespace ────────────────────────────────

/**
 * Opens the login window on demand.
 *
 * Resolves once authenticated, rejects if the user closes the window.
 * Requires a prior `configure()` carrying an `auth` configuration.
 */
export async function openLoginModal(): Promise<void> {
    if (!_currentConfig?.auth) {
        throw new ConfigError(
            "[GeoLeaf Connector] openLoginModal() requires auth to be configured. " +
                "Call GeoLeaf.Connector.configure() with auth first."
        );
    }
    return showLoginModal(_currentConfig);
}

/**
 * `true` as soon as a `configure()` succeeded. Read by the plugin registry's `healthCheck`.
 *
 * ⚠️ Exported as a FUNCTION and not a value: the registry stores the closure
 * and only invokes it at the boot report. A captured value would stay `false`
 * forever, with no test seeing it.
 */
export function isConfigured(): boolean {
    return _currentInstance !== null;
}

/*!
 * GeoLeaf Connector — API du singleton
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * L'état du singleton connector et les deux opérations que le namespace public expose.
 *
 *
 * ## Pourquoi ce module existe (API publique S4.7)
 *
 * `GeoLeaf.Connector` était monté par un objet littéral dans `entry.ts`, avec le corps de
 * `openLoginModal` écrit sur place. `check-facade-purity` (INV-FACADE) ne balaie que les
 * paquets portant un `src/public-api.ts` : le connector échappait donc entièrement à la gate,
 * et un `public-api.ts` créé par simple copie du littéral l'aurait fait rougir — sa grammaire
 * n'accepte qu'un délégué mince (un appel unique vers un symbole importé), pas un corps à deux
 * instructions.
 *
 * ## ⚠️ L'état DOIT vivre ici, avec ses lecteurs
 *
 * `_currentConfig` est lu par trois choses à des instants différents :
 *
 *   1. `openLoginModal()`, à l'appel ;
 *   2. le hook `__GEOLEAF_WORKER_HEADERS_HOOK__` posé par `configure()` — que le
 *      worker-manager du CORE lit sans jamais importer ce plugin ;
 *   3. `isConfigured()`, invoqué par le `healthCheck` du registre de plugins.
 *
 * Séparer l'écrivain de l'un de ces lecteurs produit une panne SILENCIEUSE : le hook fermerait
 * sur un `_currentConfig` que plus personne n'écrit, et les Workers de tuiles perdraient leurs
 * en-têtes d'authentification sans erreur ni test rouge (le hook n'est vérifié que par sa
 * PRÉSENCE). C'est pour cela que `configure`, l'état et le hook sont dans le même fichier.
 *
 * ## `isConfigured()` est une fonction, jamais une valeur
 *
 * `entry.ts` déclare `healthCheck: isConfigured`. Écrire `healthCheck: () => hasInstance` avec
 * une valeur capturée rendrait `false` à jamais, et la panne serait invisible : `register()` ne
 * fait que STOCKER la clôture, elle n'est invoquée qu'au rapport de boot — dans un
 * `console.groupCollapsed`, sans test qui la couvre.
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

    // Install credential button (Sprint 2 — idempotent, no-op if not enabled)
    installCredentialButton(config);

    _currentInstance = createConnector(config);
}

// ─── Surface consommée par le namespace public ───────────────────────────────

/**
 * Ouvre la fenêtre de connexion à la demande.
 *
 * Résout une fois authentifié, rejette si l'utilisateur ferme la fenêtre. Exige un
 * `configure()` préalable portant une configuration `auth`.
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
 * `true` dès qu'un `configure()` a réussi. Lu par le `healthCheck` du registre de plugins.
 *
 * ⚠️ Exporté comme FONCTION et non comme valeur : le registre stocke la clôture et ne
 * l'invoque qu'au rapport de boot. Une valeur capturée resterait `false` pour toujours, sans
 * qu'aucun test ne le voie.
 */
export function isConfigured(): boolean {
    return _currentInstance !== null;
}

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
import type { RefreshOutcome, SessionState } from "./token-store.js";
import {
    install as installFetchInterceptor,
    uninstall as uninstallFetchInterceptor,
    getWorkerHeaders,
} from "./fetch-interceptor.js";
import { installMapLibreBridge } from "./maplibre-bridge.js";
import { AuthClient } from "./auth-client.js";
import { showLoginModal } from "./login-ui.js";
import { armSessionResume, disarmSessionResume } from "./session-resume.js";
import { armRenewalRetry, disarmRenewalRetry } from "./renewal-retry.js";
import { installCredentialButton, uninstallCredentialButton } from "./credential-button.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A configured connector — the object an integrator receives from {@link createConnector}.
 *
 * It reads the token of ITS `baseUrl`. ⚠️ What it does not own is the renewal: the token store
 * keeps ONE renewal delegate for the page, whatever the API. An instance built with
 * `auth.endpoint` installs its delegate in place of the one already there — the `configure()`
 * singleton's included — and every session of the page is then renewed against its endpoint.
 */
export interface ConnectorInstance {
    /** Synchronous token read from RAM cache. Returns null if not loaded yet. */
    getTokenSync(): string | null;
    /** Async token read (IDB → RAM cache). Returns null if not authenticated. */
    getTokenAsync(): Promise<string | null>;
    /**
     * Deactivates this instance: its token reads return `null` from then on.
     *
     * ⚠️ It also removes the page's renewal delegate, whoever installed it. Until the next
     * `configure()`, a 401 in `auth.endpoint` mode finds nothing to renew the session with, and
     * ends it. It touches neither `window.fetch` nor the stored tokens.
     */
    destroy(): void;
}

// ─── Singleton state (global API) ────────────────────────────────────────────

let _currentInstance: ConnectorInstance | null = null;
let _currentConfig: ConnectorConfig | null = null;

/**
 * Where the guided-reconnection listener is remembered — on `globalThis`, deliberately.
 *
 * 🛑 **A module-scoped reference is not enough, and the test suite proved it before
 * production could.** The listener lives on `document`, which outlives the module: a
 * second copy of this bundle on one page — or a module reload — would stack a listener
 * that the new instance holds no reference to, and one window would open per orphaned
 * copy. Remembering it where `document` lives makes the removal reach every previous
 * instance. Same shape as `__GEOLEAF_WORKER_HEADERS_HOOK__`, and for the same reason.
 *
 * ⚠️ **The name is a LITERAL property at each site, never a variable key**, and that is
 * not a style choice: a write shaped `host[someKey] = …` is a dynamic-key write, which
 * the prototype-pollution gate counts — rightly, since it cannot tell a constant from an
 * attacker-controlled value. The neighbouring hook is written the same way.
 */
type AuthListenerHost = { __GEOLEAF_CONNECTOR_AUTH_LISTENER__?: EventListener };
/** A login window is open. Guards against one window per failed entry of a drain. */
let _reconnecting = false;

/**
 * Re-opens the login window when the session dies, once.
 *
 * 🛑 **`geoleaf:connector:auth-error` had TWO emitters and ZERO listeners.** The
 * interceptor emits it when a renewal fails, the store when the delegate throws — and
 * nobody acted on it, so the session ended in silence at the worst possible moment: the
 * return of network, when the outbox is waiting to be pushed. The component that reopens
 * it already existed; only the link was missing.
 *
 * ⚠️ **Only when `auth.ui` was asked for.** Its absence means "the host owns the
 * interface": opening a window an integrator never requested would be more intrusive
 * than the defect being fixed.
 *
 * ⚠️ **And once.** A drain pushes the queue entry by entry; without the guard, a failed
 * tour would open one window per capture.
 */
function _wireGuidedReconnect(config: ConnectorConfig): void {
    if (typeof document === "undefined") return;
    const host = globalThis as AuthListenerHost;
    const previous = host.__GEOLEAF_CONNECTOR_AUTH_LISTENER__;
    if (previous) document.removeEventListener("geoleaf:connector:auth-error", previous);
    delete host.__GEOLEAF_CONNECTOR_AUTH_LISTENER__;
    if (!config.auth?.ui) return;

    const listener: EventListener = () => {
        if (_reconnecting || !_currentConfig?.auth) return;
        _reconnecting = true;
        void Promise.resolve(showLoginModal(_currentConfig)).finally(() => {
            _reconnecting = false;
        });
    };
    host.__GEOLEAF_CONNECTOR_AUTH_LISTENER__ = listener;
    document.addEventListener("geoleaf:connector:auth-error", listener);
}

// ─── Shared refresh-delegate wiring ──────────────────────────────────────────

/**
 * Wires the TokenStore refresh delegate for a config with an auth endpoint.
 * No-op when no auth.endpoint is set. Shared by createConnector() and the
 * global singleton _configure() so the refresh logic lives in one place.
 */
function _wireRefreshDelegate(config: ConnectorConfig): void {
    if (!config.auth?.endpoint) return;
    TokenStore._setRefreshFn(async (baseUrl: string): Promise<RefreshOutcome> => {
        // 🛑 THE RAW RECORD, NOT `getTokenSync`. The whole point of a refresh is to
        // trade an EXPIRED token for a fresh one — and `getTokenSync` evicts an expired
        // entry and returns `null`, so the delegate gave up before reaching the network
        // in exactly the case it exists for. `load()` returns the record as stored,
        // expiry included: the server is the one that arbitrates, and that is what a
        // refresh endpoint is FOR.
        const stored = await TokenStore.load(baseUrl);
        const presented = stored?.token;
        if (!presented || !config.auth?.endpoint) return { verdict: "absent" };
        const result = await AuthClient.refresh(config.auth.endpoint, presented);
        if (result.verdict === "refused") return { verdict: "refused", presented };
        if (result.verdict === "unavailable") return { verdict: "unavailable" };

        // ⚠️ Stored only if the session is still the one this renewal presented: a sign-out
        // (or a sign-in) completed during the flight wins, and nothing is announced.
        const expiresAt = Date.now() + result.expiresIn * 1000;
        if (!(await TokenStore.saveIfCurrent(baseUrl, presented, result.token, expiresAt))) {
            return { verdict: "superseded" };
        }
        if (typeof document !== "undefined") {
            document.dispatchEvent(
                new CustomEvent("geoleaf:connector:token-refreshed", { detail: { baseUrl } })
            );
        }
        return { verdict: "renewed", token: result.token };
    });
}

// ─── createConnector — ESM named export ──────────────────────────────────────

/**
 * Creates a ConnectorInstance from a validated config, outside the `GeoLeaf.Connector`
 * singleton: it installs no fetch interception, no worker hook and no tile bridge.
 *
 * ⚠️ With `auth.endpoint`, it installs its renewal delegate in place of the page's one — see
 * {@link ConnectorInstance}. Intended for advanced integrators.
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
 * If auth.ui is true and no session is stored (or it was refused), shows the login modal.
 */
export async function configure(config: ConnectorConfig): Promise<void> {
    validateConfig(config);
    // A relaunch armed for the previous session must not renew this one.
    disarmRenewalRetry();

    // Destroy the existing instance if any
    if (_currentInstance) {
        uninstallCredentialButton();
        disarmSessionResume();
        _currentInstance.destroy();
        uninstallFetchInterceptor();
        _currentInstance = null;
        _currentConfig = null;
    }

    _currentConfig = config;

    // ⚠️ THE DELEGATE COMES FIRST. The warm-up that read the store used to run before it was
    // wired, so an expired token could not be renewed by it; the session is now read ONCE,
    // with the renewal possible from that very read.
    if (config.auth?.endpoint) _wireRefreshDelegate(config);

    _wireGuidedReconnect(config);
    // The captures a dead session set aside come back when the operator does — the core
    // cannot see that moment, this plugin can (`session-resume.ts`). ⚠️ ARMED BEFORE THE
    // SESSION IS READ: a renewal at boot emits `token-refreshed`, and the queue the previous
    // session set aside must hear it.
    armSessionResume();

    // Warm up RAM cache from IDB (required before the MapLibre bridge and the worker hook,
    // which read it synchronously) — and learn what the session is.
    const session = config.auth?.endpoint ? await TokenStore.resolveSession(config.baseUrl) : null;

    // Install fetch monkey-patch
    installFetchInterceptor(config);

    // Install Worker headers hook on globalThis
    // worker-manager.ts reads this via __GEOLEAF_WORKER_HEADERS_HOOK__ (no import of this plugin)
    // It hands the core's capabilities over: whether an asynchronous `getToken` may answer
    // with a promise depends on the core that calls it (`getWorkerHeaders`).
    (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"] = (
        url: string,
        capabilities?: { readonly acceptsPromise?: boolean }
    ): ReturnType<typeof getWorkerHeaders> => {
        if (!_currentConfig) return undefined;
        return getWorkerHeaders(url, _currentConfig, capabilities);
    };

    // Install the MapLibre bridge — the token's path for tiles loaded in MapLibre's worker
    installMapLibreBridge(config);

    // ⚠️ DECIDED AFTER INSTALLING. A login window the user closes rejects `configure()`;
    // installed after it, nothing would inject a token obtained later by `openLoginModal()`.
    if (config.getToken) await config.getToken();
    else if (session) await _settleSession(config, session);

    // Install credential button (idempotent, no-op if not enabled)
    installCredentialButton(config);

    _currentInstance = createConnector(config);
}

/**
 * What `configure()` does with the session it found, in `auth.endpoint` mode.
 *
 * 🛑 **A stored session whose renewal cannot be reached is NOT an absence** — with or without
 * `auth.ui`. Opening the application with no network, the token expired in the night, used to
 * block on a login window that needs the very network that is missing; closing it rejected
 * `configure()`, and without `auth.ui` the host received the same `ConfigError` as a device
 * never signed in. The session is kept instead, and the next request — or the network's return
 * — renews it.
 *
 * No session at all, or one the server refused: the login window when `auth.ui` asks for it,
 * else the `ConfigError` that names the problem where it is (CN-16).
 */
async function _settleSession(config: ConnectorConfig, session: SessionState): Promise<void> {
    if (session.token !== null) return;
    if (session.verdict === "unavailable") {
        armRenewalRetry(config.baseUrl);
        return;
    }
    if (config.auth?.ui) {
        await showLoginModal(config);
        return;
    }
    throw new ConfigError(
        "[GeoLeaf Connector] No valid token found and auth.ui is not enabled. " +
            "Configure auth.ui: true to show the login modal, or provide a valid token."
    );
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
 * Ends the session: the stored token is erased and the host is told.
 *
 * 🛑 **THERE WAS NO WAY TO END A SESSION.** The public surface carried `configure` and
 * `openLoginModal` only; `TokenStore.clear` had a single caller — the 401 path — and the
 * store's own docblock states that "sign-out must clear it here and not only in memory".
 * A device handed back, lent or lost kept a valid Bearer until its expiry, with no
 * gesture able to revoke it locally.
 *
 * ⚠️ **In `getToken` mode it erases NOTHING, and that is not a gap.** There, the host
 * owns the token and the plugin holds no copy of it — the property decision ⑧ of the CDC
 * defends by refusing `setToken`. Clearing a store the plugin does not own would be
 * theatre, and calling it a sign-out would misname what happened.
 *
 * ⚠️ It does **not** purge cached field data: that is a separate decision, with its own
 * confirmation to obtain (an outbox may hold captures no server has yet). It is named
 * here rather than half-done.
 *
 * Reached through the namespace the plugin mounts — `GeoLeaf.Connector.logout()`.
 *
 * ⚠️ **No `@example` here, and the absence is measured.** Examples are COMPILED by the
 * documentation gate, and the core's ambient declaration types this plugin's namespace
 * as `unknown` (like the fourteen others), so any example written through it fails to
 * typecheck. Writing one with a cast would teach a wart; writing one through an ESM
 * import would be false, since the package exports only `createConnector`. The honest
 * form is prose until the namespace carries a type.
 *
 * @returns Resolves once the token is gone. Never throws — a sign-out that fails on an
 *   unconfigured plugin has nothing to report.
 */
export async function logout(): Promise<void> {
    const config = _currentConfig;
    if (!config || config.getToken) return;
    // Before the erasure: a relaunch firing in between would renew the session being ended.
    disarmRenewalRetry();
    await TokenStore.clear(config.baseUrl);
    if (typeof document !== "undefined") {
        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:signed-out", { detail: { baseUrl: config.baseUrl } })
        );
    }
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

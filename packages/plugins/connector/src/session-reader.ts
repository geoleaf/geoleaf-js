/*!
 * GeoLeaf Connector — the write session, told to the pre-departure check
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * What the session is worth, told to the core's pre-departure check (`Storage.preflight()`).
 *
 * The core authenticates nothing, so it cannot know whether captures made off-network will
 * reach the server: when this plugin manages the session (`auth.endpoint`), the token is its
 * own. It TELLS the session through the slot the core opens for it,
 * `GeoLeaf.Sync.registerSessionReader` (core ≥ 3.11.0) — the core never reads this plugin's
 * namespace. On an older core the slot is absent, and nothing is told.
 *
 * 🛑 **`TokenStore.load`, never `resolveSession`.** The latter is the read of a caller about to
 * PRESENT the token: it renews an expired or expiring one. A check made before leaving writes
 * nothing — `load` returns the record as stored, expiry included, and only warms the memory
 * cache.
 *
 * ⚠️ **In `getToken` mode it says nothing, and registers nothing.** The host holds the token
 * and alone knows its expiry; it registers its own reader to say it, and a `getToken`
 * configuration never replaces it with one that knows less.
 *
 * ⚠️ **The configuration is read at each call, never captured** — the reason `connector-api.ts`
 * gives for its worker hook. A reader left in the slot by a previous `auth.endpoint`
 * configuration answers `null` once the page switched to `getToken`: it never answers for a
 * session that is no longer the page's.
 */

import { TokenStore } from "./token-store.js";
import type { ConnectorConfig } from "./config.js";

/** The write session as the core's contract names it (`WriteSession`) — redeclared, not imported. */
interface WriteSessionView {
    readonly state: "valid" | "expired" | "absent";
    readonly expiresAt: number | null;
}

/** The slot, as this plugin expects it — absent on a core older than 3.11.0. */
interface SessionSeamHost {
    GeoLeaf?: {
        Sync?: {
            registerSessionReader?: (reader: () => Promise<WriteSessionView | null>) => void;
        };
    };
}

/** True when this plugin holds the session of `config` — `auth.endpoint` mode. */
function _holdsSession(config: ConnectorConfig | null): config is ConnectorConfig {
    return Boolean(config?.auth?.endpoint) && !config?.getToken;
}

/** The session of the configuration in force, read as stored — `null` when it is not ours. */
async function _read(config: ConnectorConfig | null): Promise<WriteSessionView | null> {
    if (!_holdsSession(config)) return null;
    const stored = await TokenStore.load(config.baseUrl);
    if (!stored) return { state: "absent", expiresAt: null };
    return {
        state: stored.expiresAt > Date.now() ? "valid" : "expired",
        expiresAt: stored.expiresAt,
    };
}

/**
 * Registers the reader in the core's slot, for a configuration whose session this plugin holds.
 *
 * @param currentConfig - The configuration in force, read at each call of the reader.
 */
export function registerSessionReader(currentConfig: () => ConnectorConfig | null): void {
    if (!_holdsSession(currentConfig())) return;
    const sync = (globalThis as SessionSeamHost).GeoLeaf?.Sync;
    sync?.registerSessionReader?.(() => _read(currentConfig()));
}

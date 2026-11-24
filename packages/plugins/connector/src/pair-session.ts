/*!
 * GeoLeaf Connector — "pair" session: one renewal per device, shared across tabs
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The lifecycle of a `"pair"` session — an access token held in memory, a single-use refresh
 * token persisted.
 *
 * 🛑 **A REFRESH TOKEN PRESENTED TWICE MAY SIGN THE USER OUT EVERYWHERE.** A server that rotates
 * refresh tokens commonly treats the replay of a spent one as a theft, and revokes the whole
 * family. Two tabs that renew at the same moment, each with the token it read at boot, do
 * exactly that. Hence three rules, all here:
 *
 * 1. **One renewal at a time per device** — a `navigator.locks` lock named after the session.
 *    The store's own deduplication (`token-store.ts`) only merges the calls of ONE tab.
 * 2. **The refresh token is read from the database UNDER the lock**, just before the call: the
 *    tab that held the lock before may have rotated it. Memory is never trusted for it there.
 * 3. **The new refresh token is written before anything else happens**, then the pair is shared
 *    with the other tabs (`BroadcastChannel`), which then need no renewal of their own.
 *
 * ⚠️ Without `navigator.locks` (an old browser), rule 1 shrinks to the tab: two tabs may then
 * collide. It is said once in the console, and written in the README.
 *
 * The lifetimes are the server's: `expires_in` and `refresh_expires_in`, nothing hard-coded. The
 * access token is renewed in the background past 80 % of its lifetime, on a read — no timer.
 */

import { TokenStore } from "./token-store.js";
import type { RefreshFn, RefreshOutcome } from "./token-store.js";
import { PairAuthClient } from "./auth-pair-client.js";
import type { PairSession } from "./auth-pair-client.js";

/** Past this share of its lifetime, a read renews the access token in the background. */
const RENEW_AT_SHARE = 0.8;

/** The channel the tabs of one origin share pairs on. */
const CHANNEL_NAME = "geoleaf-connector";

/** What the channel carries. Same origin only; never persisted. */
type PairMessage =
    | {
          readonly type: "renewed";
          readonly baseUrl: string;
          readonly token: string;
          readonly expiresAt: number;
          readonly renewAt: number;
      }
    | { readonly type: "signed-out"; readonly baseUrl: string };

/**
 * Whether memory received a NEW access token, per session — bumped by this tab's own
 * renewals and by the pairs other tabs share. A renewal that waited for the lock compares it,
 * and does not renew again what the tab before it just renewed.
 */
const _generation = new Map<string, number>();

function _bump(baseUrl: string): void {
    _generation.set(baseUrl, (_generation.get(baseUrl) ?? 0) + 1);
}

/**
 * How long a renewal that finds the pair rotated by another tab waits for that tab's message
 * before renewing on its own. The message is posted right after the rotation is stored, so it
 * is normally a matter of milliseconds; past this, the renewal goes ahead with the database's
 * refresh token — fresh, so never a replay.
 */
const SHARE_WAIT_MS = 1000;

/** Renewals waiting for another tab's pair, per session. */
const _waiters = new Map<string, Set<() => void>>();

/** Resolves when another tab shares a pair for `baseUrl`, or after `ms`. */
function _awaitShared(baseUrl: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
        const set = _waiters.get(baseUrl) ?? new Set<() => void>();
        _waiters.set(baseUrl, set);
        const done = (): void => {
            clearTimeout(timer);
            set.delete(done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        set.add(done);
    });
}

// ─── The device-wide lock ─────────────────────────────────────────────────────

/** The part of `navigator.locks` this module uses. */
interface LockManagerLike {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

let _lockWarned = false;

/**
 * Runs `run` under the session's device-wide lock — or as is, with one warning, where the
 * browser has no `navigator.locks`.
 */
function _withDeviceLock<T>(baseUrl: string, run: () => Promise<T>): Promise<T> {
    const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
    if (locks && typeof locks.request === "function") {
        return locks.request(`geoleaf-connector:${baseUrl}`, run);
    }
    if (!_lockWarned) {
        _lockWarned = true;
        console.warn(
            "[GeoLeaf Connector] navigator.locks is unavailable: renewals are serialised in this " +
                "tab only, and two tabs renewing at once may present the same refresh token."
        );
    }
    return run();
}

// ─── The channel ──────────────────────────────────────────────────────────────

/**
 * Where the armed channel is published — on the global, as the other listeners of this plugin
 * are: a second copy of the plugin closes the first one's channel when it arms its own, instead
 * of adding a second listener.
 */
interface ChannelHost {
    __GEOLEAF_CONNECTOR_PAIR_CHANNEL__?: BroadcastChannel;
}

/** The channel this copy armed — what it posts on and listens to. */
let _armed: BroadcastChannel | undefined;

function _channel(): BroadcastChannel | undefined {
    return _armed;
}

function _post(message: PairMessage): void {
    try {
        _channel()?.postMessage(message);
    } catch {
        // A closed channel shares nothing: the other tabs renew on their own, under the lock.
    }
}

function _emit(name: string, baseUrl: string): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent(name, { detail: { baseUrl } }));
}

/** Applies what another tab shared, for the session this page serves only. */
function _receive(baseUrl: string, data: unknown): void {
    const message = data as Partial<PairMessage> | null;
    if (!message || message.baseUrl !== baseUrl) return;
    if (message.type === "renewed") {
        const { token, expiresAt, renewAt } = message as Extract<PairMessage, { type: "renewed" }>;
        if (typeof token !== "string" || typeof expiresAt !== "number") return;
        TokenStore.holdInMemory(baseUrl, { token, expiresAt, renewAt });
        _bump(baseUrl);
        for (const wake of [...(_waiters.get(baseUrl) ?? [])]) wake();
        _emit("geoleaf:connector:token-refreshed", baseUrl);
    } else if (message.type === "signed-out") {
        TokenStore.forgetMemory(baseUrl);
        _bump(baseUrl);
        _emit("geoleaf:connector:signed-out", baseUrl);
    }
}

/**
 * Listens to the pairs the other tabs share for `baseUrl`. Idempotent: a second call replaces
 * the channel. Without `BroadcastChannel`, nothing is shared and each tab renews on its own —
 * still one at a time, under the lock.
 */
function armPairChannel(baseUrl: string): void {
    disarmPairChannel();
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent) => _receive(baseUrl, event.data);
    _armed = channel;
    (globalThis as ChannelHost).__GEOLEAF_CONNECTOR_PAIR_CHANNEL__ = channel;
}

/** Closes what {@link armPairChannel} opened — this copy's, and the one the page published. */
function disarmPairChannel(): void {
    const host = globalThis as ChannelHost;
    host.__GEOLEAF_CONNECTOR_PAIR_CHANNEL__?.close();
    delete host.__GEOLEAF_CONNECTOR_PAIR_CHANNEL__;
    _armed?.close();
    _armed = undefined;
}

// ─── Storing a pair ───────────────────────────────────────────────────────────

/** The access token's expiry and renewal point, from the server's lifetime. */
function _accessOf(session: PairSession, now: number) {
    return {
        token: session.accessToken,
        expiresAt: now + session.expiresIn * 1000,
        renewAt: now + session.expiresIn * 1000 * RENEW_AT_SHARE,
    };
}

/** Writes the pair (refresh token first), then shares it. Runs under the lock. */
async function _store(baseUrl: string, session: PairSession): Promise<string> {
    const now = Date.now();
    const access = _accessOf(session, now);
    await TokenStore.savePair(
        baseUrl,
        {
            refreshToken: session.refreshToken,
            ...(session.refreshExpiresIn !== undefined && {
                refreshExpiresAt: now + session.refreshExpiresIn * 1000,
            }),
        },
        access
    );
    _bump(baseUrl);
    _post({ type: "renewed", baseUrl, ...access });
    return access.token;
}

/**
 * Stores the pair a sign-in obtained, under the lock — a renewal of another tab must not
 * overwrite it with the pair of the session it replaces.
 *
 * @param baseUrl - The API the session authenticates against.
 * @param session - The pair the server issued.
 */
function establishPair(baseUrl: string, session: PairSession): Promise<void> {
    return _withDeviceLock(baseUrl, async () => {
        await _store(baseUrl, session);
    });
}

// ─── Renewing ─────────────────────────────────────────────────────────────────

/** The access token another tab shared since `generation`, or `null`. */
function _sharedSince(baseUrl: string, generation: number): string | null {
    if ((_generation.get(baseUrl) ?? 0) === generation) return null;
    return TokenStore.getTokenSync(baseUrl);
}

/**
 * One renewal, under the lock: the database's refresh token, the call, the new pair.
 *
 * @param baseUrl - The API the session authenticates against.
 * @param refreshUrl - `auth.refreshEndpoint`.
 * @param generation - This tab's memory generation when the renewal was asked for.
 * @param seen - The refresh token stored when the renewal was asked for, before the lock.
 * @returns What the renewal concluded.
 */
async function _renewUnderLock(
    baseUrl: string,
    refreshUrl: string,
    generation: number,
    seen: string | undefined
): Promise<RefreshOutcome> {
    // Rule 2 — the tab that held the lock before may have renewed: its pair is in memory now.
    const shared = _sharedSince(baseUrl, generation);
    if (shared) return { verdict: "renewed", token: shared };
    const record = await TokenStore.readPairRecord(baseUrl);
    if (!record) return { verdict: "absent" };
    if (seen !== undefined && record.refreshToken !== seen && _channel()) {
        // Rotated by another tab while this one waited: its pair is on the channel.
        await _awaitShared(baseUrl, SHARE_WAIT_MS);
        const late = _sharedSince(baseUrl, generation);
        if (late) return { verdict: "renewed", token: late };
    }
    const presented = record.refreshToken;
    const result = await PairAuthClient.refresh(refreshUrl, presented);
    if (result.verdict === "refused") return { verdict: "refused", presented };
    if (result.verdict === "unavailable") return { verdict: "unavailable" };
    // Rule 3 — the new refresh token is written before anything else.
    if ((await TokenStore.readPairRecord(baseUrl))?.refreshToken !== presented) {
        // Signed out, or signed in again, while the call flew.
        return { verdict: "superseded" };
    }
    const token = await _store(baseUrl, result.session);
    _emit("geoleaf:connector:token-refreshed", baseUrl);
    return { verdict: "renewed", token };
}

/**
 * The `"pair"` contract's renewal, as the store calls it (`RefreshFn`): it goes through the
 * store's deduplication, outage pause and remembered refusal like the `"token"` one.
 *
 * @param refreshUrl - `auth.refreshEndpoint`.
 * @returns The renewal of a session.
 */
function pairRenewal(refreshUrl: string): RefreshFn {
    return async (baseUrl: string) => {
        const generation = _generation.get(baseUrl) ?? 0;
        const seen = (await TokenStore.readPairRecord(baseUrl))?.refreshToken;
        return _withDeviceLock(baseUrl, () =>
            _renewUnderLock(baseUrl, refreshUrl, generation, seen)
        );
    };
}

// ─── Signing out ──────────────────────────────────────────────────────────────

/**
 * Ends a `"pair"` session: erased locally — in every tab — FIRST, then revoked on the server
 * when `revokeUrl` is set. The erasure does not wait for the server and does not depend on it:
 * a revocation that fails leaves a token the server will expire, never a session on the device.
 *
 * @param baseUrl - The API the session authenticates against.
 * @param revokeUrl - `auth.revokeEndpoint`, or `undefined` for a local sign-out.
 * @param onErased - Called once the session is erased, before the revocation is sent.
 * @returns Whether the server confirmed the revocation — `false` without `revokeUrl`.
 */
function endPair(
    baseUrl: string,
    revokeUrl: string | undefined,
    onErased: () => void
): Promise<boolean> {
    return _withDeviceLock(baseUrl, async () => {
        const record = await TokenStore.readPairRecord(baseUrl);
        await TokenStore.clear(baseUrl);
        _bump(baseUrl);
        _post({ type: "signed-out", baseUrl });
        onErased();
        if (!revokeUrl || !record) return false;
        return PairAuthClient.revoke(revokeUrl, record.refreshToken);
    });
}

/** The `"pair"` session's lifecycle — see the module's header. */
export const PairSessions = {
    establish: establishPair,
    renewal: pairRenewal,
    end: endPair,
    armChannel: armPairChannel,
    disarmChannel: disarmPairChannel,
};

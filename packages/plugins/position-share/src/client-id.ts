/*!
 * @geoleaf-plugins/position-share — Stable client identifier
 *
 * Mints, persists and returns the identifier that labels every sample this browser emits.
 * Without it the backend cannot tell one field worker's trail from another's — which is also
 * what makes the value personal data: it is the join key between a person and a track.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const STORAGE_KEY = "geoleaf.position-share.clientId";

// `loc:` is this repository's prefix for locally-minted identifiers — the same one the core's
// offline queue uses for records that have no server identity yet. Keeping it here means a
// backend reading both surfaces can tell at a glance that the value was minted by a browser
// and is not a server key.
const PREFIX = "loc:";

let _cached: string | null = null;

/** Minted once per browser, then read back. Falls back when `crypto.randomUUID` is absent. */
function mint(): string {
    const uuid =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return PREFIX + uuid;
}

/**
 * Returns the identifier that labels every sample this browser emits, minting and persisting
 * it on first call.
 *
 * It survives reloads BY DESIGN — without it the backend cannot tell one field worker's
 * trail from another's, and every sample would look like a new device. That persistence is
 * also what makes it personal data: it is the join key between a person and a track.
 *
 * Storage failures are not fatal. Private-browsing modes throw on `setItem`, and a session
 * that emits under a fresh identifier is far better than one that cannot emit at all.
 *
 * @returns The stable identifier, prefixed `loc:`.
 *
 * @example
 * ```ts
 * const id = getClientId();
 * // → "loc:3f2504e0-4f89-11d3-9a0c-0305e82c3301"
 * ```
 */
export function getClientId(): string {
    if (_cached) return _cached;

    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            _cached = stored;
            return stored;
        }
    } catch {
        // Storage unreadable — fall through and mint a per-session identifier.
    }

    const minted = mint();
    _cached = minted;
    try {
        localStorage.setItem(STORAGE_KEY, minted);
    } catch {
        // Non-fatal, deliberately: see the note above.
    }
    return minted;
}

/**
 * Forgets this browser's identifier: clears the in-memory cache and removes it from
 * storage, so the next {@link getClientId} mints a fresh one.
 *
 * This is the primitive an integrator needs to honour a right-to-erasure request
 * (RGPD art. 17) or apply a retention limit (art. 5-1-e): the identifier is personal
 * data — the join key between a person and a track (see {@link getClientId}). Without
 * it, a stored identifier could not be cleared through the plugin's own surface.
 *
 * Storage failures are swallowed, like in {@link getClientId}: a private-browsing mode
 * that throws on `removeItem` must not turn a forget into an exception — the in-memory
 * cache is cleared regardless.
 */
export function clearClientId(): void {
    _cached = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage unwritable — the in-memory cache is cleared regardless.
    }
}

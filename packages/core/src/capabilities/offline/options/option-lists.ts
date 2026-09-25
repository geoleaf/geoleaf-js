/*!
 * GeoLeaf Core (offline capability) — Option lists kept for off-network use
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The choices of a dropdown field declared by URL (`fetchOptions`), kept on the device.
 *
 * Without them, an off-network form is incomplete by construction: the field shows its
 * placeholder alone. The service worker may hold a copy, but network-first, never for an
 * authenticated request, and lost at each release — nothing a technician can count on.
 *
 * 🛑 **Kept in `preferences`, NOT in `layers`.** The offline preparation stores its other
 * resources in `layers`, keyed by URL — and `layers` is the store the cache budget evicts,
 * oldest first (`db/eviction.ts`); configuration resources are downloaded first, so a list
 * stored there would be the first thing to go. `preferences` is evicted by nothing. Same
 * gesture as `offline.pullState` (`report/pull-state.ts`): a key in a store that exists,
 * no schema bump.
 *
 * Cache first: a held list is answered at once; online, it is refreshed BEHIND the answer, so
 * a list edited on the server reaches the device without making a form wait for it. Two
 * writers fill the store: the offline preparation (`prefetchOptionLists`, called by
 * `CacheManager.cacheProfile`), and any online resolution — a form opened once online is a
 * form that works off-network afterwards.
 *
 * The request goes through the page's `fetch` (bounded), so a connector that authenticates
 * its origin authenticates this too — which is exactly the case the service worker cannot
 * keep.
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { IndexedDB } from "../db/indexeddb.js";

/** One choice, in the form a `<select>` holds it. */
interface OptionListEntry {
    value: string;
    label: string;
}

/** What the store keeps under a list's key. */
interface StoredOptionList {
    options: OptionListEntry[];
    /** When it was fetched, epoch ms. */
    fetchedAt: number;
}

/** Prefix of every option-list key in the `preferences` store. */
const KEY_PREFIX = "offline.optionList:";

/**
 * The store key of a list — its URL made absolute against the page, so a profile writing it
 * relative and the dropdown asking for it resolved agree.
 *
 * @param url - The list's URL, as a field declares it.
 * @returns The key under which it is kept.
 */
function optionListKey(url: string): string {
    const base = typeof document !== "undefined" ? document.baseURI : undefined;
    let absolute = url;
    try {
        absolute = new URL(url, base).href;
    } catch {
        // Not resolvable: keyed as written, which is still one key per list.
    }
    return KEY_PREFIX + absolute;
}

/** Validates a response body as a list of choices, or `null` when it is not one. */
function _asList(body: unknown): OptionListEntry[] | null {
    if (!Array.isArray(body)) return null;
    const out: OptionListEntry[] = [];
    for (const item of body) {
        const v = (item as { value?: unknown } | null)?.value;
        const l = (item as { label?: unknown } | null)?.label;
        if ((typeof v !== "string" && typeof v !== "number") || typeof l !== "string") return null;
        out.push({ value: String(v), label: l });
    }
    return out;
}

/** Fetches a list, or `null` — never throws: an unreachable list is an answer, not an error. */
async function _fetchList(url: string): Promise<OptionListEntry[] | null> {
    try {
        const res = await fetchBounded(url);
        if (!res.ok) return null;
        return _asList(await res.json());
    } catch {
        return null;
    }
}

/** The held list, or `null`. */
async function _read(url: string): Promise<OptionListEntry[] | null> {
    const held = (await IndexedDB.getPreference(optionListKey(url), null)) as
        StoredOptionList | null | undefined;
    return held && Array.isArray(held.options) ? held.options : null;
}

/** Keeps a list. */
async function _write(url: string, options: OptionListEntry[]): Promise<void> {
    const record: StoredOptionList = { options, fetchedAt: Date.now() };
    await IndexedDB.setPreference(optionListKey(url), record);
}

/** `false` only when the browser positively says it is offline. */
function _online(): boolean {
    return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Answers a list — held first; fetched and kept otherwise, when the network is there.
 *
 * @param url - The list's URL.
 * @returns The choices, or `null` when none is held and none could be fetched.
 */
export async function resolveOptionList(url: string): Promise<OptionListEntry[] | null> {
    const held = await _read(url);
    if (held) {
        if (_online()) {
            // Behind the answer: a form never waits for a refresh.
            void _fetchList(url)
                .then((fresh) => (fresh ? _write(url, fresh) : undefined))
                .catch((err: unknown) =>
                    Log.debug("[OptionLists] Refresh not kept:", (err as Error)?.message)
                );
        }
        return held;
    }
    if (!_online()) return null;
    const fresh = await _fetchList(url);
    if (fresh) await _write(url, fresh);
    return fresh;
}

/**
 * Fetches and keeps every list a profile declares — the offline preparation's share.
 *
 * @param urls - The lists' URLs; duplicates are fetched once.
 * @returns How many lists were kept, and how many could not be fetched.
 */
export async function prefetchOptionLists(
    urls: readonly string[]
): Promise<{ stored: number; failed: number }> {
    const tally = { stored: 0, failed: 0 };
    const unique = [...new Set(urls.map((u) => optionListKey(u)))].map((k) =>
        k.slice(KEY_PREFIX.length)
    );
    for (const url of unique) {
        const fresh = await _fetchList(url);
        if (fresh) {
            await _write(url, fresh);
            tally.stored += 1;
        } else {
            tally.failed += 1;
            Log.warn(`[OptionLists] Option list not kept for off-network use: ${url}`);
        }
    }
    return tally;
}

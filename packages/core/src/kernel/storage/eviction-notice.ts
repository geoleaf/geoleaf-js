/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file eviction-notice.ts
 * @description The single in-core listener of `geoleaf:cache:evicted`.
 *
 * 🛑 WHY THIS FILE EXISTS. The core EMITS the eviction alert from two places and
 * listened to it nowhere: the repo's only `addEventListener` lived in `offline-ui`,
 * a **gated** plugin, **absent from `deploy-core`**. On that variant — the one that
 * ships to a client — the notice went into the void from the start. Not weight,
 * data loss: the user did not know space was running out.
 *
 * ## The two emitters, and why ONE listener suffices
 *
 *   1. `kernel/storage/sw-register.ts` — the `_wireEvictionBridge()` bridge, which
 *      turns the Service Worker's message back into a DOM event (eviction under
 *      quota pressure).
 *   2. `capabilities/offline/cache/cache-manager.ts` — `_enforceCacheQuota()`,
 *      **in-core and outside any worker** (eviction on the `maxCacheBytes` budget),
 *      hence **also outside PWA**.
 *
 * Both dispatch the SAME name on the SAME `document`: a single listener covers
 * them. 🛑 **Do not add a second one** — the listener count is what was at zero,
 * not the emitter count that needs fixing.
 *
 * ## ⚠️ WHY THE WIRING IS NOT IN `_wireEvictionBridge()`
 *
 * That bridge is only called **after** `navigator.serviceWorker.register()` —
 * "never on a page with no worker", its own comment says. Placing the listener
 * there would make it blind to emitter no. 2, precisely the non-PWA path. The
 * wiring must therefore be on an **unconditional** path: it is, via
 * `setupStorage()` (B8).
 *
 * ## ⚠️ POURQUOI `notifyPrimitive` ET NON `GeoLeaf.UI.notify`
 *
 * The two surfaces do NOT degrade the same way when `toast-renderer` is absent or
 * disabled — and only one of the two fits here:
 *
 *   · `GeoLeaf.UI.notify.*` lit `_UINotifications` en `?.` → **no-op silencieux** ;
 *   · `notifyPrimitive.notify()` porte un `_consoleFallback` → **`console.warn`**.
 *
 * Going through the rich surface would reproduce the silence this file corrects.
 * With the primitive, a profile that disables the renderer loses the toast but
 * **not the signal**: the message is lost loudly, never silently.
 *
 * © 2026 Mattieu Pottier
 * Licensed under the MIT License
 * SPDX-License-Identifier: MIT
 */

import type { GeoLeafCacheEvictedDetail } from "../../contracts/event-bus.contract.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { formatFileSize } from "../../utils/general/formatters.js";
import { notifyPrimitive } from "../../utils/notify/notify.primitive.js";

/**
 * Listener in place? `setupStorage()` is re-callable (it is tied to the `shared`
 * module's lifecycle), so a second call must not stack a second listener — which
 * would double the displayed notice. MODULE-level flag, like the eviction
 * bridge's.
 */
let _evictionNoticeWired = false;

/**
 * Makes the eviction notice visible on EVERY variant, `deploy-core` included.
 *
 * 🛑 Early exit when nothing was evicted. `_enforceCacheQuota()` only emits when
 * records ARE removed, but a zero detail stays possible; a "0 entries removed"
 * notification teaches the user to stop reading them.
 *
 * ⚠️ **THE TWO PRODUCERS DO NOT CARRY THE SAME DETAIL**, and that governs the guard
 * below:
 *   · IndexedDB (`_enforceCacheQuota` → `db/eviction.ts`) — full detail,
 *     `freedBytes` set, counts expressed in BYTES;
 *   · Cache API (the Service Worker, relayed by `sw-register.ts`) — **no
 *     `freedBytes`**: the Cache API exposes no entry's size, and `totalBefore` /
 *     `totalAfter` count ENTRIES there, not bytes.
 *
 * Fabricating a number to homogenise the two producers would display a false
 * quantity; the notice therefore speaks without a size when it is missing.
 *
 * 🛑 **THE GUARD BEARS ON THE RAW NUMBER, NOT THE FORMATTED STRING — a fix, not a
 * transposition.** The original listener (`offline-ui`) tested
 * `formatFileSize(...)`, leaning on a comment claiming it "returns `""`" when the
 * measurement is missing. **That was true of the plugin's proxy only when the
 * core's seam is ABSENT**; as soon as the core answers, `formatFileSize(undefined)`
 * returns `"0 B"` — a **truthy** string. The Cache API path therefore displayed
 * "(0 B)" on every worker eviction. Guarding on the number removes the whole
 * class.
 */
function _onEvicted(event: Event): void {
    const detail = (event as CustomEvent<GeoLeafCacheEvictedDetail>).detail ?? {};

    const count = typeof detail.evicted === "number" ? detail.evicted : 0;
    if (count <= 0) return;

    const freedBytes = detail.freedBytes;
    const freed =
        typeof freedBytes === "number" && freedBytes > 0 ? formatFileSize(freedBytes) : "";

    // `{0}` and not `{count}`: `getLabel()` interpolates positionally. `offline-ui`
    // carries the same key with `{count}` because it does a manual `.replace()` —
    // not the engine's convention, and copying its spelling would display "{count}"
    // on screen.
    const base = getLabel("storage.notif.cacheEvicted", String(count));

    notifyPrimitive.notify(freed ? `${base} (${freed})` : base, "warning");
}

/**
 * Wires the single in-core listener of `geoleaf:cache:evicted`.
 *
 * Called by `setupStorage()` (B8) — an **unconditional** boot path, deliberately
 * independent of Service Worker registration (see the file header). Idempotent.
 */
export function wireEvictionNotice(): void {
    if (_evictionNoticeWired) return;
    if (typeof document === "undefined") return;
    _evictionNoticeWired = true;

    document.addEventListener("geoleaf:cache:evicted", _onEvicted);
}

/**
 * Removes the listener set by {@link wireEvictionNotice}.
 *
 * ⚠️ **Exported for the test harness**, which must be able to re-wire between two
 * cases without stacking listeners — the module flag would otherwise make any
 * second `wireEvictionNotice()` inoperative, and a green test would prove
 * nothing.
 */
export function unwireEvictionNotice(): void {
    if (!_evictionNoticeWired) return;
    _evictionNoticeWired = false;

    document.removeEventListener("geoleaf:cache:evicted", _onEvicted);
}

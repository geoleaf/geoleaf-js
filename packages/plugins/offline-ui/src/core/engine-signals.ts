/*!
 * GeoLeaf Offline UI — the ENGINE's signals, made visible
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Listens to the signals the offline engine emits and nobody heard.
 *
 * ## Pourquoi ce module existe
 *
 * The engine emitted eight signals; the UI listened to five. The three orphans
 * were **database availability, quota overflow and budget eviction** — measured,
 * and arbitrated early: they are **exactly** the ones the non-evictable store and
 * the tile-cache arbitration need to be **observable**. An engine that manages the
 * quota without ever saying so is indistinguishable, from outside, from one that
 * does not manage it.
 *
 * ⚠️ **`geoleaf:storage:ready` is NOT listened to here — it was DELETED from the
 * engine.** It carried no payload and fired on **every** database open, hence
 * every startup: one notification per boot is noise, and a listener that would
 * only log would have closed the counter to the letter while bringing nothing.
 * The repo's rule is "an emitter without a listener gets removed **or** consumed"
 * — that one got removed.
 * ⚠️ And on iOS, the state that matters is not "the database opens" but "the
 * database was **purged**", which that signal did not say.
 *
 * ## The two tones, and why they differ
 *
 * | Signal | Ton | Motif |
 * |---|---|---|
 * | `storage:quota-exceeded` | **error** | the browser REFUSED a write: the next capture may not fit. The gravest of the three on a field device |
 * | `cache:evicted` | **warning** | data the user had asked to download is no longer there. ⚠️ **Never unsynchronised work** — the contract's hard rule forbids it, and `features` is UNREACHABLE by eviction — but what they lose, they had asked for, and they must know **before** going off-network |
 *
 * ## What this module does NOT do
 *
 * It fixes nothing and decides nothing: it makes audible what the engine already
 * says. If a host loads the engine without this UI, it hears nothing — which
 * holds, since it then has no offline UI at all.
 */

import { getUINotifications, tLabel as t } from "@geoleaf/host-runtime";
import { formatFileSize } from "../utils/core-utils.js";

/** Detail carried by `geoleaf:storage:quota-exceeded` (`db/layers.ts`). */
interface QuotaExceededDetail {
    /** Key of the record the browser refused to write. */
    id?: string;
    /** Size, in bytes, of what was being written. */
    size?: number;
}

// 🛑 `EvictedDetail` and `EVICTED_MS` left with the eviction listener.
// The detail's contract is now `GeoLeafCacheEvictedDetail`
// (`core/src/contracts/event-bus.contract.ts`), read by
// `kernel/storage/eviction-notice.ts`. What they documented about the TWO
// producers — the Cache API does not set `freedBytes` — is carried in that file's
// header, where the rendering is decided.

/** Display duration of the write refusal. */
const QUOTA_MS = 8000;

// ⚠️ `formatFileSize` and NOT a local formatter. I had written one — twenty lines
// of division by 1024 — before measuring that this package already exposes three
// (`utils/core-utils.ts`: `formatFileSize`, `toMB`, `toGB`), which delegate to the
// core's formatters through the seam. A fourth would have been a structural
// duplicate created the very day the previous slice settled one (the three
// `getStorageQuota`). ⚠️ It returns `""` when the measure is missing — which the
// calls below test before displaying.

/** The attached listeners, so they can be removed — a plugin tearing down leaves nothing. */
let _detach: Array<() => void> = [];

/**
 * Wires the listeners on `document`. Idempotent: a second call replaces the first.
 *
 * @example
 * wireEngineSignals();
 */
export function wireEngineSignals(): void {
    unwireEngineSignals();

    const onQuota = (event: Event) => {
        const detail = (event as CustomEvent<QuotaExceededDetail>).detail ?? {};
        const size = formatFileSize(detail.size);
        // ⚠️ The message NAMES the size when known, and stays silent otherwise. A
        // notification displaying "undefined" is worse than one displaying
        // nothing: it teaches the user to stop reading them.
        const base = t("storage.notif.quotaExceeded");
        getUINotifications()?.error?.(size ? `${base} (${size})` : base, QUOTA_MS);
    };

    // 🛑 THE EVICTION LISTENER WAS MOVED UP INTO THE CORE, it is no longer here.
    //
    // It lived in this file, and it was the repo's ONLY one: on `deploy-core`,
    // which does not embed this plugin, the alert went into the void. It is now
    // rendered by `kernel/storage/eviction-notice.ts`, on an unconditional boot
    // path — hence on EVERY variant, and for both emitters (the SW bridge and
    // `cache-manager`, the latter outside PWA).
    //
    // ⚠️ Do not restore it "for the rich UI": both listeners would show TWO toasts
    // on `deploy-full`. The listener count is what was at zero on one variant, not
    // the emitter count that needed fixing.
    //
    // 🖐 The quota, however, STAYS HERE: `geoleaf:storage:quota-exceeded` is
    // emitted by this plugin's `db/layers.ts` — the one writing to IndexedDB. That
    // half has no in-core emitter, hence nothing to move up.
    document.addEventListener("geoleaf:storage:quota-exceeded", onQuota);
    _detach = [() => document.removeEventListener("geoleaf:storage:quota-exceeded", onQuota)];
}

/**
 * Removes the listeners set by {@link wireEngineSignals}.
 *
 * ⚠️ **EXPORTED FOR THE HARNESS, and the orphan survey got it wrong.** The
 * orphan-export sweep flagged it with no production consumer — accurate:
 * `entry.ts` calls `wireEngineSignals()` at load and the plugin has no
 * teardown path. **But it has a TEST consumer** (`__tests__/engine-signals.test.js`,
 * case "unwiring really removes the listeners"), and un-exporting it turned **7
 * cases** red immediately.
 *
 * It is the survey's **class D** — "test seams: the corpus excludes `__tests__` by
 * design" — not class A. The right gesture is thus to keep it exported with this
 * motive written here: un-exporting would have removed the unwiring's only
 * coverage to close a surface nobody called anyway. **"Dead" does not mean
 * "disposable"**, and this case is the reminder that the sweep alone does not
 * decide.
 *
 * 🛑 If a plugin teardown ever appears, IT is what must call this: a listener set
 * on `document` and never removed is a leak, and this function's existence does
 * not fix it as long as no production code invokes it.
 */
export function unwireEngineSignals(): void {
    for (const off of _detach) off();
    _detach = [];
}

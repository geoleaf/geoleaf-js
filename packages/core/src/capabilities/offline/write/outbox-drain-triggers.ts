/*!
 * GeoLeaf Core (offline capability) — Outbox drain triggers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * WHEN the outbox is drained — the half of the write cycle that lived in a plugin.
 *
 * 🛑 **THE ENGINE WAS IN-CORE AND ITS ONLY TRIGGER WAS NOT.** `pushOutbox` has always
 * belonged to this capability, but the single production caller that ever fired it
 * automatically was `@geoleaf-plugins/editor`, on its own `online` listener. Consequences,
 * none of which showed up in a test: an application without that plugin never emptied its
 * queue; the plugin is loaded LAZILY, so a session reopened with captures owed drained only
 * once the editor came back; and `offline-ui`'s replay button was the only manual way out.
 *
 * ⚠️ **The sheet `docs/specs/capacites/offline.md` argued the opposite** (OF-17, 08/08/2026:
 * "replay requires the plugin that created the entities, which is acquired by
 * construction"). That reasoning had one true premise — a plugin drains on its own — and it
 * dies with the drain wrapper this lot removes. `Storage.applyEdit` is public: the outbox
 * has writers the editor knows nothing about.
 *
 * ## The four triggers, and why each is here
 *
 * | Trigger | What it catches |
 * |---|---|
 * | `armOutboxDrain()` itself | a queue left by a previous session — the "storage ready" case |
 * | `window "online"` | the tour comes back into coverage |
 * | `visibilitychange` → visible | the device wakes with the radio already back |
 * | periodic tick | **the retry backoff R1 introduced, which nothing re-fired** |
 *
 * 🛑 **The fourth is not a comfort, it is the completion of R1.** That lot gave failures an
 * exponential deferral (30 s → 2 min → 8 min) written on the entry and READ by the drain,
 * which walks past without waiting. Nothing re-triggered afterwards: an entry deferred with
 * the network up sat there until the next network transition or a human click. The tick is
 * what makes the backoff mean "retry later" rather than "retry if something else happens".
 *
 * ⚠️ **It listens to the NATIVE `window` events, not `geoleaf:online` / `geoleaf:offline`.**
 * Those are emitted by `kernel/storage/offline-detector.ts`, which the deployed profile does
 * not even initialise (`modules.pwa.offlineDetector.enabled: false`) — measured, and written
 * into `e2e/helpers/offline.js`. A trigger built on them would be dead on the shipped app.
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { pushOutbox } from "./push-engine.js";

/**
 * Period of the drain tick.
 *
 * 🛑 **DERIVED FROM THE BACKOFF SCALE, NOT CHOSEN.** `push-engine.ts` defers a failure by
 * 30 s, then ×4, capped at 8 min. A tick shorter than the base step wakes the device for
 * entries that are all deferred; one longer than the cap makes an entry wait up to twice
 * that cap. 60 s is twice the base step and an eighth of the cap, which bounds the lateness
 * past `nextAttemptAt` at one minute on every rung of the ladder.
 */
const DRAIN_POLL_INTERVAL_MS = 60_000;

/**
 * Minimum delay between two drains fired by a wake-up.
 *
 * A user switching between applications produces a `visibilitychange` per switch. Without
 * a floor, each one costs a queue read and a drain.
 */
const MIN_DRAIN_INTERVAL_MS = 5_000;

/** What asked for a drain — logged, and useful when reading a trace after a tour. */
type DrainCause = "storageReady" | "online" | "visible" | "poll" | "write";

/** Collaborators the tests replace; production passes none. */
interface DrainTriggerDeps {
    /** Clock. */
    now?: () => number;
    /** Timer factory — injected because `pushOutbox` is async and fake timers alone
     * cannot order it against `fake-indexeddb`'s own task scheduling. */
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
    /** `modules.offline.drain.pollIntervalMs`; `0` disables the tick. */
    pollIntervalMs?: number;
}

let _armed = false;
let _timer: unknown = null;
let _deps: Required<Pick<DrainTriggerDeps, "now">> & DrainTriggerDeps = { now: () => Date.now() };
let _lastDrainAt = 0;
let _draining = false;
let _again = false;
/**
 * `true` while the queue MIGHT hold something replayable.
 *
 * 🛑 **IT EXISTS BECAUSE THE TICK WAS PAYING A DATABASE READ FOREVER.** The three gates ran
 * `navigator.onLine`, then `countDue()` — so on an application with an empty queue, every
 * page opened one IndexedDB transaction per minute, for the life of the tab, to learn each
 * time that there was nothing to do. Measured on the E2E suite: with the tick on, a routing
 * panel with a 3 s visibility budget failed twice over a 108-spec slice; with
 * `pollIntervalMs: 0`, the same slice came out 100/100. A background timer that reads the
 * database on an idle app is a defect on a field device — battery first, and here latency.
 *
 * ⚠️ **It starts TRUE, and that direction is the safe one**: "unknown" must mean "look", never
 * "skip". The arming drain settles it on the first pass.
 *
 * ⚠️ **What it deliberately does NOT see: another tab's write.** Two tabs share the database;
 * a write in A leaves B's flag false, so B will not poll for it. A drains it — and B
 * re-checks on `online`, on wake-up and at its next arming. The gap is bounded, and it is
 * strictly narrower than the one before R7, when nothing polled at all.
 */
let _maybeOwed = true;
let _onOnline: (() => void) | null = null;
let _onVisibility: (() => void) | null = null;
let _onQueued: (() => void) | null = null;

/** `false` only when the browser positively says so — an unknown state is treated as online. */
function _online(): boolean {
    return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** The outbox module, or `null` while the engine is not wired. */
function _outbox(): { countDue?(now: number): Promise<number> } | null {
    const db = StorageContract.DB as {
        _ensureModule?: (name: string) => { countDue?(now: number): Promise<number> } | null;
    } | null;
    return db?._ensureModule?.("Outbox") ?? null;
}

/**
 * Drains, and drains ONCE MORE if something asked while it was running.
 *
 * ⚠️ **The replay is capped at one extra pass, deliberately.** Triggers coincide by nature —
 * a phone waking in coverage fires `online` and `visibilitychange` in the same second — and
 * those have nothing new to push. The case that earns the extra pass is a WRITE landing
 * mid-drain: the running pass read the queue before it existed, so without this it would
 * wait for the next tick.
 *
 * ⚠️ Re-entrance is closed TWICE and neither is redundant: here, and by `pushOutbox`'s own
 * lock, which also covers the callers that never come through this file (the console, the
 * E2E suite, `offline-ui`'s replay button).
 *
 * @param cause - What asked. Logged.
 */
export async function requestDrain(cause: DrainCause): Promise<void> {
    if (_draining) {
        _again = true;
        return;
    }
    _draining = true;
    try {
        do {
            _again = false;
            _lastDrainAt = _deps.now();
            Log.debug(`[Offline.Drain] déclenché par « ${cause} »`);
            const report = await pushOutbox();
            // A pass that touched nothing AND walked past nothing proves the queue holds no
            // replayable entry: the tick may stop reading until something says otherwise.
            // ⚠️ `deferred > 0` KEEPS it lit — those entries are waiting for their delay, and
            // the tick is precisely what will come back for them.
            _maybeOwed = report.attempted > 0 || report.deferred > 0;
        } while (_again);
    } catch (e) {
        // `pushOutbox` does not throw by contract; a rejection here would be an engine
        // fault, and it must not kill the timer that will retry.
        Log.warn("[Offline.Drain] passe en échec :", e);
    } finally {
        _draining = false;
    }
}

/**
 * One tick of the periodic retry.
 *
 * Three gates, cheapest first — the order is the whole point of a background timer on a
 * field device: no network means no reason to touch IndexedDB at all, and a queue with
 * nothing DUE means no reason to drain.
 */
async function _tick(): Promise<void> {
    if (!_online()) return;
    // The cheapest gate of all, and it is INSIDE the timer rather than replacing it: when the
    // last drain left nothing and nothing has been queued since, the tick costs zero I/O.
    if (!_maybeOwed) return;
    const due = await _outbox()?.countDue?.(_deps.now());
    if (!due) return;
    await requestDrain("poll");
}

function _startTimer(): void {
    if (_timer !== null) return;
    const period = _deps.pollIntervalMs ?? DRAIN_POLL_INTERVAL_MS;
    if (period <= 0) return;
    const set = _deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    _timer = set(() => void _tick(), period);
}

function _stopTimer(): void {
    if (_timer === null) return;
    const clear = _deps.clearInterval ?? ((h: unknown) => clearInterval(h as never));
    clear(_timer);
    _timer = null;
}

/**
 * Reacts to the tab becoming visible or hidden.
 *
 * 🛑 **Hidden STOPS the timer rather than skipping the work.** A tick that returns early
 * still wakes the device — which is what a background timer costs on a phone in a pocket.
 * Stopping it makes `visibilitychange` and the tick ONE mechanism instead of two that talk
 * past each other.
 */
function _handleVisibility(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") {
        _stopTimer();
        return;
    }
    _startTimer();
    if (!_online()) return;
    if (_deps.now() - _lastDrainAt < MIN_DRAIN_INTERVAL_MS) return;
    void _outbox()
        ?.countDue?.(_deps.now())
        .then((due) => {
            if (due) return requestDrain("visible");
            return undefined;
        });
}

/**
 * Arms the drain: listeners, tick, and a first pass.
 *
 * 🛑 **The call itself IS the "storage initialised" trigger** — one gesture, not two. The
 * lifecycle arms right after `StorageContract._markReady()`, so this first pass is by
 * construction later than the moment IndexedDB opened, and it is what empties a queue left
 * by a previous session without waiting for a network transition that may never come (the
 * device may well have been online the whole time).
 *
 * Idempotent: a second call replaces the injected collaborators without stacking listeners.
 *
 * @param deps - Test seams and `pollIntervalMs`. Production passes nothing.
 */
export function armOutboxDrain(deps: DrainTriggerDeps = {}): void {
    _deps = { now: deps.now ?? (() => Date.now()), ...deps };
    if (_armed) return;
    _armed = true;
    if (typeof window !== "undefined") {
        _onOnline = () => void requestDrain("online");
        window.addEventListener("online", _onOnline);
    }
    if (typeof document !== "undefined") {
        _onVisibility = _handleVisibility;
        document.addEventListener("visibilitychange", _onVisibility);
        // The core announces its own enqueues (`local-edit-api.ts`); hearing one is what
        // re-lights the tick without a read.
        _onQueued = () => {
            _maybeOwed = true;
        };
        document.addEventListener("geoleaf:offline:outbox-queued", _onQueued);
    }
    if (typeof document === "undefined" || document.visibilityState === "visible") _startTimer();
    void requestDrain("storageReady");
}

/** Releases everything `armOutboxDrain` took. Idempotent. */
export function disarmOutboxDrain(): void {
    if (_onOnline && typeof window !== "undefined") {
        window.removeEventListener("online", _onOnline);
    }
    if (typeof document !== "undefined") {
        if (_onVisibility) document.removeEventListener("visibilitychange", _onVisibility);
        if (_onQueued) document.removeEventListener("geoleaf:offline:outbox-queued", _onQueued);
    }
    _onOnline = null;
    _onVisibility = null;
    _onQueued = null;
    _maybeOwed = true;
    _stopTimer();
    _armed = false;
    _lastDrainAt = 0;
    _again = false;
}

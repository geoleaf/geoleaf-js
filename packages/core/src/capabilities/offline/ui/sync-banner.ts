/*!
 * GeoLeaf Core (offline capability) — Sync banner
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The strip that says what is still owed to the server — shown when it has something to say.
 *
 * 🛑 **THE SECOND AXIS OF THIS PRODUCT HAD NO REPRESENTATION IN THE CORE.** A technician
 * spends a day off-network; nothing on screen said how many captures were still held, when
 * the device last succeeded, or whether anything had been set aside. A live `⏳ N` counter
 * did exist — in `@geoleaf-plugins/editor`'s floating tool menu — so it disappeared with the
 * plugin, and the core itself painted nothing at all.
 *
 * ⚠️ **The audit's wording is requalified here**: "no permanent indicator of the write
 * queue" was too broad — that counter reads the WHOLE outbox, not just the editor's. What
 * is true, and is what this file fixes, is "nothing permanent **in the core's chrome**".
 *
 * ## Permanent in the core, not permanent in pixels
 *
 * 🛑 **AND THAT DISTINCTION IS THE WHOLE DESIGN.** The first version took its ~29 px in every
 * state, including the one a consultation profile never leaves: online, nothing owed, never
 * synchronised, action greyed out. On a deliverable it is worse than idle — `build-deploy`
 * strips the write endpoints, so that state is the ONLY one most sessions ever see. Chrome
 * that never changes is chrome nobody reads, and this one also collided with the theme pills
 * that were already sitting at `top: 10px` of the same containing block.
 *
 * So the strip is **mounted and subscribed at all times, and displayed when it carries
 * information**: something owed, something set aside, or the network down. What R7 required
 * — a representation that belongs to the CORE and does not leave with a plugin — is
 * unaffected: the listeners never stop, so it comes back on the very event that makes it
 * meaningful. The always-readable copy lives in `offline-ui`'s cache modal, which is where
 * one goes to ask the question when the strip is silent.
 *
 * ## What it shows, and what it deliberately does not
 *
 * Network · how many writes are owed · when the server last accepted something · how many
 * entries are set aside. Two actions: drain now, and dismiss.
 *
 * 🛑 **The per-entry DETAIL is not here, and that is a boundary rather than a shortcut.**
 * The audit asked for "one press for the detail". The list of pending entries, with its
 * retry button, is the editor's pending-queue modal — a plugin surface. Reproducing it in
 * the core would either duplicate it or make the core reach for a plugin; the press
 * therefore does the thing that has no other home: it asks for a drain.
 *
 * ## Where it mounts
 *
 * At the top of `.gl-main`, created at runtime. Nothing is added to
 * `apps/geoleaf-app/index.html` on purpose: `build-deploy.cjs` patches that file with `/gm`
 * regexes and `APP-04/05/08` guard its single-line forms — a markup anchor there would be a
 * standing risk for a strip a `querySelector` can find. A host that embeds the map without
 * that shell (the Suite's widget) falls back to the map container's parent, and short of
 * that mounts nothing rather than guessing.
 */

import { Log } from "../../../utils/log/index.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { readSyncStatus } from "../write/sync-status.js";
import type { SyncStatus } from "../../../contracts/sync.contract.js";
import "./css/sync-banner.css";

let _root: HTMLElement | null = null;
let _els: {
    dot: HTMLElement;
    net: HTMLElement;
    pending: HTMLElement;
    quarantine: HTMLElement;
    last: HTMLElement;
    action: HTMLButtonElement;
    close: HTMLButtonElement;
} | null = null;
let _listeners: (() => void)[] = [];
let _inFlight: Promise<void> | null = null;
let _again = false;

/**
 * The worst situation the operator has acknowledged, or `null` when nothing is acknowledged.
 *
 * 🛑 **DISMISSING ACKNOWLEDGES WHAT WAS SEEN, NOT WHAT WILL HAPPEN.** A close that held
 * forever would turn a safety net into an off switch nobody decided to install: the strip
 * exists because captures can be lost, and the person clicking it is saying "I have read
 * this", not "stop telling me". So it comes back the moment the situation WORSENS — one more
 * entry owed, one more set aside, or the network dropping.
 *
 * ⚠️ Module state and nothing else: never persisted. An acknowledgement from yesterday says
 * nothing about today's queue, and storing it would open a session silent about owed
 * captures — the exact failure this strip was built to end.
 */
let _dismissed: { owed: number; quarantined: number; offline: boolean } | null = null;

/** Where the strip goes: the app shell, else the map's own parent, else nowhere. */
function _host(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    const main = document.querySelector<HTMLElement>(".gl-main");
    if (main) return main;
    return document.getElementById("geoleaf-map")?.parentElement ?? null;
}

/**
 * "3 min", "2 h", "hier" — a duration, not a clock reading.
 *
 * ⚠️ A timestamp answers "at 14:02", which a technician must then subtract from now, on a
 * device whose clock they did not set. The question being asked is "how long ago".
 */
function _ago(at: number, now: number): string {
    const minutes = Math.max(0, Math.round((now - at) / 60_000));
    if (minutes < 1) return getLabel("ui.sync.last_at", "< 1 min");
    if (minutes < 60) return getLabel("ui.sync.last_at", `${minutes} min`);
    const hours = Math.round(minutes / 60);
    if (hours < 24) return getLabel("ui.sync.last_at", `${hours} h`);
    return getLabel("ui.sync.last_at", `${Math.round(hours / 24)} j`);
}

/**
 * Re-reads the queue and repaints.
 *
 * ⚠️ NOT exported: nothing outside drives it. The strip follows the core's two queue events
 * and the native network ones — a public refresh would be a second way to do what those
 * already do, and the two would drift.
 *
 * ⚠️ Coalesced: three events can land in the same tick (a write, its drain, the network
 * coming back), and each would otherwise open its own transaction to paint the same thing.
 */
function refreshSyncBanner(): Promise<void> {
    if (!_els) return Promise.resolve();
    // ⚠️ A concurrent caller gets the RUNNING promise, not an immediate resolve: awaiting a
    // refresh must mean "the strip now shows this". Returning early would make the await a
    // lie — and it is the kind of lie only a test notices, right up to the day a caller
    // reads the DOM straight after.
    if (_inFlight) {
        _again = true;
        return _inFlight;
    }
    _inFlight = (async () => {
        try {
            // Three events can land in the same tick — a write, its drain, the network
            // coming back — and each would otherwise open its own transaction to paint the
            // same thing. The extra lap covers whatever arrived during the read.
            do {
                _again = false;
                _paint(await readSyncStatus());
            } while (_again);
        } catch (e) {
            // An indicator that throws takes the page with it; one that stops updating is
            // merely stale. Neither is good — only one of them loses the map.
            Log.warn("[Offline.Banner] rafraîchissement en échec :", e);
        } finally {
            _inFlight = null;
        }
    })();
    return _inFlight;
}

/**
 * Has the situation worsened since the operator dismissed the strip?
 *
 * Anything that is not strictly worse stays acknowledged — a drain that lowers the count
 * must not re-open a strip the operator has already read.
 */
function _worseThanDismissed(status: SyncStatus): boolean {
    if (!_dismissed) return true;
    if (status.owed > _dismissed.owed) return true;
    if (status.quarantined > _dismissed.quarantined) return true;
    return !status.online && !_dismissed.offline;
}

/** Writes the four facts, the action's state, and whether the strip takes any room. */
function _paint(status: SyncStatus): void {
    if (!_root || !_els) return;
    const { online, owed, quarantined, lastSyncAt } = status;
    // ⚠️ `setAttribute("data-network", …)` AND NOT `dataset.network`, and the reason is a
    // gate: purgecss extracts tokens from the SOURCE, so an attribute never spelled out is
    // an attribute it cannot see — `.gl-sync-banner[data-network="offline"] .…__dot` was
    // reported as a dead selector. Writing the attribute in full makes the coupling between
    // this line and the stylesheet visible to a reader and to the tool alike; safelisting it
    // would have hidden the same coupling behind a regex.
    _root.setAttribute("data-network", online ? "online" : "offline");
    _els.net.textContent = getLabel(online ? "ui.sync.online" : "ui.sync.offline");
    _els.pending.textContent =
        owed === 0
            ? getLabel("ui.sync.all_sent")
            : owed === 1
              ? getLabel("ui.sync.pending_one")
              : getLabel("ui.sync.pending_many", String(owed));
    _els.quarantine.textContent =
        quarantined > 0 ? getLabel("ui.sync.quarantined", String(quarantined)) : "";
    _els.quarantine.hidden = quarantined === 0;
    _els.last.textContent =
        lastSyncAt === null ? getLabel("ui.sync.last_never") : _ago(lastSyncAt, Date.now());
    // Offered only when there is something to send AND a network to send it on: a button
    // that does nothing when pressed teaches the user to stop pressing it.
    _els.action.disabled = owed === 0 || !online;

    // Nothing owed, nothing set aside, network up: the strip has no information, and
    // "everything is sent" is the one sentence it can go on repeating for a whole session.
    const idle = owed === 0 && quarantined === 0 && online;
    // 🛑 An acknowledgement is dropped as soon as there is nothing left to acknowledge —
    // otherwise the FIRST situation of the next hour would be compared against a stale
    // baseline and stay hidden.
    if (idle) _dismissed = null;
    // Two attributes and not one: they are two different facts, and a test that asks "was
    // this hidden because it had nothing to say, or because someone closed it?" deserves an
    // answer. Both spelled out literally — same purgecss rule as `data-network` above.
    _root.setAttribute("data-idle", idle ? "true" : "false");
    _root.setAttribute("data-dismissed", !idle && !_worseThanDismissed(status) ? "true" : "false");
    _publishInset();
}

/**
 * Tells the shell how much room the strip is taking, in `--gl-map-top-inset`.
 *
 * 🛑 **BECAUSE THE STRIP OVERLAPS SURFACES THAT WERE THERE FIRST.** The map is
 * `position: absolute; inset: 0` inside `.gl-main`, so the strip does not push it down — it
 * covers it — and `#gl-theme-primary-container` (z 1001) and `#gl-theme-secondary-container`
 * (z 1000) sit at `top: 10px` of that same containing block, against this strip's z 2. The
 * theme pills therefore paint straight over the counters and over the drain button, which is
 * what a screenshot of the deployed profile showed.
 *
 * ⚠️ **The remedy is to STACK, not to outrank.** The repository already settled this once,
 * for the navigation banner against the position-share badge: raising a z-index there would
 * have buried a privacy indicator. Here it would bury the theme selector. So the strip
 * publishes its own footprint and says nothing about who consumes it — a capability naming
 * another capability's container is the coupling `theme-selector.css` explicitly refuses.
 *
 * ⚠️ **MEASURED, never assumed.** The height depends on the action button's `min-height`,
 * which doubles under `(pointer: coarse)`, and on the interface language. Every constant
 * written here would have been wrong on a touch device.
 */
function _publishInset(): void {
    const host = _root?.parentElement;
    if (!host || !_root) return;
    // Read AFTER the attributes above: a hidden strip is `display: none`, hence `0`, which
    // is exactly the value the token should carry then.
    host.style.setProperty("--gl-map-top-inset", `${_root.offsetHeight}px`);
}

/** Builds the strip. Text nodes only — no `innerHTML` on a surface that shows counts. */
function _build(): HTMLElement {
    const root = document.createElement("div");
    root.className = "gl-sync-banner";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-label", getLabel("aria.sync.banner"));
    // 🛑 FOCUSABLE BECAUSE IT SCROLLS, and axe said so before a person did
    // (`scrollable-region-focusable`, serious, at a 375 px viewport). The strip never wraps
    // — a field device is held in one hand and a two-row status bar is a status bar nobody
    // reads — so on a narrow screen it overflows horizontally. A region that scrolls and
    // takes no focus is a region a keyboard user cannot read the end of.
    //
    // ⚠️ The cost is one tab stop before the map, and it is the right trade: the
    // alternative — dropping the scroll for `overflow: hidden` — would not fix the reading,
    // it would silently CUT what cannot be reached.
    root.tabIndex = 0;

    const dot = document.createElement("span");
    dot.className = "gl-sync-banner__dot";
    const net = document.createElement("span");
    net.className = "gl-sync-banner__net";
    const sep = document.createElement("span");
    sep.className = "gl-sync-banner__sep";
    sep.textContent = "·";
    const pending = document.createElement("span");
    pending.className = "gl-sync-banner__pending";
    const quarantine = document.createElement("span");
    quarantine.className = "gl-sync-banner__quarantine";
    quarantine.hidden = true;
    const last = document.createElement("span");
    last.className = "gl-sync-banner__last";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "gl-sync-banner__action";
    action.textContent = getLabel("ui.sync.action");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "gl-sync-banner__close";
    close.textContent = "✕";
    // Named for a screen reader, because "✕" is not a name. `title` too: the strip is read
    // on a phone, where the only other affordance is a glyph 12 px wide.
    close.setAttribute("aria-label", getLabel("ui.sync.dismiss"));
    close.title = getLabel("ui.sync.dismiss");

    root.append(dot, net, sep, pending, quarantine, last, action, close);
    _els = { dot, net, pending, quarantine, last, action, close };
    return root;
}

/** Adds a listener and remembers how to take it back. */
function _on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    _listeners.push(() => target.removeEventListener(type, handler));
}

/**
 * Mounts the strip at the top of the app shell. Idempotent.
 *
 * Mounting is not showing: the strip stays hidden while it has nothing to say (see the
 * module header). `enabled: false` mounts nothing at all, listeners included.
 *
 * @param options - `{ enabled }` from `modules.offline.banner`; `false` mounts nothing.
 */
export function mountSyncBanner(options: { enabled?: boolean } = {}): void {
    if (options.enabled === false) return;
    if (_root) return;
    const host = _host();
    if (!host) {
        Log.debug("[Offline.Banner] aucun hôte (.gl-main ni conteneur de carte) — non monté.");
        return;
    }
    _root = _build();
    // Hidden until the first paint says otherwise: without this the strip would flash at
    // full height on every boot, which is precisely the chrome this design removes.
    _root.setAttribute("data-idle", "true");
    _root.setAttribute("data-dismissed", "false");
    host.insertBefore(_root, host.firstChild);

    // The core's own two events: something entered the queue, something left it. Before R7
    // the only such signal was the editor plugin's, so an indicator had to depend on a
    // plugin to know that a write had happened.
    _on(document, "geoleaf:offline:outbox-queued", () => void refreshSyncBanner());
    _on(document, "geoleaf:offline:outbox-drained", () => void refreshSyncBanner());
    // Native events, not `geoleaf:online` — the detector that emits those is opt-in, and a
    // strip that goes blind because a profile turned a badge off would be worse than none.
    _on(window, "online", () => void refreshSyncBanner());
    _on(window, "offline", () => void refreshSyncBanner());
    _on(_root, "click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".gl-sync-banner__close")) {
            // Read back from the DOM rather than kept in a variable: `_paint` is the only
            // writer of these three facts, so the strip on screen IS the acknowledged
            // situation. A parallel copy would be a second truth updated on another path.
            void readSyncStatus().then((s) => {
                _dismissed = { owed: s.owed, quarantined: s.quarantined, offline: !s.online };
                _paint(s);
            });
            return;
        }
        if (target?.closest(".gl-sync-banner__action")) {
            (
                globalThis as { GeoLeaf?: { Storage?: { _requestOutboxDrain?(c: string): void } } }
            ).GeoLeaf?.Storage?._requestOutboxDrain?.("banner");
        }
    });

    void refreshSyncBanner();
}

/** Removes the strip and every listener it took. Idempotent. */
export function unmountSyncBanner(): void {
    for (const off of _listeners) off();
    _listeners = [];
    // Give the token back BEFORE dropping the reference: a strip that leaves without
    // clearing its footprint keeps every top-anchored surface pushed down by a band that no
    // longer exists.
    _root?.parentElement?.style.removeProperty("--gl-map-top-inset");
    _root?.remove();
    _root = null;
    _els = null;
    _inFlight = null;
    _again = false;
    _dismissed = null;
}

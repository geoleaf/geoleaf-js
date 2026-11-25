/*!
 * @geoleaf/host-runtime
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Stateful focus trap for the library's modal surfaces (responsive modal,
 * confirm dialog). `createFocusTrap` returns an object that owns its own
 * `document` listener: `activate()` attaches it, moves focus into the
 * container and remembers where focus came from; `deactivate()` detaches and
 * restores it. Escape is handled here too, via the `onEscape` callback.
 *
 * ## Why the core has a second focus trap, and why they are NOT merged
 *
 * `packages/core/src/utils/controls/focus-trap.ts` exports
 * `handleFocusTrap(container, event)` — a pure function the caller invokes from
 * its own `keydown` listener. It is not an older copy of this file: the two
 * differ in four ways that a merge would have to arbitrate rather than absorb.
 *
 *   1. **Ownership** — this one attaches to `document` itself; the core one
 *      never registers a listener and holds no state.
 *   2. **Focusable set** — this one matches `a[href]` and
 *      `[contenteditable="true"]`; the core one matches any `[href]` and no
 *      contenteditable.
 *   3. **Visibility filter** — this one uses `closest("[hidden]")` +
 *      `getComputedStyle().display`; the core one uses `offsetParent !== null`.
 *      They do not agree in a real browser.
 *   4. **Empty container** — this one calls `preventDefault()` (Tab is
 *      swallowed); the core one returns and lets Tab leave the container.
 *
 * Merging is therefore a change to the DEPENDENCY GRAPH, not a refactor:
 * `packages/core` does not depend on `@geoleaf/field-renderer`, and making it
 * do so is an architecture decision. It also cannot be validated where it
 * matters — difference 3 is unobservable under happy-dom, where `offsetParent`
 * is `undefined` — so it is blocked on the browser verification pass. Until then the duplication is deliberate and
 * recorded, which is cheaper than a silent behaviour change.
 */

const FOCUSABLE_SELECTOR =
    "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])," +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/**
 * What GeoLeaf draws: its own classes and ids, and the engine's map element it mounts in.
 */
const GEOLEAF_OWNED = '[class^="gl-"],[class*=" gl-"],[id^="gl-"],.maplibregl-map';

/**
 * True when a key event was aimed at the HOST, not at GeoLeaf.
 *
 * 🛑 The listener sits on `document`, so it hears every key of the page. A host that opens its
 * own dialog over a GeoLeaf window (a "Search more" from a field, a confirmation) holds the focus
 * in that dialog, and its Escape is the host's: heard here too, it also closed — or asked to
 * discard — the GeoLeaf form under it. Stacking the window under the host's dialogs did not
 * settle that; this does. A key from the page body (nothing focused) or from anything GeoLeaf
 * draws is still ours, so Escape keeps closing a window whose focus was lost to the map.
 */
function isAimedAtHost(container: HTMLElement, target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (container.contains(target)) return false;
    const { body, documentElement } = document;
    if (target === body || target === documentElement) return false;
    // ⚠️ The walk stops BELOW <body>: the core writes its theme class on the host's body
    // (`gl-theme-dark`), so `closest()` would find a "GeoLeaf" ancestor for every element of
    // the page — the host's dialog included. Seen in the delivered bundle, Escape still closing.
    for (let el: Element | null = target; el && el !== body; el = el.parentElement) {
        if (el.matches(GEOLEAF_OWNED)) return false;
    }
    return true;
}

/**
 * A keyboard focus trap that can be switched on and off.
 *
 * While active, Tab and Shift+Tab cycle within the container and Escape fires the configured
 * handler. ⚠️ `deactivate()` must be called when the container goes away — an active trap
 * outlives its DOM and keeps intercepting keys.
 */
export interface FocusTrap {
    activate(): void;
    deactivate(): void;
}

/**
 * Traps keyboard focus within `container`.
 * Tab / Shift+Tab cycle through focusable children; Escape fires `onEscape`. A key whose target
 * is a host element outside the container and outside anything GeoLeaf draws — a host dialog
 * opened over this one — is left to the host.
 */
export function createFocusTrap(container: HTMLElement, onEscape?: () => void): FocusTrap {
    let previousFocus: Element | null = null;

    function getFocusable(): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (el) => !el.closest("[hidden]") && getComputedStyle(el).display !== "none"
        );
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (isAimedAtHost(container, e.target)) return;
        if (e.key === "Escape") {
            e.preventDefault();
            onEscape?.();
            return;
        }
        if (e.key !== "Tab") return;

        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
            e.preventDefault();
            return;
        }

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    return {
        activate() {
            previousFocus = document.activeElement;
            document.addEventListener("keydown", onKeyDown);
            const focusable = getFocusable();
            focusable[0]?.focus();
        },
        deactivate() {
            document.removeEventListener("keydown", onKeyDown);
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
            previousFocus = null;
        },
    };
}

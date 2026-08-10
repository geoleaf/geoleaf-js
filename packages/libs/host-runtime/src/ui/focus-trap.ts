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
 * is `undefined` — so it is blocked on the browser verification pass
 * (roadmap_backlog-residuel R.7). Until then the duplication is deliberate and
 * recorded, which is cheaper than a silent behaviour change.
 */

const FOCUSABLE_SELECTOR =
    "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])," +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

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
 * Tab / Shift+Tab cycle through focusable children; Escape fires `onEscape`.
 */
export function createFocusTrap(container: HTMLElement, onEscape?: () => void): FocusTrap {
    let previousFocus: Element | null = null;

    function getFocusable(): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (el) => !el.closest("[hidden]") && getComputedStyle(el).display !== "none"
        );
    }

    function onKeyDown(e: KeyboardEvent): void {
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

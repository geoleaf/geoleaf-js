/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Shared Tab / Shift+Tab focus cycling for modal-style surfaces (side panel,
 * lightbox, share modal, mobile sheet). Each of those used to carry its own
 * copy of the same twenty lines, and the copies had drifted: the lightbox
 * omitted links and form controls from its selector — so Tab walked straight
 * out of it — and the share modal filtered neither disabled nor hidden nodes,
 * so `focus()` could land on a node that cannot take focus and strand the user.
 *
 * ⚠️ `@geoleaf/host-runtime` ships a SECOND focus trap
 * (`src/ui/focus-trap.ts`, `createFocusTrap`). Not a copy of this one: it owns
 * its own `document` listener and its state, handles Escape, restores the
 * previously focused element, matches a different focusable set, filters
 * visibility differently, and swallows Tab on an empty container where this one
 * lets it through. The two are NOT merged on purpose — `packages/core` depends
 * on neither, so merging changes the dependency graph, and the visibility
 * difference cannot be verified under happy-dom (see the `offsetParent` note
 * below). Blocked on the browser verification pass (roadmap_backlog-residuel
 * R.7). The full comparison lives in the host-runtime file's header.
 *
 * ⚠️ This paragraph said `@geoleaf/field-renderer` until 06/08/2026: decision W3
 * (Sprint 6, S6b / B-144) moved that trap to `host-runtime`, which owns the UI
 * plumbing. The motive for keeping the two apart is unchanged — only the address
 * moved. Corrected here because a comment that names a file which no longer holds
 * what it describes is the C5 counter of the completeness clause, and no gate can
 * tell a true sentence from a stale one.
 *
 * @version 1.0.0
 */

/**
 * Nodes that can take keyboard focus. `[href]` covers anchors, and the
 * `:not([disabled])` guards keep unfocusable form controls out of the cycle —
 * calling `focus()` on one is a silent no-op that would strand the caret.
 */
const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab / Shift+Tab cycling inside `container`.
 *
 * Non-`Tab` keys return immediately, so callers may hand over every `keydown`
 * without pre-filtering. Focus is only redirected at the two ends of the cycle:
 * anywhere in the middle the browser's native order is left alone.
 *
 * ⚠️ The `offsetParent` visibility filter is carried over verbatim from the
 * three call sites that already had it. It cannot be covered by a test: under
 * happy-dom `offsetParent` is `undefined`, so the filter keeps every node and
 * the assertion would pass either way. Do not "improve" it into a
 * `getComputedStyle` check — that would change browser behaviour with no test
 * able to notice.
 *
 * @param container - The element focus must stay within.
 * @param e - The `keydown` event.
 */
export function handleFocusTrap(container: HTMLElement, e: KeyboardEvent): void {
    if (e.key !== "Tab") return;

    const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((node) => node.offsetParent !== null);
    // Guarding both ends replaces the length check AND retires a non-null assertion.
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (e.shiftKey) {
        if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
    } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

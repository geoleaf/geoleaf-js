/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Shared keyboard arithmetic for roving-tabindex widgets (WCAG 2.1 §1.5.5).
 *
 * Lives in `ui/` root because both `ui/desktop/` (tab strip) and `ui/mobile/`
 * (toolbar pill) implement roving tabindex and the ESLint `no-restricted-imports`
 * boundary forbids them from importing each other (archi B.4).
 */

/**
 * Maps an arrow / Home / End key press to the index that should receive focus.
 *
 * Pure index arithmetic — the caller owns `preventDefault()`, focus and any
 * `tabindex` bookkeeping, because those differ between the two widgets (the
 * mobile toolbar swaps `tabindex` on move, the desktop tab strip only focuses).
 *
 * @param key - The `KeyboardEvent.key` value.
 * @param currentIndex - Index of the currently focused item, already validated as in-range.
 * @param count - Number of focusable items; must be ≥ 1.
 * @returns The target index, or `null` when the key is not a navigation key.
 */
export function resolveRovingIndex(
    key: string,
    currentIndex: number,
    count: number
): number | null {
    if (count < 1) return null;
    switch (key) {
        case "ArrowDown":
        case "ArrowRight":
            return (currentIndex + 1) % count;
        case "ArrowUp":
        case "ArrowLeft":
            return (currentIndex - 1 + count) % count;
        case "Home":
            return 0;
        case "End":
            return count - 1;
        default:
            return null;
    }
}

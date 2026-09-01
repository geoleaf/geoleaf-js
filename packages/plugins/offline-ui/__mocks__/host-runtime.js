/**
 * Partial mock of `@geoleaf/host-runtime` — routed by `vitest.config.ts`'s alias.
 *
 * ## Pourquoi il remplace `__mocks__/field-renderer.js`
 *
 * `confirmDialog` and `createFocusTrap` moved from `@geoleaf/field-renderer` to
 * `@geoleaf/host-runtime`. The five `offline-ui` sources importing them
 * followed, so the alias had to follow too — otherwise the REAL `confirmDialog`
 * would load and **open a real modal** mid-suite, exactly what the old mock
 * prevented.
 *
 * ## 🛑 Why it is PARTIAL, and why that matters
 *
 * The old mock could replace everything: `offline-ui` used only three
 * `field-renderer` symbols. Of `host-runtime`, it uses **nine** — `Log`,
 * `tLabel`, `coreConfigGet`, `getGeoLeaf`, `getUINotifications`,
 * `fetchWithTimeout` beyond the two interface functions. Stubbing them all
 * would run the tests on fictional plumbing.
 *
 * Hence the re-export of the real module, **through a relative path**: the
 * `@geoleaf/host-runtime` specifier is intercepted by the alias, so importing
 * it here would create a loop. Only the two interface symbols are overridden.
 *
 * `vi` is a vitest global (`globals: true`). Tests can override the resolved value:
 *   confirmDialog.mockResolvedValueOnce(false)
 */
export * from "../../../libs/host-runtime/src/index.ts";

const _fn = typeof vi !== "undefined" ? () => vi.fn() : () => () => {};

/** Resolves `true` by default (the user confirms). Override per test. */
export const confirmDialog =
    typeof vi !== "undefined" ? vi.fn(() => Promise.resolve(true)) : () => Promise.resolve(true);

/** Focus trap: `activate`/`deactivate` are no-ops in test. */
export const createFocusTrap = () => ({ activate: _fn(), deactivate: _fn() });

/**
 * Faithful test double for `domCreate` — the single one every `vi.mock` should use.
 *
 * ## Why this file exists
 *
 * Seven test files each hand-rolled their own `domCreate` stub, and **six of the
 * seven diverged from the real function**:
 *
 * | file                                  | divergence                                  |
 * | ------------------------------------- | ------------------------------------------- |
 * | `label-button-visibility.test.js`     | ignored every argument, always a bare button |
 * | `label-button-manager.test.js`        | dropped `parent` — **nothing was appended**  |
 * | `geolocation.test.js`                 | collapsed every tag to `div` except `a`      |
 * | `map-branches.test.js`                | `tag \|\| "div"` — the real one throws       |
 * | `theme-selector.test.js`              | same fallback                                |
 * | `coverage-modules-ui-controls.test.js`| accepted an array of classes                 |
 *
 * A stub is not a neutral convenience: it is what the assertions actually run
 * against. A component relying on `parent` insertion was, under two of these,
 * never inserted — so the test proved something production does not do.
 *
 * ## Why a shared double rather than seven fixed copies
 *
 * ADR-10 plans to migrate 40 call sites onto `domCreate`, which **requires
 * extending it** (it handles none of `textContent` / `attributes` / `dataset` /
 * `on*`). The moment its signature changes, seven independent copies would go
 * stale silently and keep passing against the old shape. With one double, the
 * equivalence suite (`__tests__/utils/dom-create-double.test.js`) fails the build
 * and points at the single place to update.
 *
 * ⚠️ Keep this a faithful mirror. If you need different behaviour for one test,
 * override it locally in that test — do not weaken this file.
 *
 * @see `packages/core/src/modules/utils/general/dom-helpers.ts` — the original
 * @see `__tests__/utils/dom-create.test.js` — the original's own unit suite
 */

/**
 * Mirrors `domCreate(tag, className?, parent?)` exactly:
 * create → set class if truthy → append if a parent is given → return the element.
 *
 * Notably it does NOT guard the tag: `document.createElement("")` throws, in the
 * double as in the original.
 */
function domCreateDouble(tag, className, parent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
}

export { domCreateDouble };

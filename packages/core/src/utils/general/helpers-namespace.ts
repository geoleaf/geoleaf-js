/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Helpers - Performance optimization & DOM utilities
 *
 * @remarks
 * `createElement` and its `CreateElementOptions` were removed at KERNEL S10:
 * zero callers, and its option shape diverged from the `dom-helpers.ts`
 * factory (`styles` vs `style`, innerHTML winning over textContent) in ways no
 * type-check would catch. Build DOM through `domCreate` / `createElement` in
 * `./dom-helpers.js`.
 *
 * @remarks
 * KERNEL S14 — moved here from `utils/helpers/dom-helpers.ts`, which shared a
 * BASENAME with `utils/general/dom-helpers.ts` without sharing a single export.
 * The two were never duplicates: that one is the DOM *factory*, this is the
 * `GeoLeaf.Helpers` façade object, and it already depended on the factory (see
 * the `applyCssText` import below). The homonymy was real friction — it is why
 * `scripts/check-orphan-exports.cjs` had to switch from `endsWith` to exact-path
 * matching. Renaming to `helpers.ts` removes the collision; the one-file
 * `utils/helpers/` directory and its barrel went with it.
 */

import { applyCssText } from "./dom-helpers.js";

/**
 * Looks an element up by id, without throwing on a missing or malformed id.
 *
 * A non-string or empty id yields `null` instead of reaching the DOM, so a value coming from
 * a profile or a URL parameter can be passed straight through.
 *
 * @param id - Element id; anything that is not a non-empty string yields `null`.
 * @returns The element, or `null` if the id was unusable or nothing matched.
 *
 * @example
 * ```js
 * const element = GeoLeaf.Helpers.getElementById("my-map");
 * // Returns: HTMLElement | null
 * ```
 */
function getElementById(id: string | null | undefined): HTMLElement | null {
    if (!id || typeof id !== "string") return null;
    return document.getElementById(id);
}

/**
 * Runs a CSS selector, returning `null` rather than throwing on an invalid one.
 *
 * `ParentNode.querySelector` throws a `SyntaxError` on a malformed selector; here that is
 * caught and flattened to `null`, which matters when the selector comes from configuration
 * rather than from source.
 *
 * @param selector - CSS selector; a non-string or empty value yields `null`.
 * @param parent - Root to search from. Defaults to `document`.
 * @returns The first match, or `null` if the selector was invalid or nothing matched.
 *
 * @example
 * ```js
 * const element = GeoLeaf.Helpers.querySelector(".gl-map-container");
 * const child = GeoLeaf.Helpers.querySelector(".item", parentElement);
 * // Returns: Element | null
 * ```
 */
function querySelector(selector: string, parent: ParentNode = document): Element | null {
    if (!selector || typeof selector !== "string") return null;
    try {
        return parent.querySelector(selector);
    } catch {
        return null;
    }
}

/**
 * Runs a CSS selector and returns the matches as a real array.
 *
 * Always an array — never `null`, never a live `NodeList` — so the result can be mapped or
 * filtered directly and will not mutate underfoot as the DOM changes. An invalid selector
 * yields an empty array rather than throwing.
 *
 * @param selector - CSS selector; a non-string or empty value yields `[]`.
 * @param parent - Root to search from. Defaults to `document`.
 * @returns The matches, possibly empty.
 *
 * @example
 * ```js
 * const elements = GeoLeaf.Helpers.querySelectorAll(".poi-marker");
 * // Returns: Element[] (always an array, never null)
 * ```
 */
function querySelectorAll(selector: string, parent: ParentNode = document): Element[] {
    if (!selector || typeof selector !== "string") return [];
    try {
        return Array.from(parent.querySelectorAll(selector));
    } catch {
        return [];
    }
}

/**
 * Adds one or more CSS classes to an element.
 *
 * Each argument is split on whitespace before being applied, so `"primary highlighted"` and
 * `"primary", "highlighted"` are equivalent. A null or class-less element is a no-op rather
 * than a throw — callers routinely pass the result of a lookup that may have missed.
 *
 * @param element - Target element; null or undefined is ignored.
 * @param classNames - Class names, each of which may itself be a space-separated list.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.addClass(element, "active");
 * GeoLeaf.Helpers.addClass(element, "primary", "highlighted");
 * ```
 */
function addClass(element: Element | null | undefined, ...classNames: string[]): void {
    if (!element || !element.classList) return;
    const allClasses = classNames.flatMap((cn) => cn.split(" ")).filter(Boolean);
    element.classList.add(...allClasses);
}

/**
 * Removes one or more CSS classes from an element.
 *
 * Mirrors {@link addClass}: each argument is split on whitespace, and a null or class-less
 * element is a no-op. Removing a class the element does not carry is not an error.
 *
 * @param element - Target element; null or undefined is ignored.
 * @param classNames - Class names, each of which may itself be a space-separated list.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.removeClass(element, "active");
 * GeoLeaf.Helpers.removeClass(element, "loading", "disabled");
 * ```
 */
function removeClass(element: Element | null | undefined, ...classNames: string[]): void {
    if (!element || !element.classList) return;
    const allClasses = classNames.flatMap((cn) => cn.split(" ")).filter(Boolean);
    element.classList.remove(...allClasses);
}

/**
 * Toggles a CSS class and reports the state it settled on.
 *
 * ⚠️ A null element returns `false` — the same value as "the class was removed". When the
 * element may be missing, test it before calling rather than reading the return value as
 * proof of a removal.
 *
 * @param element - Target element; null or undefined yields `false` without touching the DOM.
 * @param className - The class to toggle. Unlike {@link addClass}, a single name is expected.
 * @param force - When given, forces the outcome: `true` adds, `false` removes.
 * @returns `true` if the class is present after the call, `false` otherwise.
 *
 * @example
 * ```js
 * const added = GeoLeaf.Helpers.toggleClass(element, "active");
 * // Returns: true when added, false when removed
 * ```
 */
function toggleClass(
    element: Element | null | undefined,
    className: string,
    force?: boolean
): boolean {
    if (!element || !element.classList) return false;
    return element.classList.toggle(className, force);
}

/**
 * Reports whether an element carries a CSS class.
 *
 * A null or class-less element yields `false`, so the check never needs a guard of its own.
 *
 * @param element - Target element; null or undefined yields `false`.
 * @param className - The class to look for.
 * @returns `true` if the element carries the class.
 *
 * @example
 * ```js
 * const isActive = GeoLeaf.Helpers.hasClass(element, "active");
 * // Returns: boolean
 * ```
 */
function hasClass(element: Element | null | undefined, className: string): boolean {
    if (!element || !element.classList) return false;
    return element.classList.contains(className);
}

/**
 * Detaches a node from its parent.
 *
 * A node that is null or already detached is a no-op. ⚠️ This removes the node from the DOM
 * but does not release listeners bound to it — use the disposer returned by
 * {@link addEventListener} when the node carried handlers.
 *
 * @param element - Node to detach; null, undefined or already-detached is ignored.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.removeElement(element);
 * ```
 */
function removeElement(element: Node | null | undefined): void {
    if (element?.parentNode) {
        element.parentNode.removeChild(element);
    }
}

/**
 * Schedules a callback on the next animation frame.
 *
 * Falls back to a zero-delay `setTimeout` where `requestAnimationFrame` is missing (SSR,
 * jsdom), so the returned id is only meaningful when paired with {@link cancelFrame}, which
 * handles both cases.
 *
 * @param callback - Invoked before the next repaint, with the frame timestamp.
 * @returns A handle to pass to {@link cancelFrame}.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.requestFrame(() => {
 *     // Optimised animation or DOM modification
 *     element.style.transform = `translateX(${x}px)`;
 * });
 * // Returns: number (animation frame ID)
 * ```
 */
function requestFrame(callback: FrameRequestCallback): number {
    const w =
        typeof window !== "undefined"
            ? window
            : typeof globalThis !== "undefined"
              ? globalThis
              : ({} as Window);
    if (typeof (w as Window).requestAnimationFrame === "function") {
        return (w as Window).requestAnimationFrame(callback);
    }
    return setTimeout(callback as () => void, 0) as unknown as number;
}

/**
 * Cancels a frame scheduled by {@link requestFrame}.
 *
 * Handles both paths symmetrically: a real `cancelAnimationFrame` where available, a
 * `clearTimeout` on the fallback. Cancelling an id that has already fired is a no-op.
 *
 * @param id - The handle returned by {@link requestFrame}.
 *
 * @example
 * ```js
 * const frameId = GeoLeaf.Helpers.requestFrame(callback);
 * GeoLeaf.Helpers.cancelFrame(frameId);
 * ```
 */
function cancelFrame(id: number): void {
    const w =
        typeof window !== "undefined"
            ? window
            : typeof globalThis !== "undefined"
              ? globalThis
              : ({} as Window);
    if (typeof (w as Window).cancelAnimationFrame === "function") {
        (w as Window).cancelAnimationFrame(id);
    } else {
        clearTimeout(id);
    }
}

/**
 * Creates an `AbortController` that optionally aborts itself after a delay.
 *
 * ⚠️ The timer is **not** cleared when the request settles on its own: the abort still fires
 * at the deadline, harmlessly on an already-settled signal, but the timer keeps the closure
 * alive until then. For long timeouts on hot paths, hold the controller and abort explicitly.
 *
 * @param timeout - Delay in milliseconds before aborting. Omitted or `0` means no deadline.
 * @returns A controller whose `signal` can be handed to `fetch`.
 *
 * @example
 * ```js
 * const controller = GeoLeaf.Helpers.createAbortController(5000); // timeout 5s
 * const response = await fetch("/api/data", { signal: controller.signal });
 * ```
 */
function createAbortController(timeout?: number): AbortController {
    const controller = new AbortController();
    if (timeout) {
        setTimeout(() => controller.abort(), timeout);
    }
    return controller;
}

/**
 * Defers an image load until it scrolls into view.
 *
 * The real URL is read from the element's `data-src`; the `src` is only assigned once the
 * observer reports an intersection, then the element is unobserved. Where
 * `IntersectionObserver` is unavailable the image is loaded **immediately** rather than never
 * — the degraded path costs bandwidth, not correctness.
 *
 * @param img - The image element. It must carry `data-src`, or nothing is loaded.
 * @param options - Observer options; `threshold` is the visible fraction that triggers the
 *   load. Defaults to `{ threshold: 0.1 }`.
 *
 * @example
 * ```js
 * const img = document.querySelector(".poi-image");
 * // `querySelector` yields `Element | null`: the guard is necessary, not decorative.
 * if (img instanceof HTMLImageElement) {
 *     GeoLeaf.Helpers.lazyLoadImage(img, {
 *         threshold: 0.1, // load at 10% visibility
 *     });
 * }
 * ```
 */
function lazyLoadImage(
    img: HTMLImageElement,
    options: { threshold?: number } = { threshold: 0.1 }
): void {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
        const src = img.dataset.src || img.getAttribute("data-src");
        if (src) img.src = src;
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const lazyImg = entry.target as HTMLImageElement;
                const src = lazyImg.dataset.src || lazyImg.getAttribute("data-src");
                if (src) lazyImg.src = src;
                observer.unobserve(lazyImg);
            }
        });
    }, options);

    observer.observe(img);
}

/**
 * Runs a callback when the browser goes idle, rather than competing with the current frame.
 *
 * Uses `requestIdleCallback` where available and a plain `setTimeout` otherwise. In both
 * paths `timeout` is the **deadline**: the callback runs by then even if no idle period
 * occurred, so this defers work without risking that it never happens.
 *
 * @param callback - The deferred work.
 * @param timeout - Deadline in milliseconds after which the callback runs regardless.
 *   Defaults to `100`.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.lazyExecute(() => {
 *     // Initialisation non urgente
 *     loadHeavyData();
 * }, 100);
 * ```
 */
function lazyExecute(callback: () => void, timeout: number = 100): void {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (
            window as Window & {
                requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number;
            }
        ).requestIdleCallback(callback, { timeout });
    } else {
        setTimeout(callback, timeout);
    }
}

/**
 * Deletes every own key of an object, in place.
 *
 * The reference is preserved, which is the whole point: a cache held by several modules is
 * emptied for all of them at once, where reassigning `{}` would only rebind the local name.
 * ⚠️ Only own enumerable keys go — inherited properties and symbol keys remain.
 *
 * @param obj - Object to empty; null, undefined or a non-object is ignored.
 *
 * @example
 * ```js
 * const cache = { key1: "val1", key2: "val2" };
 * GeoLeaf.Helpers.clearObject(cache);
 * // cache === {} (same reference, content emptied)
 * ```
 */
function clearObject(obj: Record<string, unknown> | null | undefined): void {
    if (!obj || typeof obj !== "object") return;
    Object.keys(obj).forEach((key) => {
        delete obj[key];
    });
}

/**
 * Builds a `DocumentFragment` from a list of elements, for a single-reflow insertion.
 *
 * Appending N elements one by one costs N layout passes; appending the fragment costs one.
 * ⚠️ Entries that are not `HTMLElement` instances are **silently skipped** — text nodes and
 * raw strings do not survive this call.
 *
 * @param children - Elements to append, in order. Non-`HTMLElement` entries are dropped.
 * @returns A fragment holding the accepted children.
 *
 * @example
 * ```js
 * const fragment = GeoLeaf.Helpers.createFragment([el1, el2, el3]);
 * container.appendChild(fragment);
 * ```
 */
function createFragment(children: HTMLElement[] = []): DocumentFragment {
    const fragment = document.createDocumentFragment();
    children.forEach((child) => {
        if (child instanceof HTMLElement) {
            fragment.appendChild(child);
        }
    });
    return fragment;
}

/**
 * Binds a listener and returns the disposer that unbinds it.
 *
 * The returned closure captures the exact `(event, handler, options)` triple, which is what
 * makes removal reliable: `removeEventListener` silently does nothing when the options do
 * not match the ones used at bind time, and that mismatch is the usual source of leaked
 * handlers. A missing element or handler yields a no-op disposer, so the result is always
 * safe to call.
 *
 * @param element - Target; null or undefined yields a no-op disposer.
 * @param event - Event name, e.g. `"click"`.
 * @param handler - Listener function or `handleEvent` object.
 * @param options - Standard `addEventListener` options (`capture`, `once`, `passive`).
 * @returns A disposer that removes the listener. Idempotent in practice.
 *
 * @example
 * ```js
 * const cleanup = GeoLeaf.Helpers.addEventListener(
 *     button,
 *     "click",
 *     (e) => {
 *         console.log("Click !");
 *     },
 *     { once: true }
 * );
 *
 * // Nettoyer manuellement si besoin
 * cleanup();
 * ```
 */
function addEventListener(
    element: EventTarget | null | undefined,
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
): () => void {
    if (!element || !event || !handler) return () => {};
    element.addEventListener(event, handler, options);
    return () => {
        element.removeEventListener(event, handler, options);
    };
}

/**
 * Binds several listeners to one target and returns a single disposer for all of them.
 *
 * Equivalent to calling {@link addEventListener} per entry, but the returned closure releases
 * the whole set — which is what makes it usable in a `destroy()` that must not track handles
 * individually. The same `options` apply to every entry.
 *
 * @param element - Target; null or undefined yields a no-op disposer.
 * @param events - Map of event name to handler.
 * @param options - Standard `addEventListener` options, applied to every entry.
 * @returns A disposer that removes all the listeners bound by this call.
 *
 * @example
 * ```js
 * const cleanup = GeoLeaf.Helpers.addEventListeners(element, {
 *     click: () => console.log("click"),
 *     mouseenter: () => console.log("hover"),
 *     mouseleave: () => console.log("leave"),
 * });
 *
 * // Clean up all the listeners
 * cleanup();
 * ```
 */
function addEventListeners(
    element: EventTarget | null | undefined,
    events: Record<string, EventListenerOrEventListenerObject>,
    options?: boolean | AddEventListenerOptions
): () => void {
    if (!element || !events) return () => {};
    const cleanups: (() => void)[] = [];
    Object.entries(events).forEach(([eventName, handler]) => {
        cleanups.push(addEventListener(element, eventName, handler, options));
    });
    return () => {
        cleanups.forEach((cleanup) => cleanup());
    };
}

/**
 * Binds one listener on a parent that fires for descendants matching a selector.
 *
 * The point is dynamic content: markers and list rows added after binding are covered,
 * because only the parent carries a handler. ⚠️ The match is tested against `event.target`
 * itself, **not** its ancestors — a click landing on a child of the matched element does not
 * fire. Keep the selector on the element that actually receives the event.
 *
 * ⚠️ `handler` is called with `this` bound to the matched element, so it must be a
 * **function expression**; an arrow function has no `this` to bind.
 *
 * @param parent - Element carrying the real listener; null or undefined yields a no-op disposer.
 * @param event - Event name, e.g. `"click"`.
 * @param selector - CSS selector the event target must match.
 * @param handler - Invoked with `this` set to the matched element.
 * @returns A disposer that removes the delegating listener.
 *
 * @example
 * ```js
 * // Listen to every POI marker, even those added dynamically
 * GeoLeaf.Helpers.delegateEvent(document.body, "click", ".gl-poi-marker", function (e) {
 *     // `this` is typed `Element`; `dataset` lives on `HTMLElement`.
 *     if (this instanceof HTMLElement) {
 *         console.log("POI cliqué:", this.dataset.poiId);
 *     }
 * });
 * ```
 */
function delegateEvent(
    parent: EventTarget | null | undefined,
    event: string,
    selector: string,
    handler: (this: Element, e: Event) => void
): () => void {
    const delegatedHandler = (e: Event): void => {
        const target = e.target as Element | null;
        if (target?.matches?.(selector)) {
            handler.call(target, e);
        }
    };
    return addEventListener(parent, event, delegatedHandler);
}

/**
 * Deep-clones a value, preserving `Date` and `RegExp` and tolerating circular references.
 *
 * Cycles are resolved through an identity map, so a graph that points back at itself clones
 * to a graph with the same shape instead of overflowing the stack. ⚠️ Only plain objects,
 * arrays, `Date` and `RegExp` are reconstructed — `Map`, `Set`, class instances and functions
 * come back as plain objects or by reference, losing their prototype.
 *
 * @param obj - Value to clone. Primitives are returned as-is.
 * @param seen - Identity map used to resolve cycles. Internal to the recursion; callers
 *   should not pass it.
 * @returns A structurally independent copy.
 *
 * @example
 * ```js
 * const original = { name: "POI", coords: [45.5, -73.6], tags: ["a", "b"] };
 * const clone = GeoLeaf.Helpers.deepClone(original);
 *
 * clone.tags.push("c");
 * console.log(original.tags); // ['a', 'b'] — original unmodified
 * console.log(clone.tags); // ['a', 'b', 'c']
 * ```
 */
function deepClone<T>(obj: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
    if (obj === null || typeof obj !== "object") return obj;
    if (seen.has(obj as object)) return seen.get(obj as object) as T;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    // The rule fires on any non-literal `new RegExp()`, which is right in general: a
    // pattern built from user input can be a ReDoS vector. Here the source is a RegExp
    // the caller already holds and has already used — cloning it introduces no pattern
    // that did not exist a line earlier, and there is no string concatenation to smuggle
    // one in. The alternative (returning the same RegExp instance) would break the deep
    // clone: `lastIndex` is mutable and would stay shared.
    // eslint-disable-next-line security/detect-non-literal-regexp -- reconstructs an EXISTING RegExp, no concatenation
    if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags) as unknown as T;
    if (Array.isArray(obj)) {
        const cloned: unknown[] = [];
        seen.set(obj as object, cloned);
        (obj as unknown[]).forEach((item) => cloned.push(deepClone(item, seen)));
        return cloned as unknown as T;
    }
    const cloned: Record<string, unknown> = {};
    seen.set(obj as object, cloned);
    Object.keys(obj as object).forEach((key) => {
        cloned[key] = deepClone((obj as Record<string, unknown>)[key], seen);
    });
    return cloned as T;
}

/**
 * Reports whether a value counts as empty.
 *
 * Empty means: `null`, `undefined`, a whitespace-only string, an array of length 0, or an
 * object with no own enumerable keys. ⚠️ `0` and `false` are **not** empty — this is
 * deliberately not a falsiness test, so a zero coordinate or a disabled flag survives it.
 *
 * @param value - Value to test.
 * @returns `true` if the value is empty by the rule above.
 *
 * @example
 * ```js
 * GeoLeaf.Helpers.isEmpty(""); // true
 * GeoLeaf.Helpers.isEmpty([]); // true
 * GeoLeaf.Helpers.isEmpty({}); // true
 * GeoLeaf.Helpers.isEmpty(null); // true
 * GeoLeaf.Helpers.isEmpty(undefined); // true
 * GeoLeaf.Helpers.isEmpty("hello"); // false
 * ```
 */
function isEmpty(value: unknown): boolean {
    if (value == null) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

/**
 * Resolves after a delay — a `setTimeout` in `await` form.
 *
 * There is no cancellation: the promise always resolves, never rejects. For a delay that must
 * be interruptible, pair a signal from {@link createAbortController} with the awaited work.
 *
 * @param ms - Delay in milliseconds.
 * @returns A promise resolving once the delay has elapsed.
 *
 * @example
 * ```js
 * async function loadData() {
 *     console.log("Chargement...");
 *     await GeoLeaf.Helpers.wait(2000);
 *     console.log("Données chargées après 2s");
 * }
 * ```
 */
function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff, then rethrows the last failure.
 *
 * `maxRetries` counts **attempts, not retries**: the function is called that many times in
 * total, and the wait between attempt *i* and *i+1* is `delay × 2ⁱ`. There is therefore no
 * wait after the final attempt — with the defaults, three calls separated by 1 000 ms and
 * 2 000 ms, then the error surfaces.
 *
 * Every failure is retried, including ones that never will succeed: a 404 costs the full
 * schedule. Filter inside `fn` when the distinction matters.
 *
 * @param fn - The operation to attempt. Re-invoked from scratch on each attempt.
 * @param maxRetries - Total number of attempts. Defaults to `3`.
 * @param delay - Base delay in milliseconds, doubled after each failed attempt. Defaults to `1000`.
 * @returns The first successful result.
 * @throws The error thrown by the final attempt.
 *
 * @example
 * ```js
 * const data = await GeoLeaf.Helpers.retryWithBackoff(
 *     async () => {
 *         const response = await fetch("/api/poi");
 *         if (!response.ok) throw new Error("Erreur réseau");
 *         return response.json();
 *     },
 *     3, // total attempt count (default: 3)
 *     1000 // initial delay in ms (default: 1000)
 * );
 *
 * // Sequence for maxRetries = 3:
 * // 1. Failure → wait 1,000 ms
 * // 2. Failure → wait 2,000 ms (1000 * 2^1)
 * // 3. Failure → that attempt's error is rethrown (no final wait)
 * ```
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            if (i < maxRetries - 1) {
                const backoffDelay = delay * Math.pow(2, i);
                await wait(backoffDelay);
            }
        }
    }
    throw lastError;
}

const Helpers = {
    getElementById,
    querySelector,
    querySelectorAll,
    applyCssText,
    addClass,
    removeClass,
    toggleClass,
    hasClass,
    removeElement,
    requestFrame,
    cancelFrame,
    createAbortController,
    lazyLoadImage,
    lazyExecute,
    clearObject,
    createFragment,
    addEventListener,
    addEventListeners,
    delegateEvent,
    deepClone,
    isEmpty,
    wait,
    retryWithBackoff,
};

export { Helpers };

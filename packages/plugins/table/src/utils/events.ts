/*!
 * @geoleaf-plugins/table — Event listener manager (repatriated, pure)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Minimal standalone replacement for the core delegation manager. `on()` attaches
 * the listener and returns a teardown function; the table pushes these into its
 * `_eventCleanups` registries and runs them before re-render / on destroy.
 * https://geoleaf.dev
 */

/**
 * The table's DOM event names, in one place.
 *
 * Centralised because emitters and listeners live in different modules: a literal typo on one
 * side would produce an event nobody hears, and nothing would report it.
 */
export const events = {
    /**
     * Attaches an event listener and returns a teardown function that detaches it.
     *
     * @param target - The event target.
     * @param type - Event type (e.g. "click", "change", "scroll").
     * @param handler - Listener callback.
     * @param options - `addEventListener` options (boolean capture or options object).
     * @param _label - Diagnostic label (accepted for call-site parity; unused).
     */
    on(
        target: EventTarget,
        type: string,
        handler: EventListener,
        options?: boolean | AddEventListenerOptions,
        _label?: string
    ): () => void {
        target.addEventListener(type, handler, options);
        return () => target.removeEventListener(type, handler, options);
    },

    /** Runs a teardown function previously returned by {@link on}. */
    off(cleanup: unknown): void {
        if (typeof cleanup === "function") {
            (cleanup as () => void)();
        }
    },
};

/**
 * Shim mock for @core/utils/event-listener-manager
 * Provides a functional `events` object backed by real addEventListener.
 */
"use strict";

const events = {
    on(target, event, handler, capture, _label) {
        if (!target) return null;
        target.addEventListener(event, handler, capture || false);
        return () => target.removeEventListener(event, handler, capture || false);
    },
    off(idOrCleanup) {
        if (typeof idOrCleanup === "function") idOrCleanup();
        return true;
    },
};

export { events };

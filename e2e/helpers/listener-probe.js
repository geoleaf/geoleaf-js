// @ts-check
// Live DOM listener probe — shared by the lifecycle specs (`10-lifecycle`, `71-mount-remount`).

/**
 * Installs a live-listener probe before any page script runs.
 *
 * DevTools' `getEventListeners()` is not reachable from page context, so the only
 * way to observe listener accumulation is to wrap the prototype methods ourselves.
 * A naive +1/-1 counter is NOT enough: a defensive `removeEventListener()` for a
 * handler that was never added would decrement and mask a real leak. So we key on
 * (target, type, handler, capture) and hold a Map of live keys — `remove` on an
 * unknown key is then a no-op, exactly as it is in the DOM.
 *
 * ⚠️ ONLY LISTENERS ON *ATTACHED* TARGETS COUNT, and that is a measured correction,
 * not a convenience. Counting every registration made this probe go RED on a
 * non-defect: MapLibre's `Map._setupPainter()` binds `webglcontextcreationerror` to
 * its `<canvas>` and never unbinds it, so each cycle left one more handler behind —
 * on a canvas that `map.remove()` had already detached. A handler on a node no
 * longer in the document is unreachable and GC-collectable; it is not residual
 * state. Keeping it in the count would have forced a baseline stamp over a
 * third-party non-bug — the exact move this repo treats as a gate that stops
 * guarding. `WeakRef` is what lets us ask the question without retaining the node.
 */
export async function installListenerProbe(page) {
    await page.addInitScript(() => {
        const proto = EventTarget.prototype;
        const add = proto.addEventListener;
        const remove = proto.removeEventListener;
        const ids = new WeakMap();
        const live = new Map();
        let next = 1;
        const idOf = (o) => {
            if (o === null || (typeof o !== "object" && typeof o !== "function")) return String(o);
            let id = ids.get(o);
            if (!id) ids.set(o, (id = next++));
            return id;
        };
        const keyOf = (target, type, handler, opts) =>
            `${idOf(target)}|${type}|${idOf(handler)}|${
                (typeof opts === "object" && opts !== null ? opts.capture : opts) ? 1 : 0
            }`;
        proto.addEventListener = function (type, handler, opts) {
            const key = keyOf(this, type, handler, opts);
            live.set(key, new WeakRef(this));
            // A `{ once: true }` listener is removed BY THE DOM when it fires, without any
            // `removeEventListener` call to observe: a companion `once`, posted untracked with it,
            // drops its key on the same dispatch. Without it every fired `once` read as
            // a leak — measured on `71-mount-remount`, where each boot posts some.
            if (typeof opts === "object" && opts !== null && opts.once) {
                add.call(this, type, () => live.delete(key), {
                    once: true,
                    capture: Boolean(opts.capture),
                });
            }
            return add.call(this, type, handler, opts);
        };
        proto.removeEventListener = function (type, handler, opts) {
            live.delete(keyOf(this, type, handler, opts));
            return remove.call(this, type, handler, opts);
        };
        Object.defineProperty(window, "__glLiveListeners", {
            get: () => {
                let n = 0;
                for (const [key, ref] of live) {
                    const t = ref.deref();
                    if (t === undefined) {
                        live.delete(key); // target collected — nothing residual left
                    } else if (t === window || t === document || t.isConnected !== false) {
                        n++;
                    }
                }
                return n;
            },
        });
    });
}

/** Current number of live DOM listeners, as seen by the probe above. */
export async function liveListeners(page) {
    return page.evaluate(() => window.__glLiveListeners);
}

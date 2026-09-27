/**
 * `whenStyleReady` — the one wait on a map's style (`utils/general/style-ready.ts`).
 *
 * What it must hold, each a way the waits it replaces failed: resolve at once on a loaded style;
 * NOT resume on an event landing before `isStyleLoaded()` flips (a single `once("styledata")`
 * did, measured at boot on `tourism`); resume on whichever of the three events carries the flip;
 * and leave no listener behind.
 */
import { describe, test, expect, vi } from "vitest";
import { whenStyleReady, STYLE_READY_EVENTS } from "../../src/utils/general/style-ready.js";

function fakeMap(loaded: boolean) {
    const listeners = new Map<string, Set<() => void>>();
    const map = {
        loaded,
        isStyleLoaded: () => map.loaded,
        on: vi.fn((type: string, fn: () => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        }),
        off: vi.fn((type: string, fn: () => void) => listeners.get(type)?.delete(fn)),
        emit: (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn()),
        listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
    return map;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("whenStyleReady", () => {
    test("un style déjà chargé : résolu tout de suite, sans écouteur", async () => {
        const map = fakeMap(true);
        await whenStyleReady(map);
        expect(map.on).not.toHaveBeenCalled();
    });

    test.each(STYLE_READY_EVENTS)("reprend sur `%s` une fois le style chargé", async (evt) => {
        const map = fakeMap(false);
        let done = false;
        void whenStyleReady(map).then(() => (done = true));

        // Every event landing before the flip is re-tested and ignored.
        for (const early of STYLE_READY_EVENTS) map.emit(early);
        await flush();
        expect(done).toBe(false);

        map.loaded = true;
        map.emit(evt);
        await flush();
        expect(done).toBe(true);
        expect(map.listening()).toBe(0);
    });
});

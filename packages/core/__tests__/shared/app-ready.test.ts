/**
 * `kernel/shared/app-ready.ts` — what runs once the application is ready, whenever it subscribes.
 *
 * `geoleaf:app:ready` has no replay: a `{ once: true }` listener added after it fired waits
 * forever. `whenAppReady()` runs a late subscriber at once. The flag must fall back at the next
 * boot and at `Core.destroy()` (teardown seam), or a recreated map would mount its capabilities
 * before its own reveal. Witness mutations: drop the `_ready` branch of `whenAppReady` (the
 * « after » case goes red), or the `registerLifecycleTeardown` line of `markAppReady` (the
 * teardown case goes red).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAppReady, resetAppReady, whenAppReady } from "../../src/kernel/shared/app-ready.js";
import { runLifecycleTeardowns } from "../../src/kernel/shared/lifecycle.js";

const fire = (): void => {
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
};

afterEach(() => {
    resetAppReady();
});

describe("whenAppReady", () => {
    it("before the reveal: waits for geoleaf:app:ready, and runs once", () => {
        const listener = vi.fn();
        whenAppReady(listener);
        expect(listener).not.toHaveBeenCalled();

        fire();
        fire();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("after the reveal: runs at once — the event will not come again", () => {
        markAppReady();
        const listener = vi.fn();
        whenAppReady(listener);
        expect(listener).toHaveBeenCalledTimes(1);

        fire();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("a listener waiting on the event can still be detached with removeEventListener", () => {
        const listener = vi.fn();
        whenAppReady(listener);
        document.removeEventListener("geoleaf:app:ready", listener);

        fire();
        expect(listener).not.toHaveBeenCalled();
    });
});

describe("the ready flag falls back", () => {
    it("at the start of a boot (resetAppReady): a subscriber waits again", () => {
        markAppReady();
        resetAppReady();
        const listener = vi.fn();
        whenAppReady(listener);
        expect(listener).not.toHaveBeenCalled();
        fire();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("when the last map is destroyed (lifecycle teardown seam)", () => {
        markAppReady();
        runLifecycleTeardowns();
        const listener = vi.fn();
        whenAppReady(listener);
        expect(listener).not.toHaveBeenCalled();
        fire();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

/**
 * @tests built-in/ui/mobile/mobile-toolbar — RM-P2 #6a filter-check interval teardown
 *
 * The 2s filter-state polling interval created in `initMobileToolbar` was never
 * cleared → it leaked on every destroy → recreate cycle. A lifecycle teardown now
 * clears it. Importing the module registers that teardown at load time.
 */
import { runLifecycleTeardowns } from "../../src/kernel/shared/lifecycle.js";
import { domState } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";
// Side-effect import: registers the filter-check-interval teardown on load.
import "../../src/kernel/ui/mobile/mobile-toolbar.js";

describe("mobile-toolbar — RM-P2 #6a filter-check interval teardown", () => {
    afterEach(() => {
        if (domState.filterCheckInterval != null) {
            clearInterval(domState.filterCheckInterval);
            domState.filterCheckInterval = null;
        }
    });

    it("clears domState.filterCheckInterval on lifecycle teardown (no leak on destroy)", () => {
        domState.filterCheckInterval = setInterval(() => {}, 1_000_000);
        expect(domState.filterCheckInterval).not.toBeNull();
        runLifecycleTeardowns();
        expect(domState.filterCheckInterval).toBeNull();
    });

    it("teardown is a no-op when no interval is active", () => {
        domState.filterCheckInterval = null;
        expect(() => runLifecycleTeardowns()).not.toThrow();
        expect(domState.filterCheckInterval).toBeNull();
    });
});

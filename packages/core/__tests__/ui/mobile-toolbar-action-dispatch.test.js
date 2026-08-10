/**
 * @tests built-in/ui/mobile/mobile-toolbar — toolbar-action dispatch branch (KERNEL S8)
 *
 * S8 extracted the inlined lazy/eager dispatch block out of `onToolbarClick` into
 * the shared `ui/toolbar-dispatch.js` helper. The helper is `void` / fire-and-forget,
 * so the `if (action) { …; return; }` guard in the caller is load-bearing: without
 * the `return`, control falls through to `_dispatchSheetAction()` and a button
 * carrying BOTH `data-gl-toolbar-action` and `data-gl-sheet` fires twice.
 *
 * These tests pin that invariant — they fail if the `return` is ever dropped.
 */
import { openSheet } from "../../src/kernel/ui/mobile/mobile-toolbar-sheet.js";
import { initMobileToolbar } from "../../src/kernel/ui/mobile/mobile-toolbar.js";
import { domState } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";

vi.mock("../../src/kernel/ui/mobile/mobile-toolbar-sheet.js", async (orig) => ({
    ...(await orig()),
    openSheet: vi.fn(),
}));

/** Boots a toolbar into a fresh `.gl-main` and returns the scroll container. */
function mountToolbar() {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    initMobileToolbar({ glMain });
    return glMain;
}

describe("mobile-toolbar — toolbar-action dispatch", () => {
    let actions;
    let onAction;

    beforeEach(() => {
        document.body.innerHTML = "";
        actions = [];
        onAction = (e) => actions.push(e.detail);
        document.addEventListener("geoleaf:toolbar:action", onAction);
    });

    afterEach(() => {
        document.removeEventListener("geoleaf:toolbar:action", onAction);
        if (domState.filterCheckInterval != null) {
            clearInterval(domState.filterCheckInterval);
            domState.filterCheckInterval = null;
        }
        vi.clearAllMocks();
    });

    it("dispatches geoleaf:toolbar:action with the action id and the clicked element", () => {
        mountToolbar();
        const btn = document.createElement("button");
        btn.setAttribute("data-gl-toolbar-action", "print");
        domState.toolbar.appendChild(btn);

        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(actions).toHaveLength(1);
        expect(actions[0].action).toBe("print");
        expect(actions[0].element).toBe(btn);
    });

    it("does NOT also open the sheet when the button carries both attributes", () => {
        mountToolbar();
        const btn = document.createElement("button");
        btn.setAttribute("data-gl-toolbar-action", "print");
        btn.setAttribute("data-gl-sheet", "legend");
        domState.toolbar.appendChild(btn);

        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(actions).toHaveLength(1);
        // The load-bearing assertion: falling through would open the sheet too.
        expect(openSheet).not.toHaveBeenCalled();
    });

    it("still opens the sheet for a button with no toolbar action", () => {
        mountToolbar();
        const btn = document.createElement("button");
        btn.setAttribute("data-gl-sheet", "legend");
        domState.toolbar.appendChild(btn);

        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(actions).toHaveLength(0);
        expect(openSheet).toHaveBeenCalledWith("legend");
    });
});

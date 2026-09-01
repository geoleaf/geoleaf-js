/**
 * @geoleaf-plugins/table — public surface of `buildPublicApi()`.
 *
 * 🛑 **This file is this surface's ONLY net, and that is a measured property.**
 * `Table` is not in `EXPECTED_FACADE_KEYS` (`scripts/lib/namespace-surface.mjs`)
 * — it is a plugin, absent from a core boot, so the post-boot golden master
 * does not see it. And `CONSUMER-CONTRACT/CC-03`, which could read it,
 * derives its perimeter from a manifest living OUTSIDE this repo: on a clone
 * without `GEOLEAF_CONSUMERS` it skips with exit 0.
 *
 * ⚠️ It only asserted `api.open` — a member could vanish with nothing turning
 * red. The list below is written by HAND, deliberately: it is not a snapshot,
 * so `vitest -u` cannot rubber-stamp a surface regression.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildPublicApi } from "../public-api.js";
import { tableState } from "../table-state.js";

/** The 15 published members. Removing a line here is an act, not a side effect. */
const EXPECTED_MEMBERS = [
    "show",
    "hide",
    "toggle",
    "open",
    "isOpen",
    "setLayer",
    "refresh",
    "sortByField",
    "setSelection",
    "getSelectedIds",
    "clearSelection",
    "zoomToSelection",
    "highlightSelection",
    "exportSelection",
    "exportLayer",
] as const;

afterEach(() => {
    tableState._container = null;
    tableState._isVisible = false;
    tableState._map = null;
});

describe("@geoleaf-plugins/table public API", () => {
    it("expose exactement les membres documentés, tous appelables", () => {
        const api = buildPublicApi();

        expect(Object.keys(api).sort()).toEqual([...EXPECTED_MEMBERS].sort());
        for (const name of EXPECTED_MEMBERS) {
            expect(typeof api[name], `\`${name}\` doit rester une fonction`).toBe("function");
        }
    });

    it("isOpen() suit show() et hide()", () => {
        const api = buildPublicApi();
        tableState._container = document.createElement("div");

        expect(api.isOpen()).toBe(false);
        api.show();
        expect(api.isOpen()).toBe(true);
        api.hide();
        expect(api.isOpen()).toBe(false);
    });

    it("🛑 isOpen() rend le contournement possible — `open()` BASCULE", () => {
        const api = buildPublicApi();
        tableState._container = document.createElement("div");

        // The defect itself, exercised rather than cited: two `open()` calls close again.
        api.open();
        expect(api.isOpen()).toBe(true);
        api.open();
        expect(api.isOpen(), "`open()` est un alias de `toggle()`").toBe(false);

        // The workaround `isOpen()` makes possible, which did not exist before it.
        if (!api.isOpen()) api.open();
        if (!api.isOpen()) api.open();
        expect(api.isOpen()).toBe(true);
    });
});

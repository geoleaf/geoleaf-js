/**
 * Unit coverage for the small pure utilities the ported suites previously
 * mocked away:
 *   - src/utils/events.ts       (events.on / events.off)
 *   - src/utils/dom-helpers.ts  (createElement / $create)
 *   - src/config.ts             (getPluginConfig — ?? {} branch)
 *
 * None of the modules under test are mocked. Runtime seams are driven through
 * the shared `globalThis.GeoLeaf` helper (resetGeoLeaf / setTableConfig).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { resetGeoLeaf, setTableConfig } from "./_helpers/geoleaf-global.js";
import { events } from "../utils/events.js";
import { createElement, $create } from "../utils/dom-helpers.js";
import { getPluginConfig } from "../config.js";

beforeEach(() => {
    resetGeoLeaf();
    vi.clearAllMocks();
});

// ── events.ts ───────────────────────────────────────────────────

describe("utils/events.ts — events", () => {
    it("on() attaches a listener and returns a teardown that detaches it", () => {
        const target = document.createElement("button");
        const handler = vi.fn();
        const off = events.on(target, "click", handler);
        target.dispatchEvent(new Event("click"));
        expect(handler).toHaveBeenCalledTimes(1);

        off();
        target.dispatchEvent(new Event("click"));
        // No further calls after teardown.
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("on() forwards addEventListener options and the diagnostic label", () => {
        const target = document.createElement("div");
        const handler = vi.fn();
        const off = events.on(target, "scroll", handler, { capture: true }, "diag-label");
        target.dispatchEvent(new Event("scroll"));
        expect(handler).toHaveBeenCalledTimes(1);
        off();
    });

    it("off() runs a teardown function", () => {
        const cleanup = vi.fn();
        events.off(cleanup);
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("off() ignores non-function values (does not throw)", () => {
        expect(() => events.off(null)).not.toThrow();
        expect(() => events.off(undefined)).not.toThrow();
        expect(() => events.off(42)).not.toThrow();
    });
});

// ── dom-helpers.ts ──────────────────────────────────────────────

describe("utils/dom-helpers.ts — createElement / $create", () => {
    it("creates a bare element with no props", () => {
        const el = createElement("span");
        expect(el.tagName.toLowerCase()).toBe("span");
    });

    it("skips null/undefined prop values", () => {
        const el = createElement("div", { id: undefined, className: undefined });
        expect(el.id).toBe("");
        expect(el.className).toBe("");
    });

    it("applies className and id", () => {
        const el = createElement("div", { className: "a b", id: "the-id" });
        expect(el.className).toBe("a b");
        expect(el.id).toBe("the-id");
    });

    it("applies style object", () => {
        const el = createElement("div", { style: { color: "red" } });
        expect(el.style.color).toBe("red");
    });

    it("applies dataset entries", () => {
        const el = createElement("div", { dataset: { foo: "bar", count: "3" } });
        expect(el.dataset.foo).toBe("bar");
        expect(el.dataset.count).toBe("3");
    });

    it("applies arbitrary attributes via the attributes map", () => {
        const el = createElement("div", { attributes: { role: "button", "aria-label": "X" } });
        expect(el.getAttribute("role")).toBe("button");
        expect(el.getAttribute("aria-label")).toBe("X");
    });

    it("sets textContent", () => {
        const el = createElement("p", { textContent: "hi" });
        expect(el.textContent).toBe("hi");
    });

    it("sets direct DOM properties present on the element (type, checked)", () => {
        const input = createElement("input", { type: "checkbox", checked: true });
        expect((input as HTMLInputElement).type).toBe("checkbox");
        expect((input as HTMLInputElement).checked).toBe(true);
    });

    it("sets a property present on the element (colSpan, title)", () => {
        const td = createElement("td", { colSpan: 2, title: "tip" });
        expect((td as HTMLTableCellElement).colSpan).toBe(2);
        expect(td.title).toBe("tip");
    });

    it("falls back to setAttribute for unknown keys not present on the element", () => {
        const el = createElement("div", { "data-custom": "v" });
        expect(el.getAttribute("data-custom")).toBe("v");
    });

    it("$create is an alias of createElement", () => {
        expect($create).toBe(createElement);
        const el = $create("section", { id: "s" });
        expect(el.id).toBe("s");
    });
});

// ── config.ts ───────────────────────────────────────────────────

// ⚠️ These three cases take one key as a WITNESS of the merge mechanism —
// they do not test the key itself. The witness was `pageSize` until
// 29/07/2026; the worst possible choice, since that key has **no read site**:
// the suite thus proved the merge correctly materialises a value nothing
// consumes. Witness replaced by `defaultHeight`, which the panel reads — a
// merge test must lean on a key whose disappearance would show elsewhere.
describe("config.ts — getPluginConfig", () => {
    it("returns the defaults when no override is configured (Config.get → {})", () => {
        // No Config wired → coreConfigGet returns its default {} → ?? {} branch.
        const cfg = getPluginConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.defaultHeight).toBe("40%");
        expect(cfg.maxRowsPerLayer).toBe(1000);
    });

    it("merges modules.table overrides over the defaults", () => {
        setTableConfig({ enabled: false, defaultHeight: "25%" });
        const cfg = getPluginConfig();
        expect(cfg.enabled).toBe(false);
        expect(cfg.defaultHeight).toBe("25%");
        // Untouched defaults survive the merge.
        expect(cfg.maxRowsPerLayer).toBe(1000);
        expect(cfg.resizable).toBe(true);
    });

    it("handles Config.get returning a non-object falsy override via ?? {}", () => {
        // Wire Config so modules.table resolves to null → (null ?? {}) branch.
        setTableConfig(null);
        const cfg = getPluginConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.defaultHeight).toBe("40%");
    });
});

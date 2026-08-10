/**
 * Campagne de tests unitaires — modules utils peu couverts
 */

import { TimerManager } from "../src/utils/general/timer-manager.js";
import { EventListenerManager } from "../src/utils/general/event-listener-manager.js";
import { createElement, appendChild, clearElement } from "../src/utils/general/dom-helpers.js";
import {
    validateUrl,
    resolveField,
    compareByOrder,
    fireMapEvent,
} from "../src/utils/general/utils-base.js";
import { ErrorLogger } from "../src/utils/log/error-logger.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coverage — TimerManager", () => {
    let tm;
    beforeEach(() => {
        tm = new TimerManager("test");
        vi.useFakeTimers();
    });
    afterEach(() => {
        tm.clearAll();
        vi.useRealTimers();
    });

    it("creates instance with name", () => {
        expect(tm.name).toBe("test");
        expect(tm.timers).toBeDefined();
    });
    it("creates instance with default name when no arg passed", () => {
        const tmDefault = new TimerManager();
        expect(tmDefault.name).toBe("default");
    });
    it("setTimeout schedules callback", () => {
        const fn = vi.fn();
        tm.setTimeout(fn, 100);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it("clearAll clears timers", () => {
        const fn = vi.fn();
        tm.setTimeout(fn, 1000);
        tm.clearAll();
        vi.advanceTimersByTime(1000);
        expect(fn).not.toHaveBeenCalled();
    });
    it("setInterval schedules callback repeatedly", () => {
        const fn = vi.fn();
        const id = tm.setInterval(fn, 100, "interval-label");
        expect(typeof id).toBe("number");
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(2);
        tm.clearInterval(id);
        vi.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(2);
    });
    it("setInterval catches callback errors", () => {
        const fn = vi.fn(() => {
            throw new Error("interval error");
        });
        tm.setInterval(fn, 100);
        expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });
    it("clearTimeout returns true when id exists, false otherwise", () => {
        const id = tm.setTimeout(vi.fn(), 5000);
        expect(tm.clearTimeout(id)).toBe(true);
        expect(tm.clearTimeout(999)).toBe(false);
    });
    it("clearInterval returns true when id exists, false otherwise", () => {
        const id = tm.setInterval(vi.fn(), 1000);
        expect(tm.clearInterval(id)).toBe(true);
        expect(tm.clearInterval(999)).toBe(false);
    });
    it("getStats returns timeouts and intervals counts", () => {
        tm.setTimeout(vi.fn(), 1000);
        tm.setInterval(vi.fn(), 500);
        const stats = tm.getStats();
        expect(stats.timeouts).toBe(1);
        expect(stats.intervals).toBe(1);
        expect(stats.total).toBe(2);
    });
    it("listActiveTimers returns timeout and interval entries", () => {
        tm.setTimeout(vi.fn(), 1000, "t1");
        const id2 = tm.setInterval(vi.fn(), 500, "i1");
        const list = tm.listActiveTimers();
        expect(list.length).toBe(2);
        expect(list.some((t) => t.type === "timeout" && t.label === "t1")).toBe(true);
        expect(list.some((t) => t.type === "interval" && t.label === "i1")).toBe(true);
        tm.clearInterval(id2);
        expect(tm.listActiveTimers().length).toBe(1);
    });
    it("destroy clears all and logs", () => {
        tm.setTimeout(vi.fn(), 10000);
        tm.destroy();
        expect(tm.getStats().total).toBe(0);
    });
});

describe("Coverage — EventListenerManager", () => {
    let elm;
    let target;
    beforeEach(() => {
        elm = new EventListenerManager("test");
        target = document.createElement("div");
    });
    afterEach(() => {
        elm.removeAll();
    });

    it("addEventListener registers handler", () => {
        const fn = vi.fn();
        const id = elm.addEventListener(target, "click", fn);
        expect(id).not.toBeNull();
        target.dispatchEvent(new Event("click"));
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it("removeAll cleans listeners", () => {
        const fn = vi.fn();
        elm.addEventListener(target, "click", fn);
        elm.removeAll();
        target.dispatchEvent(new Event("click"));
        expect(fn).not.toHaveBeenCalled();
    });
    it("removeListenersForTarget removes all listeners for target", () => {
        const fn = vi.fn();
        elm.addEventListener(target, "click", fn);
        elm.addEventListener(target, "keydown", vi.fn());
        const removed = elm.removeListenersForTarget(target);
        expect(removed).toBe(2);
        target.dispatchEvent(new Event("click"));
        expect(fn).not.toHaveBeenCalled();
    });
    it("listActiveListeners and getCount", () => {
        elm.addEventListener(target, "click", vi.fn());
        expect(elm.getCount()).toBe(1);
        const list = elm.listActiveListeners();
        expect(list.length).toBe(1);
        expect(list[0].event).toBe("click");
        elm.removeAll();
        expect(elm.getCount()).toBe(0);
    });
    it("destroy removes all", () => {
        elm.addEventListener(target, "click", vi.fn());
        elm.destroy();
        expect(elm.getCount()).toBe(0);
    });
});

describe("Coverage — dom-helpers", () => {
    beforeAll(() => {
        global.GeoLeaf = global.GeoLeaf || { Utils: {}, DOMSecurity: null };
    });
    it("createElement creates div with className", () => {
        const el = createElement("div", { className: "card" });
        expect(el.tagName).toBe("DIV");
        expect(el.className).toBe("card");
    });
    it("createElement throws for empty tag", () => {
        expect(() => createElement("", {})).toThrow(TypeError);
    });
    it("createElement with style object applies styles", () => {
        const el = createElement("div", { style: { color: "red", marginTop: "10px" } });
        expect(el.style.color).toBe("red");
        expect(el.style.marginTop).toBe("10px");
    });
    it("createElement with dataset sets data attributes", () => {
        const el = createElement("div", { dataset: { id: "x", role: "button" } });
        expect(el.dataset.id).toBe("x");
        expect(el.dataset.role).toBe("button");
    });
    it("createElement with attributes sets attributes", () => {
        const el = createElement("div", { attributes: { "aria-label": "test", title: "tip" } });
        expect(el.getAttribute("aria-label")).toBe("test");
        expect(el.getAttribute("title")).toBe("tip");
    });
    it("createElement with textContent sets text", () => {
        const el = createElement("span", { textContent: "hello" });
        expect(el.textContent).toBe("hello");
    });
    it("createElement with id sets id", () => {
        const el = createElement("div", { id: "my-id" });
        expect(el.id).toBe("my-id");
    });
    it("createElement with innerHTML uses textContent when no DOMSecurity", () => {
        global.GeoLeaf.DOMSecurity = null;
        const el = createElement("div", { innerHTML: "<b>safe</b>" });
        expect(el.textContent).toBe("<b>safe</b>");
        global.GeoLeaf.DOMSecurity = undefined;
    });
    it("createElement with innerHTML uses setSafeHTML when DOMSecurity present", () => {
        const setSafeHTML = vi.fn();
        global.GeoLeaf.DOMSecurity = { setSafeHTML };
        const el = createElement("div", { innerHTML: "<b>x</b>" });
        expect(setSafeHTML).toHaveBeenCalledWith(el, "<b>x</b>");
        global.GeoLeaf.DOMSecurity = null;
    });
    it("appendChild appends nodes", () => {
        const parent = document.createElement("div");
        const child = document.createElement("span");
        appendChild(parent, child);
        expect(parent.children.length).toBe(1);
        expect(parent.firstChild).toBe(child);
    });
    it("appendChild with array of children flattens", () => {
        const parent = document.createElement("div");
        const a = document.createElement("span");
        const b = document.createElement("span");
        appendChild(parent, [a, b]);
        expect(parent.children.length).toBe(2);
        expect(parent.children[0]).toBe(a);
        expect(parent.children[1]).toBe(b);
    });
    it("appendChild with string creates text node", () => {
        const parent = document.createElement("div");
        appendChild(parent, "hello");
        expect(parent.childNodes.length).toBe(1);
        expect(parent.firstChild.textContent).toBe("hello");
    });
    it("appendChild with number creates text node", () => {
        const parent = document.createElement("div");
        appendChild(parent, 42);
        expect(parent.firstChild.textContent).toBe("42");
    });
    it("appendChild skips null and false", () => {
        const parent = document.createElement("div");
        appendChild(parent, null, false, document.createElement("span"));
        expect(parent.children.length).toBe(1);
    });
    it("clearElement removes children", () => {
        const parent = document.createElement("div");
        parent.appendChild(document.createElement("span"));
        clearElement(parent);
        expect(parent.children.length).toBe(0);
    });
    it("clearElement returns same element for null/undefined", () => {
        expect(clearElement(null)).toBeNull();
        expect(clearElement(undefined)).toBeUndefined();
    });
    it("createElement with onClick adds listener when no GeoLeaf.Utils.events", () => {
        const prev = global.GeoLeaf?.Utils;
        global.GeoLeaf = { ...global.GeoLeaf, Utils: {} };
        const fn = vi.fn();
        const el = createElement("button", { onClick: fn });
        el.click();
        expect(fn).toHaveBeenCalled();
        global.GeoLeaf.Utils = prev;
    });
    it("createElement with ariaLabel sets aria-label", () => {
        const el = createElement("div", { ariaLabel: "Test label" });
        expect(el.getAttribute("aria-label")).toBe("Test label");
    });
    it("createElement with children appends after textContent/innerHTML", () => {
        const child = document.createElement("span");
        const el = createElement("div", {}, child);
        expect(el.contains(child)).toBe(true);
    });
});

describe("Coverage — general-utils (extra)", () => {
    it("validateUrl returns null for invalid", () => {
        expect(validateUrl("")).toBeNull();
        expect(validateUrl(null)).toBeNull();
    });
    it("validateUrl returns url for valid http", () => {
        expect(validateUrl("https://example.com/")).toBe("https://example.com/");
    });
    it("resolveField returns first found path", () => {
        const obj = { a: { b: 42 }, x: 1 };
        expect(resolveField(obj, "a.b", "x")).toBe(42);
        expect(resolveField(obj, "missing", "x")).toBe(1);
    });
    it("compareByOrder sorts by order", () => {
        expect(compareByOrder({ order: 1 }, { order: 2 }, 999)).toBe(-1);
        expect(compareByOrder({ order: 2 }, { order: 1 }, 999)).toBe(1);
    });
    it("fireMapEvent calls map.fire when map has fire", () => {
        const fire = vi.fn();
        const map = { fire };
        fireMapEvent(map, "test", {});
        expect(fire).toHaveBeenCalledWith("test", {});
    });
});

describe("Coverage — ErrorLogger", () => {
    it("error does not throw", () => {
        expect(() => ErrorLogger.error("TestModule", "test message")).not.toThrow();
    });
    it("error with Error object logs stack", () => {
        expect(() => ErrorLogger.error("M", "msg", new Error("e"))).not.toThrow();
    });
    it("warn does not throw", () => {
        expect(() => ErrorLogger.warn("TestModule", "warning")).not.toThrow();
    });
    it("info does not throw", () => {
        expect(() => ErrorLogger.info("TestModule", "info")).not.toThrow();
    });
    it("debug does not throw", () => {
        expect(() => ErrorLogger.debug("TestModule", "debug")).not.toThrow();
    });
    it("quotaError does not throw", () => {
        expect(() => ErrorLogger.quotaError("M", 1024, 2048)).not.toThrow();
    });
    it("networkError does not throw", () => {
        expect(() => ErrorLogger.networkError("M", "https://x.com", 404)).not.toThrow();
    });
    it("validationError does not throw", () => {
        expect(() => ErrorLogger.validationError("M", "field", "number")).not.toThrow();
    });
    it("idbError does not throw", () => {
        expect(() => ErrorLogger.idbError("M", "get")).not.toThrow();
    });
    it("performance does not throw", () => {
        expect(() => ErrorLogger.performance("M", "load", 100)).not.toThrow();
    });
    it("memoryWarning does not throw", () => {
        expect(() => ErrorLogger.memoryWarning("M", 500)).not.toThrow();
    });
    it("operation returns context with success/error/warn", () => {
        const ctx = ErrorLogger.operation("M", "op");
        expect(ctx.success).toBeDefined();
        expect(ctx.error).toBeDefined();
        expect(ctx.warn).toBeDefined();
        expect(ctx.success(42)).toBe(42);
        expect(() => ctx.error(new Error("e"))).toThrow("e");
    });
});

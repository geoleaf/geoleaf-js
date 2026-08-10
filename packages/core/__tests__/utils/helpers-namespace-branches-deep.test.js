/**
 * Deep branch coverage for src/utils/general/helpers-namespace.ts — T10.1
 * Uses await import() for Istanbul ESM instrumentation.
 *
 * Target: 0/130 branches → 80%+
 */

describe("utils/general/helpers-namespace — deep branches", () => {
    let Helpers;

    beforeAll(async () => {
        const mod = await import("../../src/utils/general/helpers-namespace.ts");
        Helpers = mod.Helpers;
    });

    // ─────────────────────────────── getElementById ──────────────────────────

    describe("getElementById", () => {
        it("returns null for null id (false branch)", () => {
            expect(Helpers.getElementById(null)).toBeNull();
        });

        it("returns null for undefined id", () => {
            expect(Helpers.getElementById(undefined)).toBeNull();
        });

        it("returns null for non-string id", () => {
            expect(Helpers.getElementById(42)).toBeNull();
        });

        it("returns null when element not found (valid string id)", () => {
            expect(Helpers.getElementById("non-existent-id-xyz")).toBeNull();
        });

        it("returns element when found", () => {
            const el = document.createElement("div");
            el.id = "test-el-id";
            document.body.appendChild(el);
            expect(Helpers.getElementById("test-el-id")).toBe(el);
            document.body.removeChild(el);
        });
    });

    // ─────────────────────────────── querySelector ───────────────────────────

    describe("querySelector", () => {
        it("returns null for empty selector", () => {
            expect(Helpers.querySelector("")).toBeNull();
        });

        it("returns null for non-string selector", () => {
            expect(Helpers.querySelector(null)).toBeNull();
        });

        it("returns null for invalid selector (catch branch)", () => {
            expect(Helpers.querySelector("[" /* invalid */)).toBeNull();
        });

        it("returns element for valid selector", () => {
            const el = document.createElement("div");
            el.className = "qs-test-class";
            document.body.appendChild(el);
            expect(Helpers.querySelector(".qs-test-class")).toBe(el);
            document.body.removeChild(el);
        });

        it("queries within a custom parent", () => {
            const parent = document.createElement("section");
            const child = document.createElement("span");
            child.className = "inner-span";
            parent.appendChild(child);
            expect(Helpers.querySelector(".inner-span", parent)).toBe(child);
        });
    });

    // ─────────────────────────────── querySelectorAll ────────────────────────

    describe("querySelectorAll", () => {
        it("returns [] for empty selector", () => {
            expect(Helpers.querySelectorAll("")).toEqual([]);
        });

        it("returns [] for invalid selector (catch branch)", () => {
            expect(Helpers.querySelectorAll("[")).toEqual([]);
        });

        it("returns array of matching elements", () => {
            const p1 = document.createElement("p");
            const p2 = document.createElement("p");
            p1.className = "qsa-target";
            p2.className = "qsa-target";
            document.body.appendChild(p1);
            document.body.appendChild(p2);
            const result = Helpers.querySelectorAll(".qsa-target");
            expect(result.length).toBeGreaterThanOrEqual(2);
            document.body.removeChild(p1);
            document.body.removeChild(p2);
        });
    });

    // ─────────────────────────────── addClass / removeClass ──────────────────

    describe("addClass / removeClass / toggleClass / hasClass", () => {
        it("addClass: no-op when element is null", () => {
            expect(() => Helpers.addClass(null, "foo")).not.toThrow();
        });

        it("addClass: adds classes to element", () => {
            const el = document.createElement("div");
            Helpers.addClass(el, "a b", "c");
            expect(el.classList.contains("a")).toBe(true);
            expect(el.classList.contains("b")).toBe(true);
            expect(el.classList.contains("c")).toBe(true);
        });

        it("removeClass: no-op when element is null", () => {
            expect(() => Helpers.removeClass(null, "foo")).not.toThrow();
        });

        it("removeClass: removes classes from element", () => {
            const el = document.createElement("div");
            el.className = "a b c";
            Helpers.removeClass(el, "a c");
            expect(el.classList.contains("a")).toBe(false);
            expect(el.classList.contains("b")).toBe(true);
        });

        it("toggleClass: returns false when element is null", () => {
            expect(Helpers.toggleClass(null, "foo")).toBe(false);
        });

        it("toggleClass: toggles class without force", () => {
            const el = document.createElement("div");
            const result = Helpers.toggleClass(el, "active");
            expect(result).toBe(true);
            expect(el.classList.contains("active")).toBe(true);
            Helpers.toggleClass(el, "active");
            expect(el.classList.contains("active")).toBe(false);
        });

        it("toggleClass: forces class on with true", () => {
            const el = document.createElement("div");
            Helpers.toggleClass(el, "forced", true);
            expect(el.classList.contains("forced")).toBe(true);
        });

        it("hasClass: returns false when element is null", () => {
            expect(Helpers.hasClass(null, "foo")).toBe(false);
        });

        it("hasClass: returns true when class present", () => {
            const el = document.createElement("div");
            el.className = "present";
            expect(Helpers.hasClass(el, "present")).toBe(true);
            expect(Helpers.hasClass(el, "absent")).toBe(false);
        });
    });

    // ─────────────────────────────── removeElement ───────────────────────────

    describe("removeElement", () => {
        it("no-op for null (optional chain false branch)", () => {
            expect(() => Helpers.removeElement(null)).not.toThrow();
        });

        it("removes element with parentNode (true branch)", () => {
            const parent = document.createElement("div");
            const child = document.createElement("span");
            parent.appendChild(child);
            Helpers.removeElement(child);
            expect(parent.children).toHaveLength(0);
        });

        it("no-op when element has no parent", () => {
            const el = document.createElement("div");
            expect(() => Helpers.removeElement(el)).not.toThrow();
        });
    });

    // ─────────────────────────────── requestFrame / cancelFrame ──────────────

    describe("requestFrame / cancelFrame", () => {
        it("requestFrame uses requestAnimationFrame in jsdom", () => {
            const cb = vi.fn();
            const id = Helpers.requestFrame(cb);
            // Returns a number (jsdom) or an object (happy-dom) — just check it's defined
            expect(id).toBeDefined();
        });

        it("cancelFrame cancels animation frame", () => {
            const cb = vi.fn();
            const id = Helpers.requestFrame(cb);
            expect(() => Helpers.cancelFrame(id)).not.toThrow();
        });
    });

    // ─────────────────────────────── createAbortController ───────────────────

    describe("createAbortController", () => {
        it("creates controller without timeout (false branch)", () => {
            const ctrl = Helpers.createAbortController();
            expect(ctrl).toBeInstanceOf(AbortController);
            expect(ctrl.signal.aborted).toBe(false);
        });

        it("creates controller with timeout (true branch), aborts after delay", async () => {
            vi.useFakeTimers();
            const ctrl = Helpers.createAbortController(100);
            expect(ctrl.signal.aborted).toBe(false);
            vi.advanceTimersByTime(100);
            expect(ctrl.signal.aborted).toBe(true);
            vi.useRealTimers();
        });
    });

    // ─────────────────────────────── lazyLoadImage ───────────────────────────

    describe("lazyLoadImage", () => {
        it("falls back when IntersectionObserver is unavailable — data-src set", () => {
            const origIO = global.IntersectionObserver;
            delete global.IntersectionObserver;

            const img = document.createElement("img");
            img.dataset.src = "test.jpg";
            Helpers.lazyLoadImage(img);
            expect(img.src).toContain("test.jpg");

            global.IntersectionObserver = origIO;
        });

        it("falls back without src — no-op (src falsy branch)", () => {
            const origIO = global.IntersectionObserver;
            delete global.IntersectionObserver;

            const img = document.createElement("img");
            Helpers.lazyLoadImage(img); // no data-src
            expect(img.src).toBe("");

            global.IntersectionObserver = origIO;
        });

        it("uses IntersectionObserver when available", () => {
            const observeSpy = vi.fn();
            global.IntersectionObserver = class {
                constructor(cb) {
                    this.cb = cb;
                }
                observe = observeSpy;
                unobserve = vi.fn();
            };

            const img = document.createElement("img");
            img.dataset.src = "lazy.jpg";
            Helpers.lazyLoadImage(img);
            expect(observeSpy).toHaveBeenCalledWith(img);

            delete global.IntersectionObserver;
        });
    });

    // ─────────────────────────────── lazyExecute ─────────────────────────────

    describe("lazyExecute", () => {
        it("uses requestIdleCallback when available (true branch)", () => {
            const cb = vi.fn();
            const ricSpy = vi.fn((fn) => fn());
            Object.defineProperty(window, "requestIdleCallback", {
                value: ricSpy,
                writable: true,
                configurable: true,
            });

            Helpers.lazyExecute(cb, 200);
            expect(cb).toHaveBeenCalled();

            // Restore to undefined (but keep the property present to avoid breaking other tests)
            Object.defineProperty(window, "requestIdleCallback", {
                value: undefined,
                writable: true,
                configurable: true,
            });
        });

        it("falls back to setTimeout when requestIdleCallback is not a function (else branch)", () => {
            vi.useFakeTimers();
            const cb = vi.fn();
            // Ensure rIC is not present by temporarily stubbing check via spy on window
            // Since we can't easily remove a jsdom property, we verify the setTimeout path
            // by calling the helper after deleting the property if possible
            const origDescriptor = Object.getOwnPropertyDescriptor(window, "requestIdleCallback");
            Object.defineProperty(window, "requestIdleCallback", {
                value: undefined,
                writable: true,
                configurable: true,
            });

            // Only test if "requestIdleCallback" is NOT in window now (property = undefined means present but falsy)
            // jsdom keeps the property key: we skip this test if can't delete
            if (!("requestIdleCallback" in window) || window.requestIdleCallback === undefined) {
                // Delete to make `in` check false
                try {
                    delete window.requestIdleCallback;
                } catch {
                    // Cannot delete — skip cleanly
                    vi.useRealTimers();
                    if (origDescriptor) {
                        Object.defineProperty(window, "requestIdleCallback", origDescriptor);
                    }
                    return;
                }
                Helpers.lazyExecute(cb, 50);
                vi.advanceTimersByTime(50);
                expect(cb).toHaveBeenCalled();
            }

            if (origDescriptor) {
                Object.defineProperty(window, "requestIdleCallback", origDescriptor);
            }
            vi.useRealTimers();
        });
    });

    // ─────────────────────────────── clearObject ─────────────────────────────

    describe("clearObject", () => {
        it("no-op for null (false branch)", () => {
            expect(() => Helpers.clearObject(null)).not.toThrow();
        });

        it("no-op for non-object (false branch)", () => {
            expect(() => Helpers.clearObject("string")).not.toThrow();
        });

        it("deletes all keys from object", () => {
            const obj = { a: 1, b: 2 };
            Helpers.clearObject(obj);
            expect(Object.keys(obj)).toHaveLength(0);
        });
    });

    // ─────────────────────────────── createFragment ──────────────────────────

    describe("createFragment", () => {
        it("creates empty fragment from no args", () => {
            const frag = Helpers.createFragment();
            expect(frag).toBeInstanceOf(DocumentFragment);
            expect(frag.childNodes).toHaveLength(0);
        });

        it("appends HTMLElement children (true branch)", () => {
            const el1 = document.createElement("div");
            const el2 = document.createElement("span");
            const frag = Helpers.createFragment([el1, el2]);
            expect(frag.childNodes).toHaveLength(2);
        });
    });

    // ─────────────────────────────── addEventListener ────────────────────────

    describe("addEventListener (Helpers)", () => {
        it("returns no-op when element is null (false branch)", () => {
            const cleanup = Helpers.addEventListener(null, "click", vi.fn());
            expect(typeof cleanup).toBe("function");
            expect(() => cleanup()).not.toThrow();
        });

        it("returns no-op when event is empty string", () => {
            const el = document.createElement("div");
            const cleanup = Helpers.addEventListener(el, "", vi.fn());
            expect(() => cleanup()).not.toThrow();
        });

        it("returns no-op when handler is null", () => {
            const el = document.createElement("div");
            const cleanup = Helpers.addEventListener(el, "click", null);
            expect(() => cleanup()).not.toThrow();
        });

        it("attaches and returns removal function (true branch)", () => {
            const el = document.createElement("button");
            const handler = vi.fn();
            const cleanup = Helpers.addEventListener(el, "click", handler);

            el.click();
            expect(handler).toHaveBeenCalledTimes(1);

            cleanup();
            el.click();
            expect(handler).toHaveBeenCalledTimes(1); // not called again
        });
    });

    // ─────────────────────────────── addEventListeners ───────────────────────

    describe("addEventListeners", () => {
        it("returns no-op when element is null", () => {
            const cleanup = Helpers.addEventListeners(null, { click: vi.fn() });
            expect(() => cleanup()).not.toThrow();
        });

        it("returns no-op when events is null", () => {
            const el = document.createElement("div");
            const cleanup = Helpers.addEventListeners(el, null);
            expect(() => cleanup()).not.toThrow();
        });

        it("attaches multiple listeners and cleanup removes them all", () => {
            const el = document.createElement("div");
            const clickSpy = vi.fn();
            const focusSpy = vi.fn();
            const cleanup = Helpers.addEventListeners(el, { click: clickSpy, focus: focusSpy });

            el.dispatchEvent(new MouseEvent("click"));
            el.dispatchEvent(new FocusEvent("focus"));
            expect(clickSpy).toHaveBeenCalledTimes(1);
            expect(focusSpy).toHaveBeenCalledTimes(1);

            cleanup();
            el.dispatchEvent(new MouseEvent("click"));
            expect(clickSpy).toHaveBeenCalledTimes(1); // not called again
        });
    });

    // ─────────────────────────────── delegateEvent ───────────────────────────

    describe("delegateEvent", () => {
        it("invokes handler when target matches selector (true branch)", () => {
            const parent = document.createElement("ul");
            document.body.appendChild(parent);
            const li = document.createElement("li");
            li.className = "item";
            parent.appendChild(li);

            const handler = vi.fn();
            const cleanup = Helpers.delegateEvent(parent, "click", "li.item", handler);

            li.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(handler).toHaveBeenCalledTimes(1);

            cleanup();
            document.body.removeChild(parent);
        });

        it("does not invoke handler when target does not match selector (false branch)", () => {
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            const span = document.createElement("span");
            parent.appendChild(span);

            const handler = vi.fn();
            const cleanup = Helpers.delegateEvent(parent, "click", "li.item", handler);

            span.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(handler).not.toHaveBeenCalled();

            cleanup();
            document.body.removeChild(parent);
        });
    });

    // ─────────────────────────────── deepClone ───────────────────────────────

    describe("deepClone", () => {
        it("returns null unchanged (null branch)", () => {
            expect(Helpers.deepClone(null)).toBeNull();
        });

        it("returns primitives unchanged", () => {
            expect(Helpers.deepClone(42)).toBe(42);
            expect(Helpers.deepClone("str")).toBe("str");
            expect(Helpers.deepClone(true)).toBe(true);
        });

        it("handles Date (Date branch)", () => {
            const d = new Date(2025, 0, 1);
            const cloned = Helpers.deepClone(d);
            expect(cloned).toBeInstanceOf(Date);
            expect(cloned.getTime()).toBe(d.getTime());
            expect(cloned).not.toBe(d);
        });

        it("handles RegExp (RegExp branch)", () => {
            const re = /abc/gi;
            const cloned = Helpers.deepClone(re);
            expect(cloned).toBeInstanceOf(RegExp);
            expect(cloned.source).toBe("abc");
            expect(cloned.flags).toContain("g");
            expect(cloned).not.toBe(re);
        });

        it("handles Array (Array branch)", () => {
            const arr = [1, 2, { x: 3 }];
            const cloned = Helpers.deepClone(arr);
            expect(cloned).toEqual(arr);
            expect(cloned).not.toBe(arr);
            expect(cloned[2]).not.toBe(arr[2]);
        });

        it("handles plain object recursively (object branch)", () => {
            const obj = { a: 1, b: { c: 2 } };
            const cloned = Helpers.deepClone(obj);
            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
            expect(cloned.b).not.toBe(obj.b);
        });

        it("handles circular references (seen branch)", () => {
            const obj = { name: "circular" };
            obj.self = obj;
            const cloned = Helpers.deepClone(obj);
            expect(cloned.name).toBe("circular");
            expect(cloned.self).toBe(cloned); // circular preserved
        });
    });

    // ─────────────────────────────── isEmpty ─────────────────────────────────

    describe("isEmpty", () => {
        it("returns true for null (null branch)", () => {
            expect(Helpers.isEmpty(null)).toBe(true);
        });

        it("returns true for undefined (== null branch)", () => {
            expect(Helpers.isEmpty(undefined)).toBe(true);
        });

        it("returns true for empty string", () => {
            expect(Helpers.isEmpty("")).toBe(true);
        });

        it("returns true for whitespace-only string", () => {
            expect(Helpers.isEmpty("   ")).toBe(true);
        });

        it("returns false for non-empty string", () => {
            expect(Helpers.isEmpty("hello")).toBe(false);
        });

        it("returns true for empty array", () => {
            expect(Helpers.isEmpty([])).toBe(true);
        });

        it("returns false for non-empty array", () => {
            expect(Helpers.isEmpty([1])).toBe(false);
        });

        it("returns true for empty object", () => {
            expect(Helpers.isEmpty({})).toBe(true);
        });

        it("returns false for non-empty object (object branch, then else)", () => {
            expect(Helpers.isEmpty({ a: 1 })).toBe(false);
        });

        it("returns false for number (else branch)", () => {
            expect(Helpers.isEmpty(42)).toBe(false);
        });

        it("returns false for boolean false", () => {
            expect(Helpers.isEmpty(false)).toBe(false);
        });
    });

    // ─────────────────────────────── wait ────────────────────────────────────

    describe("wait", () => {
        it("resolves after given ms", async () => {
            vi.useFakeTimers();
            const p = Helpers.wait(100);
            vi.advanceTimersByTime(100);
            await p;
            vi.useRealTimers();
        });
    });

    // ─────────────────────────────── retryWithBackoff ─────────────────────────

    describe("retryWithBackoff", () => {
        it("returns result immediately on first success", async () => {
            const fn = vi.fn().mockResolvedValue("ok");
            const result = await Helpers.retryWithBackoff(fn, 3, 0);
            expect(result).toBe("ok");
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("retries on failure and succeeds on third attempt", async () => {
            let calls = 0;
            const fn = vi.fn().mockImplementation(() => {
                calls++;
                if (calls < 3) return Promise.reject(new Error("fail"));
                return Promise.resolve("success");
            });
            const result = await Helpers.retryWithBackoff(fn, 3, 0);
            expect(result).toBe("success");
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it("throws lastError after all retries exhausted", async () => {
            const fn = vi.fn().mockRejectedValue(new Error("always fails"));
            await expect(Helpers.retryWithBackoff(fn, 2, 0)).rejects.toThrow("always fails");
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("skips backoff wait on last retry attempt (i < maxRetries-1 false branch)", async () => {
            vi.useFakeTimers();
            let calls = 0;
            const fn = vi.fn().mockImplementation(() => {
                calls++;
                if (calls < 2) return Promise.reject(new Error("fail once"));
                return Promise.resolve("done");
            });

            const p = Helpers.retryWithBackoff(fn, 2, 100);
            // First call fails; second call fires with 0 backoff since i=1 is NOT < maxRetries-1=1
            await vi.runAllTimersAsync();
            const result = await p;
            expect(result).toBe("done");
            vi.useRealTimers();
        });
    });
});

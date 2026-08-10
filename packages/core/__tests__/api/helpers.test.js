/**
 */

import { Helpers } from "../../src/api/geoleaf.helpers.js";

// Sprint 1: ensure global.GeoLeaf.Helpers is set so tests can use GeoLeaf.Helpers.
// COUVERTURE S2: the façade is imported directly and a failure to resolve it now throws.
// The former `else` branch re-required `utils/general/helpers.ts` when `Helpers` was
// missing — the same fallback that `helpers/index.test.js` documents having removed,
// because it let a broken import run the whole suite green against a substitute object.
beforeAll(() => {
    global.GeoLeaf = global.GeoLeaf || {};
    global.GeoLeaf.Helpers = Helpers;
});

describe("GeoLeaf.Helpers Module", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    // ========================================================================
    // DOM HELPERS
    // ========================================================================

    describe("DOM Helpers", () => {
        describe("getElementById", () => {
            it("should find element by ID", () => {
                document.body.innerHTML = '<div id="test-id">Content</div>';
                const element = GeoLeaf.Helpers.getElementById("test-id");
                expect(element).toBeTruthy();
                expect(element.id).toBe("test-id");
            });

            it("should return null for non-existent ID", () => {
                const element = GeoLeaf.Helpers.getElementById("non-existent");
                expect(element).toBeNull();
            });
        });

        describe("querySelector", () => {
            it("should find element by selector", () => {
                document.body.innerHTML = '<div class="test-class">Content</div>';
                const element = GeoLeaf.Helpers.querySelector(".test-class");
                expect(element).toBeTruthy();
                expect(element.className).toBe("test-class");
            });

            it("should return null for non-existent selector", () => {
                const element = GeoLeaf.Helpers.querySelector(".non-existent");
                expect(element).toBeNull();
            });

            it("should use context if provided", () => {
                document.body.innerHTML = `
                    <div id="parent">
                        <span class="child">Child 1</span>
                    </div>
                    <span class="child">Child 2</span>
                `;
                const parent = document.getElementById("parent");
                const element = GeoLeaf.Helpers.querySelector(".child", parent);
                expect(element.textContent).toBe("Child 1");
            });
        });

        describe("Class Manipulation", () => {
            let element;

            beforeEach(() => {
                element = document.createElement("div");
            });

            describe("addClass", () => {
                it("should add single class", () => {
                    GeoLeaf.Helpers.addClass(element, "test-class");
                    expect(element.classList.contains("test-class")).toBe(true);
                });

                it("should add multiple classes", () => {
                    GeoLeaf.Helpers.addClass(element, "class1 class2 class3");
                    expect(element.classList.contains("class1")).toBe(true);
                    expect(element.classList.contains("class2")).toBe(true);
                    expect(element.classList.contains("class3")).toBe(true);
                });

                it("should not duplicate existing classes", () => {
                    element.className = "existing";
                    GeoLeaf.Helpers.addClass(element, "existing");
                    expect(element.className).toBe("existing");
                });
            });

            describe("removeClass", () => {
                it("should remove single class", () => {
                    element.className = "class1 class2";
                    GeoLeaf.Helpers.removeClass(element, "class1");
                    expect(element.classList.contains("class1")).toBe(false);
                    expect(element.classList.contains("class2")).toBe(true);
                });

                it("should remove multiple classes", () => {
                    element.className = "class1 class2 class3";
                    GeoLeaf.Helpers.removeClass(element, "class1 class3");
                    expect(element.classList.contains("class1")).toBe(false);
                    expect(element.classList.contains("class2")).toBe(true);
                    expect(element.classList.contains("class3")).toBe(false);
                });
            });

            describe("toggleClass", () => {
                it("should toggle class on/off", () => {
                    GeoLeaf.Helpers.toggleClass(element, "active");
                    expect(element.classList.contains("active")).toBe(true);

                    GeoLeaf.Helpers.toggleClass(element, "active");
                    expect(element.classList.contains("active")).toBe(false);
                });

                it("should force add class", () => {
                    GeoLeaf.Helpers.toggleClass(element, "active", true);
                    expect(element.classList.contains("active")).toBe(true);

                    GeoLeaf.Helpers.toggleClass(element, "active", true);
                    expect(element.classList.contains("active")).toBe(true);
                });

                it("should force remove class", () => {
                    element.className = "active";
                    GeoLeaf.Helpers.toggleClass(element, "active", false);
                    expect(element.classList.contains("active")).toBe(false);

                    GeoLeaf.Helpers.toggleClass(element, "active", false);
                    expect(element.classList.contains("active")).toBe(false);
                });
            });

            describe("hasClass", () => {
                it("should return true for existing class", () => {
                    element.className = "test-class";
                    expect(GeoLeaf.Helpers.hasClass(element, "test-class")).toBe(true);
                });

                it("should return false for non-existing class", () => {
                    expect(GeoLeaf.Helpers.hasClass(element, "non-existent")).toBe(false);
                });
            });
        });

        describe("removeElement", () => {
            it("should remove element from DOM", () => {
                document.body.innerHTML = '<div id="test">Content</div>';
                const element = document.getElementById("test");

                GeoLeaf.Helpers.removeElement(element);
                expect(document.getElementById("test")).toBeNull();
            });

            it("should handle null element gracefully", () => {
                expect(() => GeoLeaf.Helpers.removeElement(null)).not.toThrow();
            });
        });
    });

    // ========================================================================
    // PERFORMANCE HELPERS
    // ========================================================================

    describe("Performance Helpers", () => {
        describe("requestFrame / cancelFrame", () => {
            it("should wrap requestAnimationFrame", () => {
                const mockFn = vi.fn();
                const spy = vi.spyOn(window, "requestAnimationFrame");

                const id = GeoLeaf.Helpers.requestFrame(mockFn);
                expect(spy).toHaveBeenCalledWith(mockFn);
                expect(typeof id).toBe("number");

                spy.mockRestore();
            });

            it("should wrap cancelAnimationFrame", () => {
                const spy = vi.spyOn(window, "cancelAnimationFrame");

                GeoLeaf.Helpers.cancelFrame(123);
                expect(spy).toHaveBeenCalledWith(123);

                spy.mockRestore();
            });
        });
    });

    // ========================================================================
    // ABORTCONTROLLER UTILITIES
    // ========================================================================

    describe("AbortController Utilities", () => {
        describe("createAbortController", () => {
            it("should create AbortController without timeout", () => {
                const controller = GeoLeaf.Helpers.createAbortController();
                expect(controller).toBeInstanceOf(AbortController);
                expect(controller.signal.aborted).toBe(false);
            });

            it("should create AbortController with timeout", () => {
                const controller = GeoLeaf.Helpers.createAbortController(1000);
                expect(controller).toBeInstanceOf(AbortController);
                expect(controller.signal.aborted).toBe(false);

                vi.advanceTimersByTime(1000);
                expect(controller.signal.aborted).toBe(true);
            });
        });
    });

    // ========================================================================
    // LAZY LOADING
    // ========================================================================

    describe("Lazy Loading", () => {
        describe("lazyLoadImage", () => {
            it("should set image src immediately if IntersectionObserver not available", () => {
                const originalIO = window.IntersectionObserver;
                delete window.IntersectionObserver;

                const img = document.createElement("img");
                img.dataset.src = "https://example.com/image.jpg";

                GeoLeaf.Helpers.lazyLoadImage(img);

                expect(img.src).toBe("https://example.com/image.jpg");

                window.IntersectionObserver = originalIO;
            });

            it("should use IntersectionObserver when available", () => {
                const mockObserve = vi.fn();
                const mockUnobserve = vi.fn();

                // Vitest 4: `new IntersectionObserver(cb)` needs a constructable mock.
                window.IntersectionObserver = vi.fn(
                    class {
                        constructor() {
                            return {
                                observe: mockObserve,
                                unobserve: mockUnobserve,
                                disconnect: vi.fn(),
                            };
                        }
                    }
                );

                const img = document.createElement("img");
                img.dataset.src = "https://example.com/image.jpg";

                GeoLeaf.Helpers.lazyLoadImage(img);

                expect(mockObserve).toHaveBeenCalledWith(img);
            });
        });

        describe("lazyExecute", () => {
            it("should execute callback after delay", () => {
                const mockFn = vi.fn();

                GeoLeaf.Helpers.lazyExecute(mockFn, 1000);
                expect(mockFn).not.toHaveBeenCalled();

                vi.advanceTimersByTime(1000);
                expect(mockFn).toHaveBeenCalledTimes(1);
            });

            it("should use default delay", () => {
                const mockFn = vi.fn();

                GeoLeaf.Helpers.lazyExecute(mockFn);

                vi.advanceTimersByTime(100);
                expect(mockFn).toHaveBeenCalledTimes(1);
            });
        });
    });

    // ========================================================================
    // MEMORY OPTIMIZATION
    // ========================================================================

    describe("Memory Optimization", () => {
        describe("clearObject", () => {
            it("should delete all properties", () => {
                const obj = { a: 1, b: 2, c: 3 };
                GeoLeaf.Helpers.clearObject(obj);
                expect(Object.keys(obj).length).toBe(0);
            });

            it("should handle empty object", () => {
                const obj = {};
                expect(() => GeoLeaf.Helpers.clearObject(obj)).not.toThrow();
            });

            it("should not throw on null/undefined", () => {
                expect(() => GeoLeaf.Helpers.clearObject(null)).not.toThrow();
                expect(() => GeoLeaf.Helpers.clearObject(undefined)).not.toThrow();
            });
        });

        describe("createFragment", () => {
            it("should create DocumentFragment", () => {
                const fragment = GeoLeaf.Helpers.createFragment();
                expect(fragment).toBeInstanceOf(DocumentFragment);
            });

            it("should append children to fragment", () => {
                const children = [
                    document.createElement("div"),
                    document.createElement("span"),
                    document.createElement("p"),
                ];

                const fragment = GeoLeaf.Helpers.createFragment(children);
                expect(fragment.children.length).toBe(3);
            });
        });
    });

    // ========================================================================
    // EVENT HELPERS
    // ========================================================================

    describe("Event Helpers", () => {
        describe("addEventListener", () => {
            it("should add event listener and return cleanup function", () => {
                const element = document.createElement("button");
                const handler = vi.fn();

                const cleanup = GeoLeaf.Helpers.addEventListener(element, "click", handler);

                element.click();
                expect(handler).toHaveBeenCalledTimes(1);

                cleanup();
                element.click();
                expect(handler).toHaveBeenCalledTimes(1); // Not called again
            });

            it("should support event options", () => {
                const element = document.createElement("button");
                const handler = vi.fn();

                GeoLeaf.Helpers.addEventListener(element, "click", handler, { once: true });

                element.click();
                element.click();
                expect(handler).toHaveBeenCalledTimes(1); // Only once
            });
        });

        describe("addEventListeners", () => {
            it("should add multiple event listeners", () => {
                const element = document.createElement("button");
                const clickHandler = vi.fn();
                const mouseoverHandler = vi.fn();

                const cleanup = GeoLeaf.Helpers.addEventListeners(element, {
                    click: clickHandler,
                    mouseover: mouseoverHandler,
                });

                element.click();
                element.dispatchEvent(new Event("mouseover"));

                expect(clickHandler).toHaveBeenCalledTimes(1);
                expect(mouseoverHandler).toHaveBeenCalledTimes(1);

                cleanup();
                element.click();
                expect(clickHandler).toHaveBeenCalledTimes(1); // Not called again
            });
        });

        describe("delegateEvent", () => {
            it("should delegate events to matching children", () => {
                document.body.innerHTML = `
                    <div id="parent">
                        <button class="target">Button 1</button>
                        <button class="target">Button 2</button>
                        <span>Not a target</span>
                    </div>
                `;

                const handler = vi.fn();
                const parent = document.getElementById("parent");
                const cleanup = GeoLeaf.Helpers.delegateEvent(parent, "click", ".target", handler);

                const button1 = parent.querySelector(".target");
                button1.click();
                expect(handler).toHaveBeenCalledTimes(1);

                const span = parent.querySelector("span");
                span.click();
                expect(handler).toHaveBeenCalledTimes(1); // Still 1, span didn't match

                cleanup();
                button1.click();
                expect(handler).toHaveBeenCalledTimes(1); // Not called after cleanup
            });
        });
    });

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================

    describe("Utility Functions", () => {
        describe("deepClone", () => {
            it("should clone primitives", () => {
                expect(GeoLeaf.Helpers.deepClone(42)).toBe(42);
                expect(GeoLeaf.Helpers.deepClone("string")).toBe("string");
                expect(GeoLeaf.Helpers.deepClone(true)).toBe(true);
                expect(GeoLeaf.Helpers.deepClone(null)).toBe(null);
            });

            it("should clone arrays", () => {
                const arr = [1, 2, [3, 4]];
                const cloned = GeoLeaf.Helpers.deepClone(arr);

                expect(cloned).toEqual(arr);
                expect(cloned).not.toBe(arr);
                expect(cloned[2]).not.toBe(arr[2]);
            });

            it("should clone objects", () => {
                const obj = { a: 1, b: { c: 2 } };
                const cloned = GeoLeaf.Helpers.deepClone(obj);

                expect(cloned).toEqual(obj);
                expect(cloned).not.toBe(obj);
                expect(cloned.b).not.toBe(obj.b);
            });

            it("should handle circular references", () => {
                const obj = { a: 1 };
                obj.self = obj;

                const cloned = GeoLeaf.Helpers.deepClone(obj);
                expect(cloned.a).toBe(1);
                expect(cloned.self).toBe(cloned);
            });

            it("should clone Date objects", () => {
                const date = new Date("2024-01-01");
                const cloned = GeoLeaf.Helpers.deepClone(date);

                expect(cloned).toEqual(date);
                expect(cloned).not.toBe(date);
            });

            it("should clone RegExp objects", () => {
                const regex = /test/gi;
                const cloned = GeoLeaf.Helpers.deepClone(regex);

                expect(cloned.source).toBe(regex.source);
                expect(cloned.flags).toBe(regex.flags);
                expect(cloned).not.toBe(regex);
            });
        });

        describe("isEmpty", () => {
            it("should return true for empty values", () => {
                expect(GeoLeaf.Helpers.isEmpty(null)).toBe(true);
                expect(GeoLeaf.Helpers.isEmpty(undefined)).toBe(true);
                expect(GeoLeaf.Helpers.isEmpty("")).toBe(true);
                expect(GeoLeaf.Helpers.isEmpty([])).toBe(true);
                expect(GeoLeaf.Helpers.isEmpty({})).toBe(true);
            });

            it("should return false for non-empty values", () => {
                expect(GeoLeaf.Helpers.isEmpty("string")).toBe(false);
                expect(GeoLeaf.Helpers.isEmpty([1])).toBe(false);
                expect(GeoLeaf.Helpers.isEmpty({ a: 1 })).toBe(false);
                expect(GeoLeaf.Helpers.isEmpty(0)).toBe(false);
                expect(GeoLeaf.Helpers.isEmpty(false)).toBe(false);
            });
        });

        describe("wait", () => {
            it("should wait specified milliseconds", async () => {
                const promise = GeoLeaf.Helpers.wait(100);

                vi.advanceTimersByTime(100);
                await promise;

                // With fake timers, we just check promise resolved
                await expect(promise).resolves.toBeUndefined();
            });
        });

        describe("retryWithBackoff", () => {
            it("should succeed on first try", async () => {
                const fn = vi.fn().mockResolvedValue("success");

                vi.useRealTimers(); // Need real timers for async
                const result = await GeoLeaf.Helpers.retryWithBackoff(fn, 3, 100);

                expect(result).toBe("success");
                expect(fn).toHaveBeenCalledTimes(1);
                vi.useFakeTimers();
            });

            it("should retry on failure", async () => {
                const fn = vi
                    .fn()
                    .mockRejectedValueOnce(new Error("Fail 1"))
                    .mockRejectedValueOnce(new Error("Fail 2"))
                    .mockResolvedValue("success");

                vi.useRealTimers();
                const result = await GeoLeaf.Helpers.retryWithBackoff(fn, 3, 10);

                expect(result).toBe("success");
                expect(fn).toHaveBeenCalledTimes(3);
                vi.useFakeTimers();
            });

            it("should throw after max retries", async () => {
                const fn = vi.fn().mockRejectedValue(new Error("Always fails"));

                vi.useRealTimers();
                await expect(GeoLeaf.Helpers.retryWithBackoff(fn, 3, 10)).rejects.toThrow(
                    "Always fails"
                );

                expect(fn).toHaveBeenCalledTimes(3);
                vi.useFakeTimers();
            });
        });
    });
});

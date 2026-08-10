/**
 * Tests for src/api/geoleaf.helpers.ts (ESM)
 * DOM utilities, performance optimization, and async helpers
 * Sprint 1: import from modules directly to avoid src/helpers/index.ts resolution chain in Jest
 *
 * ⚠️ Nommé `-extended` au STRUCT S7 : arrivé de `__tests__/helpers/index.test.js`, il
 * entrait en collision avec `api/index.test.js` (SUT `kernel/api/index.ts`). Le nom nu
 * revient à `api/helpers.test.js`, dont le basename porte déjà le nom du SUT ; celui-ci
 * est la suite la plus large des deux sur le même module, d'où `-extended` — l'idiome
 * que le dossier emploie déjà (`api/api.test.js` / `api/api-extended.test.js`).
 */

// KERNEL S11 — this file used to be self-fulfilling, by two separate mechanisms:
//   1. It imported `debounce`/`throttle` from `general-utils` and DEFINED local
//      `fetchWithTimeout`/`batchDomOperations`, then spread all four into the object under
//      test — so `expect(Helpers.debounce).toBe(debounce)` asserted nothing. None of the four
//      has ever existed on the runtime façade; they were undeclared at S11.
//   2. A cascading try/catch fell back to `HelpersFromModule = {}`, so a broken import made
//      the whole suite run green against an object built entirely by the test.
// Both are gone: the façade is imported directly, and a failure to resolve it now throws.
import { Helpers } from "../../src/api/geoleaf.helpers.js";

const {
    getElementById,
    querySelector,
    querySelectorAll,
    addClass,
    removeClass,
    toggleClass,
    hasClass,
    removeElement,
    requestFrame,
    cancelFrame,
    createAbortController,
    lazyLoadImage,
    lazyExecute,
    clearObject,
    createFragment,
    addEventListener,
    addEventListeners,
    delegateEvent,
    deepClone,
    isEmpty,
    wait,
    retryWithBackoff,
} = Helpers;

/**
 * ========================================
 * DOM HELPERS TESTS
 * ========================================
 */

describe("Helpers - DOM Utilities", () => {
    describe("getElementById", () => {
        it("should return element by ID", () => {
            const div = document.createElement("div");
            div.id = "test-id";
            document.body.appendChild(div);

            const result = getElementById("test-id");
            expect(result).toBe(div);

            document.body.removeChild(div);
        });

        it("should return null for non-existent ID", () => {
            expect(getElementById("non-existent")).toBeNull();
        });

        it("should return null for invalid input", () => {
            expect(getElementById(null)).toBeNull();
            expect(getElementById("")).toBeNull();
            expect(getElementById(123)).toBeNull();
        });
    });

    describe("querySelector", () => {
        it("should return first matching element", () => {
            const div = document.createElement("div");
            div.className = "test-class";
            document.body.appendChild(div);

            const result = querySelector(".test-class");
            expect(result).toBe(div);

            document.body.removeChild(div);
        });

        it("should return null for non-existent selector", () => {
            expect(querySelector(".non-existent")).toBeNull();
        });

        it("should support parent context", () => {
            const parent = document.createElement("div");
            const child = document.createElement("span");
            child.className = "child";
            parent.appendChild(child);
            document.body.appendChild(parent);

            const result = querySelector(".child", parent);
            expect(result).toBe(child);

            document.body.removeChild(parent);
        });

        it("should return null for invalid selector", () => {
            expect(querySelector(null)).toBeNull();
            expect(querySelector("")).toBeNull();
        });
    });

    describe("querySelectorAll", () => {
        it("should return all matching elements as array", () => {
            const div1 = document.createElement("div");
            const div2 = document.createElement("div");
            div1.className = "test";
            div2.className = "test";
            document.body.appendChild(div1);
            document.body.appendChild(div2);

            const result = querySelectorAll(".test");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);

            document.body.removeChild(div1);
            document.body.removeChild(div2);
        });

        it("should return empty array for non-existent selector", () => {
            const result = querySelectorAll(".non-existent");
            expect(result).toEqual([]);
        });

        it("should return empty array for invalid selector", () => {
            expect(querySelectorAll(null)).toEqual([]);
            expect(querySelectorAll("")).toEqual([]);
        });
    });

    describe("addClass", () => {
        it("should add single class", () => {
            const div = document.createElement("div");
            addClass(div, "test");
            expect(div.classList.contains("test")).toBe(true);
        });

        it("should add multiple classes", () => {
            const div = document.createElement("div");
            addClass(div, "class1", "class2");
            expect(div.classList.contains("class1")).toBe(true);
            expect(div.classList.contains("class2")).toBe(true);
        });

        it("should handle space-separated classes", () => {
            const div = document.createElement("div");
            addClass(div, "class1 class2");
            expect(div.classList.contains("class1")).toBe(true);
            expect(div.classList.contains("class2")).toBe(true);
        });

        it("should handle null element", () => {
            expect(() => addClass(null, "test")).not.toThrow();
        });
    });

    describe("removeClass", () => {
        it("should remove single class", () => {
            const div = document.createElement("div");
            div.className = "test";
            removeClass(div, "test");
            expect(div.classList.contains("test")).toBe(false);
        });

        it("should remove multiple classes", () => {
            const div = document.createElement("div");
            div.className = "class1 class2";
            removeClass(div, "class1", "class2");
            expect(div.classList.contains("class1")).toBe(false);
            expect(div.classList.contains("class2")).toBe(false);
        });

        it("should handle null element", () => {
            expect(() => removeClass(null, "test")).not.toThrow();
        });
    });

    describe("toggleClass", () => {
        it("should toggle class", () => {
            const div = document.createElement("div");
            toggleClass(div, "test");
            expect(div.classList.contains("test")).toBe(true);
            toggleClass(div, "test");
            expect(div.classList.contains("test")).toBe(false);
        });

        it("should force add class", () => {
            const div = document.createElement("div");
            toggleClass(div, "test", true);
            expect(div.classList.contains("test")).toBe(true);
            toggleClass(div, "test", true);
            expect(div.classList.contains("test")).toBe(true);
        });

        it("should force remove class", () => {
            const div = document.createElement("div");
            div.className = "test";
            toggleClass(div, "test", false);
            expect(div.classList.contains("test")).toBe(false);
        });
    });

    describe("hasClass", () => {
        it("should return true if element has class", () => {
            const div = document.createElement("div");
            div.className = "test";
            expect(hasClass(div, "test")).toBe(true);
        });

        it("should return false if element does not have class", () => {
            const div = document.createElement("div");
            expect(hasClass(div, "test")).toBe(false);
        });

        it("should handle null element", () => {
            expect(hasClass(null, "test")).toBe(false);
        });
    });

    describe("removeElement", () => {
        it("should remove element from DOM", () => {
            const div = document.createElement("div");
            document.body.appendChild(div);
            expect(document.body.contains(div)).toBe(true);

            removeElement(div);
            expect(document.body.contains(div)).toBe(false);
        });

        it("should handle element without parent", () => {
            const div = document.createElement("div");
            expect(() => removeElement(div)).not.toThrow();
        });

        it("should handle null element", () => {
            expect(() => removeElement(null)).not.toThrow();
        });
    });
});

/**
 * ========================================
 * PERFORMANCE HELPERS TESTS
 * ========================================
 */

describe("Helpers - Performance", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("requestFrame", () => {
        it("should call requestAnimationFrame if available", () => {
            const callback = vi.fn();
            const mockRaf = vi.fn();
            global.requestAnimationFrame = mockRaf;

            requestFrame(callback);
            expect(mockRaf).toHaveBeenCalledWith(callback);
        });

        it("should fallback to setTimeout", () => {
            const originalRaf = global.requestAnimationFrame;
            delete global.requestAnimationFrame;

            const callback = vi.fn();
            requestFrame(callback);

            vi.advanceTimersByTime(16);
            expect(callback).toHaveBeenCalled();

            global.requestAnimationFrame = originalRaf;
        });
    });

    describe("cancelFrame", () => {
        it("should cancel animation frame", () => {
            const mockCaf = vi.fn();
            global.cancelAnimationFrame = mockCaf;

            cancelFrame(123);
            expect(mockCaf).toHaveBeenCalledWith(123);
        });
    });
});

/**
 * ========================================
 * ABORT CONTROLLER TESTS
 * ========================================
 */

describe("Helpers - AbortController", () => {
    describe("createAbortController", () => {
        it("should create AbortController", () => {
            const controller = createAbortController();
            expect(controller).toBeInstanceOf(AbortController);
            expect(controller.signal).toBeDefined();
        });

        it("should abort after timeout", async () => {
            vi.useFakeTimers();

            const controller = createAbortController(100);
            expect(controller.signal.aborted).toBe(false);

            vi.advanceTimersByTime(100);
            expect(controller.signal.aborted).toBe(true);

            vi.useRealTimers();
        });
    });
});

/**
 * ========================================
 * LAZY LOADING TESTS
 * ========================================
 */

describe("Helpers - Lazy Loading", () => {
    describe("lazyLoadImage", () => {
        it("should fallback to immediate load if IntersectionObserver unavailable", () => {
            const originalIO = global.IntersectionObserver;
            delete global.IntersectionObserver;

            const img = document.createElement("img");
            img.dataset.src = "image.jpg";

            lazyLoadImage(img);
            expect(img.src).toContain("image.jpg");

            global.IntersectionObserver = originalIO;
        });

        it("should use IntersectionObserver if available", () => {
            const mockObserver = {
                observe: vi.fn(),
                unobserve: vi.fn(),
            };
            // Vitest 4: `new IntersectionObserver()` needs a constructable mock.
            global.IntersectionObserver = vi.fn(
                class {
                    constructor() {
                        return mockObserver;
                    }
                }
            );

            const img = document.createElement("img");
            img.dataset.src = "image.jpg";

            lazyLoadImage(img);
            expect(mockObserver.observe).toHaveBeenCalledWith(img);
        });
    });

    describe("lazyExecute", () => {
        it("should use requestIdleCallback if available", () => {
            const mockRic = vi.fn();
            global.requestIdleCallback = mockRic;

            const callback = vi.fn();
            lazyExecute(callback, 100);

            expect(mockRic).toHaveBeenCalledWith(callback, { timeout: 100 });
        });

        it("should fallback to setTimeout", () => {
            const originalRic = global.requestIdleCallback;
            delete global.requestIdleCallback;

            vi.useFakeTimers();
            const callback = vi.fn();

            lazyExecute(callback, 100);
            vi.advanceTimersByTime(100);

            expect(callback).toHaveBeenCalled();

            vi.useRealTimers();
            global.requestIdleCallback = originalRic;
        });
    });
});

/**
 * ========================================
 * MEMORY OPTIMIZATION TESTS
 * ========================================
 */

describe("Helpers - Memory Optimization", () => {
    describe("clearObject", () => {
        it("should clear all object keys", () => {
            const obj = { a: 1, b: 2, c: 3 };
            clearObject(obj);
            expect(Object.keys(obj)).toEqual([]);
        });

        it("should handle null", () => {
            expect(() => clearObject(null)).not.toThrow();
        });

        it("should handle non-objects", () => {
            expect(() => clearObject("string")).not.toThrow();
            expect(() => clearObject(123)).not.toThrow();
        });
    });

    describe("createFragment", () => {
        it("should create DocumentFragment", () => {
            const fragment = createFragment();
            expect(fragment).toBeInstanceOf(DocumentFragment);
        });

        it("should append children to fragment", () => {
            const child1 = document.createElement("div");
            const child2 = document.createElement("span");
            const fragment = createFragment([child1, child2]);

            expect(fragment.childNodes.length).toBe(2);
            expect(fragment.childNodes[0]).toBe(child1);
            expect(fragment.childNodes[1]).toBe(child2);
        });

        it("should ignore non-element children", () => {
            const child = document.createElement("div");
            const fragment = createFragment([child, "string", null, 123]);

            expect(fragment.childNodes.length).toBe(1);
        });
    });
});

/**
 * ========================================
 * EVENT HELPERS TESTS
 * ========================================
 */

describe("Helpers - Events", () => {
    describe("addEventListener", () => {
        it("should add event listener", () => {
            const div = document.createElement("div");
            const handler = vi.fn();

            addEventListener(div, "click", handler);
            div.click();

            expect(handler).toHaveBeenCalled();
        });

        it("should return cleanup function", () => {
            const div = document.createElement("div");
            const handler = vi.fn();

            const cleanup = addEventListener(div, "click", handler);
            cleanup();
            div.click();

            expect(handler).not.toHaveBeenCalled();
        });

        it("should handle null element", () => {
            const cleanup = addEventListener(null, "click", vi.fn());
            expect(() => cleanup()).not.toThrow();
        });
    });

    describe("addEventListeners", () => {
        it("should add multiple event listeners", () => {
            const div = document.createElement("div");
            const clickHandler = vi.fn();
            const mouseoverHandler = vi.fn();

            addEventListeners(div, {
                click: clickHandler,
                mouseover: mouseoverHandler,
            });

            div.click();
            div.dispatchEvent(new Event("mouseover"));

            expect(clickHandler).toHaveBeenCalled();
            expect(mouseoverHandler).toHaveBeenCalled();
        });

        it("should return cleanup function for all listeners", () => {
            const div = document.createElement("div");
            const clickHandler = vi.fn();
            const mouseoverHandler = vi.fn();

            const cleanup = addEventListeners(div, {
                click: clickHandler,
                mouseover: mouseoverHandler,
            });

            cleanup();

            div.click();
            div.dispatchEvent(new Event("mouseover"));

            expect(clickHandler).not.toHaveBeenCalled();
            expect(mouseoverHandler).not.toHaveBeenCalled();
        });

        it("should handle null element", () => {
            const cleanup = addEventListeners(null, { click: vi.fn() });
            expect(() => cleanup()).not.toThrow();
        });
    });

    describe("delegateEvent", () => {
        it("should delegate event to matching children", () => {
            const parent = document.createElement("div");
            const child = document.createElement("button");
            child.className = "btn";
            parent.appendChild(child);

            const handler = vi.fn();
            delegateEvent(parent, "click", ".btn", handler);

            child.click();
            expect(handler).toHaveBeenCalled();
        });

        it("should not trigger for non-matching elements", () => {
            const parent = document.createElement("div");
            const child = document.createElement("span");
            parent.appendChild(child);

            const handler = vi.fn();
            delegateEvent(parent, "click", ".btn", handler);

            child.click();
            expect(handler).not.toHaveBeenCalled();
        });
    });
});

/**
 * ========================================
 * UTILITY FUNCTIONS TESTS
 * ========================================
 */

describe("Helpers - Utilities", () => {
    describe("deepClone", () => {
        it("should clone primitives", () => {
            expect(deepClone(42)).toBe(42);
            expect(deepClone("string")).toBe("string");
            expect(deepClone(true)).toBe(true);
            expect(deepClone(null)).toBe(null);
        });

        it("should clone objects", () => {
            const obj = { a: 1, b: { c: 2 } };
            const cloned = deepClone(obj);

            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
            expect(cloned.b).not.toBe(obj.b);
        });

        it("should clone arrays", () => {
            const arr = [1, 2, [3, 4]];
            const cloned = deepClone(arr);

            expect(cloned).toEqual(arr);
            expect(cloned).not.toBe(arr);
            expect(cloned[2]).not.toBe(arr[2]);
        });

        it("should clone Date objects", () => {
            const date = new Date("2024-01-01");
            const cloned = deepClone(date);

            expect(cloned).toEqual(date);
            expect(cloned).not.toBe(date);
        });

        it("should clone RegExp objects", () => {
            const regex = /test/gi;
            const cloned = deepClone(regex);

            expect(cloned.source).toBe(regex.source);
            expect(cloned.flags).toBe(regex.flags);
            expect(cloned).not.toBe(regex);
        });

        it("should handle circular references", () => {
            const obj = { a: 1 };
            obj.self = obj;

            const cloned = deepClone(obj);
            expect(cloned.a).toBe(1);
            expect(cloned.self).toBe(cloned);
        });
    });

    describe("isEmpty", () => {
        it("should return true for empty values", () => {
            expect(isEmpty(null)).toBe(true);
            expect(isEmpty(undefined)).toBe(true);
            expect(isEmpty("")).toBe(true);
            expect(isEmpty("  ")).toBe(true);
            expect(isEmpty([])).toBe(true);
            expect(isEmpty({})).toBe(true);
        });

        it("should return false for non-empty values", () => {
            expect(isEmpty("text")).toBe(false);
            expect(isEmpty([1])).toBe(false);
            expect(isEmpty({ a: 1 })).toBe(false);
            expect(isEmpty(0)).toBe(false);
            expect(isEmpty(false)).toBe(false);
        });
    });

    describe("wait", () => {
        it("should wait for specified time", async () => {
            vi.useFakeTimers();

            const promise = wait(100);
            vi.advanceTimersByTime(100);

            await promise;
            expect(true).toBe(true); // Promise resolved

            vi.useRealTimers();
        });
    });

    describe("retryWithBackoff", () => {
        it("should retry on failure with exponential backoff", async () => {
            vi.useFakeTimers();

            let attempts = 0;
            const fn = vi.fn(async () => {
                attempts++;
                if (attempts < 3) throw new Error("Failed");
                return "success";
            });

            const promise = retryWithBackoff(fn, 3, 100);

            // Fast-forward through all retries
            await vi.runAllTimersAsync();

            const result = await promise;
            expect(result).toBe("success");
            expect(fn).toHaveBeenCalledTimes(3);

            vi.useRealTimers();
        });

        it("should throw last error after max retries", async () => {
            const fn = vi.fn(async () => {
                throw new Error("Always fails");
            });

            await expect(retryWithBackoff(fn, 3, 100)).rejects.toThrow("Always fails");
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it("should succeed on first try if no error", async () => {
            const fn = vi.fn(async () => "success");
            const result = await retryWithBackoff(fn, 3, 100);

            expect(result).toBe("success");
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });
});

/**
 * ========================================
 * NAMESPACE EXPORT TESTS
 * ========================================
 */

describe("Helpers - Namespace Export", () => {
    // KERNEL S11 — contract guard. Locks the runtime surface against the frozen `DECLARED`
    // list below, so a member can never again be declared without existing (the
    // `debounce`/`throttle`/`fetchWithTimeout`/`batchDomOperations` defect) or exist
    // without being declared.
    // ⚠️ The oracle is this list, NOT a `.d.ts` file — the comment used to say the guard
    // locked against the root `index.d.ts`, which it never read (and which ARCHI S6 removed
    // as never-published and drifted). Editing the façade means editing this list on
    // purpose; that deliberate edit IS the review checkpoint.
    it("exposes exactly the documented surface — no phantoms, no undeclared members", () => {
        const DECLARED = [
            "getElementById",
            "querySelector",
            "querySelectorAll",
            "addClass",
            "removeClass",
            "toggleClass",
            "hasClass",
            "removeElement",
            "applyCssText",
            "requestFrame",
            "cancelFrame",
            "lazyLoadImage",
            "lazyExecute",
            "addEventListener",
            "addEventListeners",
            "delegateEvent",
            "createAbortController",
            "clearObject",
            "createFragment",
            "deepClone",
            "isEmpty",
            "wait",
            "retryWithBackoff",
        ];
        expect(Object.keys(Helpers).sort()).toEqual([...DECLARED].sort());
        for (const name of DECLARED) {
            expect(typeof Helpers[name]).toBe("function");
        }
    });

    it("does not expose the four members undeclared at S11", () => {
        // They live on GeoLeaf.Utils (debounce/throttle) or nowhere at all.
        for (const ghost of ["debounce", "throttle", "fetchWithTimeout", "batchDomOperations"]) {
            expect(Helpers[ghost]).toBeUndefined();
        }
    });

    it("should export all functions in Helpers namespace", () => {
        // DOM Helpers
        expect(Helpers.getElementById).toBe(getElementById);
        expect(Helpers.querySelector).toBe(querySelector);
        expect(Helpers.querySelectorAll).toBe(querySelectorAll);
        expect(Helpers.addClass).toBe(addClass);
        expect(Helpers.removeClass).toBe(removeClass);
        expect(Helpers.toggleClass).toBe(toggleClass);
        expect(Helpers.hasClass).toBe(hasClass);
        expect(Helpers.removeElement).toBe(removeElement);

        // Scheduling
        expect(Helpers.requestFrame).toBe(requestFrame);
        expect(Helpers.cancelFrame).toBe(cancelFrame);

        // AbortController Utilities
        expect(Helpers.createAbortController).toBe(createAbortController);

        // Lazy Loading
        expect(Helpers.lazyLoadImage).toBe(lazyLoadImage);
        expect(Helpers.lazyExecute).toBe(lazyExecute);

        // Memory Optimization
        expect(Helpers.clearObject).toBe(clearObject);
        expect(Helpers.createFragment).toBe(createFragment);

        // Event Helpers
        expect(Helpers.addEventListener).toBe(addEventListener);
        expect(Helpers.addEventListeners).toBe(addEventListeners);
        expect(Helpers.delegateEvent).toBe(delegateEvent);

        // Utility Functions
        expect(Helpers.deepClone).toBe(deepClone);
        expect(Helpers.isEmpty).toBe(isEmpty);
        expect(Helpers.wait).toBe(wait);
        expect(Helpers.retryWithBackoff).toBe(retryWithBackoff);
    });
});

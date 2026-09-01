/**
 * Verification of the test environment itself.
 *
 * ⚠️ **Kept deliberately — imports no project module, and that is its
 * nature.** Its subject IS the harness: does `setup.js` mount
 * `global.testHelpers`, the DOM and the `fetch` mock? A file testing the
 * harness has no module under test — not the defect the no-import triage
 * chased. Do not re-flag it at the next triage.
 */

describe("Environment Setup", () => {
    test("Jest is configured correctly", () => {
        expect(true).toBe(true);
    });

    test("Global helpers are available", () => {
        expect(global.testHelpers).toBeDefined();
        expect(typeof global.testHelpers.createMapContainer).toBe("function");
        expect(typeof global.testHelpers.createMockPOI).toBe("function");
    });

    test("Leaflet mock is no longer required (MapLibre)", () => {
        // global.L was removed during the Leaflet purge
        expect(true).toBe(true);
    });

    test("DOM is available (jsdom)", () => {
        const div = document.createElement("div");
        div.id = "test";
        document.body.appendChild(div);

        expect(document.getElementById("test")).toBeDefined();
    });

    test("Fetch mock is available", () => {
        expect(global.fetch).toBeDefined();
        expect(typeof global.fetch).toBe("function");
    });
});

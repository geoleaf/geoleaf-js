/**
 * ThemeSelectorLifecycle — S8/F2 app:ready mount of the theme switch bar.
 *
 * The default theme is applied by ThemeEngineModule (kernel); this lifecycle only builds
 * the selector UI on `geoleaf:app:ready`, gated by an acceptance guard (active profile +
 * both theme containers present). Mirrors the filter/labels capability pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInit = vi.fn(() => Promise.resolve());
const mockDestroy = vi.fn();
vi.mock("../../../src/capabilities/theme-selector/theme-selector.js", () => ({
    ThemeSelector: { init: (o) => mockInit(o), destroy: () => mockDestroy() },
}));
vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), debug: vi.fn() },
}));
let mockProfileId = "p1";
vi.mock("../../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({ Config: { getActiveProfileId: () => mockProfileId } }),
}));

const { ThemeSelectorLifecycle } =
    await import("../../../src/capabilities/theme-selector/lifecycle.ts");

/** Adds the two theme containers to the DOM; returns a cleanup function. */
function addContainers() {
    const primary = document.createElement("div");
    primary.id = "gl-theme-primary-container";
    const secondary = document.createElement("div");
    secondary.id = "gl-theme-secondary-container";
    document.body.append(primary, secondary);
    return () => {
        primary.remove();
        secondary.remove();
    };
}

describe("ThemeSelectorLifecycle (S8/F2)", () => {
    beforeEach(() => {
        ThemeSelectorLifecycle._reset(); // clean module state before clearing the mocks
        vi.clearAllMocks();
        mockProfileId = "p1";
    });
    afterEach(() => {
        ThemeSelectorLifecycle._reset();
    });

    it("mounts the selector on app:ready when profile + containers present", () => {
        const cleanup = addContainers();
        ThemeSelectorLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p1" }));
        cleanup();
    });

    it("does NOT mount when the theme containers are absent (acceptance guard)", () => {
        ThemeSelectorLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockInit).not.toHaveBeenCalled();
    });

    it("does NOT mount when there is no active profile (acceptance guard)", () => {
        mockProfileId = null;
        const cleanup = addContainers();
        ThemeSelectorLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockInit).not.toHaveBeenCalled();
        cleanup();
    });

    it("init() is idempotent — a single app:ready subscription", () => {
        const cleanup = addContainers();
        ThemeSelectorLifecycle.init();
        ThemeSelectorLifecycle.init(); // second call guarded by _started
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockInit).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("_reset() detaches the listener and destroys the selector", () => {
        const cleanup = addContainers();
        ThemeSelectorLifecycle.init();
        ThemeSelectorLifecycle._reset();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockInit).not.toHaveBeenCalled(); // listener detached before the event
        expect(mockDestroy).toHaveBeenCalled();
        cleanup();
    });
});

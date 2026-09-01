/**
 * Legend teardown (_reset) — real create → destroy → recreate.
 *
 * F1's `lifecycle.test.js` mocks `legend-api.js` wholesale, so the *actual*
 * teardown (`public-api.ts` `_reset`: clearTimeout ×2, overlay DOM purge,
 * `_control.remove()`, `_allLayers.clear()`, state reset) is exercised nowhere.
 * This guards the CDC §11 "state leak on recreate" risk with the un-mocked
 * `Legend` namespace (S10 / F3, P1 closing).
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockEnsureSprite = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
    ensureProfileSpriteInjectedSync: mockEnsureSprite,
    isProfileSpriteReady: () =>
        document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
    registerSpriteIcons: vi.fn(() => Promise.resolve()),
    hasProfileSprite: vi.fn(() => false),
}));

describe("Legend _reset (create → destroy → recreate)", () => {
    let Legend;
    const mockConfigGet = vi.fn();
    const mockConfigGetActiveProfile = vi.fn();
    const controlRemove = vi.fn();
    let controlContainer;
    const mockControlCreate = vi.fn(() => ({
        _container: controlContainer,
        hide: vi.fn(),
        addTo: vi.fn(),
        remove: controlRemove,
        updateMultiLayerContent: vi.fn(),
    }));

    // The deferral is LOAD-BEARING despite an inert target: the hook installs
    // `GeoLeaf.Config`, `_LegendControl` and `fetch` BEFORE loading. The
    // sequence is written, the author intended it, and a module inert today
    // can stop being so. `await import()` preserves it to the letter — the
    // 1st of the triage's four limits, in the ADR.
    beforeAll(async () => {
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.Config = {
            get: mockConfigGet,
            getActiveProfile: mockConfigGetActiveProfile,
            getAll: vi.fn(() => ({})),
        };
        globalThis.GeoLeaf._LegendControl = { create: mockControlCreate };
        globalThis.GeoLeaf._LegendGenerator = null;
        globalThis.GeoLeaf._LayerVisibilityManager = null;
        globalThis.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        );
        ({ Legend } = await import("../../../src/capabilities/legend/public-api.js"));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        controlContainer = document.createElement("div");
        mockConfigGet.mockImplementation((key) =>
            key === "data" ? { profilesBasePath: "profiles" } : null
        );
        mockConfigGetActiveProfile.mockReturnValue({
            id: "reset-profile",
            layers: [{ id: "layer1", configFile: "layer1.json" }],
        });
        Legend._reset(); // clean module state before each case
    });

    afterEach(() => {
        Legend._reset();
        vi.useRealTimers();
    });

    it("clears control, pending timers and layer state on _reset", () => {
        vi.useFakeTimers();
        const map = { addControl: vi.fn(), removeControl: vi.fn() };

        // create — init populates _map / _profileConfig / _allLayers
        expect(Legend.init(map)).toBe(true);
        expect(Legend.getAllLayers().size).toBeGreaterThan(0);

        // materialise a control + schedule the debounced rebuild and overlay timers
        Legend.setLayerVisibility("layer1", true);
        Legend._rebuildDisplay();
        Legend.showLoadingOverlay();
        expect(mockControlCreate).toHaveBeenCalled();
        expect(Legend.isLegendVisible()).toBe(true);

        const createCallsBefore = mockControlCreate.mock.calls.length;

        // destroy
        Legend._reset();

        expect(controlRemove).toHaveBeenCalled(); // _control.remove() ran, _control = null
        expect(Legend.isLegendVisible()).toBe(false);
        expect(Legend.getAllLayers().size).toBe(0); // _allLayers cleared

        // both timers were purged — advancing past every deadline rebuilds nothing
        vi.advanceTimersByTime(13000);
        expect(mockControlCreate).toHaveBeenCalledTimes(createCallsBefore);
    });

    // B.27c — the sprite-retry timer.
    //
    // When the legend renders icons before the profile sprite is available, it
    // schedules a 2 s re-render. That timer was the one `setTimeout` in this module
    // not held in a slot, so `_reset()` could not cancel it: a destroy inside the
    // 2 s window left the callback to fire on a torn-down module — or, on the
    // recreate path, to force a rebuild of the *next* instance from the previous
    // one's closure.
    it("cancels the pending sprite retry on _reset", () => {
        vi.useFakeTimers();
        const map = { addControl: vi.fn(), removeControl: vi.fn() };
        Legend.init(map);

        // A visible layer whose legend carries an icon → `hasIcons` is true, and the
        // sprite is absent from the document → the 2 s retry is scheduled.
        const layers = Legend.getAllLayers();
        const info = layers.get("layer1");
        info.visible = true;
        info.legendData = { sections: [{ items: [{ icon: "poi-school" }] }] };
        layers.set("layer1", info);
        Legend._rebuildDisplay();

        Legend._reset();

        // The sprite lands right after the teardown — the exact race the retry exists for.
        const sprite = document.createElement("svg");
        sprite.setAttribute("data-geoleaf-sprite", "profile");
        document.body.appendChild(sprite);

        const rebuildSpy = vi.fn();
        const original = Legend._rebuildDisplay;
        Legend._rebuildDisplay = rebuildSpy;
        try {
            vi.advanceTimersByTime(2000);
        } finally {
            Legend._rebuildDisplay = original;
            sprite.remove();
        }
        expect(rebuildSpy).not.toHaveBeenCalled();
    });

    it("recreates from a clean slate after _reset (no residual state)", () => {
        const map = { addControl: vi.fn(), removeControl: vi.fn() };
        Legend.init(map);
        Legend.setLayerVisibility("layer1", true);
        Legend._rebuildDisplay();
        Legend._reset();

        // recreate with a different profile — instance #1 state must not leak
        mockConfigGetActiveProfile.mockReturnValue({
            id: "reset-profile-2",
            layers: [{ id: "layerA", configFile: "a.json" }],
        });
        expect(Legend.init(map)).toBe(true);

        const layers = Legend.getAllLayers();
        expect(layers.has("layerA")).toBe(true);
        expect(layers.has("layer1")).toBe(false);
        expect(Legend.isLegendVisible()).toBe(false); // fresh — no control yet
    });
});

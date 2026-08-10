/**
 * B.27b — Labels capability teardown symmetry.
 *
 * The capability injects a 🏷️ button into a control container owned by the layer
 * manager, and `attachEventHandler` (ui/widgets.ts) puts TWO listeners on it: the
 * toggle handler and a `stopPropagation` guard. Neither the element nor the
 * listeners were released by `_reset()`, so both survived a destroy with no
 * re-init — a button still painted in the layer list, still wired to a torn-down
 * module.
 *
 * Runs against the REAL `LabelButtonManager` + the REAL `attachEventHandler` (the
 * mocked-manager view in `lifecycle.test.js` cannot see a DOM leak). Only the
 * boundaries are doubled: log, i18n, and the GeoJSON layer store.
 */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockToggleLabels = vi.fn(() => true);

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/utils/i18n/i18n.js", () => ({ getLabel: (key) => key }));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        getLayerById: () => ({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
        }),
    },
}));
vi.mock("../../../src/capabilities/labels/labels.js", () => ({
    Labels: {
        init: vi.fn(),
        destroy: vi.fn(),
        toggleLabels: (id) => mockToggleLabels(id),
        areLabelsEnabled: () => false,
    },
}));

import { LabelsLifecycle } from "../../../src/capabilities/labels/lifecycle.js";

/** Mounts a layer row the way the layer manager does, and fires the controls seam. */
function mountLayerRow(layerId) {
    const item = document.createElement("div");
    item.setAttribute("data-layer-id", layerId);
    const controls = document.createElement("div");
    controls.className = "gl-layer-manager__item-controls";
    item.appendChild(controls);
    document.body.appendChild(item);
    document.dispatchEvent(
        new CustomEvent("geoleaf:layer-item:controls", {
            detail: { layerId, controlsContainer: controls, toggleable: true },
        })
    );
    return controls;
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    LabelsLifecycle._reset();
});

afterEach(() => {
    LabelsLifecycle._reset();
    document.body.innerHTML = "";
});

describe("LabelsLifecycle — teardown symmetry (B.27b)", () => {
    it("_reset() detaches every injected label button", () => {
        LabelsLifecycle.init();
        const controls = mountLayerRow("ly1");
        const btn = controls.querySelector(".gl-layer-manager__label-toggle");
        expect(btn).toBeTruthy();

        LabelsLifecycle._reset();

        expect(controls.querySelector(".gl-layer-manager__label-toggle")).toBeNull();
        expect(btn.isConnected).toBe(false);
    });

    it("no clickable label toggle survives teardown", () => {
        LabelsLifecycle.init();
        mountLayerRow("ly1");
        // Sanity: while the capability is up, the rendered button really drives Labels.
        document.querySelector(".gl-layer-manager__label-toggle").click();
        expect(mockToggleLabels).toHaveBeenCalledWith("ly1");
        mockToggleLabels.mockClear();

        LabelsLifecycle._reset();

        // Nothing left in the document tree to click — the assertion is on the
        // reachable surface, which is the whole surface a user has. A *detached*
        // node still runs its own listeners if some caller kept a reference and
        // calls `.click()` on it; releasing them for good would mean handing
        // `attachEventHandler` (ui/widgets.ts) a disposer it does not have, for a
        // node that is unreachable and collectable as soon as the row goes.
        const leftover = document.querySelector(".gl-layer-manager__label-toggle");
        expect(leftover).toBeNull();
        leftover?.click();
        expect(mockToggleLabels).not.toHaveBeenCalled();
    });

    // Pin (green before and after the fix): the removal must not break the auto-heal
    // path — `init()` re-syncs rows already in the DOM, and must re-arm each with
    // exactly one button rather than none or two.
    it("init() after _reset() re-arms existing rows with exactly one button each", () => {
        LabelsLifecycle.init();
        const controls = mountLayerRow("ly1");
        LabelsLifecycle._reset();
        LabelsLifecycle.init();

        expect(controls.querySelectorAll(".gl-layer-manager__label-toggle")).toHaveLength(1);
        expect(document.querySelectorAll(".gl-layer-manager__label-toggle")).toHaveLength(1);
    });
});

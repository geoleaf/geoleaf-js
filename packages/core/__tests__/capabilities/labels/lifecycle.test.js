/**
 * Unit tests — capabilities/labels/lifecycle.ts (S4)
 *
 * LabelsLifecycle wires the Labels singleton init/destroy and owns the per-layer
 * 🏷️ button via the `geoleaf:layer-item:controls` seam (injection without the
 * layer manager importing labels statically).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    Labels: { init: vi.fn(), destroy: vi.fn() },
    LabelButtonManager: { createButton: vi.fn(), syncImmediate: vi.fn(), removeButtons: vi.fn() },
}));
vi.mock("../../../src/capabilities/labels/labels.js", () => ({ Labels: mocks.Labels }));
vi.mock("../../../src/capabilities/labels/label-button-manager.js", () => ({
    LabelButtonManager: mocks.LabelButtonManager,
}));

const { LabelsLifecycle } = await import("../../../src/capabilities/labels/lifecycle.ts");

function dispatchControls(layerId, toggleable = true) {
    document.dispatchEvent(
        new CustomEvent("geoleaf:layer-item:controls", {
            detail: { layerId, controlsContainer: document.createElement("div"), toggleable },
        })
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

afterEach(() => {
    LabelsLifecycle._reset();
});

describe("LabelsLifecycle", () => {
    it("init() calls Labels.init and injects the button on the controls seam", () => {
        LabelsLifecycle.init();
        expect(mocks.Labels.init).toHaveBeenCalledTimes(1);
        dispatchControls("ly1", true);
        expect(mocks.LabelButtonManager.createButton).toHaveBeenCalledWith(
            "ly1",
            expect.any(HTMLElement)
        );
        expect(mocks.LabelButtonManager.syncImmediate).toHaveBeenCalledWith("ly1");
    });

    it("init() is idempotent (second call is a no-op)", () => {
        LabelsLifecycle.init();
        LabelsLifecycle.init();
        expect(mocks.Labels.init).toHaveBeenCalledTimes(1);
    });

    it("init() re-syncs buttons for layers already rendered in the DOM", () => {
        const item = document.createElement("div");
        item.setAttribute("data-layer-id", "existing");
        document.body.appendChild(item);
        LabelsLifecycle.init();
        expect(mocks.LabelButtonManager.syncImmediate).toHaveBeenCalledWith("existing");
    });

    it("_reset() calls Labels.destroy, removes the buttons and detaches the seam", () => {
        LabelsLifecycle.init();
        LabelsLifecycle._reset();
        expect(mocks.Labels.destroy).toHaveBeenCalledTimes(1);
        expect(mocks.LabelButtonManager.removeButtons).toHaveBeenCalledTimes(1);
        dispatchControls("ly2", false);
        expect(mocks.LabelButtonManager.createButton).not.toHaveBeenCalled();
    });

    it("seam handler ignores events with no layerId", () => {
        LabelsLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:layer-item:controls", {
                detail: { controlsContainer: document.createElement("div") },
            })
        );
        expect(mocks.LabelButtonManager.createButton).not.toHaveBeenCalled();
    });
});

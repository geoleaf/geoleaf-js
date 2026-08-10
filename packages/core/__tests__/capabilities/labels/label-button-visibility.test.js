/**
 * Integration tests for the label button visibility
 *
 * Test scenarios:
 * 1. Button hidden when layer is OFF
 * 2. Bouton visible quand layer ON + label.enabled: true
 * 3. Button hidden quand layer ON + label.enabled: false
 * 4. Changement de style: visibleByDefault reapplied
 * 5. Toggle layer: button hidden/shown based on state
 * 6. Debouncing: multiple rapid calls do not cause issues
 *
 * Implementation notes:
 * - LabelButtonManager uses direct imports (GeoJSONCore, Labels), not global delegates
 * - _applyState uses button.disabled + CSS classes, not style.display
 */

vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: vi.fn() },
}));
vi.mock("../../../src/capabilities/labels/labels.js", () => ({
    Labels: { areLabelsEnabled: vi.fn(() => false), toggleLabels: vi.fn() },
}));
vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../src/kernel/ui/components.js", () => ({
    _UIComponents: { attachEventHandler: vi.fn() },
}));
vi.mock("../../../src/utils/general/dom-helpers.js", () => ({
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
}));
vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn(() => ""),
}));

import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import { GeoJSONCore as GeoJSONCoreMock } from "../../../src/kernel/geojson/core.js";
import { Labels as LabelsMock } from "../../../src/capabilities/labels/labels.js";
import { LabelButtonManager } from "../../../src/capabilities/labels/label-button-manager.js";

describe("Label Button Visibility Integration Tests", () => {
    let mockLayerData;
    let mockButton;
    let mockLayerItem;

    beforeEach(() => {
        // Mock du DOM
        document.body.innerHTML =
            '<div data-layer-id="test-layer"><button class="gl-layer-manager__label-toggle"></button></div>';
        mockLayerItem = document.querySelector('[data-layer-id="test-layer"]');
        mockButton = mockLayerItem.querySelector(".gl-layer-manager__label-toggle");

        // Mock layer data
        mockLayerData = {
            id: "test-layer",
            _visibility: { current: true },
            currentStyle: { label: { enabled: true, visibleByDefault: false } },
        };

        GeoJSONCoreMock.getLayerById.mockReturnValue(mockLayerData);
        LabelsMock.areLabelsEnabled.mockReturnValue(false);

        global.GeoLeaf = {
            Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
    });

    describe("Rule 1: Layer OFF → Button hidden", () => {
        test("The button should be hidden when the layer is OFF", () => {
            // Arrange: Layer OFF
            mockLayerData._visibility.current = false;
            mockLayerData.currentStyle.label.enabled = true;

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert: disabled + --disabled class (not style.display)
            expect(mockButton.disabled).toBe(true);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(
                true
            );
        });

        test("The button stays hidden even if label.enabled = true", () => {
            // Arrange: Layer OFF + labels available
            mockLayerData._visibility.current = false;
            mockLayerData.currentStyle.label.enabled = true;
            LabelsMock.areLabelsEnabled.mockReturnValue(true);

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert
            expect(mockButton.disabled).toBe(true);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(
                true
            );
        });
    });

    describe("Rule 2: Layer ON + label.enabled: false → Button hidden", () => {
        test("The button should be hidden when label.enabled = false", () => {
            // Arrange: Layer ON mais pas de labels in the style
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = false;

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert
            expect(mockButton.disabled).toBe(true);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(
                true
            );
        });
    });

    describe("Rule 3: Layer ON + label.enabled: true → Bouton visible", () => {
        test("Le bouton should be visible avec state inactif", () => {
            // Arrange: Layer ON + labels available mais non actifs
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = true;
            LabelsMock.areLabelsEnabled.mockReturnValue(false);

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert
            expect(mockButton.disabled).toBe(false);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--on")).toBe(false);
            expect(mockButton.getAttribute("aria-pressed")).toBe("false");
        });

        test("The button should be visible with active state when labels are shown", () => {
            // Arrange: Layer ON + labels actifs
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = true;
            LabelsMock.areLabelsEnabled.mockReturnValue(true);

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert
            expect(mockButton.disabled).toBe(false);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--on")).toBe(true);
            expect(mockButton.getAttribute("aria-pressed")).toBe("true");
        });
    });

    describe("Debouncing", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.clearAllTimers();
            vi.useRealTimers();
        });

        // Le pendant `sync()` (debounce 300 ms) est purgé (S4) : aucun appelant prod —
        // les 6 sites réels appellent `syncImmediate`. Seul ce chemin reste testé.
        test("syncImmediate() applique l'état sans attendre", () => {
            // Arrange
            const syncSpy = vi.spyOn(LabelButtonManager, "_doSync");
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = true;

            // Act: Appeler syncImmediate()
            LabelButtonManager.syncImmediate("test-layer");

            // Assert: Immediate call without waiting
            expect(syncSpy).toHaveBeenCalledTimes(1);
            expect(syncSpy).toHaveBeenCalledWith("test-layer");

            syncSpy.mockRestore();
        });
    });

    describe("Complete integration scenarios", () => {
        test("Scenario: Toggle layer OFF → ON with labels available", () => {
            // Arrange: Layer OFF
            mockLayerData._visibility.current = false;
            mockLayerData.currentStyle.label.enabled = true;

            // Act 1: Sync initial (layer OFF)
            LabelButtonManager._doSync("test-layer");
            expect(mockButton.disabled).toBe(true);

            // Act 2: Activer la layer
            mockLayerData._visibility.current = true;
            LabelButtonManager._doSync("test-layer");

            // Assert: Bouton maintenant visible
            expect(mockButton.disabled).toBe(false);
        });

        test("Scenario: Toggle layer ON → OFF with active labels", () => {
            // Arrange: Layer ON avec labels actifs
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = true;
            LabelsMock.areLabelsEnabled.mockReturnValue(true);

            // Act 1: Sync initial (layer ON, labels actifs)
            LabelButtonManager._doSync("test-layer");
            expect(mockButton.disabled).toBe(false);
            expect(mockButton.classList.contains("gl-layer-manager__label-toggle--on")).toBe(true);

            // Act 2: Disable la layer
            mockLayerData._visibility.current = false;
            LabelButtonManager._doSync("test-layer");

            // Assert: Button hidden
            expect(mockButton.disabled).toBe(true);
        });

        test("Scenario: Style change with label.enabled true → false", () => {
            // Arrange: Layer ON avec labels
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = true;

            // Act 1: Sync initial
            LabelButtonManager._doSync("test-layer");
            expect(mockButton.disabled).toBe(false);

            // Act 2: Changer towards style sans labels
            mockLayerData.currentStyle.label.enabled = false;
            LabelButtonManager._doSync("test-layer");

            // Assert: Button hidden
            expect(mockButton.disabled).toBe(true);
        });

        test("Scenario: Style change with label.enabled false → true", () => {
            // Arrange: Layer ON sans labels
            mockLayerData._visibility.current = true;
            mockLayerData.currentStyle.label.enabled = false;

            // Act 1: Sync initial
            LabelButtonManager._doSync("test-layer");
            expect(mockButton.disabled).toBe(true);

            // Act 2: Changer towards style avec labels
            mockLayerData.currentStyle.label.enabled = true;
            LabelButtonManager._doSync("test-layer");

            // Assert: Bouton visible
            expect(mockButton.disabled).toBe(false);
        });
    });

    describe("Gestion des states edge cases", () => {
        test("Layer without _visibility metadata should be treated as invisible", () => {
            // Arrange: Supprimer _visibility
            delete mockLayerData._visibility;
            mockLayerData.currentStyle.label.enabled = true;

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert: Button hidden (no visibility = OFF)
            expect(mockButton.disabled).toBe(true);
        });

        test("Layer sans currentStyle devrait masquer le bouton", () => {
            // Arrange: Supprimer currentStyle
            mockLayerData._visibility.current = true;
            delete mockLayerData.currentStyle;

            // Act
            LabelButtonManager._doSync("test-layer");

            // Assert: Button hidden (pas de style = pas de labels)
            expect(mockButton.disabled).toBe(true);
        });

        test("LayerItem not found should not cause an error", () => {
            // Arrange: Supprimer le layerItem du DOM
            document.body.innerHTML = "";

            // Act & Assert: Ne devrait pas throw
            expect(() => {
                LabelButtonManager._doSync("test-layer");
            }).not.toThrow();
        });

        test("Button not found should not cause an error", () => {
            // Arrange: Supprimer le bouton
            mockButton.remove();

            // Act & Assert: Ne devrait pas throw
            expect(() => {
                LabelButtonManager._doSync("test-layer");
            }).not.toThrow();
        });
    });
});

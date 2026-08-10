/**
 * Unit tests — capabilities/labels/install.ts (presets build, S2)
 *
 * Validates LABELS_INSTALLER: the declaration wiring (layer C), the
 * registerGlobals facade writes moved out of globals.ui.ts's setupUI (layer B),
 * and the createModule factory. These assertions replace the labels checks
 * removed from __tests__/globals/ui.test.js.
 */

import { describe, expect, it } from "vitest";

const { LABELS_INSTALLER } = await import("../../../src/capabilities/labels/install.ts");
const { LABELS_CAPABILITY } = await import("../../../src/capabilities/labels/labels-capability.ts");
const { LabelsModule } = await import("../../../src/capabilities/labels/module.ts");
const { LabelButtonManager } = await import(
    "../../../src/capabilities/labels/label-button-manager.ts"
);
const { LabelRenderer } = await import("../../../src/capabilities/labels/label-renderer.ts");
const { Labels } = await import("../../../src/api/geoleaf.labels.ts");

describe("LABELS_INSTALLER (capabilities/labels/install)", () => {
    it("exposes LABELS_CAPABILITY as its declaration", () => {
        expect(LABELS_INSTALLER.declaration).toBe(LABELS_CAPABILITY);
    });

    it("registerGlobals assigns the labels public facades (B6, ex-setupUI)", () => {
        const gl = {};
        LABELS_INSTALLER.registerGlobals(gl);
        expect(gl._LabelButtonManager).toBe(LabelButtonManager);
        expect(gl._LabelRenderer).toBe(LabelRenderer);
        expect(gl.Labels).toBe(Labels);
    });

    it("registerGlobals is additive and idempotent", () => {
        const gl = { existing: 1 };
        LABELS_INSTALLER.registerGlobals(gl);
        LABELS_INSTALLER.registerGlobals(gl);
        expect(gl.existing).toBe(1);
        expect(gl.Labels).toBe(Labels);
    });

    it("createModule returns a fresh LabelsModule (id 'labels', deps ['geojson'])", () => {
        const m = LABELS_INSTALLER.createModule();
        expect(m).toBeInstanceOf(LabelsModule);
        expect(m.id).toBe("labels");
        expect(m.dependencies).toEqual(["geojson"]);
        expect(LABELS_INSTALLER.createModule()).not.toBe(m);
    });
});

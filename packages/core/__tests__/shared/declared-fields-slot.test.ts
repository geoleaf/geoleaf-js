/**
 * The declared-fields slot — one provider per reader, and every reader that reads a declared
 * field fills it from its installer.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
    declaredFieldProviders,
    provideDeclaredFields,
} from "../../src/kernel/shared/declared-fields-slot.js";
import { TAXONOMY_INSTALLER } from "../../src/capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "../../src/capabilities/feature-info/install.js";
import { LABELS_INSTALLER } from "../../src/capabilities/labels/install.js";
import { FILTER_INSTALLER } from "../../src/capabilities/filter/install.js";

const READERS = [TAXONOMY_INSTALLER, FEATURE_INFO_INSTALLER, LABELS_INSTALLER, FILTER_INSTALLER];

afterEach(() => {
    for (const installer of READERS) provideDeclaredFields(installer.declaration.id, null);
    provideDeclaredFields("a", null);
});

describe("declared-fields slot", () => {
    it("keeps one provider per reader — a second fill replaces, it does not add", () => {
        const before = declaredFieldProviders().length;
        const first = () => [];
        const second = () => [];
        provideDeclaredFields("a", first);
        provideDeclaredFields("a", second);
        expect(declaredFieldProviders()).toHaveLength(before + 1);
        expect(declaredFieldProviders()).toContain(second);
        expect(declaredFieldProviders()).not.toContain(first);
    });

    it("empties a reader's place on null", () => {
        provideDeclaredFields("a", () => []);
        const filled = declaredFieldProviders().length;
        provideDeclaredFields("a", null);
        expect(declaredFieldProviders()).toHaveLength(filled - 1);
    });

    it("is filled by every reader's installer, once however many boots", () => {
        const before = declaredFieldProviders().length;
        for (const installer of READERS) installer.registerGlobals?.({});
        for (const installer of READERS) installer.registerGlobals?.({});
        expect(declaredFieldProviders()).toHaveLength(before + READERS.length);
    });
});

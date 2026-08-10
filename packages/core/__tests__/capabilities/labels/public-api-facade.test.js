/**
 * Unit tests — `capabilities/labels/public-api.ts` (façade à 33 %).
 *
 * `buildPublicApi()` augmente le singleton `Labels` de deux aides de lecture
 * (`isEnabled` / `getConfig`) et le rend tel quel. On mocke `Labels` et `getLabelsConfig`.
 */
import { vi, test, expect, beforeEach } from "vitest";

// vi.hoisted : la factory de vi.mock est hissée en tête ; les variables qu'elle
// référence doivent l'être aussi, sinon « Cannot access before initialization ».
const { getLabelsConfig } = vi.hoisted(() => ({ getLabelsConfig: vi.fn() }));

vi.mock("../../../src/capabilities/labels/labels.js", () => ({
    Labels: { enableLabels: vi.fn(), toggleLabels: vi.fn() },
}));
vi.mock("../../../src/capabilities/labels/config.js", () => ({ getLabelsConfig }));

import { buildPublicApi } from "../../../src/capabilities/labels/public-api.js";

let api;
beforeEach(() => {
    vi.clearAllMocks();
    getLabelsConfig.mockReturnValue({ enabled: true });
    api = buildPublicApi();
});

test("rend le singleton Labels augmenté des aides de lecture", () => {
    expect(typeof api.enableLabels).toBe("function"); // du singleton
    expect(typeof api.isEnabled).toBe("function"); // ajouté
    expect(typeof api.getConfig).toBe("function");
});

test("isEnabled : vrai sauf enabled === false", () => {
    expect(api.isEnabled()).toBe(true);
    getLabelsConfig.mockReturnValue({ enabled: false });
    expect(api.isEnabled()).toBe(false);
    getLabelsConfig.mockReturnValue({}); // absent → non-false → true
    expect(api.isEnabled()).toBe(true);
});

test("getConfig rend la config résolue", () => {
    getLabelsConfig.mockReturnValue({ enabled: true, size: 14 });
    expect(api.getConfig()).toEqual({ enabled: true, size: 14 });
});

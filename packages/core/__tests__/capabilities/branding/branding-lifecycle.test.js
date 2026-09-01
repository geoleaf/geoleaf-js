/**
 * Unit tests — `BrandingLifecycle` (backlog COUVERTURE B.2).
 *
 * `capabilities/branding/lifecycle.ts` measured at **28.6%** (2/7 lines). The
 * module is tiny but carries a guarantee that matters: mounting is
 * **idempotent** — `BrandingModule` can call it several times without
 * stacking two overlays. That guarantee was verified by nothing, and a badly
 * reset `_started` would break it silently.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/capabilities/branding/branding.js", async (importActual) => ({
    ...(await importActual()),
    Branding: { init: vi.fn(), destroy: vi.fn() },
}));

const { BrandingLifecycle } = await import("../../../src/capabilities/branding/lifecycle.js");
const { Branding } = await import("../../../src/capabilities/branding/branding.js");

const fakeMap = { id: "carte" };

beforeEach(() => {
    BrandingLifecycle._reset();
    vi.clearAllMocks();
});

afterEach(() => {
    BrandingLifecycle._reset();
});

describe("BrandingLifecycle.init — montage idempotent", () => {
    test("le premier init monte l'overlay avec la carte reçue", () => {
        BrandingLifecycle.init(fakeMap);
        expect(Branding.init).toHaveBeenCalledTimes(1);
        expect(Branding.init).toHaveBeenCalledWith(fakeMap);
    });

    test("les appels suivants sont des no-op — pas de second overlay", () => {
        BrandingLifecycle.init(fakeMap);
        BrandingLifecycle.init(fakeMap);
        BrandingLifecycle.init({ id: "autre" });
        expect(Branding.init).toHaveBeenCalledTimes(1);
    });
});

describe("BrandingLifecycle._reset — la couture de test / destroy du module", () => {
    test("détruit l'overlay", () => {
        BrandingLifecycle.init(fakeMap);
        BrandingLifecycle._reset();
        expect(Branding.destroy).toHaveBeenCalledTimes(1);
    });

    test("rouvre la porte : après _reset, un init remonte réellement", () => {
        BrandingLifecycle.init(fakeMap);
        BrandingLifecycle._reset();
        BrandingLifecycle.init(fakeMap);
        expect(Branding.init).toHaveBeenCalledTimes(2);
    });

    test("_reset sans montage préalable ne jette pas", () => {
        expect(() => BrandingLifecycle._reset()).not.toThrow();
    });
});

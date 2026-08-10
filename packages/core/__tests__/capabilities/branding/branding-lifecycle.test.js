/**
 * Unit tests — `BrandingLifecycle` (backlog COUVERTURE B.2).
 *
 * `capabilities/branding/lifecycle.ts` était mesuré à **28,6 %** (2/7 lignes). Le module est
 * minuscule mais porte une garantie qui compte : le montage est **idempotent** — `BrandingModule`
 * peut l'appeler plusieurs fois sans empiler deux overlays. Cette garantie n'était vérifiée
 * par rien, et un `_started` mal remis à zéro la casserait en silence.
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

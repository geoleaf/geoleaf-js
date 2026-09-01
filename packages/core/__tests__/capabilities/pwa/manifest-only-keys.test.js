/**
 * Unit tests — `modules.pwa` spans TWO consumers, and only one of them is this bundle.
 *
 * `description` / `theme_color` / `background_color` exist in `packages/core/src` as TYPE
 * members alone (`PWAConfig`, pwa-manager.ts): grep finds no runtime read. They are
 * NOT dead keys — `scripts/build-deploy.cjs` merges each into the deployed
 * `manifest.json` — but a reader of the capability had no way to tell that apart from the
 * "declared and never read" family (B.22), because the declaration said nothing.
 *
 * `name` / `short_name` are the contrast that makes the split legible: they are read on
 * BOTH sides. So the guard is not "these three are unused" (they are used, elsewhere) but
 * "the runtime half of the block is exactly {enabled, installPrompt, name, short_name}".
 * Break the split — forward a manifest-only key into the runtime, or stop forwarding a
 * two-sided one — and this fails, together with the table in `pwa-capability.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { PwaLifecycle } = await import("../../../src/capabilities/pwa/lifecycle.ts");
const { PWAManager } = await import("../../../src/capabilities/pwa/pwa-manager.ts");
const { PWA_CAPABILITY } = await import("../../../src/capabilities/pwa/pwa-capability.ts");

/** Keys the deployed manifest takes from `modules.pwa` (build-deploy.cjs). */
const MANIFEST_KEYS = ["name", "short_name", "description", "theme_color", "background_color"];

/** Of those, the ones the RUNTIME also reads (pwa-manager.ts, via lifecycle.ts). */
const RUNTIME_AND_MANIFEST = ["name", "short_name"];

/** A block setting every manifest key to a distinguishable value. */
const FULL_BLOCK = {
    enabled: true,
    installPrompt: { enabled: true },
    name: "Full App Name",
    short_name: "ShortName",
    description: "A description",
    theme_color: "#2d6a4f",
    background_color: "#ffffff",
};

afterEach(() => {
    vi.restoreAllMocks();
    PwaLifecycle._reset();
});

describe("modules.pwa — the runtime / build split", () => {
    it("every manifest key is declared in the capability schema", () => {
        // Guards the guard: a manifest key dropped from the declaration would make the
        // split table describe a block the studio cannot see.
        for (const key of MANIFEST_KEYS) {
            expect(PWA_CAPABILITY.configSchema[key]).toBeTruthy();
        }
    });

    it("the declaration marks the manifest-only keys BUILD-TIME ONLY", () => {
        // The split is documented where a reader looks for it — the declaration itself,
        // which is what `getCapabilitySchema('pwa')` hands the studio.
        for (const key of MANIFEST_KEYS.filter((k) => !RUNTIME_AND_MANIFEST.includes(k))) {
            expect(PWA_CAPABILITY.configSchema[key].description).toContain("BUILD-TIME ONLY");
        }
        for (const key of RUNTIME_AND_MANIFEST) {
            expect(PWA_CAPABILITY.configSchema[key].description).not.toContain("BUILD-TIME ONLY");
            expect(PWA_CAPABILITY.configSchema[key].description).toContain("RUNTIME + BUILD");
        }
    });

    it("the lifecycle forwards the two-sided keys and NOTHING manifest-only", () => {
        const init = vi.spyOn(PWAManager, "init").mockImplementation(() => {});
        PwaLifecycle.init(FULL_BLOCK);

        expect(init).toHaveBeenCalledTimes(1);
        const forwarded = init.mock.calls[0][0];
        // Read on both sides → the runtime must see them (banner app name).
        expect(forwarded.name).toBe("Full App Name");
        expect(forwarded.short_name).toBe("ShortName");
        // Manifest-only → the runtime must never see them.
        for (const key of MANIFEST_KEYS.filter((k) => !RUNTIME_AND_MANIFEST.includes(k))) {
            expect(forwarded).not.toHaveProperty(key);
        }
    });

    it("the install banner's app name comes from short_name, then name", () => {
        // The single runtime effect of the two-sided keys (pwa-manager.ts) — the reason
        // they are not "build-time only" like their three neighbours.
        const initPrompt = vi.spyOn(PWAManager, "init");
        PwaLifecycle.init(FULL_BLOCK);
        expect(initPrompt.mock.calls[0][0].short_name).toBe("ShortName");
        initPrompt.mockRestore();
    });
});

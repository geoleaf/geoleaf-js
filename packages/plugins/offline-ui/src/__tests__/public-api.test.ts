/**
 * Witness — what `public-api.ts` declares is what `ui/cache-button.ts` mounts.
 *
 * The consumer-contract gate resolves `provider: "plugin:offline-ui"` paths by reading
 * `buildPublicApi()` and `PUBLIC_API_MOUNT` at the AST. That read is only worth something if
 * the mounted object really carries those members and really delegates: this file is the
 * runtime half of the declaration.
 */
import { vi, describe, test, expect } from "vitest";

type Mounted = Record<string, unknown> & {
    openModal: () => unknown;
    Modules: { ModalManager: { openModal: () => unknown } };
};

/** Loads a fresh module graph on a namespace carrying the core's `UI` façade. */
async function mount() {
    vi.resetModules();
    const g = globalThis as unknown as { GeoLeaf?: Record<string, unknown> };
    g.GeoLeaf = { UI: {} };
    const api = await import("../public-api.js");
    await import("../ui/cache-button.js");
    const mounted = api.PUBLIC_API_MOUNT.split(".").reduce<unknown>(
        (o, k) => (o as Record<string, unknown> | undefined)?.[k],
        g.GeoLeaf
    ) as Mounted | undefined;
    return { api, mounted };
}

describe("public-api — the declared facade is the mounted one", () => {
    test("every declared member is on the object at the mount point", async () => {
        const { api, mounted } = await mount();

        expect(api.PUBLIC_API_MOUNT).toBe("UI.CacheButton");
        expect(mounted).toBeTruthy();
        const declared = Object.keys(api.buildPublicApi());
        expect(declared.length).toBeGreaterThan(0);
        for (const member of declared) {
            expect(typeof mounted?.[member], `UI.CacheButton.${member}`).toBe("function");
        }
    });

    test("openModal on the mounted object delegates to the modal manager", async () => {
        const { mounted } = await mount();
        if (!mounted) throw new Error("UI.CacheButton is not mounted");
        const spy = vi
            .spyOn(mounted.Modules.ModalManager, "openModal")
            .mockImplementation(() => undefined);

        mounted.openModal();

        expect(spy).toHaveBeenCalledTimes(1);
    });
});

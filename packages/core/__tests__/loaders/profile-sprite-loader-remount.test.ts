/**
 * Witness — the profile sprite belongs to the application that injected it.
 *
 * ## What this file pins
 *
 * `GeoLeaf.mount()` / `unmount()` / `mount()` of another profile: the sprite loader inserted the
 * first profile's `<svg data-geoleaf-sprite="profile">` into `document.body`, nothing removed it
 * when that application was torn down, and the presence guard then skipped the next profile's
 * injection. The second application inherited the first one's symbols and never loaded its own —
 * its POI layers drew no icon at all.
 *
 * The teardown is driven through the real `ConfigModule.destroy()`, the one `unmount()` reaches
 * through `ModuleRegistry.destroy()`: a module that stops calling the reset is caught here — not
 * only a reset that does the wrong thing. And the lifecycle seam alone (`Core.destroy()` without
 * an unmount) must leave the sprite: the legend and the other modules live on and point at it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ensureProfileSpriteInjectedSync, isProfileSpriteReady } =
    await import("../../src/utils/loaders/profile-sprite-loader.ts");
const { runLifecycleTeardowns } = await import("../../src/kernel/shared/lifecycle.ts");
const { ConfigModule } = await import("../../src/app/boot-modules/config.module.ts");

/** What `unmount()` does to the profile's state: the config module's teardown. */
function unmountApplication(): void {
    new ConfigModule().destroy();
}
const { ensureGeoLeaf } = await import("../../src/utils/general/geoleaf-global.ts");

const SPRITES: Record<string, string> = {
    "https://sprites.example.test/a.svg":
        '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="ra-star" viewBox="0 0 1 1"/></svg>',
    "https://sprites.example.test/b.svg":
        '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="rb-diamond" viewBox="0 0 1 1"/></svg>',
};

const GeoLeaf = ensureGeoLeaf() as unknown as Record<string, unknown>;
const savedTaxonomy = GeoLeaf["Taxonomy"];

/** Makes `spriteUrl` the active profile's sprite, as the taxonomy capability reports it. */
function activateProfile(spriteUrl: string): void {
    GeoLeaf["Taxonomy"] = { getIcons: () => ({ spriteUrl }) };
}

function spriteRoots(): Element[] {
    return Array.from(document.querySelectorAll("svg[data-geoleaf-sprite]"));
}

function symbolIds(): string[] {
    return spriteRoots().flatMap((root) =>
        Array.from(root.querySelectorAll("symbol[id]")).map((s) => s.id)
    );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => SPRITES[url] ?? "",
    }));
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    unmountApplication();
    for (const root of spriteRoots()) root.remove();
    GeoLeaf["Taxonomy"] = savedTaxonomy;
    vi.unstubAllGlobals();
});

describe("profile sprite — mount, unmount, mount of another profile", () => {
    it("a single boot injects the sprite once, however many layers ask", async () => {
        activateProfile("https://sprites.example.test/a.svg");
        await Promise.all([
            ensureProfileSpriteInjectedSync(),
            ensureProfileSpriteInjectedSync(),
            ensureProfileSpriteInjectedSync(),
        ]);
        await ensureProfileSpriteInjectedSync();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(spriteRoots()).toHaveLength(1);
        expect(symbolIds()).toEqual(["ra-star"]);
    });

    it("the teardown removes the sprite its application injected", async () => {
        activateProfile("https://sprites.example.test/a.svg");
        await ensureProfileSpriteInjectedSync();
        expect(isProfileSpriteReady()).toBe(true);

        unmountApplication();

        expect(spriteRoots()).toHaveLength(0);
        expect(isProfileSpriteReady()).toBe(false);
    });

    it("the next profile gets its own sprite, and none of the previous one's", async () => {
        activateProfile("https://sprites.example.test/a.svg");
        await ensureProfileSpriteInjectedSync();
        unmountApplication();

        activateProfile("https://sprites.example.test/b.svg");
        await ensureProfileSpriteInjectedSync();

        expect(spriteRoots()).toHaveLength(1);
        expect(symbolIds()).toEqual(["rb-diamond"]);
        expect(fetchMock).toHaveBeenLastCalledWith("https://sprites.example.test/b.svg");
    });

    it("an injection still in flight at the teardown inserts nothing afterwards", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        fetchMock.mockImplementationOnce(async (url: string) => {
            await gate;
            return { ok: true, status: 200, text: async () => SPRITES[url] ?? "" };
        });

        activateProfile("https://sprites.example.test/a.svg");
        const pending = ensureProfileSpriteInjectedSync();
        unmountApplication();
        release();
        await pending;

        expect(spriteRoots()).toHaveLength(0);

        // …and the next application is not left joining the stale injection.
        activateProfile("https://sprites.example.test/b.svg");
        await ensureProfileSpriteInjectedSync();
        expect(symbolIds()).toEqual(["rb-diamond"]);
    });

    it("Core.destroy() alone — the lifecycle seam, no unmount — leaves the sprite", async () => {
        activateProfile("https://sprites.example.test/a.svg");
        await ensureProfileSpriteInjectedSync();

        runLifecycleTeardowns();

        expect(symbolIds()).toEqual(["ra-star"]);
    });

    it("leaves a sprite root the host put there itself", async () => {
        const hostRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        hostRoot.setAttribute("data-geoleaf-sprite", "host");
        document.body.appendChild(hostRoot);

        activateProfile("https://sprites.example.test/a.svg");
        await ensureProfileSpriteInjectedSync();
        unmountApplication();

        expect(spriteRoots()).toEqual([hostRoot]);
    });
});

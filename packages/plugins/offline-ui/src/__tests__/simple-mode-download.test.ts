/**
 * The field window prepares a zone on its own — `openModal({ mode: "simple" })` opened first.
 *
 * The simple body builds no purge button. The assembler (`cache-control.ts`) used to hand the
 * download handler its elements only when that button existed, so a simple window opened FIRST
 * left the handler without a download button: « Télécharger » threw « Cannot set properties of
 * null (setting 'disabled') » at every click. Opened after the full window, it worked — on the
 * references the other body had left behind.
 *
 * The control is built through the real assembler, clicked through its real DOM.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

// ⚠️ WITHOUT extension — the cross-plugin alias stubs `../cache/cache-control.js`.
import { CacheControl } from "../cache/cache-control";
import { DownloadHandler } from "../cache/download-handler.js";

// The global the plugin reads, typed loosely: these doubles stand in for the core's facades.
const G = globalThis as unknown as { GeoLeaf?: any };

let notif: Record<string, ReturnType<typeof vi.fn>>;
let cacheProfile: ReturnType<typeof vi.fn>;

beforeEach(() => {
    document.body.innerHTML = "";
    G.GeoLeaf = G.GeoLeaf ?? {};
    const cfg: Record<string, unknown> = {
        "data.activeProfile": "prof-1",
        "modules.offline.enabled": true,
        "modules.pwa.enabled": true,
    };
    G.GeoLeaf.Config = { get: (k: string, fb: unknown) => (k in cfg ? cfg[k] : fb) };
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    G.GeoLeaf._UINotifications = notif;
    cacheProfile = vi.fn(async () => ({ resourcesCount: 5, totalSize: 2_097_152 }));
    G.GeoLeaf.Storage = {
        isPluginLoaded: () => true,
        isAvailable: () => true,
        CacheManager: { cacheProfile, clearCache: vi.fn(async () => 0) },
        Cache: {
            Storage: { loadLayerSelection: vi.fn(async () => ({ totalEstimatedSize: 1_048_576 })) },
        },
    };
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (G.GeoLeaf) {
        G.GeoLeaf.Storage = undefined;
        G.GeoLeaf._UINotifications = undefined;
    }
});

/** Mounts a control in `mode`, clicks « Télécharger », lets every timer run. */
async function clickDownload(mode: "simple" | "full") {
    const ctrl = CacheControl.create({ mode });
    if (!ctrl) throw new Error("CacheControl.create returned no control");
    const container = ctrl.onAdd({ id: "map" });
    document.body.appendChild(container);
    const btn = container.querySelector<HTMLButtonElement>("#gl-cache-download");
    expect(btn).toBeTruthy();
    btn!.click();
    await vi.runAllTimersAsync();
    return { ctrl, container, btn: btn! };
}

describe("fenêtre simple ouverte en premier — « Télécharger » prépare la zone", () => {
    test("le mode simple seul télécharge, sans erreur, et rend le bouton", async () => {
        vi.useFakeTimers();
        const { container, btn } = await clickDownload("simple");

        // The simple body has no purge button: the guard must not depend on one.
        expect(container.querySelector("#gl-cache-clear")).toBeNull();
        expect(notif.error).not.toHaveBeenCalled();
        expect(cacheProfile).toHaveBeenCalledWith("prof-1", expect.any(Object));
        expect(notif.success).toHaveBeenCalled();
        expect(btn.disabled).toBe(false);
    });

    test("complet puis simple : le gestionnaire pilote le bouton du corps simple, pas l'ancien", async () => {
        vi.useFakeTimers();
        const full = CacheControl.create({ mode: "full" });
        if (!full) throw new Error("CacheControl.create returned no control");
        full.onAdd({ id: "map" });
        full.onRemove({ id: "map" });

        const { btn } = await clickDownload("simple");

        expect(notif.error).not.toHaveBeenCalled();
        expect(cacheProfile).toHaveBeenCalledTimes(1);
        // The handler drives THIS body's button, and holds no purge button the body lacks.
        expect(DownloadHandler._downloadBtn).toBe(btn);
        expect(DownloadHandler._clearBtn).toBeNull();
        expect(btn.disabled).toBe(false);
    });
});

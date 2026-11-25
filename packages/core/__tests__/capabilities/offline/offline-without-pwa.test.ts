/**
 * `offline` embarked without `pwa` is refused at boot, and says why.
 *
 * The engine was loaded on `modules.pwa.enabled` read from the configuration — never on `pwa`
 * being in the bundle. A hand-written manifest with `offline` and no `pwa` started the engine,
 * the banner and the outbox with no service worker: reopened off-network, the page did not exist,
 * and nothing had said so. Only the generated entries refused that list. Red on the code before
 * the fix: the engine was loaded.
 *
 * Switched off by the configuration (`modules.pwa.enabled: false`, `pwa` embarked), the engine
 * stays unloaded SILENTLY — that is the documented double gate, not a defect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OFFLINE_INSTALLER } from "../../../src/capabilities/offline/install.js";
import { OFFLINE_CAPABILITY } from "../../../src/capabilities/offline/offline-capability.js";
import { PWA_CAPABILITY } from "../../../src/capabilities/pwa/pwa-capability.js";
import { OfflineLifecycle } from "../../../src/capabilities/offline/lifecycle.js";
import { CapabilityRegistry } from "../../../src/kernel/api/index.js";
import { Log } from "../../../src/utils/log/index.js";
import type { SharedLifecycleContext } from "../../../src/contracts/preset.contract.js";

const CONFIG = { modules: { offline: { enabled: true }, pwa: { enabled: true } } };

function run(config: Record<string, unknown> = CONFIG): ReturnType<typeof vi.fn> {
    const storage = { init: vi.fn(() => Promise.resolve()) };
    OFFLINE_INSTALLER.sharedLifecycle?.({
        GeoLeaf: { Storage: storage },
        config,
    } as unknown as SharedLifecycleContext);
    return storage.init;
}

let ensure: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    CapabilityRegistry._reset();
    CapabilityRegistry.register(OFFLINE_CAPABILITY);
    ensure = vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
    error = vi.spyOn(Log, "error").mockImplementation(() => {});
});

afterEach(() => {
    OfflineLifecycle._reset();
    CapabilityRegistry._reset();
    vi.restoreAllMocks();
});

describe("offline sans pwa dans le bundle", () => {
    it("le moteur n'est pas chargé, et une erreur dit pourquoi", () => {
        run();
        expect(ensure).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledTimes(1);
        expect(String(error.mock.calls[0]?.[0])).toMatch(/pwa/);
    });

    it("pwa embarquée et allumée : le moteur est chargé (inchangé)", () => {
        CapabilityRegistry.register(PWA_CAPABILITY);
        run();
        expect(ensure).toHaveBeenCalledWith("offline");
        expect(error).not.toHaveBeenCalled();
    });

    it("pwa embarquée mais éteinte par la configuration : pas de moteur, sans erreur", () => {
        CapabilityRegistry.register(PWA_CAPABILITY);
        run({ modules: { offline: { enabled: true }, pwa: { enabled: false } } });
        expect(ensure).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});

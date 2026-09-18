/**
 * Witness — a resource the profile DECLARES and cannot obtain is signalled.
 *
 * ## What this file pins
 *
 * Every loader of `kernel/config/profile-loader.ts` catches its own failure and returns `null`.
 * The catch used to END the story: the profile counted as loaded, `geoleaf:profile:loaded`
 * fired with no flag, and on the bundle path a declared section that the bundle compiler had
 * skipped was not even an error. Each case below was seen RED on that code.
 *
 * The real `ProfileManager` and `ProfileLoader` run; only the network
 * (`ConfigLoader.fetchJson`) is scripted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));

vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { fetchJson: fetchJsonMock },
}));

const { ProfileManager } = await import("../../src/kernel/config/profile.ts");
const { getProfileLoadReport } = await import("../../src/kernel/config/profile-load-report.ts");

type ProfileConfig = Parameters<typeof ProfileManager.init>[0];

/**
 * Scripts the network: a path suffix answers a JSON body, or rejects with an Error. Any
 * other request answers like a server that does not have the file.
 */
function serve(responses: Record<string, unknown>): void {
    fetchJsonMock.mockImplementation(async (url: string) => {
        const path = url.split("?")[0] ?? url;
        for (const [suffix, body] of Object.entries(responses)) {
            if (path.endsWith(suffix)) {
                if (body instanceof Error) throw body;
                return body;
            }
        }
        throw new Error(`HTTP 404 pour ${url}`);
    });
}

/** A modular profile declaring one required section and one plugin configuration. */
const MODULAR = {
    id: "demo",
    version: "1.0.0",
    map: { center: [45, 5], zoom: 6 },
    Files: {
        uiFile: "config/core/ui.json",
        modules: { legend: "config/plugins/legend.json" },
    },
};

interface Signal {
    name: string;
    detail: unknown;
}

const disposers: (() => void)[] = [];

/** Records both profile signals, in the order they reach `document`. */
function recordSignals(): Signal[] {
    const signals: Signal[] = [];
    for (const name of ["geoleaf:profile:failed", "geoleaf:profile:loaded"]) {
        const handler = (event: Event) =>
            signals.push({ name, detail: (event as CustomEvent).detail });
        document.addEventListener(name, handler);
        disposers.push(() => document.removeEventListener(name, handler));
    }
    return signals;
}

beforeEach(() => {
    fetchJsonMock.mockReset();
    ProfileManager.reset();
    ProfileManager.init({
        data: { activeProfile: "demo", profilesBasePath: "profiles" },
    } as unknown as ProfileConfig);
});

afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
});

describe("declared profile resources that cannot be obtained", () => {
    it("a declared plugin configuration that 404s → geoleaf:profile:failed, BEFORE geoleaf:profile:loaded", async () => {
        serve({
            "profile.json": MODULAR,
            "config/core/ui.json": {},
            "config/plugins/legend.json": new Error(
                "HTTP 404 pour profiles/demo/config/plugins/legend.json?t=0"
            ),
        });
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals.map((s) => s.name)).toEqual([
            "geoleaf:profile:failed",
            "geoleaf:profile:loaded",
        ]);
        expect(signals[0]?.detail).toEqual({
            profileId: "demo",
            fatal: false,
            failures: [
                {
                    resource: "Files.modules.legend",
                    url: "profiles/demo/config/plugins/legend.json?t=0",
                    required: false,
                    message: expect.stringContaining("404"),
                },
            ],
        });
    });

    it("a declared REQUIRED section that fails is reported as required — and the load is not fatal", async () => {
        serve({
            "profile.json": MODULAR,
            "config/core/ui.json": new Error("Erreur de parsing JSON"),
            "config/plugins/legend.json": {},
        });
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals[0]?.detail).toMatchObject({
            fatal: false,
            failures: [{ resource: "Files.uiFile", required: true }],
        });
        expect(getProfileLoadReport().fatal).toBe(false);
    });

    it("an optional file the profile does not declare is not a failure", async () => {
        serve({
            "profile.json": { ...MODULAR, Files: { uiFile: "config/core/ui.json" } },
            "config/core/ui.json": {},
        });
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals.map((s) => s.name)).toEqual(["geoleaf:profile:loaded"]);
        expect(getProfileLoadReport().failures).toEqual([]);
    });

    it("on the bundle path, a declared section the bundle does not carry is a failure", async () => {
        serve({
            "profile.json": { ...MODULAR, bundleFile: "profile-bundle.json" },
            "profile-bundle.json": { ui: {} },
        });
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals[0]?.detail).toMatchObject({
            fatal: false,
            failures: [
                {
                    resource: "Files.modules.legend",
                    required: false,
                    message: expect.stringContaining("bundle"),
                },
            ],
        });
    });

    it("a bundle that fails while its cascade fallback succeeds is recovered, not reported", async () => {
        serve({
            "profile.json": { ...MODULAR, bundleFile: "profile-bundle.json" },
            "profile-bundle.json": new Error("HTTP 404 pour profiles/demo/profile-bundle.json?t=0"),
            "config/core/ui.json": {},
            "config/plugins/legend.json": {},
        });
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals.map((s) => s.name)).toEqual(["geoleaf:profile:loaded"]);
    });

    it("profile.json that 404s is FATAL — and geoleaf:profile:loaded does not follow", async () => {
        serve({});
        const signals = recordSignals();

        await ProfileManager.loadActiveProfileResources();

        expect(signals.map((s) => s.name)).toEqual(["geoleaf:profile:failed"]);
        expect(signals[0]?.detail).toMatchObject({
            profileId: "demo",
            fatal: true,
            failures: [{ resource: "profile.json", required: true }],
        });
        expect(getProfileLoadReport().fatal).toBe(true);
    });

    it("a host that cancels geoleaf:profile:failed is recorded in the report", async () => {
        serve({
            "profile.json": MODULAR,
            "config/core/ui.json": {},
            "config/plugins/legend.json": new Error("HTTP 404"),
        });
        const cancel = (event: Event) => event.preventDefault();
        document.addEventListener("geoleaf:profile:failed", cancel);
        disposers.push(() => document.removeEventListener("geoleaf:profile:failed", cancel));

        await ProfileManager.loadActiveProfileResources();

        expect(getProfileLoadReport().prevented).toBe(true);
    });
});

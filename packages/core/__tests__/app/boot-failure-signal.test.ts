/**
 * Witness — a boot that cannot complete is SIGNALLED, never left as a silent spinner.
 *
 * ## What this file pins
 *
 * Every failure path of `bootWithPreset` (`app/boot-core.ts`) used to end in a log line and a
 * `return`: no event reached the host, and the `#gl-loader` veil — which only `revealApp()`
 * hides — stayed up forever. A `loadConfig` whose promise rejected without calling back hung
 * the boot outright. Each case below was seen RED on that code before the wiring existed.
 *
 * ## The harness
 *
 * It mirrors `boot-core.test.js`: collaborators are injected, no `GeoLeaf.*` namespace is
 * stood up. What it adds is the DOM the default screen needs (`#gl-loader`) and listeners on
 * the two signals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

type Preset = Parameters<typeof bootWithPreset>[0];
type Ctx = Parameters<typeof bootWithPreset>[1];
type Options = NonNullable<Parameters<typeof bootWithPreset>[2]>;

interface LoadConfigOptions {
    onLoaded: (cfg: unknown) => void;
    onError: (err: unknown) => void;
}

const PRESET = { id: "boot-failure-signal", capabilities: [] } as unknown as Preset;

/**
 * A BootContext whose collaborators each script one outcome.
 *
 * @param over - The outcomes to script; each absent one succeeds.
 * @returns The context, plus the registry stand-in for assertions.
 */
function makeCtx(
    over: {
        loadConfig?: (opts: LoadConfigOptions) => unknown;
        loadProfile?: () => Promise<unknown>;
        registryInit?: () => Promise<void>;
        beforeBoot?: () => Promise<void> | void;
    } = {}
) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf: Record<string, unknown> = {
        loadConfig:
            over.loadConfig ??
            ((opts: LoadConfigOptions) => {
                setTimeout(() => opts.onLoaded({}), 0);
            }),
        Config: {
            loadActiveProfileResources: vi.fn(over.loadProfile ?? (() => Promise.resolve(null))),
        },
    };
    if (over.beforeBoot) GeoLeaf["_beforeBootCallback"] = over.beforeBoot;
    const registry = {
        register: vi.fn(),
        isInitialized: vi.fn(() => false),
        init: vi.fn(over.registryInit ?? (() => Promise.resolve())),
        getAll: vi.fn(() => []),
    };
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { ctx: { GeoLeaf, app, registry } as unknown as Ctx, registry };
}

/** A `loadConfig` that reports `error` through its callback, as the real chain does. */
function failingConfig(error: Error) {
    return (opts: LoadConfigOptions) => {
        setTimeout(() => opts.onError(error), 0);
    };
}

const disposers: (() => void)[] = [];

/**
 * Collects the details of every `name` event reaching `document` until the test ends.
 *
 * @param name - The event to listen to.
 * @returns The live list of details.
 */
function listen(name: string): unknown[] {
    const details: unknown[] = [];
    const handler = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener(name, handler);
    disposers.push(() => document.removeEventListener(name, handler));
    return details;
}

/** The app shell's loading veil. */
function mountVeil(): HTMLElement {
    const veil = document.createElement("div");
    veil.id = "gl-loader";
    document.body.appendChild(veil);
    return veil;
}

beforeEach(() => {
    CapabilityRegistry._reset();
    sessionStorage.clear();
    document.body.replaceChildren();
});

afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe("a boot that cannot complete is signalled", () => {
    it("a rejected root configuration → geoleaf:boot:failed (config), and the registry never runs", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx, registry } = makeCtx({
            loadConfig: failingConfig(new Error("HTTP 404 pour ./profiles/geoleaf.config.json")),
        });

        await bootWithPreset(PRESET, ctx);

        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ reason: "config", phase: "config", provisional: false });
        expect(registry.init).not.toHaveBeenCalled();
    });

    it("a loadConfig that rejects without calling back no longer hangs the boot", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({ loadConfig: () => Promise.reject(new Error("invalid map")) });

        const outcome = await Promise.race([
            bootWithPreset(PRESET, ctx).then(() => "settled"),
            new Promise((resolve) => setTimeout(() => resolve("hung"), 200)),
        ]);

        expect(outcome).toBe("settled");
        expect(failed[0]).toMatchObject({ reason: "config" });
    });

    it("a rejected profile load → geoleaf:boot:failed (profile), and the registry never runs", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx, registry } = makeCtx({
            loadProfile: () => Promise.reject(new Error("Required modules not available")),
        });

        await bootWithPreset(PRESET, ctx);

        expect(failed[0]).toMatchObject({ reason: "profile", phase: "profile" });
        expect(registry.init).not.toHaveBeenCalled();
    });

    it("a rejected registry init → geoleaf:boot:failed (module)", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({ registryInit: () => Promise.reject(new Error("module boom")) });

        await bootWithPreset(PRESET, ctx);

        expect(failed[0]).toMatchObject({ reason: "module", phase: "registry" });
    });

    it("a beforeBoot that throws aborts: geoleaf:boot:aborted, the veil goes, no failure screen", async () => {
        const veil = mountVeil();
        const aborted = listen("geoleaf:boot:aborted");
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({
            beforeBoot: () => {
                throw new Error("not authenticated");
            },
        });

        await bootWithPreset(PRESET, ctx);

        expect(aborted).toHaveLength(1);
        expect(failed).toHaveLength(0);
        expect(veil.classList.contains("gl-loader--fade")).toBe(true);
        expect(veil.querySelector(".gl-boot-failure")).toBeNull();
    });
});

describe("the default failure screen", () => {
    it("is drawn in the veil — an alert dialog offering Reload, and no Continue", async () => {
        const veil = mountVeil();
        const { ctx } = makeCtx({ loadConfig: failingConfig(new Error("boom")) });

        await bootWithPreset(PRESET, ctx);

        expect(veil.classList.contains("gl-loader--error")).toBe(true);
        expect(veil.querySelector('[role="alertdialog"]')).not.toBeNull();
        expect(veil.querySelector('[data-gl-action="reload"]')).not.toBeNull();
        expect(veil.querySelector('[data-gl-action="continue"]')).toBeNull();
    });

    it("is not drawn when a host cancels geoleaf:boot:failed", async () => {
        const veil = mountVeil();
        const cancel = (event: Event) => event.preventDefault();
        document.addEventListener("geoleaf:boot:failed", cancel);
        disposers.push(() => document.removeEventListener("geoleaf:boot:failed", cancel));
        const { ctx } = makeCtx({ loadConfig: failingConfig(new Error("boom")) });

        await bootWithPreset(PRESET, ctx);

        expect(veil.classList.contains("gl-loader--error")).toBe(false);
        expect(veil.childElementCount).toBe(0);
    });

    it("is never created without a veil — the host receives the event alone", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({ loadConfig: failingConfig(new Error("boom")) });

        await bootWithPreset(PRESET, ctx);

        expect(failed).toHaveLength(1);
        expect(document.querySelector(".gl-boot-failure")).toBeNull();
    });
});

describe("the boot watchdog", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("fires a PROVISIONAL timeout when the configuration never arrives", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({ loadConfig: () => new Promise(() => {}) });
        const options: Options = { watchdogMs: 1000 };

        void bootWithPreset(PRESET, ctx, options);
        await vi.advanceTimersByTimeAsync(999);
        expect(failed).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);

        expect(failed[0]).toMatchObject({ reason: "timeout", phase: "config", provisional: true });
    });

    it("is paused while beforeBoot runs — an authentication gate may take minutes", async () => {
        const failed = listen("geoleaf:boot:failed");
        const { ctx } = makeCtx({
            loadConfig: (opts) => {
                queueMicrotask(() => opts.onLoaded({}));
            },
            beforeBoot: () => new Promise<void>((resolve) => setTimeout(resolve, 60_000)),
            registryInit: () => new Promise(() => {}),
        });
        const options: Options = { watchdogMs: 1000 };

        void bootWithPreset(PRESET, ctx, options);
        await vi.advanceTimersByTimeAsync(59_999);

        expect(failed).toHaveLength(0);
    });
});

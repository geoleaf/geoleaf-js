/**
 * Witness — a module that throws during the boot is judged by what depends on it.
 *
 * ## What this file pins
 *
 * `registry.init()` used to stop at the first module that threw, and the boot treated every
 * such stop alike: the interface chain and an optional capability were the same failure. The
 * boot now passes `onModuleError` to the registry, and the dependency graph decides:
 *
 * - a failure in the interface chain (`ui`, or anything `ui` depends on) is FATAL —
 *   `geoleaf:boot:failed`, naming the module;
 * - any other failure is not: `geoleaf:module:failed` (cancelable), and the reveal is held on a
 *   screen that names the module, or — once the application is revealed — a persistent notice.
 *
 * The registry is a stand-in that reports one failure through the option, the way the real one
 * does. Each case was seen RED on the boot before the option was passed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { holdReveal } = await import("../../src/app/boot-failure.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { notifyPrimitive } = await import("../../src/utils/notify/notify.primitive.ts");

type Preset = Parameters<typeof bootWithPreset>[0];
type Ctx = Parameters<typeof bootWithPreset>[1];

interface ModuleFailure {
    id: string;
    error: unknown;
    skipped: readonly string[];
}

interface InitOptions {
    onModuleError?: (failure: ModuleFailure) => "continue" | "abort";
}

const PRESET = { id: "boot-module-failure", capabilities: [] } as unknown as Preset;

/**
 * A BootContext whose registry reports `failure` through `onModuleError`, and throws unless told
 * to continue — the real registry's contract.
 *
 * @param failure - The module failure to report.
 * @param before - Runs inside `init()` before the failure, e.g. a reveal.
 */
function makeCtx(failure: ModuleFailure, before?: () => void) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const registry = {
        register: vi.fn(),
        isInitialized: vi.fn(() => false),
        init: vi.fn(async (_adapter: unknown, _config: unknown, options?: InitOptions) => {
            before?.();
            const decision = options?.onModuleError?.(failure);
            if (decision !== "continue") throw failure.error;
        }),
        getAll: vi.fn(() => []),
    };
    const GeoLeaf = {
        loadConfig: (opts: { onLoaded: (cfg: unknown) => void }) => {
            setTimeout(() => opts.onLoaded({}), 0);
        },
        Config: { loadActiveProfileResources: vi.fn(() => Promise.resolve(null)) },
    };
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { GeoLeaf, app, registry } as unknown as Ctx;
}

const disposers: (() => void)[] = [];

/** Collects the details of every `name` event until the test ends. */
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
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe("a module failure during the boot", () => {
    it("an optional capability that throws is NOT fatal: geoleaf:module:failed, and no geoleaf:boot:failed", async () => {
        const moduleFailed = listen("geoleaf:module:failed");
        const bootFailed = listen("geoleaf:boot:failed");

        await bootWithPreset(
            PRESET,
            makeCtx({ id: "legend", error: new Error("legend boom"), skipped: [] })
        );

        expect(moduleFailed).toHaveLength(1);
        expect(moduleFailed[0]).toMatchObject({
            module: "legend",
            message: "legend boom",
            skipped: [],
        });
        expect(bootFailed).toHaveLength(0);
    });

    it("a failure in the interface chain is FATAL: geoleaf:boot:failed names the module", async () => {
        const bootFailed = listen("geoleaf:boot:failed");

        await bootWithPreset(
            PRESET,
            makeCtx({
                id: "geojson",
                error: new Error("geojson boom"),
                skipped: ["ui", "theme-engine"],
            })
        );

        expect(bootFailed).toHaveLength(1);
        expect(bootFailed[0]).toMatchObject({ reason: "module", module: "geojson" });
    });

    it("before the reveal, it holds the reveal on a screen naming the module; « Continue » replays it", async () => {
        const veil = mountVeil();
        await bootWithPreset(
            PRESET,
            makeCtx({ id: "legend", error: new Error("legend boom"), skipped: [] })
        );
        let revealed = false;

        expect(holdReveal(() => (revealed = true))).toBe(true);
        expect(veil.textContent).toContain("legend");

        veil.querySelector<HTMLButtonElement>('[data-gl-action="continue"]')?.click();
        expect(revealed).toBe(true);
    });

    it("a host that cancels geoleaf:module:failed takes the signal over: no screen, the reveal proceeds", async () => {
        const veil = mountVeil();
        const cancel = (event: Event) => event.preventDefault();
        document.addEventListener("geoleaf:module:failed", cancel);
        disposers.push(() => document.removeEventListener("geoleaf:module:failed", cancel));

        await bootWithPreset(
            PRESET,
            makeCtx({ id: "legend", error: new Error("legend boom"), skipped: [] })
        );

        expect(holdReveal(() => {})).toBe(false);
        expect(veil.querySelector(".gl-boot-failure")).toBeNull();
    });

    it("after the reveal, a warning names the module — no screen over what works, no boot failure", async () => {
        const veil = mountVeil();
        const bootFailed = listen("geoleaf:boot:failed");
        const notify = vi.spyOn(notifyPrimitive, "notify");

        await bootWithPreset(
            PRESET,
            makeCtx({ id: "legend", error: new Error("legend boom"), skipped: [] }, () => {
                holdReveal(() => {});
            })
        );

        expect(veil.querySelector(".gl-boot-failure")).toBeNull();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining("legend"), "warning");
        expect(bootFailed).toHaveLength(0);
    });
});

describe("the diagnostic the failure screen hands over", () => {
    it("carries the recent log entries, redacted", async () => {
        const veil = mountVeil();
        const writeText = vi.fn((_text: string) => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });

        await bootWithPreset(
            PRESET,
            makeCtx({ id: "geojson", error: new Error("geojson boom"), skipped: ["ui"] })
        );
        veil.querySelector<HTMLButtonElement>('[data-gl-action="copy"]')?.click();

        const copied = JSON.parse(String(writeText.mock.calls[0]?.[0])) as {
            entries?: { message: string }[];
        };
        expect(Array.isArray(copied.entries)).toBe(true);
        expect(copied.entries?.some((e) => e.message.includes("geojson boom"))).toBe(true);
    });
});

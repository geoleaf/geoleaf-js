/**
 * Config-contract Phase C / C1 — B1 root family: logging.level + debug (log level).
 *
 *   - @anomaly ANO-026: logging.level is wired (config-core _resolveLogLevel →
 *     Log.setLevel) but no profile ships it (capability-lock).
 *   - debug → log level: debug:true raises the level to "debug" when no explicit
 *     logging.level; logging.level always wins.
 *
 * Consumer: config/geoleaf-config/config-core.ts (_resolveLogLevel / _applyLoggingConfig).
 * Inventory B1.
 */

// vi.hoisted so mockLog exists when the (hoisted) vi.mock factory runs, before
// the static `import { Config }` triggers config-core's `import { Log }`.
const mockLog = vi.hoisted(() => ({
    setLevel: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";

const apply = (cfg) => Config.init({ config: cfg, autoEvent: false });

describe("config B1 — logging.level + debug (config-core)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the Config singleton between tests (deepMerge accumulates otherwise).
        Config._config = {};
        Config._isLoaded = false;
        Config._subModulesInitialized = false;
    });

    // ── @anomaly ANO-026 — logging.level (wired, 0 profile data) ─────────────
    describe("@anomaly ANO-026 — logging.level applied to Log.setLevel", () => {
        it.each(["debug", "info", "warn", "error", "production"])(
            "logging.level=%s is applied",
            async (level) => {
                await apply({ logging: { level } });
                expect(mockLog.setLevel).toHaveBeenCalledWith(level);
            }
        );

        it("defaults to 'info' when neither logging.level nor debug is set", async () => {
            await apply({});
            expect(mockLog.setLevel).toHaveBeenCalledWith("info");
        });
    });

    // ── debug → log level ────────────────────────────────────────────────────
    describe("debug flag → resolved log level", () => {
        it("debug:true (no explicit level) raises the level to 'debug'", async () => {
            await apply({ debug: true });
            expect(mockLog.setLevel).toHaveBeenCalledWith("debug");
        });

        it("debug:false (no explicit level) stays 'info'", async () => {
            await apply({ debug: false });
            expect(mockLog.setLevel).toHaveBeenCalledWith("info");
        });

        it("explicit logging.level wins over the debug flag", async () => {
            await apply({ debug: true, logging: { level: "warn" } });
            expect(mockLog.setLevel).toHaveBeenCalledWith("warn");
        });
    });
});

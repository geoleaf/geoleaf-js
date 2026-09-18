/**
 * Witness — the log keeps a bounded memory that support can read.
 *
 * ## What this file pins
 *
 * `utils/log/logger.ts` wrote to the console and nowhere else: on a field device, with no
 * developer tools, nothing a technician saw could be reported. The log now keeps a record of
 * recent entries (`utils/log/log-record.ts`) — warnings and errors always, debug only when the
 * level asks for it — fed by `Log`, by the boot's `AppLog` and by the global `error` /
 * `unhandledrejection` events, and read back REDACTED.
 *
 * Every case loads fresh modules (`vi.resetModules`): the record is module state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type LoggerModule = typeof import("../../src/utils/log/logger.ts");
type RecordModule = typeof import("../../src/utils/log/log-record.ts");

let logger: LoggerModule;
let record: RecordModule;

beforeEach(async () => {
    vi.resetModules();
    logger = await import("../../src/utils/log/logger.ts");
    record = await import("../../src/utils/log/log-record.ts");
    for (const method of ["debug", "info", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation(() => {});
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

const messages = () => logger.Log.getEntries().map((entry) => entry.message);

describe("Log — the ring of recent entries", () => {
    it("records warnings and errors even below the console threshold", () => {
        logger.Log.setLevel("error");
        logger.Log.warn("[X] hidden from the console");
        logger.Log.error("[X] shown");

        const entries = logger.Log.getEntries();
        expect(entries.map((e) => e.level)).toEqual(["warn", "error"]);
        expect(entries.every((e) => e.source === "log")).toBe(true);
    });

    it("records debug only when the level is DEBUG", () => {
        logger.Log.setLevel("info");
        logger.Log.debug("[X] not recorded");
        logger.Log.setLevel("debug");
        logger.Log.debug("[X] recorded");

        expect(messages()).toEqual([expect.stringContaining("[X] recorded")]);
    });

    it("keeps the latest 500 entries, dropping the oldest", () => {
        for (let i = 0; i < 510; i++) logger.Log.warn(`[X] w${i}`);

        const kept = messages();
        expect(kept).toHaveLength(500);
        expect(kept[0]).toContain("[X] w10");
        expect(kept.at(-1)).toContain("[X] w509");
    });

    it("reduces an Error to its name, its message and three stack lines", () => {
        logger.Log.error("[X] failed:", new Error("boom"));

        const [message] = messages();
        expect(message).toContain("Error: boom");
        expect((message ?? "").split("\n").length).toBeLessThanOrEqual(5);
    });

    it("summarises a GeoJSON feature instead of dumping its attributes", () => {
        logger.Log.warn("[X] feature", { type: "Feature", id: 7, properties: { owner: "Jane" } });

        const [message] = messages();
        expect(message).toContain("[Feature id=7]");
        expect(message).not.toContain("Jane");
    });

    it("redacts secrets when entries are read", () => {
        logger.Log.warn("[X] GET https://tiles.example.test/a.png?access_token=s3cr3t");

        const [message] = messages();
        expect(message).not.toContain("s3cr3t");
        expect(message).toContain("[redacted]");
    });

    it("exportDiagnostic() is JSON carrying the redacted entries", () => {
        logger.Log.warn("[X] GET https://tiles.example.test/a.png?key=ABC123");

        const diagnostic = JSON.parse(logger.Log.exportDiagnostic()) as {
            format: string;
            entries: { message: string }[];
        };
        expect(diagnostic.format).toBe("geoleaf-log");
        expect(diagnostic.entries).toHaveLength(1);
        expect(diagnostic.entries[0]?.message).not.toContain("ABC123");
    });
});

describe("captureGlobalErrors — uncaught errors reach the ring", () => {
    it("records `error` and `unhandledrejection`, once each even when installed twice", () => {
        const target = new EventTarget();
        record.captureGlobalErrors(target);
        record.captureGlobalErrors(target);

        const error = new Event("error");
        Object.assign(error, { message: "boom global", error: new Error("boom global") });
        target.dispatchEvent(error);
        const rejection = new Event("unhandledrejection");
        Object.assign(rejection, { reason: new Error("rejected promise") });
        target.dispatchEvent(rejection);

        const globals = logger.Log.getEntries().filter((e) => e.source === "global");
        expect(globals).toHaveLength(2);
        expect(globals[0]?.message).toContain("boom global");
        expect(globals[1]?.message).toContain("rejected promise");
    });
});

describe("AppLog — the boot logger feeds the same ring", () => {
    it("an AppLog warning is recorded with source `app`", async () => {
        const { ensureGeoLeaf } = await import("../../src/utils/general/geoleaf-global.ts");
        await import("../../src/app/app-namespace.ts");
        const app = ensureGeoLeaf()._app as { AppLog: { warn: (...args: unknown[]) => void } };

        app.AppLog.warn("[Registry] init() failed:", new Error("module boom"));

        const entries = logger.Log.getEntries().filter((e) => e.source === "app");
        expect(entries).toHaveLength(1);
        expect(entries[0]?.message).toContain("module boom");
    });
});

/**
 * The write session reader's slot, and the façade that fills it (`GeoLeaf.Sync`).
 *
 * The core authenticates nothing: whoever holds the token — the connector, or a host handing
 * its own over — registers a reader here, and `Storage.preflight()` reads it back. One slot:
 * a page has one write session to report.
 */
import { beforeEach, describe, expect, it } from "vitest";

const { SessionReaderContract } = await import("../../src/kernel/shared/session-reader-seam.js");
const { Sync } = await import("../../src/api/geoleaf.sync.js");

beforeEach(() => SessionReaderContract._reset());

describe("SessionReaderContract", () => {
    it("is empty until someone registers", () => {
        expect(SessionReaderContract._get()).toBeNull();
    });

    it("keeps ONE reader: the last registration wins", () => {
        const first = () => null;
        const second = () => ({ state: "absent" as const, expiresAt: null });
        SessionReaderContract.register(first);
        SessionReaderContract.register(second);
        expect(SessionReaderContract._get()).toBe(second);
    });

    it("null empties the slot", () => {
        SessionReaderContract.register(() => null);
        SessionReaderContract.register(null);
        expect(SessionReaderContract._get()).toBeNull();
    });
});

describe("GeoLeaf.Sync.registerSessionReader", () => {
    it("is mounted on the global, where a plugin reaches it without importing the core", () => {
        const host = globalThis as { GeoLeaf?: { Sync?: Record<string, unknown> } };
        expect(typeof host.GeoLeaf?.Sync?.["registerSessionReader"]).toBe("function");
    });

    it("fills the slot the pre-departure check reads, and null empties it", () => {
        const reader = () => ({ state: "valid" as const, expiresAt: 1 });
        Sync.registerSessionReader(reader);
        expect(SessionReaderContract._get()).toBe(reader);
        Sync.registerSessionReader(null);
        expect(SessionReaderContract._get()).toBeNull();
    });
});

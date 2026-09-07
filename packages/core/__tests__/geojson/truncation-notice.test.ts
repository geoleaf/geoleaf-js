/**
 * @tests built-in/geojson/loader/truncation-notice
 *
 * 🛑 THE DEFECT THIS GUARDS IS A SILENCE, and silences do not fail tests by themselves.
 * `ogc-api-loader.ts` has carried a `truncated` member since 19/08/2026, correct and
 * documented — and read by exactly one module, which turned it into a boolean nobody
 * displayed. Every suite in this repository was green throughout. What follows asserts
 * that the signal reaches a surface, and that it does so ONCE.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const notify = vi.fn();
vi.mock("../../src/utils/notify/notify.primitive.js", () => ({
    notifyPrimitive: { notify },
}));

type Facts = { limit: number; fetched: number; matched?: number };
let announceTruncation: (id: string, label: string, t: Facts | undefined) => boolean;
let resetTruncationNotices: () => void;

beforeAll(async () => {
    const mod = await import("../../src/kernel/geojson/loader/truncation-notice.ts");
    announceTruncation = mod.announceTruncation;
    resetTruncationNotices = mod.resetTruncationNotices;
});

beforeEach(() => {
    notify.mockClear();
    resetTruncationNotices();
});

describe("announceTruncation — le témoin qui n'atteignait personne", () => {
    it("se tait quand rien n'a été coupé", () => {
        expect(announceTruncation("sites", "Sites", undefined)).toBe(false);
        expect(notify).not.toHaveBeenCalled();
    });

    it("annonce « N sur M » quand la source a DONNÉ son total", () => {
        const said = announceTruncation("sites", "Sites Rosario", {
            limit: 10000,
            fetched: 10999,
            matched: 31337,
        });

        expect(said).toBe(true);
        expect(notify).toHaveBeenCalledTimes(1);
        const [message, level] = notify.mock.calls[0] ?? [];
        expect(level).toBe("warning");
        expect(message).toContain("Sites Rosario");
        expect(message).toContain("10000");
        expect(message).toContain("31337");
        // 🛑 `fetched` must NOT appear. It is what the loop had accumulated when the cap
        // stopped it — one page past the bound — so "10000 sur 10999" would be a
        // precise-looking lie about a layer holding 31 337.
        expect(message).not.toContain("10999");
    });

    it("ne FABRIQUE pas de total quand le serveur n'en sert pas", () => {
        announceTruncation("sites", "Sites", { limit: 5000, fetched: 5999 });

        const [message] = notify.mock.calls[0] ?? [];
        expect(message).toContain("5000");
        // Neither the accumulated count nor an invented total: the message says the layer
        // holds more, and names no M at all.
        expect(message).not.toContain("5999");
    });

    it("ne prend pas `fetched` pour un total quand `matched` n'est pas plus grand que la borne", () => {
        // A server that serves `numberMatched` equal to (or below) the cap has not been
        // truncated by an amount worth naming — announcing "3 out of 3" would read as a
        // bug in the message, not in the data.
        announceTruncation("sites", "Sites", { limit: 3, fetched: 5, matched: 3 });

        const [message] = notify.mock.calls[0] ?? [];
        expect(message).not.toContain("sur 3");
        expect(message).not.toContain("out of 3");
    });

    it("UNE SEULE FOIS par couche — un `moveend` ne réédite pas l'alerte", () => {
        const facts = { limit: 100, fetched: 150, matched: 900 };
        expect(announceTruncation("sites", "Sites", facts)).toBe(true);
        expect(announceTruncation("sites", "Sites", facts)).toBe(false);
        expect(announceTruncation("sites", "Sites", facts)).toBe(false);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("mais une fois PAR COUCHE — deux couches tronquées font deux alertes", () => {
        announceTruncation("sites", "Sites", { limit: 10, fetched: 20, matched: 50 });
        announceTruncation("villes", "Villes", { limit: 10, fetched: 20, matched: 50 });
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it("retombe sur l'identifiant quand la couche n'a pas de libellé", () => {
        announceTruncation("sites_rosario", "", { limit: 10, fetched: 20 });
        expect(notify.mock.calls[0]?.[0]).toContain("sites_rosario");
    });
});

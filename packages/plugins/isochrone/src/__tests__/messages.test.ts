/**
 * @geoleaf-plugins/isochrone — what the window says of a refusal
 *
 * One message per reason, never « an error occurred »; a refusal of the engine says its status
 * and, when it could be read, its code; a cancellation the user asked for says nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import L_fr from "../lang/lang-fr.js";
import type { ComputeResult } from "../model.js";
import { label, refusalMessage, rowLabel } from "../ui/messages.js";

const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

beforeEach(() => {
    host.GeoLeaf = {
        I18n: { getLabel: (key: string) => (L_fr as Record<string, string>)[key] ?? key },
    };
});

afterEach(() => {
    host.GeoLeaf = previous;
});

/** A refusal. */
function refused(reason: string, extra: Record<string, number> = {}): ComputeResult {
    return { ok: false, reason, ...extra } as ComputeResult;
}

describe("refusalMessage", () => {
    it("says nothing of a success, nor of a cancellation", () => {
        expect(refusalMessage({ ok: true, ids: [] })).toBe("");
        expect(refusalMessage(refused("aborted"))).toBe("");
    });

    it("names the status and the engine's code of a refusal", () => {
        expect(refusalMessage(refused("http", { status: 400, code: 151 }))).toBe(
            "Le moteur a refusé la demande (statut 400, code 151)"
        );
        expect(refusalMessage(refused("http", { status: 503 }))).toBe(
            "Le moteur a refusé la demande (statut 503)"
        );
    });

    it("carries the limit of a duration too long and of a full stack", () => {
        expect(refusalMessage(refused("too-long", { limit: 60 }))).toBe(
            "Durée limitée à 60 minutes par ce moteur"
        );
        expect(refusalMessage(refused("cap-reached", { limit: 8 }))).toBe(
            "Limite de 8 couches atteinte"
        );
    });

    it("gives every reason a message of its own", () => {
        const reasons = [
            "timeout",
            "network",
            "malformed",
            "no-engine",
            "no-map",
            "busy",
            "invalid",
            "http",
            "too-long",
            "cap-reached",
        ];
        const messages = reasons.map((r) => refusalMessage(refused(r)));
        expect(new Set(messages).size).toBe(reasons.length);
        expect(messages.every((m) => m !== "" && !m.startsWith("isochrone."))).toBe(true);
    });

    it("reads a reason it does not know as an answer it cannot read", () => {
        expect(refusalMessage(refused("something-new"))).toBe(refusalMessage(refused("malformed")));
    });
});

describe("label", () => {
    it("fills its placeholders, and leaves one without a value as it is", () => {
        expect(label("isochrone.list.moved", { row: "5 min · Voiture", rank: 2 })).toBe(
            "5 min · Voiture : rang 2 sur {count}"
        );
    });

    it("names a zone by its duration and its mode", () => {
        expect(rowLabel(10, "foot")).toBe("10 min · À pied");
        expect(rowLabel(5, "bike")).toBe("5 min · Vélo");
        expect(rowLabel(5, "car")).toBe("5 min · Voiture");
    });
});

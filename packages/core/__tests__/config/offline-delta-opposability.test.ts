/**
 * Is `offline.source.delta` OPPOSABLE — both halves, or nothing?
 *
 * 🛑 **THIS FILE EXISTS BECAUSE THE RULE HAS NO LIVE SUBJECT.** No profile of the repository
 * declares a delta: `npm run validate:profiles` comes out green with the rule exactly as it does
 * without it, and removing `required` would redden strictly nothing. The pattern is that of
 * `offline-maxfeatures-opposability.test.ts`: a rule no shipped profile exercises lives on its
 * negative cases, here.
 *
 * What the rule catches, and nothing else does: a declaration with a freshness filter and no
 * tombstone property. The pull would then ask only for what changed — and a deletion never
 * changes anything the filter can see, so the layer would keep, forever and without a word,
 * every entity the server deleted.
 *
 * ⚠️ The negative cases below were SEEN RED by removing `required` from the block.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// config → __tests__ → core → packages → <racine>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/layer-config.schema.json"), "utf8")
);

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

/** A layer pulled from a declared source, carrying whatever `delta` block the case is about. */
const withDelta = (delta: unknown) => ({
    id: "couche",
    offline: {
        enabled: true,
        maxFeatures: 5000,
        source: { url: "https://backend.test/ogc", ...(delta === undefined ? {} : { delta }) },
    },
});

/** Errors located under the `delta` block, so a case cannot pass on another motive. */
function deltaErrors(delta: unknown) {
    validate(withDelta(delta));
    return (validate.errors ?? []).filter((e) =>
        e.instancePath.startsWith("/offline/source/delta")
    );
}

describe("`offline.source.delta` — les deux moitiés, ou rien", () => {
    it("ACCEPTE la déclaration complète", () => {
        expect(validate(withDelta({ freshness: "datetime", deletedProperty: "deleted_at" }))).toBe(
            true
        );
    });

    it("ACCEPTE une source SANS déclaration — le repli, le rapatriement complet", () => {
        expect(validate(withDelta(undefined))).toBe(true);
    });

    it("REFUSE la fraîcheur sans les pierres tombales — le delta ne verrait aucune suppression", () => {
        const errors = deltaErrors({ freshness: "datetime" });
        expect(
            errors.some(
                (e) => e.keyword === "required" && e.params?.missingProperty === "deletedProperty"
            )
        ).toBe(true);
    });

    it("REFUSE les pierres tombales sans filtre de fraîcheur", () => {
        const errors = deltaErrors({ deletedProperty: "deleted_at" });
        expect(
            errors.some(
                (e) => e.keyword === "required" && e.params?.missingProperty === "freshness"
            )
        ).toBe(true);
    });

    it("REFUSE un filtre que le cœur ne parle pas", () => {
        const errors = deltaErrors({ freshness: "cql2", deletedProperty: "deleted_at" });
        expect(errors.some((e) => e.keyword === "enum")).toBe(true);
    });

    it("REFUSE une propriété de suppression vide", () => {
        const errors = deltaErrors({ freshness: "datetime", deletedProperty: "" });
        expect(errors.some((e) => e.keyword === "minLength")).toBe(true);
    });

    it("REFUSE une clé que rien ne lit", () => {
        const errors = deltaErrors({
            freshness: "datetime",
            deletedProperty: "deleted_at",
            since: "2026-09-01",
        });
        expect(errors.some((e) => e.keyword === "additionalProperties")).toBe(true);
    });
});

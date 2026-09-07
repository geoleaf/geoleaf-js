/**
 * Is `offline.maxFeatures` OPPOSABLE as soon as offline reading is on? (R9, task 2.4)
 *
 * 🛑 **THIS FILE EXISTS BECAUSE THE RULE HAS NO LIVE SUBJECT.** The repository's only two
 * offline layers — `tourism/sites_rosario` and `tourism/villes_principales` — already
 * declare `maxFeatures: 5000`. `npm run validate:profiles` therefore comes out green with
 * the rule exactly as it did without it, and removing the `if`/`then` branch would redden
 * strictly nothing. That is the motive the A14 `$comment` names for
 * `attributes-opposability.test.js`, whose pattern this file follows: two positive
 * subjects only ever prove the positive case.
 *
 * What the rule catches, and nothing else does: without `maxFeatures`, the OGC loader
 * falls back to `DEFAULT_MAX_FEATURES` (10 000) and a layer of 30 000 entities is served
 * at a third **in silence** — the map looks complete.
 *
 * ⚠️ Every negative case below was SEEN RED by removing the branch from the schema.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// config → __tests__ → core → packages → <racine>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readText = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const schema = JSON.parse(readText("profiles/schemas/layer-config.schema.json"));
const loaderSource = readText("packages/core/src/kernel/geojson/loader/ogc-api-loader.ts");

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

/** One `offline` block, or `null` for a layer that declares none. */
type OfflineBlock = Record<string, unknown> | null;

/** Minimal valid layer config, plus whatever `offline` block the case is about. */
const withOffline = (offline: OfflineBlock) => ({ id: "couche", ...(offline ? { offline } : {}) });

/** Errors bearing on the missing key, so a green case cannot pass on another motive. */
function maxFeaturesErrors(config: Record<string, unknown>) {
    validate(config);
    return (validate.errors ?? []).filter(
        (e) => e.keyword === "required" && e.params?.missingProperty === "maxFeatures"
    );
}

describe("R9 — `offline.maxFeatures` est requis dès `offline.enabled`", () => {
    it("REFUSE une couche hors-ligne sans plafond déclaré", () => {
        const errors = maxFeaturesErrors(withOffline({ enabled: true }));
        expect(errors).toHaveLength(1);
        expect(errors[0]?.instancePath).toBe("/offline");
    });

    it("REFUSE aussi quand la couche déclare une source mais pas de plafond", () => {
        // The case an integrator actually writes: the pull is configured, the bound is
        // forgotten, and the fallback to 10 000 decides for them.
        expect(
            maxFeaturesErrors(
                withOffline({ enabled: true, source: { url: "https://backend.test/ogc" } })
            )
        ).toHaveLength(1);
    });

    it("ACCEPTE dès que le plafond est déclaré", () => {
        expect(validate(withOffline({ enabled: true, maxFeatures: 30000 }))).toBe(true);
    });

    it("N'EXIGE RIEN quand le hors-ligne est éteint — la règle est conditionnelle", () => {
        // `enabled: false` means the layer always loads from the network: no local store
        // to bound, so demanding a cap would be ceremony that integrators would satisfy
        // with a meaningless number.
        expect(validate(withOffline({ enabled: false }))).toBe(true);
        expect(maxFeaturesErrors(withOffline({ enabled: false }))).toHaveLength(0);
    });

    it("n'exige rien d'une couche SANS bloc `offline`", () => {
        expect(validate(withOffline(null))).toBe(true);
    });

    it("refuse toujours un plafond de zéro ou négatif — la règle ne remplace pas la borne", () => {
        validate(withOffline({ enabled: true, maxFeatures: 0 }));
        expect(
            (validate.errors ?? []).some(
                (e) => e.keyword === "minimum" && e.instancePath === "/offline/maxFeatures"
            )
        ).toBe(true);
    });

    it("le défaut que la règle existe pour rendre EXPLICITE est bien 10 000", () => {
        // 🛑 Read from the loader, never copied: this suite must fail if the fallback
        // moves, because the whole motive of the rule is the size of that silent
        // fallback. A number retyped here would agree with a stale one forever.
        const match = loaderSource.match(/const DEFAULT_MAX_FEATURES = ([\d_]+);/);
        expect(match).not.toBeNull();
        expect(Number((match?.[1] ?? "").replace(/_/g, ""))).toBe(10000);
    });
});

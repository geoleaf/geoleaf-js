/**
 * Config-contract Phase C / C3 — B4 themes.json anomalies (regression-lock).
 *
 *   ANO-047 config.primaryThemes.compactThreshold — ❌ no-mapping CONTRACT: read
 *     live (theme-selector-primary.ts) but ABSENT from the hardened
 *     primaryThemes block → inconfigurable. Schema-reject is enforced here; the
 *     live read sits behind UI state (it.todo with the file:line).
 *   ANO-046 config.{primary,secondary}Themes.position / showNavigationButtons —
 *     orphans (⚪): declared in the schema (schema-ACCEPTED) but 0 consumer.
 *   ANO-005 config.defautTheme — legacy/typo alias, TOLERATED by the schema; the
 *     canonical key is the root-level defaultTheme (resolved S1).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/themes.schema.json"), "utf8")
);
delete schema.$id;
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

describe("config B4 — themes @anomaly locks", () => {
    it("sanity: a schema-valid themes doc passes", () => {
        expect(validate({ defaultTheme: "a", themes: [{ id: "a" }] })).toBe(true);
    });

    // ── ANO-047 compactThreshold (no-mapping CONTRACT) ────────────────────────
    describe("@anomaly ANO-047 — config.primaryThemes.compactThreshold", () => {
        it("schema: compactThreshold is rejected (inconfigurable)", () => {
            expect(
                validate({
                    config: { primaryThemes: { compactThreshold: 3 } },
                    themes: [{ id: "a" }],
                })
            ).toBe(false);
        });
        it.todo(
            "live: theme-selector-primary.ts:110 reads _state.config.primaryThemes.compactThreshold ?? 5 (UI-state coupled)"
        );
    });

    // ── ANO-046 position / showNavigationButtons (orphans, schema-accepted) ────
    describe("@anomaly ANO-046 — position / showNavigationButtons (orphans)", () => {
        it("primaryThemes.position is schema-accepted (configurable, but inert)", () => {
            expect(
                validate({
                    config: { primaryThemes: { position: "top-map" } },
                    themes: [{ id: "a" }],
                })
            ).toBe(true);
        });
        it("secondaryThemes.showNavigationButtons is schema-accepted (configurable, but inert)", () => {
            expect(
                validate({
                    config: { secondaryThemes: { showNavigationButtons: true } },
                    themes: [{ id: "a" }],
                })
            ).toBe(true);
        });
        it.todo("ANO-046 position/showNavigationButtons — 0 consumer (grep=0): wire or remove");
    });

    // ── ANO-005 legacy defautTheme (typo alias, tolerated) ────────────────────
    describe("@anomaly ANO-005 — config.defautTheme (legacy typo, tolerated)", () => {
        it("config.defautTheme is tolerated by the schema (legacy alias)", () => {
            expect(validate({ config: { defautTheme: "a" }, themes: [{ id: "a" }] })).toBe(true);
        });
        it.todo(
            "ANO-005 defautTheme — canonical is root-level defaultTheme; drop the alias in cleanup"
        );
    });
});

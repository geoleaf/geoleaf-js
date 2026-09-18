/**
 * The CSRF module is gone — and nothing public still promises it.
 *
 * `GeoLeaf.Security.CSRFToken` minted its token in the browser and checked it in the same
 * context: no server could verify it, so it protected nothing while reading like a
 * protection. Removed in 3.4.0 (decided on 13/09/2026), together with the `auth: "csrf"`
 * write mode, which no code read either.
 *
 * These cases are the removal's proof, written before it: each was seen red on the code that
 * still carried the module.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import * as securityBarrel from "../../src/kernel/security/index.js";

// security → __tests__ → core → packages → <racine>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/layer-config.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);

/** A layer whose write block declares `auth`. */
const withAuth = (auth: string) => ({
    id: "couche",
    write: { enabled: true, endpoint: "https://backend.test/items", auth },
});

describe("module CSRF retiré", () => {
    it("le namespace `Security` ne porte plus `CSRFToken`", () => {
        expect(securityBarrel.Security).not.toHaveProperty("CSRFToken");
    });

    it("le baril n'exporte plus `CSRFToken`", () => {
        expect(securityBarrel).not.toHaveProperty("CSRFToken");
    });

    it('le schéma refuse `write.auth: "csrf"`', () => {
        expect(validate(withAuth("csrf"))).toBe(false);
        expect(validate.errors?.some((e) => e.instancePath === "/write/auth")).toBe(true);
    });

    it("le schéma accepte encore `bearer` et `none`", () => {
        expect(validate(withAuth("bearer"))).toBe(true);
        expect(validate(withAuth("none"))).toBe(true);
    });
});

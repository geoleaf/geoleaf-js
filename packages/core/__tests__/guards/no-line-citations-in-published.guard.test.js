/**
 * @file no-line-citations-in-published.guard.test.js
 * @description Guard test — no `file.ext:line` citation in the PUBLISHED surfaces.
 *
 * Why this guard exists (28-29/07/2026)
 * ----------------------------------------------
 * Two surfaces of this repo ship to the integrator with their prose:
 *
 *  - the `configSchema` `description`s, which `getCapabilitySchema(id)`
 *    publishes **at runtime** (a configuration studio displays them as-is);
 *  - the `src/api/geoleaf.*.ts` facades, published **by TypeDoc** in the npm package.
 *
 * Measured at the work's opening: **25 `file:line` citations** lived there,
 * across four capabilities, and **all 25 pointed at a line that no longer
 * carried the cited statement** — from 1 line of drift to 178. None was
 * false at birth: they all went stale silently, because a line citation does
 * not survive the first code move.
 *
 * ## Why a gate, and not just one more fix
 *
 * Fixing the 25 without closing the class means re-paying the same fix at
 * the next structure sprint. `CLAUDE.md` already forbids citing a
 * `global.d.ts` line for this exact reason; this guard extends the ban to
 * the two published surfaces, where the cost is highest since the reader is
 * **outside the repo** and cannot observe the drift.
 *
 * ## What this guard is NOT
 *
 * It does not judge a description's TRUTH — `CLAUDE.md`'s ⛔ rule, and it
 * stays with the human. It closes a single class, mechanisable and
 * unambiguous: **the form of a reference that cannot stay true**. Citing the
 * SYMBOL survives the move and stays grep-verifiable; citing the line does not.
 *
 * ⚠️ It ENFORCES **only the published surfaces**. Internal comments were
 * long allowed to cite lines (the reader has the file in front of them);
 * the code-autonomy pass of 2026-08-26 adjudicated the class as fragile
 * everywhere and swept the ~400 internal occurrences down to the pattern
 * samples this very file carries. Extending the enforcement repo-wide is a
 * separate, conditioned decision — until it is taken, this guard's corpus
 * stays the two surfaces above.
 *
 * ## A guard never seen red guards nothing
 *
 * Two anti-empty-guard assertions: at least one file read on each side.
 * Without them, a renamed directory would make this guard green having
 * scanned nothing — the class `probe-gate-visibility.cjs` watches elsewhere.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../src");
const CAPS = path.join(SRC, "capabilities");
const API = path.join(SRC, "api");

/**
 * `fichier.ts:12` / `build-deploy.cjs:676-680` / `x.ts:203,243`.
 *
 * The extension is required: without it, the pattern would catch
 * `http://…:8080`, time ranges and prose colons. The listed extensions are
 * the ones this repo cites.
 */
const LINE_CITATION = /[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|cjs|json)\s*:\s*\d+(?:\s*[-,]\s*\d+)*/g;

/** The capability declarations — their `configSchema` is published by introspection. */
function declarationFiles() {
    if (!fs.existsSync(CAPS)) return [];
    return fs
        .readdirSync(CAPS, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(CAPS, e.name, `${e.name}-capability.ts`))
        .filter((p) => fs.existsSync(p));
}

/** The ESM facades — published by TypeDoc in the npm tarball. */
function facadeFiles() {
    if (!fs.existsSync(API)) return [];
    return fs
        .readdirSync(API)
        .filter((f) => /^geoleaf\..*\.ts$/.test(f))
        .map((f) => path.join(API, f));
}

function offenders(files) {
    const out = [];
    for (const p of files) {
        const rel = path.relative(path.resolve(__dirname, "../../../.."), p);
        fs.readFileSync(p, "utf8")
            .split(/\r?\n/)
            .forEach((line, i) => {
                for (const m of line.match(LINE_CITATION) ?? []) {
                    out.push(
                        `${rel}:${i + 1} — citation de ligne \`${m}\` dans une surface PUBLIÉE. ` +
                            `Citer le SYMBOLE (une fonction, une constante) : il survit au ` +
                            `déplacement et reste vérifiable au grep.`
                    );
                }
            });
    }
    return out;
}

const DECLARATIONS = declarationFiles();
const FACADES = facadeFiles();

describe("test-garde — aucune citation `fichier:ligne` dans les surfaces publiées", () => {
    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("lit au moins une déclaration de capacité", () => {
        expect(DECLARATIONS.length, `aucun *-capability.ts sous ${CAPS}`).toBeGreaterThan(0);
    });

    it("lit au moins une façade ESM", () => {
        expect(FACADES.length, `aucun geoleaf.*.ts sous ${API}`).toBeGreaterThan(0);
    });

    it("les `configSchema` publiés ne citent aucune ligne", () => {
        const bad = offenders(DECLARATIONS);
        expect(bad, bad.join("\n")).toEqual([]);
    });

    it("les façades publiées ne citent aucune ligne", () => {
        const bad = offenders(FACADES);
        expect(bad, bad.join("\n")).toEqual([]);
    });
});

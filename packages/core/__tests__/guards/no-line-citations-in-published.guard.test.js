/**
 * @file no-line-citations-in-published.guard.test.js
 * @description Test-garde — aucune citation `fichier.ext:ligne` dans les surfaces PUBLIÉES.
 *
 * Pourquoi ce garde existe (B-63, 28-29/07/2026)
 * ----------------------------------------------
 * Deux surfaces de ce dépôt partent chez l'intégrateur avec leur prose :
 *
 *  - les `description` des `configSchema`, que `getCapabilitySchema(id)` publie **au runtime**
 *    (un studio de configuration les affiche telles quelles) ;
 *  - les façades `src/api/geoleaf.*.ts`, publiées **par TypeDoc** dans le paquet npm.
 *
 * Mesuré à l'ouverture de B-63 : **25 citations `fichier:ligne`** y vivaient, réparties sur quatre
 * capacités, et **les 25 pointaient une ligne qui ne portait plus l'énoncé cité** — de 1 ligne
 * d'écart à 178. Aucune n'était fausse à sa naissance : elles se sont toutes périmées en silence,
 * parce qu'une citation de ligne ne survit pas au premier déplacement de code.
 *
 * ## Pourquoi une gate, et pas seulement une correction
 *
 * Corriger les 25 sans fermer la classe, c'est re-payer la même correction au prochain sprint de
 * structure. `CLAUDE.md` interdit déjà de citer une ligne de `global.d.ts` pour cette raison
 * exacte ; ce garde étend l'interdit aux deux surfaces publiées, où le coût est le plus élevé
 * puisque le lecteur est **extérieur au dépôt** et ne peut pas constater la dérive.
 *
 * ## Ce que ce garde N'EST PAS
 *
 * Il ne juge pas la VÉRACITÉ d'une description — c'est la règle ⛔ de `CLAUDE.md`, et elle reste à
 * l'humain. Il ferme une seule classe, mécanisable et sans ambiguïté : **la forme d'une référence
 * qui ne peut pas rester vraie**. Citer le SYMBOLE survit au déplacement et reste vérifiable au
 * grep ; citer la ligne, non.
 *
 * ⚠️ Il ne s'applique **qu'aux surfaces publiées**. Un commentaire interne peut légitimement citer
 * une ligne — il vieillira, mais son lecteur a le fichier sous les yeux et peut le constater.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Deux assertions anti-garde-vide : au moins un fichier lu de chaque côté. Sans elles, un
 * répertoire renommé rendrait ce garde vert en n'ayant rien scanné — la classe que
 * `probe-gate-visibility.cjs` surveille ailleurs.
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
 * L'extension est exigée : sans elle, le motif attraperait les `http://…:8080`, les plages de
 * temps et les deux-points de prose. Les extensions listées sont celles que ce dépôt cite.
 */
const LINE_CITATION = /[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|cjs|json)\s*:\s*\d+(?:\s*[-,]\s*\d+)*/g;

/** Les déclarations de capacité — leur `configSchema` est publié par l'introspection. */
function declarationFiles() {
    if (!fs.existsSync(CAPS)) return [];
    return fs
        .readdirSync(CAPS, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(CAPS, e.name, `${e.name}-capability.ts`))
        .filter((p) => fs.existsSync(p));
}

/** Les façades ESM — publiées par TypeDoc dans le tarball npm. */
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
                            `déplacement et reste vérifiable au grep. (B-63)`
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

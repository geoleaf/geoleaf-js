#!/usr/bin/env node
/**
 * GATE-PROBE: are the gates still SIGHTED on a nested package? (ARCHI S10.2)
 *
 * ## The failure this exists to catch
 *
 * ARCHI S10 moves 13 plugins under `packages/plugins/` and 3 libraries under
 * `packages/libs/`. Before S9.5, ten sites across eight gates enumerated
 * `packages/` one level deep and then did:
 *
 *     if (!fs.existsSync(srcDir)) continue;   // ← silent
 *
 * After the move those gates would have found `plugins/` and `libs/` with no
 * `src/`, skipped, and exited 0 having scanned NOTHING. Not a red build — a green
 * one, reporting zero violations across zero files. Six of the eight run in
 * `ci:local`.
 *
 * A second class fails differently and is worse: a hard-coded glob
 * (`packages/plugin-*​/src/**`) does not "miss" violations, it stops matching
 * anything — so an ESLint rule elevated to `error` silently reverts to `warn`.
 * Nothing is red, and there is no diff to blame.
 *
 * Neither class announces itself. The only way to know a gate still sees a
 * package is to give it a package with a known defect and check that it reacts.
 *
 * ## What this does
 *
 * Plants `packages/plugins/__probe__/` — a nested workspace carrying one deliberate
 * defect per gate — then asserts each gate reports it. Two families:
 *
 *   A. GATE VISIBILITY — the gate runs but no longer sees the file.
 *      Asserted by: the gate must mention `__probe__` in its output.
 *   B. RULE ARMAMENT — the rule stops existing rather than missing a violation.
 *      Asserted structurally: every ratchet glob must still match real files.
 *
 * ## Usage
 *
 *   node scripts/probe-gate-visibility.cjs          # plant, assert, clean up
 *   node scripts/probe-gate-visibility.cjs --keep   # leave the probe in place
 *
 * Exits 0 when every gate saw the probe, 1 otherwise. Always removes the probe and
 * restores package.json, including on error — a probe that leaks into the tree
 * would be worse than no probe.
 *
 * ⚠️ No `npm install` is needed: the registry derives from the workspace globs by
 * reading directories, and the gates scan files. Keeping install out makes this
 * runnable in a second, so it can be run BEFORE and AFTER the S10 move.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PROBE_REL = "packages/plugins/__probe__";
const PROBE_DIR = path.join(ROOT, PROBE_REL);
const PKG_JSON = path.join(ROOT, "package.json");
const KEEP = process.argv.includes("--keep");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    x: "\x1b[0m",
};

let pkgJsonBackup = null;
/** True only when THIS run created `packages/plugins/` — see cleanup(). */
let createdPluginsDir = false;

// ─── Probe fixture ────────────────────────────────────────────────────────────

/**
 * Write the nested probe package. Every file carries exactly one planted defect,
 * chosen to match what the target gate ACTUALLY tests for — not what it sounds
 * like it tests for.
 *
 * That distinction is not theoretical: the first version of this probe used
 * `(globalThis as { L?: … }).L?.marker` for the Leaflet check and reported
 * `verify-no-leaflet` as blind. The probe was wrong, not the gate — `L\.` does not
 * match `L?.`, and `(global|globalThis|window)\.L\b` requires adjacency that the
 * type assertion breaks. A probe not validated against the gate's real criteria
 * proves the opposite of what it appears to prove.
 */
function plantProbe() {
    if (fs.existsSync(PROBE_DIR)) {
        throw new Error(
            `${PROBE_REL} exists already — refusing to overwrite. Remove it by hand if it is a leftover.`
        );
    }
    createdPluginsDir = !fs.existsSync(path.join(ROOT, "packages", "plugins"));
    fs.mkdirSync(path.join(PROBE_DIR, "src", "lang"), { recursive: true });

    // check-package-files: a files[] entry that does not exist on disk.
    fs.writeFileSync(
        path.join(PROBE_DIR, "package.json"),
        JSON.stringify(
            {
                name: "@geoleaf-plugins/__probe__",
                version: "3.0.0",
                private: true,
                type: "module",
                // `docs` (T4.3) : embarque le répertoire d'artefact planté plus bas, ce
                // que le check 2 de PKG-FILES doit refuser. `docs/` existe donc sur
                // disque, et le défaut d'origine (`THIS-FILE-DOES-NOT-EXIST.md`, check 1)
                // reste intact — deux défauts, deux checks, un seul manifeste.
                files: ["dist", "THIS-FILE-DOES-NOT-EXIST.md", "docs"],
                // SHIP-SPEC (passage public S1.6) : le corpus de `check-shipped-specifiers`
                // est DÉRIVÉ de la carte `exports` — la racine de chaque cible. Sans cette
                // carte, le paquet de sonde ne contribuerait aucun fichier et l'assertion
                // ci-dessous passerait au VERT en ne prouvant rien. C'est le mode d'échec
                // que tout ce fichier traque, et il fallait donc l'écrire ici plutôt que
                // dans la gate.
                exports: {
                    ".": {
                        types: "./dist/types/index.d.ts",
                        import: "./dist/index.js",
                    },
                },
            },
            null,
            4
        ) + "\n"
    );

    // verify-no-leaflet: a literal Leaflet import + a runtime `L.` call.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "entry.ts"),
        'import L from "leaflet";\n\nexport function probe() {\n    return L.marker([0, 0]);\n}\n'
    );

    // verify-plugin-core-boundary: a deep import into the core sources.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "deep-import.ts"),
        'import { Log } from "../../../core/src/utils/log/index.js";\n\nexport const probeLog = Log;\n'
    );

    // check-exact-optional-debt (EOD-01) : une propriété élargie en `?: T | undefined`, hors
    // baseline. Le gate dérive son corpus de `registry.all()` ; s'il cesse d'énumérer les
    // paquets imbriqués, il se tait ici. La forme est choisie pour être invisible à un grep
    // naïf autrement : c'est bien la VISITE AST qui doit la voir.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "widened.ts"),
        "export interface ProbeWidened {\n    probeField?: string | undefined;\n}\n"
    );

    // check-nonnull-assertion-debt (NNA-04) : une lecture indexée assertée. Elle n'a PAS de
    // baseline, donc elle rougit sans qu'il faille la tenir hors d'une liste — mais elle ne
    // rougit ici que si le gate énumère encore les paquets imbriqués. Même classe que la
    // précédente, et même raison de la planter dans `__probe__` plutôt que dans le core.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "asserted-index.ts"),
        "export function probeAsserted(xs: string[]): string {\n    return xs[0]!;\n}\n"
    );

    // verify-plugin-shared-fork: a LOCAL re-definition of a host-runtime canonical symbol.
    // `coreConfigGet` is a roadmap anchor, so if the gate's symbol-derivation ever silently
    // empties, this file stops being flagged — the probe catches BOTH the "gate blind to a
    // nested package" and the "gate scanning for nothing" modes. __probe__ has no baseline
    // entry, so PSF-01 must name this file.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "fork.ts"),
        "export function coreConfigGet(key, fallback) {\n    return fallback;\n}\n"
    );

    // check-event-map-coverage (API publique S3.4) : un nom d'événement `geoleaf:*` absent
    // des deux maps du contrat ET de la baseline — donc EM-01 doit le NOMMER. La gate est
    // baseline-tolérante : elle sort 0 tant que rien de NOUVEAU n'apparaît, y compris sur un
    // corpus vide, où elle annoncerait « aucun nouveau, aucun périmé » en n'ayant rien lu.
    // C'est exactement la classe que ce fichier traque.
    // ⚠️ Le littéral est lu sur l'AST, pas au grep : l'écrire en commentaire ne suffirait
    // pas, il doit être une vraie chaîne dans du code.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "event.ts"),
        "export function probeEmit() {\n" +
            '    document.dispatchEvent(new CustomEvent("geoleaf:__probe__:untyped"));\n' +
            "}\n"
    );

    // check-facade-purity (moitié plugin, B.12) : une façade qui IMPLÉMENTE au lieu de
    // déléguer — état mutable de module + branche. Le gate énumère `registry.all()` en
    // cherchant `src/public-api.ts` ; s'il cesse de voir un paquet imbriqué, il se tait
    // ici. Il sort déjà en erreur sur 0 fichier trouvé, mais ça ne dit pas qu'il les voit
    // TOUS — c'est ce que cette sonde ajoute.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "public-api.ts"),
        "let _probeState = 0;\n\n" +
            "export function buildPublicApi() {\n" +
            "    return {\n" +
            "        bump: () => (_probeState > 0 ? _probeState : ++_probeState),\n" +
            "    };\n" +
            "}\n"
    );

    // check-i18n-dict-shape: a NESTED dictionary (value is an object, not a string).
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "lang", "lang-fr.ts"),
        'export const fr = {\n    probe: {\n        nested: "interdit — le dictionnaire doit être plat",\n    },\n};\n'
    );

    // purgecss / CSS scanning: a class that exists nowhere else.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe.css"),
        ".gl-probe-marker-class { color: red; }\n"
    );

    // verify-test-load-mode (COUVERTURE S1.3/S1.4) : un module source chargé par
    // `require()` depuis un test. Le défaut est le COUPLE — un `require()` seul ne
    // prouve rien s'il ne résout pas vers une vraie source, la gate l'ignorerait.
    //
    // Ce site est ABSENT de la baseline par construction (la sonde est éphémère), donc
    // il éprouve exactement le cas qui compte : un `require()` NEUF doit rougir. C'est
    // la preuve par mutation de la gate, et elle tourne à chaque `ci:local` — là où une
    // preuve écrite à part n'aurait tourné qu'une fois.
    fs.mkdirSync(path.join(PROBE_DIR, "__tests__"), { recursive: true });
    // Le `@module` est PLANTÉ (STRUCT S5) : c'est le seul défaut vivant de MH-03, la règle
    // tenant à zéro dans tout le dépôt. Sans lui, la gate ne pourrait plus jamais être vue
    // rougir, et cesserait d'être une garde. Le tag ne rend pas le fichier documenté —
    // `extractHeader` jette les lignes `@` de la prose —, donc MH-01 continue de le nommer
    // et l'assertion de famille A qui l'éprouve reste valide.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe-load.ts"),
        "/**\n * @module sonde/probe-load\n */\nexport function probeLoaded() {\n    return true;\n}\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "__tests__", "probe-load.test.js"),
        'const { probeLoaded } = require("../src/probe-load.ts");\n\n' +
            "// Jamais exécuté : la sonde n'est pas dans le périmètre de `npm test`\n" +
            "// (le package n'a ni script `test` ni vitest.config.ts).\n" +
            "module.exports = { probeLoaded };\n"
    );

    // ── Variante SPECIFIER NU (COUVERTURE S5.6, backlog B.3) ──────────────────
    //
    // La gate ne comptait que les specifiers relatifs. Les `require("@core/…")` lui
    // étaient donc INVISIBLES — mesuré au S5 : 22 sites dans les deux plugins, dont 8
    // chargeaient de la vraie source du core, et un fichier de test entier
    // (`cache-workflow-cross.integration.test.js`) n'était dans aucun inventaire.
    //
    // Cette sonde-ci vit dans son PROPRE fichier : si la détection des specifiers nus
    // régresse, ce fichier cesse d'être nommé alors que `probe-load.test.js` continue
    // de l'être — l'échec désigne la cause au lieu de la masquer.
    fs.writeFileSync(
        path.join(PROBE_DIR, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@probe/*": ["./src/*"] } } }, null, 4) + "\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe-bare.ts"),
        "export function probeBare() {\n    return true;\n}\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "__tests__", "probe-bare.test.js"),
        'const { probeBare } = require("@probe/probe-bare.js");\n\n' +
            "// Même statut que probe-load.test.js : jamais exécuté.\n" +
            "module.exports = { probeBare };\n"
    );

    // verify-repo-hygiene / check 1b (T3.5) : un `.cjs` non déclaré à la RACINE du
    // package — la forme exacte de `packages/core/cov-check.cjs`, mort et suivi par git
    // pendant des mois. Planté hors de `src/` à dessein : le périmètre du check doit être
    // le package entier, pas son `scripts/` (2 des 4 scripts morts du T3 étaient à la
    // racine, et `packages/core/scripts/` était le SEUL `scripts/` de package du dépôt —
    // un check ainsi borné aurait scanné zéro fichier dès sa suppression).
    //
    // Et il n'est DÉLIBÉRÉMENT pas indexé : c'est ce qui prouve que le check lit le
    // worktree et pas seulement l'index — la seule raison pour laquelle il est sondable.
    fs.writeFileSync(
        path.join(PROBE_DIR, "probe-throwaway.cjs"),
        '"use strict";\n\n// T3.5 probe — throwaway script at a package root.\nmodule.exports = { probe: true };\n'
    );

    // ── T4.1 — artefact GÉNÉRÉ, et producteur qui écrit hors périmètre ────────
    //
    // Le check 5 de `verify-repo-hygiene` interdit qu'un répertoire d'artefact soit sous
    // contrôle de git. Son périmètre est une liste de FORMES relatives
    // (`lib/generated-artifacts.cjs`), précisément pour qu'un déplacement du core ne le
    // vide pas : la faute que le T3.5 a commise était de borner une gate au seul
    // répertoire que le sprint supprimait.
    //
    // Cette fixture est ce qui rend cette propriété VÉRIFIABLE : elle plante la forme
    // `docs/api` à un chemin que personne n'a écrit en dur. Une régression vers un chemin
    // absolu (`packages/core/docs/api`) cesse de la nommer.
    //
    // ⚠️ Sa visibilité DÉPEND de l'ancrage des motifs `.gitignore` du T4.1
    // (`packages/core/docs/api/`). Un `**/docs/api/` générique avalerait ce fichier : il
    // sortirait du corpus `--others --exclude-standard`, et cette assertion passerait
    // VERTE en ne prouvant plus rien. C'est la raison pour laquelle l'ancrage n'est pas
    // un détail de style — et elle est écrite ici parce que c'est ici qu'on la casserait.
    fs.mkdirSync(path.join(PROBE_DIR, "docs", "api"), { recursive: true });
    fs.writeFileSync(
        path.join(PROBE_DIR, "docs", "api", "index.html"),
        "<!-- T4.1 probe — generated artifact under git control. -->\n"
    );

    // Variante ARMEMENT : un PRODUCTEUR qui déclare écrire hors des formes connues.
    // Sans elle, renommer le `out` de `typedoc.json` désarmerait le check 5 sans
    // qu'aucun fichier ne change de statut git — donc en silence, et c'est exactement le
    // mode d'échec que ce fichier traque. `declaredOutputs()` lit la déclaration au lieu
    // de recopier le chemin, cette fixture prouve qu'il la lit encore.
    fs.writeFileSync(
        path.join(PROBE_DIR, "typedoc.json"),
        JSON.stringify({ out: "docs/__probe-api__" }, null, 4) + "\n"
    );

    // ── SHIP-SPEC (passage public S1.6) — une DÉCLARATION PUBLIÉE qui nomme un
    //    workspace `private`, donc 404 sur npm pour toujours ────────────────────
    //
    // C'est la classe qui a motivé la gate : six `.d.ts` publiables importaient des paquets
    // absents du registre, et RIEN ne pouvait le voir — les symlinks de workspace les
    // résolvent ici, donc `typecheck:consumer` reste vert (il compile depuis
    // `packages/core/examples/`, soit DANS le monorepo) et PUB-TYPES ne compile pas du tout.
    //
    // La fixture vise `@geoleaf/build-config` et non `@geoleaf/host-runtime` : les deux sont
    // `private: true`, mais le second était la cible RÉELLE des deux fuites corrigées au
    // S1.2/S1.3. Choisir la cible corrigée ferait passer l'assertion pour une régression
    // possible du correctif ; celle-ci ne peut être satisfaite que par la RÈGLE.
    //
    // ⚠️ L'aiguille est `SHIP-SPEC-02`, pas `__probe__` : deux assertions ci-dessus nomment
    // déjà ce paquet pour d'autres motifs, donc `__probe__` serait satisfait sans que la
    // règle du workspace privé ait rien vu. C'est le précédent documenté plus haut pour
    // `MH-03` et pour le check 5.
    fs.mkdirSync(path.join(PROBE_DIR, "dist", "types"), { recursive: true });
    fs.writeFileSync(
        path.join(PROBE_DIR, "dist", "types", "index.d.ts"),
        'import type { ProbeShipped } from "@geoleaf/build-config";\n' +
            "export declare function probeShipped(): ProbeShipped;\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "dist", "index.js"),
        "export function probeShipped() {\n    return null;\n}\n"
    );

    // ── Variante .mjs ─────────────────────────────────────────────────────────
    //
    // Le check 1b ne testait que `.cjs` à sa pose ; l'extension aux `.mjs` a sa PROPRE
    // assertion, sinon la fixture `.cjs` ci-dessus suffirait à la faire passer alors
    // que toute la moitié ESM de la règle aurait pu régresser — même patron que le
    // specifier nu de `verify-test-load-mode` plus haut.
    //
    // Ce fichier éprouve aussi, en négatif, l'exemption STRUCTURELLE des configs
    // rollup : il est nommé `probe-throwaway.mjs` et non `rollup-quickfix.mjs`, mais
    // c'est le même point — l'exemption est indexée sur des basenames EXACTS
    // (`rollup.config.mjs`, `rollup.consumer.mjs`), pas sur un glob `rollup*.mjs` qui
    // aurait fait du préfixe une cachette.
    fs.writeFileSync(
        path.join(PROBE_DIR, "probe-throwaway.mjs"),
        "// T3.5 probe — throwaway ESM script at a package root.\nexport const probe = true;\n"
    );
}

/** Add `packages/plugins/*` to the workspace globs so the registry can see the probe. */
function declareNestedGlob() {
    pkgJsonBackup = fs.readFileSync(PKG_JSON, "utf8");
    const pkg = JSON.parse(pkgJsonBackup);
    if (!pkg.workspaces.includes("packages/plugins/*")) {
        // Inserted before the negations so `!packages/_*` still applies last.
        pkg.workspaces = pkg.workspaces
            .filter((w) => !w.startsWith("!"))
            .concat(["packages/plugins/*"])
            .concat(pkg.workspaces.filter((w) => w.startsWith("!")));
    }
    fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 4) + "\n");
}

/**
 * Remove ONLY what this script created.
 *
 * ⚠️ This function previously did `rmSync("packages/plugins", {recursive:true})`.
 * That was safe exactly as long as `packages/plugins/` did not otherwise exist —
 * and it stopped being safe the moment ARCHI S10.1 made it the home of 13 plugins.
 * Running the probe then DELETED all 13 (557 files, recovered from the git index,
 * which held them because the move had been staged with `git mv`).
 *
 * The lesson is not "be careful with rm". It is that a cleanup routine must never
 * remove a path it did not create: `createdPluginsDir` records whether this run is
 * the one that made the directory, and nothing else is ever removed.
 */
function cleanup() {
    if (KEEP) return;
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
    // Only remove the parent if THIS run created it, and only when empty.
    if (createdPluginsDir) {
        try {
            fs.rmdirSync(path.join(ROOT, "packages", "plugins"));
        } catch {
            // Not empty — it holds real packages. Leaving it is the correct outcome.
        }
    }
    if (pkgJsonBackup !== null) fs.writeFileSync(PKG_JSON, pkgJsonBackup);
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const results = [];

/**
 * Run a gate and assert it MENTIONS the probe.
 *
 * Mentioning matters more than exiting non-zero: a gate can legitimately be
 * baseline-tolerant and still exit 0, but if it never names the probe it did not
 * look at it. Silence is the failure mode being hunted.
 */
function assertGateSees(label, argv, needle = "__probe__") {
    const res = spawnSync("node", argv, { cwd: ROOT, encoding: "utf8" });
    const out = (res.stdout || "") + (res.stderr || "");
    const saw = out.includes(needle);
    results.push({
        label,
        ok: saw,
        detail: saw ? `exit ${res.status}` : `n'a jamais nommé la sonde (${needle})`,
    });
}

/** Assert a structural fact about the repo, evaluated by `fn`. */
function assertThat(label, fn, pending) {
    let ok = false;
    let detail = "";
    try {
        const r = fn();
        ok = r === true || (r && r.ok);
        detail = (r && r.detail) || "";
    } catch (err) {
        detail = err.message;
    }
    results.push({ label, ok, detail, pending });
}

/**
 * Contrôles connus comme rouges, avec l'échéance qui les ferme.
 *
 * Ces deux-là sont des GLOBS de configuration (`packages/*​/src/**`) qui doivent
 * changer exactement au moment du déplacement, pas avant : les corriger
 * séparément rendrait le commit du S10.1 incohérent avec l'arborescence. Ils sont
 * donc attendus rouges jusqu'à ce sprint, et la sonde le dit au lieu de se taire.
 *
 * Même patron que `check-orphan-exports` et `check-config-consumers` : une
 * baseline explicite, plutôt qu'une gate durablement rouge que plus personne ne
 * lit. Un contrôle ici NON listé qui échoue fait sortir la sonde en 1.
 *
 * ⚠️ Vider cette liste fait partie du critère de sortie du S10.1.
 */
const PENDING = {
    // Vidée par ARCHI S10.1, comme son critère de sortie l'exigeait.
    //   - lint-staged : `packages/*/src/**` → `packages/**/src/**` (il ne reçoit que
    //     des fichiers indexés, donc `node_modules` est hors sujet).
    //   - purgecss : passé au REGISTRE plutôt qu'à un glob élargi — `packages/**`
    //     traversait `node_modules` (13 `.ts` de dépendances entraient dans le
    //     contenu scanné, ce qui masque du CSS réellement mort).
};

// ─── Run ──────────────────────────────────────────────────────────────────────

try {
    plantProbe();
    declareNestedGlob();

    console.log(`${C.c}── Sonde plantée : ${PROBE_REL} ──${C.x}\n`);

    // ── Famille A — visibilité de gate ────────────────────────────────────────
    console.log(`${C.d}Famille A — la gate voit-elle encore un package imbriqué ?${C.x}`);
    assertGateSees("verify-no-leaflet", ["scripts/verify-no-leaflet.cjs"]);
    assertGateSees("check-package-files", ["scripts/check-package-files.cjs"]);
    assertGateSees("check-versions", ["scripts/check-versions.cjs"]);
    assertGateSees("check-i18n-dict-shape", ["scripts/check-i18n-dict-shape.cjs"]);
    assertGateSees("count-any", ["scripts/count-any.cjs"]);
    // verify-plugin-shared-fork énumère `registry.all()` : la sonde __probe__ porte
    // `src/fork.ts` (une re-définition de `coreConfigGet`, hors baseline), donc PSF-01
    // doit la nommer. Si le gate cesse d'énumérer les packages imbriqués, il se tait ici.
    assertGateSees("verify-plugin-shared-fork", ["scripts/verify-plugin-shared-fork.cjs"]);
    // check-facade-purity : la sonde porte un `src/public-api.ts` non conforme (état
    // mutable + ternaire), donc la moitié plugin du gate doit le nommer. Sans elle, le
    // gate resterait vert en n'énumérant que les paquets qu'il voit encore.
    assertGateSees("check-facade-purity (plugins)", ["scripts/check-facade-purity.cjs"]);
    // check-exact-optional-debt : la sonde porte `src/widened.ts`, une propriété élargie hors
    // baseline, donc EOD-01 doit la nommer. Sans cette assertion, un gate qui cesserait
    // d'énumérer les paquets imbriqués sortirait vert en n'ayant scanné que le core.
    assertGateSees("check-exact-optional-debt", ["scripts/check-exact-optional-debt.cjs"]);
    // check-nonnull-assertion-debt : la sonde porte `src/asserted-index.ts`, un `xs[0]!`, donc
    // NNA-04 doit le nommer. C'est la règle sans baseline du cliquet Q5 : si le gate cessait
    // d'énumérer les paquets imbriqués, un plugin pourrait solder ses erreurs
    // `noUncheckedIndexedAccess` à coups d'assertions sans que rien ne rougisse.
    assertGateSees("check-nonnull-assertion-debt", ["scripts/check-nonnull-assertion-debt.cjs"]);
    assertGateSees("verify-test-load-mode", ["scripts/verify-test-load-mode.cjs"]);
    // Le specifier NU a sa propre assertion : sans elle, la sonde relative suffirait à
    // faire passer le contrôle alors que la moitié des formes échapperait à la gate.
    assertGateSees(
        "verify-test-load-mode (specifier nu)",
        ["scripts/verify-test-load-mode.cjs"],
        "probe-bare.test.js"
    );
    // ARCHI S11 — check-module-headers walks every package's `src/` through the registry.
    // The probe's own sources carry no module header and are absent from the baseline, so
    // MH-01 must name them. This is the check that would catch the inventory silently
    // ceasing to see a nested package: it would then report "0 new undocumented files"
    // and exit 0 — green, having scanned nothing, which is the exact class this file hunts.
    assertGateSees("check-module-headers", ["scripts/check-module-headers.cjs"]);
    // STRUCT S5 — MH-03 interdit `@module`, et la règle tient à ZÉRO dans le dépôt : sans
    // défaut planté elle ne peut plus jamais rougir. L'aiguille est `MH-03` et non
    // `__probe__`, sinon l'assertion serait déjà satisfaite par MH-01, qui nomme la sonde
    // pour un tout autre motif — et MH-03 pourrait cesser de voir un paquet imbriqué sans
    // que rien ne le signale. Le défaut vit dans `src/probe-load.ts` (cf. plantProbe).
    assertGateSees("check-module-headers (MH-03)", ["scripts/check-module-headers.cjs"], "MH-03");
    // API publique S3.4 — même raison, même classe. `check-event-map-coverage` est
    // baseline-tolérante : elle sort 0 tant qu'aucun nom NOUVEAU n'apparaît, y compris si
    // son corpus est vide. Le jour où `registry.all()` cesse de voir un paquet, elle
    // annoncerait « aucun nouveau, aucun périmé » — verte, sur zéro fichier lu. La sonde
    // plantée dans `packages/plugins/__probe__/` porte un littéral `geoleaf:*` inconnu des
    // deux maps et absent de la baseline : la gate DOIT le nommer.
    assertGateSees("check-event-map-coverage", ["scripts/check-event-map-coverage.cjs"]);
    // T3.5 — après le T3.2 le dépôt ne contient plus AUCUN `<pkg>/scripts/`, donc un check
    // ainsi borné serait resté vide-vert à vie, sans rien à regarder. `probe-throwaway.cjs`
    // est son seul défaut vivant : absent de `CJS_OUTSIDE_SCRIPTS_ALLOWLIST` par
    // construction, donc la gate doit le NOMMER. L'aiguille est le nom de fichier plutôt
    // que `__probe__`, sinon une autre catégorie mentionnant le package de sonde
    // satisferait l'assertion sans que le check 1b ait rien vu.
    assertGateSees(
        "verify-repo-hygiene (cjs hors scripts/)",
        ["scripts/verify-repo-hygiene.cjs"],
        "probe-throwaway.cjs"
    );
    // La moitié ESM a sa propre assertion : le check 1b ne testait que `.cjs` à sa pose,
    // et le registre de `scripts/` disciplinait 64 `.cjs` pour 0 `.mjs` alors que le
    // nouvel outillage s'écrit en ESM. Sans cette ligne, la fixture `.cjs` ci-dessus
    // suffirait à faire passer le contrôle.
    assertGateSees(
        "verify-repo-hygiene (mjs hors scripts/)",
        ["scripts/verify-repo-hygiene.cjs"],
        "probe-throwaway.mjs"
    );
    // T4.1 — les trois assertions du check 5 et de son pendant npm. Aiguilles = fragments
    // de CHEMIN, jamais `__probe__` seul : deux assertions ci-dessus nomment déjà ce
    // package via `probe-throwaway.*`, donc `__probe__` serait satisfait par une autre
    // catégorie sans que le check 5 ait rien vu (le précédent est documenté plus haut).
    assertGateSees(
        "verify-repo-hygiene (artefact généré sous contrôle git)",
        ["scripts/verify-repo-hygiene.cjs"],
        "__probe__/docs/api"
    );
    assertGateSees(
        "verify-repo-hygiene (producteur hors périmètre)",
        ["scripts/verify-repo-hygiene.cjs"],
        "docs/__probe-api__"
    );
    assertGateSees(
        "check-package-files (artefact embarqué par files[])",
        ["scripts/check-package-files.cjs"],
        "__probe__/docs/api"
    );
    // SHIP-SPEC (passage public S1.6) — la sonde porte `dist/types/index.d.ts` important
    // `@geoleaf/build-config`, un workspace `private: true`. SHIP-SPEC-02 est SANS baseline,
    // donc la gate doit le NOMMER, et son corpus se dérive de `registry.all()` : le jour où
    // le registre cesserait de voir un paquet imbriqué, cette assertion tomberait avant que
    // la gate n'annonce « 0 fuite » sur un corpus amputé. Aiguille = le code de la règle.
    assertGateSees(
        "check-shipped-specifiers (SHIP-SPEC-02)",
        ["scripts/check-shipped-specifiers.cjs"],
        "SHIP-SPEC-02"
    );

    // LIC-HEADERS (passage public S3) — la sonde plante huit `src/*.ts` SANS bandeau `/*!`,
    // donc LIC-01 doit les nommer. Le corpus vient de `source-inventory.collect()`, qui
    // dérive de `registry.all()` : si le registre cessait de voir un paquet imbriqué, la
    // gate annoncerait « bandeau canonique » sur un corpus amputé — et son plancher LIC-03,
    // posé à 700 fichiers, ne verrait rien puisque le core à lui seul en pèse 530.
    // C'est exactement la cécité que cette sonde existe pour rendre bruyante.
    assertGateSees("check-license-headers (LIC-01 voit un paquet imbriqué)", [
        "scripts/check-license-headers.cjs",
    ]);

    // `verify-plugin-core-boundary` n'énumère pas les packages : elle scanne
    // exactement les 2 clés de sa BASELINE, et n'imprime qu'un résumé. Deux
    // assertions successives ont dû être corrigées ici avant de tomber juste :
    // « nomme-t-elle la sonde ? » (elle ne scanne pas les autres packages) puis
    // « nomme-t-elle ses cibles ? » (elle ne les imprime pas). La propriété qui
    // compte vraiment est la RÉSOLUTION : ses cibles doivent rester trouvables, et
    // leur perte doit être bruyante. `requireByDirName` jette désormais, donc un
    // exit 0 prouve que la résolution a abouti — et on vérifie en plus que les
    // répertoires résolus contiennent bien des sources à scanner.
    assertThat("verify-plugin-core-boundary : résout ses cibles sous imbrication", () => {
        const res = spawnSync("node", ["scripts/verify-plugin-core-boundary.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        if (res.status !== 0) {
            return { ok: false, detail: `exit ${res.status} — résolution rompue` };
        }
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const registry = require("./lib/packages.cjs");
        registry.reset();
        const empty = [];
        for (const dirName of ["editor", "offline-ui"]) {
            const pkg = registry.requireByDirName(dirName);
            const srcDir = path.join(pkg.absDir, "src");
            if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) empty.push(dirName);
        }
        return {
            ok: empty.length === 0,
            detail: empty.length
                ? `périmètre vide : ${empty.join(", ")}`
                : "2/2 cibles résolues et non vides",
        };
    });

    // ── Famille B — armement de règle ─────────────────────────────────────────
    console.log(`\n${C.d}Famille B — la règle existe-t-elle encore ?${C.x}`);

    // Même classe que verify-plugin-core-boundary, trouvée par balayage après que
    // la sonde a révélé le motif : des chemins construits en dur sous `packages/`
    // dans des gates qui n'énumèrent pas. `verify-core-standalone` est le cas le
    // plus grave — CLAUDE.md qualifie sa règle de non négociable, et SYNC-01b
    // aurait cessé de scanner le connector sans un mot. `verify-repo-hygiene`
    // perdait de même son contrôle des 700 lignes.
    assertThat("gates à chemins durs : cibles mobiles résolues", () => {
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const registry = require("./lib/packages.cjs");
        registry.reset();
        // T5.5 — `core` ajouté. Il était absent parce que ses chemins étaient LITTÉRAUX
        // dans une quinzaine de gates, sous la justification écrite que « le core
        // reste » : rien à résoudre, donc rien à surveiller. Les gates passent
        // maintenant par le registre, et ce contrôle porte enfin sur le paquet que le
        // dépôt lit le plus.
        // STRUCT S2 (F9) — `host-runtime` ajouté. Il était absent alors qu'il est devenu la
        // cible de 3 des 6 seams de `verify-seam-drift` et la source du symbole dérivé de
        // `verify-plugin-shared-fork` : deux gates qui cessent de garder quoi que ce soit si
        // ce paquet devient irrésoluble.
        const targets = ["core", "connector", "offline-ui", "field-renderer", "host-runtime"];
        const missing = [];
        for (const dirName of targets) {
            try {
                const srcDir = path.join(registry.requireByDirName(dirName).absDir, "src");
                if (!fs.existsSync(srcDir)) missing.push(dirName);
            } catch {
                missing.push(dirName);
            }
        }
        return {
            ok: missing.length === 0,
            // ⚠️ Compte DÉRIVÉ. Il était écrit « 4/4 » en dur, et a menti à la seconde
            // près où ce sprint a ajouté un 5ᵉ paquet : la sonde annonçait 4 cibles en
            // en ayant vérifié 5. Un chiffre qui ne peut pas se tromper parce qu'il ne
            // mesure rien, dans le fichier même qui traque cette forme de défaut.
            detail: missing.length
                ? `introuvables : ${missing.join(", ")}`
                : `${targets.length}/${targets.length} résolues`,
        };
    });

    // STRUCT S2 (F9) — `verify-seam-drift` n'avait AUCUNE assertion dans cette sonde, alors
    // que son propre docblock (`:39-41`) se réclamait de sa protection. Un docblock qui
    // invoque une gate qui ne le couvre pas est exactement le mode d'échec n°3 que
    // `verify-host-contract-sync.cjs:46-50` décrit.
    //
    // Ce qu'on vérifie n'est pas la dérive (la gate le fait, et elle jette) mais le
    // RÉTRÉCISSEMENT du registre, sa seule panne muette avant S2 : le message de succès ne
    // comptait que les seams, jamais les fichiers, et un `files[]` amputé passait sans un
    // mot. Preuve historique dans le fichier lui-même : le seam `storage-contract`, supprimé
    // au S4.4, a fait passer le compteur de 4 à 3 sans que rien ne l'observe.
    //
    // Le plancher est lu DEPUIS la gate, jamais recopié ici — un chiffre dupliqué dans une
    // sonde est un chiffre qui mentira, ce que l'assertion précédente s'est reproché.
    assertThat("verify-seam-drift : plancher de couverture présent et armé", () => {
        const src = fs.readFileSync(path.join(ROOT, "scripts", "verify-seam-drift.cjs"), "utf8");
        const floor = src.match(/const FLOOR = \{ seams: (\d+), files: (\d+) \}/);
        if (!floor) return { ok: false, detail: "FLOOR absent — le plancher a été retiré" };
        const guards =
            /SEAMS\.length < FLOOR\.seams \|\| fileCount < FLOOR\.files/.test(src) &&
            /fileCount = SEAMS\.reduce/.test(src);
        return {
            ok: guards,
            detail: guards
                ? `plancher ${floor[1]} seams / ${floor[2]} fichiers, comparaison en place`
                : "FLOOR déclaré mais jamais comparé — la gate ne garde rien",
        };
    });

    assertThat("registre : la sonde est énumérée", () => {
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const registry = require("./lib/packages.cjs");
        registry.reset();
        const hit = registry.all().find((p) => p.dirName === "__probe__");
        return { ok: Boolean(hit), detail: hit ? hit.dir : "absente du registre" };
    });

    // Passage public S12.2 — `docs-paths.cjs` est la racine commune de SPECS-PATHS,
    // GUIDES-PATHS et TSDOC-PATHS, trois gates posées entre le 11 et le 12/08/2026 dont
    // AUCUNE n'était exercée ici.
    //
    // ⚠️ Le risque est le sien propre, et il est muet : ces gates rendent « N chemins cités,
    // 0 mort ». Si une sous-racine cesse de résoudre, le corpus tombe à zéro et le verdict
    // reste **vert** — la forme exacte du « vert qui n'a rien scanné » que cette sonde traque
    // partout ailleurs. Le module s'en défend par un `throw` dans `requireRoot()` ; ce qui
    // suit vérifie que cette défense EXISTE ENCORE, et qu'elle porte sur un corpus non vide.
    //
    // 📌 La racine INTERNE est délibérément hors périmètre : `docs-paths` reporte son
    // assertion au premier `internal()`, précisément pour que le clone public — qui n'a pas
    // `_docs_projet/` — ne meure pas à l'import. Exiger ici sa présence rendrait la sonde
    // rouge là-bas, c'est-à-dire dans le seul dépôt où ces trois gates comptent le plus.
    assertThat("docs-paths : sous-racines résolues et corpus non vide", () => {
        delete require.cache[require.resolve("./lib/docs-paths.cjs")];
        const dp = require("./lib/docs-paths.cjs");

        // Le garde-fou du module, lu DANS sa source : un `throw` retiré rendrait toutes les
        // sous-racines silencieusement optionnelles.
        const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "docs-paths.cjs"), "utf8");
        if (!/function requireRoot[\s\S]*?throw new Error\(/.test(src)) {
            return {
                ok: false,
                detail: "requireRoot ne JETTE plus — une racine absente passerait",
            };
        }

        // Compte DÉRIVÉ des sous-racines publiques, jamais une liste recopiée : ajouter une
        // 4ᵉ sous-racine sans l'exercer ici serait exactement le défaut de l'assertion
        // voisine, qui annonçait « 4/4 » en en vérifiant 5.
        const roots = ["specs", "reference", "guides"].map((k) => [k, dp[k]()]);
        const missing = roots.filter(([, abs]) => !fs.existsSync(abs)).map(([k]) => k);
        if (missing.length) return { ok: false, detail: `sous-racine(s) absente(s) : ${missing}` };

        const counts = roots.map(([k, abs]) => {
            const n = fs
                .readdirSync(abs, { recursive: true, withFileTypes: true })
                .filter((e) => e.isFile() && e.name.endsWith(".md")).length;
            return [k, n];
        });
        const empty = counts.filter(([, n]) => n === 0).map(([k]) => k);
        return {
            ok: empty.length === 0,
            detail: empty.length
                ? `corpus VIDE : ${empty.join(", ")} — la gate sortirait verte sans rien lire`
                : counts.map(([k, n]) => `${k} ${n}`).join(" · ") + " fichiers .md",
        };
    });

    // T5.1bis — `deploy-docs.cjs` est le script le plus destructeur du dépôt (`rmSync`
    // récursif sur une cible EXTERNE) et il n'est invoqué par AUCUNE CI : ni `ci-local`,
    // ni `ci.yml`, ni le hook. Sa correction la plus importante — l'ordre
    // détruire/constater de `syncDir` — n'était donc gardée que par les mutations
    // manuelles du sprint. Ici elle est exercée à chaque `ci:local`.
    //
    // ⚠️ Le cas qui compte est le NÉGATIF : source absente ⇒ la destination doit être
    // INTACTE. Avant T5.1, `rmSync(dest)` tournait d'abord et `copyDir` se contentait d'un
    // `console.warn` — la doc publiée disparaissait et le script sortait 0.
    assertThat("deploy-docs : syncDir ne détruit pas avant de constater", () => {
        delete require.cache[require.resolve("./deploy-docs.cjs")];
        const { syncDir, resolveSiteRoot, DeployError } = require("./deploy-docs.cjs");
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-probe-deploy-"));
        const failures = [];
        const attend = (label, fn) => {
            try {
                fn();
                failures.push(`${label} : aucune erreur levée`);
            } catch (err) {
                if (!(err instanceof DeployError)) failures.push(`${label} : ${err.message}`);
            }
        };
        try {
            const dest = path.join(scratch, "docs");
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, "sentinelle.txt"), "DOC EN LIGNE");
            const alive = () => fs.existsSync(path.join(dest, "sentinelle.txt"));

            // 1. Source absente → jette, et la sentinelle survit.
            attend("source absente", () => syncDir(path.join(scratch, "nexiste-pas"), dest));
            if (!alive()) failures.push("source absente : la destination a été DÉTRUITE");

            // 2. Source vide → même exigence. Publier un répertoire vide efface la doc
            //    tout aussi sûrement qu'une source manquante.
            const vide = path.join(scratch, "vide");
            fs.mkdirSync(vide, { recursive: true });
            attend("source vide", () => syncDir(vide, dest));
            if (!alive()) failures.push("source vide : la destination a été DÉTRUITE");

            // 3. Source réelle → remplacement effectif. Sans ce cas positif, un `syncDir`
            //    qui ne ferait PLUS RIEN passerait les deux assertions ci-dessus.
            const plein = path.join(scratch, "plein");
            fs.mkdirSync(plein, { recursive: true });
            fs.writeFileSync(path.join(plein, "index.html"), "<!doctype html>");
            try {
                syncDir(plein, dest);
            } catch (err) {
                failures.push(`source réelle : a jeté (${err.message})`);
            }
            if (!fs.existsSync(path.join(dest, "index.html"))) {
                failures.push("source réelle : rien n'a été copié");
            }
            if (alive()) failures.push("source réelle : la sentinelle survit — pas remplacé");

            // 4. Les gardes de la cible externe, sur les 3 valeurs qu'aucune ne doit
            //    laisser passer. `resolveSiteRoot` reçoit ses paramètres explicitement :
            //    la sonde n'a pas à muter `process.env`.
            attend("racine FS", () => resolveSiteRoot(path.parse(ROOT).root, ROOT));
            attend("racine du dépôt", () => resolveSiteRoot(ROOT, ROOT));
            attend("chemin dans le dépôt", () => resolveSiteRoot(path.join(ROOT, "scripts"), ROOT));
            attend("variable vide", () => resolveSiteRoot("   ", ROOT));
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
        return {
            ok: failures.length === 0,
            detail: failures.length ? failures.join(" · ") : "3 cas syncDir + 4 gardes de cible",
        };
    });

    // T5.8 — la gate « tout script de ci:local est tracé » résout-elle encore un graphe ?
    //
    // Son mode de panne n'est pas de rougir à tort, c'est de rétrécir : un `npm run`
    // renommé, une table restructurée, et le graphe tombe à quelques scripts sans qu'une
    // seule erreur soit levée. « 0 script non tracé » devient alors vrai et vide de sens.
    // Elle porte son propre plancher (MIN_RESOLVED) ; ce contrôle-ci vérifie que ce
    // plancher est LARGEMENT franchi, donc qu'il reste un plancher et pas un plafond.
    assertThat("ci-scripts-tracked : le graphe d'invocation ne s'est pas effondré", () => {
        const res = spawnSync("node", ["scripts/verify-ci-scripts-tracked.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const out = (res.stdout || "") + (res.stderr || "");
        const m = out.match(/(\d+) script\(s\) atteignable/);
        const n = m ? Number(m[1]) : 0;
        return {
            ok: res.status === 0 && n >= 40,
            detail:
                res.status !== 0
                    ? `exit ${res.status} — la gate elle-même est rouge`
                    : `${n} scripts résolus (attendu ≥ 40)`,
        };
    });

    // ── CI-PARITY — les trois modes d'échec, rejoués à chaque run ─────────────
    //
    // La gate de parité affirme que toute gate de `ci.yml` est lancée par `ci:local` ou
    // exemptée avec son témoin. Une garde qu'on n'a jamais VUE rougir ne garde rien : ces
    // trois assertions mutent une COPIE du workflow (crochet `GEOLEAF_CI_WORKFLOW_DIR`) et
    // exigent le code de diagnostic exact. Le code, pas une aiguille générique — ce fichier
    // documente déjà deux fois qu'une aiguille trop large se fait satisfaire par une AUTRE
    // catégorie sans que le contrôle visé ait rien vu.
    //
    // Le crochet existe pour ça et rien d'autre : sans lui, prouver la gate exigerait de
    // modifier le vrai `ci.yml` — donc on ne le ferait qu'une fois, à la pose, et jamais plus.
    // Retirer le crochet fait rougir ces trois lignes, ce qui est le but.
    const parityMutation = (label, mutate, expectedCode) =>
        assertThat(`ci-parity : ${label} (${expectedCode})`, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-parity-"));
            try {
                const src = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
                fs.writeFileSync(path.join(dir, "ci.yml"), mutate(src));
                const res = spawnSync("node", ["scripts/verify-ci-parity.cjs"], {
                    cwd: ROOT,
                    encoding: "utf8",
                    env: { ...process.env, GEOLEAF_CI_WORKFLOW_DIR: dir },
                });
                const out = (res.stdout || "") + (res.stderr || "");
                const named = out.includes(expectedCode);
                return {
                    ok: res.status !== 0 && named,
                    detail:
                        res.status === 0
                            ? `SORTIE VERTE sur un workflow muté — la gate ne voit pas ${expectedCode}`
                            : named
                              ? `rouge, et ${expectedCode} nommé`
                              : `rouge, mais ${expectedCode} jamais nommé (rougit pour une autre raison)`,
                };
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

    // 1. La propriété. `count-any.cjs` est choisi exprès : il existe, il est déclaré, il est
    //    tracé, `npm run count:any` le définit — il franchit donc tous les contrôles voisins
    //    et ne peut échouer QUE sur la parité.
    parityMutation(
        "une gate de ci.yml absente de STEPS",
        (src) =>
            `${src}\n            - name: Sonde de parite\n              run: node scripts/count-any.cjs\n`,
        "PARITY-03"
    );

    // 2. Le pourrissement. Retirer la CAUSE d'une exemption doit la faire rougir, pas la
    //    rendre silencieusement inutile.
    parityMutation(
        "une exemption dont la cause a disparu",
        (src) =>
            src
                .split("\n")
                .filter((l) => !/^\s+- run: npm ci\s*$/.test(l))
                .join("\n"),
        "PARITY-04"
    );

    // 3. La cécité. Sur un corpus tronqué, « 0 feuille non couverte » est VRAI et vide de
    //    sens : la gate doit refuser de conclure au lieu de rassurer.
    // ⚠️ LA TRONCATURE EST DÉRIVÉE, ET ELLE L'EST PARCE QU'UN NUMÉRO EN DUR A POURRI.
    // Cette mutation a été `slice(0, 40)` jusqu'au 09/08/2026. Puis l'en-tête de `ci.yml` a
    // grandi — un bloc `permissions:` et un paragraphe sur la fin de Node 20 sur les runners —
    // et `jobs:` est passé à la ligne 43. Les 40 premières lignes ne contenaient donc plus
    // aucun job : la gate rougissait bien, mais sur « corpus illisible » et non sur PARITY-01.
    // La sonde échouait ainsi en signalant exactement ce qu'elle existe pour trouver — une
    // garde qui ne rougit plus pour la bonne raison —, et le défaut n'était pas dans la gate.
    //
    // 🛑 Un corpus effondré doit rester LISIBLE. Couper à `steps:` produit « `steps:` sans
    // aucune étape », encore une erreur de lecture ; il faut un workflow bien formé dont les
    // décomptes passent sous les planchers de `FLOOR` (`ci-parity.cjs`). Trois étapes le font,
    // et le nombre est petit devant tous les planchers plutôt qu'ajusté à l'un d'eux.
    parityMutation(
        "un corpus effondré (refus de conclure)",
        (src) => {
            const lines = src.split("\n");
            const stepsAt = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
            if (stepsAt === -1) {
                throw new Error(
                    "probe: aucun bloc `steps:` dans ci.yml — la mutation ne peut plus " +
                        "construire de corpus effondré, et la sonde rougirait pour une raison " +
                        "qui n'est pas celle qu'elle instruit."
                );
            }
            let seen = 0;
            let end = stepsAt + 1;
            for (; end < lines.length; end++) {
                if (/^\s+-\s/.test(lines[end]) && ++seen > 3) break;
            }
            return lines.slice(0, end).join("\n");
        },
        "PARITY-01"
    );

    // Contre-épreuve : sans mutation, la même gate doit être VERTE. Sans cette ligne, trois
    // rouges ne prouveraient qu'une chose — que la gate rougit toujours.
    assertThat("ci-parity : verte sur le workflow réel (contre-épreuve)", () => {
        const res = spawnSync("node", ["scripts/verify-ci-parity.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        return {
            ok: res.status === 0,
            detail: res.status === 0 ? "exit 0" : `exit ${res.status} — la gate est rouge en vrai`,
        };
    });

    // ── CONSUMER-CONTRACT — la gate qui SAUTE par défaut, donc la plus fragile ──
    //
    // 🛑 **C'est le cas limite de tout ce fichier.** `verify-consumer-contract.cjs` sort 0 en
    // sautant, avec un motif nommé, dès que `GEOLEAF_CONSUMERS` n'est pas défini — ce qui est
    // le cas sur le runner CI, sur le clone public, et sur toute machine où l'opérateur n'a
    // pas exporté le crochet. Son manifeste vit chez le consommateur : il nomme un client, un
    // contact et des chemins Odoo (décision ④), et aucun chemin par défaut n'est écrit dans
    // `scripts/`, qui part intégralement dans le clone public.
    //
    // Une gate dont l'état NORMAL est « sautée » est indiscernable d'une gate morte. Ces trois
    // assertions sont la seule chose qui les distingue : elles plantent un manifeste de
    // FIXTURE dans un répertoire temporaire, via le crochet, et exigent le code de diagnostic
    // EXACT. **Elles ne prouvent pas que le vrai manifeste est lu — elles prouvent que la gate
    // MORD ENCORE**, et le docblock de la gate le dit dans ces termes plutôt que de le
    // sous-entendre.
    //
    // Le crochet existe pour ça et rien d'autre, exactement comme `GEOLEAF_CI_WORKFLOW_DIR`
    // plus haut : sans lui, prouver la gate exigerait de modifier le manifeste RÉEL, dans un
    // AUTRE dépôt — donc on ne le ferait qu'une fois, à la pose, et jamais plus.
    const consumerFixture = (label, mutate, expectedNeedle, expectedStatus) =>
        assertThat(`consumer-contract : ${label}`, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-consumers-"));
            try {
                // Le manifeste de fixture est écrit ICI, jamais copié d'un chemin de machine :
                // une fixture qui dépend d'un fichier présent sur le poste ferait passer la
                // sonde chez celui qui l'a et rougir chez les autres.
                const base = {
                    consumer: "sonde-gate-probe",
                    manifest_version: "1.4.0",
                    repos: ["__probe__"],
                    contact: "sonde@example.invalid",
                    required: {
                        public: [{ path: "Core.getMap", provider: "core", usedBy: ["sonde"] }],
                        private_tolerated: [],
                        events: [],
                        dom_contract: [],
                    },
                    not_required: {},
                    requested: [],
                    requested_events: [],
                    withdrawn: {},
                    broken_since_v3: {},
                    out_of_scope: {},
                    oracles: {},
                    sequence: [],
                    policy: "sonde",
                };
                fs.writeFileSync(
                    path.join(dir, "sonde.consumer.json"),
                    JSON.stringify(mutate(base), null, 4) + "\n"
                );
                const res = spawnSync("node", ["scripts/verify-consumer-contract.cjs"], {
                    cwd: ROOT,
                    encoding: "utf8",
                    env: { ...process.env, GEOLEAF_CONSUMERS: dir },
                });
                const out = (res.stdout || "") + (res.stderr || "");
                const named = out.includes(expectedNeedle);
                return {
                    ok: res.status === expectedStatus && named,
                    detail:
                        res.status !== expectedStatus
                            ? `exit ${res.status} au lieu de ${expectedStatus}` +
                              (res.status === 0 ? " — SORTIE VERTE sur une fixture mutée" : "")
                            : named
                              ? `exit ${expectedStatus}, et ${expectedNeedle} nommé`
                              : `exit ${expectedStatus}, mais ${expectedNeedle} jamais nommé ` +
                                "(rougit pour une autre raison)",
                };
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

    // 1. LA PROPRIÉTÉ — un chemin `required.public` qui ne résout pas doit être NOMMÉ.
    //    `Core.getMap` est choisi parce qu'il résout aujourd'hui : seul le membre muté doit
    //    faire la différence, et l'assertion ne peut donc échouer QUE sur CC-01.
    consumerFixture(
        "un chemin required.public qui ne résout pas",
        (b) => {
            b.required.public.push({
                path: "Core.membreQuiNExistePas",
                provider: "core",
                usedBy: ["sonde"],
            });
            return b;
        },
        "CC-01",
        1
    );

    // 2. LE REFUS — une clé de premier niveau inconnue doit faire sortir en 2, pas en 1 : ce
    //    n'est pas une régression du contrat, c'est un schéma que le lecteur ne sait pas lire.
    //    Sans ce refus, une clé neuve chez le consommateur ne serait vérifiée par personne et
    //    la gate resterait verte sur la partie du contrat qu'elle ignore.
    consumerFixture(
        "une clé de premier niveau inconnue (refus de conclure)",
        (b) => ({ ...b, cleQueLeLecteurNeConnaitPas: true }),
        "CC-00",
        2
    );

    // 3. LA CÉCITÉ AU FICHIER — un manifeste plus ANCIEN que le plancher doit sortir en 2.
    //    C'est le seul garde-fou contre le mode « la gate a lu autre chose » : le manifeste
    //    réel vit dans un dépôt tiers, sur une branche, et un `git checkout` là-bas suffirait
    //    à remettre une version antérieure sous les pieds de la gate. Vert = catastrophe
    //    silencieuse ; ce contrôle l'interdit.
    consumerFixture(
        "un manifeste antérieur au plancher de version (cécité au fichier lu)",
        (b) => ({ ...b, manifest_version: "1.0.0" }),
        "plancher",
        2
    );

    // 4 et 5. LE CLIQUET DE DÉPRÉCIATION — un chemin qui QUITTE `required.public`.
    //
    // 🛑 **Les trois fixtures ci-dessus ne peuvent PAS atteindre CC-10, et une quatrième
    // écrite naïvement serait sortie VERTE en n'ayant rien exercé.** CC-10 compare le
    // manifeste à la baseline `positives`, qui est indexée PAR CONSOMMATEUR : avec le
    // `consumer: "sonde-gate-probe"` du gabarit, il n'y a rien à comparer et le code tombe
    // sur sa note « aucune liste positive en baseline ». La fixture doit donc emprunter
    // l'identité ET les chemins de la baseline réelle.
    //
    // ⚠️ **Elle les LIT au lieu de les recopier.** Une sonde qui inscrirait 45 chemins en dur
    // deviendrait une cinquième description concurrente de la même surface — le mode d'échec
    // que ce dépôt paie le plus cher, et qu'une garde contre les listes tenues à la main ne
    // doit pas reproduire en étant elle-même une liste tenue à la main.
    //
    // Les DEUX assertions sont indissociables : sans la contre-épreuve, un rouge ne prouve
    // qu'une chose — que la gate rougit toujours.
    {
        const baselineCC10 = JSON.parse(
            fs.readFileSync(path.join(ROOT, "scripts/.baselines/consumer-contract.json"), "utf8")
        );
        const posCC10 = (baselineCC10.positives ?? {})[baselineCC10._consumer];
        const RETIRE = "Config.clearThemesCache";

        // Le gabarit commun : la fixture EST le consommateur de la baseline, moins (ou non)
        // l'entrée témoin. `provider` est repris de la baseline — le défauter en `core` ferait
        // rougir `Ws` et `Measure.*` en CC-01, donc rougir la sonde pour un motif étranger.
        const commeLaBaseline = (retirer) => (b) => ({
            ...b,
            consumer: baselineCC10._consumer,
            required: {
                ...b.required,
                public: posCC10.public
                    .filter((e) => !retirer || e.path !== RETIRE)
                    .map((e) => ({ path: e.path, provider: e.provider, usedBy: ["sonde"] })),
                events: posCC10.events.map((e) => ({ name: e.path, listenedBy: ["sonde"] })),
            },
        });

        if (!posCC10 || !posCC10.public.some((e) => e.path === RETIRE)) {
            // Le témoin a disparu de la baseline : l'assertion ne pourrait plus rien montrer,
            // et une sonde qui ne peut plus prouver doit le DIRE, jamais verdir en silence.
            assertThat("consumer-contract : le témoin de CC-10 existe encore en baseline", () => ({
                ok: false,
                detail:
                    `\`${RETIRE}\` n'est plus dans la baseline positive de ` +
                    `\`${baselineCC10._consumer}\` — les deux assertions CC-10 ne mordent plus. ` +
                    "Choisir un autre témoin `provider: core` et le nommer ici.",
            }));
        } else {
            consumerFixture(
                "un chemin QUITTE required.public sans dépréciation (cliquet CC-10)",
                commeLaBaseline(true),
                RETIRE, // l'aiguille est le CHEMIN, pas « CC-10 » : un code générique se fait
                1 //      satisfaire par une autre catégorie d'erreur portant le même code
            );
            consumerFixture(
                "la même fixture, entrée NON retirée : CC-10 se tait (contre-épreuve)",
                commeLaBaseline(false),
                "engagement(s) du contrat inverse",
                0
            );
        }
    }

    // T5.7 — les motifs de jetables, sur témoins à réponse connue.
    //
    // Pourquoi une assertion STRUCTURELLE et non une fixture, alors que tout le reste de
    // ce fichier plante des fichiers : le corpus des checks 1/2/3 est `getTrackedFiles()`,
    // et la sonde plante délibérément SANS indexer — c'est ce qui la rend inoffensive.
    // Une fixture `fix-*.js` posée sur le disque ne serait donc jamais regardée, et
    // l'assertion sortirait verte en ne prouvant rien : la forme même du défaut que ce
    // fichier existe pour attraper.
    //
    // Les 4 témoins NÉGATIFS portent le vrai poids. L'énoncé du T5.7 proposait un motif
    // sans ancre `\b` ; il prend `prefix-loader.js`, `hotfix-runner.js` et
    // `suffix_map.cjs` — des noms ordinaires. Retirer l'ancre fait rougir cette ligne,
    // et elle seule.
    assertThat("hygiène : les motifs de jetables discriminent (7 témoins)", () => {
        delete require.cache[require.resolve("./lib/hygiene-patterns.cjs")];
        const { THROWAWAY_PATTERNS, THROWAWAY_WITNESSES } = require("./lib/hygiene-patterns.cjs");
        const wrong = THROWAWAY_WITNESSES.filter(
            (w) => THROWAWAY_PATTERNS.some((p) => p.re.test(w.path)) !== w.throwaway
        );
        return {
            ok: wrong.length === 0,
            detail: wrong.length
                ? wrong
                      .map((w) => `${w.path} (attendu ${w.throwaway ? "PRIS" : "ignoré"})`)
                      .join(", ")
                : `${THROWAWAY_WITNESSES.length}/${THROWAWAY_WITNESSES.length} témoins conformes`,
        };
    });

    // T6.2 — même exigence pour les motifs d'ARTEFACT, qui viennent d'accueillir
    // `^artifacts/`. Les 2 témoins NÉGATIFS portent le poids : `artifacts` et
    // `test-results` sont des noms de répertoire ORDINAIRES, légitimes à l'intérieur
    // d'un paquet. Retirer l'ancre `^` fait rougir cette ligne, et elle seule.
    assertThat("hygiène : les motifs d'artefacts discriminent (7 témoins)", () => {
        delete require.cache[require.resolve("./lib/hygiene-patterns.cjs")];
        const { ARTIFACT_PATTERNS, ARTIFACT_WITNESSES } = require("./lib/hygiene-patterns.cjs");
        const wrong = ARTIFACT_WITNESSES.filter(
            (w) => ARTIFACT_PATTERNS.some((p) => p.re.test(w.path)) !== w.artifact
        );
        return {
            ok: wrong.length === 0,
            detail: wrong.length
                ? wrong
                      .map((w) => `${w.path} (attendu ${w.artifact ? "PRIS" : "ignoré"})`)
                      .join(", ")
                : `${ARTIFACT_WITNESSES.length}/${ARTIFACT_WITNESSES.length} témoins conformes`,
        };
    });

    assertThat("cliquet anti-any : les globs des DEUX cliquets matchent des fichiers réels", () => {
        // A ratchet glob that matches nothing does not fail — it releases the lock
        // in silence. This is the single cheapest guard against that.
        //
        // CAPACITÉS S10 — two defects fixed here at once, both of the same shape:
        //
        //  1. This check used to re-list the 14 plugin NAMES by hand, a copy of
        //     ANY_HARDENED_PLUGIN_PACKAGES. A package added to the ratchet was therefore
        //     invisible to the probe — the guard against hand-maintained lists was itself
        //     a hand-maintained list.
        //  2. It never looked at the CORE ratchet (ANY_HARDENED, 12 globs) at all. That is
        //     precisely how 4 of those globs came to match zero files unnoticed
        //     (`utils/renderers`, `built-in/poi`, `built-in/filters`, `modules/optional` —
        //     directories emptied by the KERNEL sprints).
        //
        // Both are closed by reading the globs from the RESOLVED config module instead of
        // restating them: `eslint.config.mjs` is imported in a child process (it is ESM,
        // this script is CJS), and every block that elevates `no-explicit-any` to "error"
        // yields its `files`. The plugin globs come out already resolved through pkgGlob(),
        // so a package rename surfaces here too.
        const { globSync } = require("glob");
        const extract = `
            const cfg = (await import("./eslint.config.mjs")).default;
            const globs = [];
            for (const b of cfg) {
                if (b?.rules?.["@typescript-eslint/no-explicit-any"] !== "error") continue;
                for (const f of b.files ?? []) if (f.startsWith("packages/")) globs.push(f);
            }
            console.log(JSON.stringify(globs));
        `;
        const res = spawnSync("node", ["--input-type=module", "-e", extract], {
            cwd: ROOT,
            encoding: "utf8",
        });
        if (res.status !== 0) {
            return {
                ok: false,
                detail: `eslint.config.mjs illisible : ${(res.stderr || "").trim()}`,
            };
        }
        /** @type {string[]} */
        const globs = JSON.parse(res.stdout);
        // A ratchet that yields no glob at all is the worst outcome, and JSON.parse would
        // happily return [] for it — so the emptiness of the LIST is checked, not just of
        // each entry.
        if (globs.length === 0) return { ok: false, detail: "aucun glob de cliquet extrait" };
        const empty = globs.filter((g) => globSync(g, { cwd: ROOT }).length === 0);
        return {
            ok: empty.length === 0,
            detail: empty.length
                ? `verrous relâchés (${empty.length}/${globs.length}) : ${empty.join(", ")}`
                : `${globs.length}/${globs.length} armés`,
        };
    });

    assertThat("lint-staged : ses globs couvrent un package imbriqué", () => {
        const { minimatch } = require("minimatch");
        const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"));
        const globs = Object.keys(pkg["lint-staged"] || {});
        const target = `${PROBE_REL}/src/entry.ts`;
        const matched = globs.filter((g) => minimatch(target, g));
        return {
            ok: matched.length > 0,
            detail: matched.length ? matched.join(", ") : `aucun glob ne couvre ${target}`,
        };
    });

    assertThat("purgecss : périmètre imbriqué, et sans node_modules", () => {
        const { globSync } = require("glob");
        delete require.cache[require.resolve("./lib/purgecss-config.cjs")];
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const cfg = require("./lib/purgecss-config.cjs");

        const css = (cfg.CSS_GLOBS || []).flatMap((g) => globSync(g));
        const content = (cfg.CONTENT_GLOBS || []).flatMap((g) => globSync(g));
        const seesProbe = css.some((f) => f.includes("__probe__"));
        // Les deux moitiés comptent : un glob trop étroit rate du CSS vivant et le
        // purge ; un glob trop large aspire `node_modules` et masque du CSS mort.
        const leaked = [...css, ...content].filter((f) => f.includes("node_modules"));

        if (!seesProbe) return { ok: false, detail: "sonde hors périmètre CSS" };
        if (leaked.length)
            return { ok: false, detail: `${leaked.length} fichier(s) de node_modules aspirés` };
        return {
            ok: true,
            detail: `${css.length} css / ${content.length} contenus, 0 node_modules`,
        };
    });

    // T6.1 — la propriété qui JUSTIFIE l'existence de `verify-e2e-coverage.cjs`.
    //
    // Elle ne peut pas s'observer sur la fixture `__probe__` : le témoin ici est une
    // DONNÉE DE COUVERTURE VIDE, pas un paquet. On en fabrique une (un répertoire
    // temporaire sans aucun `.json`) et on vérifie les deux moitiés :
    //
    //   1. `nyc report` NU y sort VERT — `istanbul-lib-coverage/lib/percent.js` renvoie
    //      100 quand `total === 0`, `blankSummary()` renvoie `pct: 'Unknown'`, et la
    //      comparaison `'Unknown' < seuil` vaut `false`. C'est le trou.
    //   2. le wrapper y sort ROUGE, par son plancher de témoin. C'est la fermeture.
    //
    // Si un jour (1) devient rouge — correctif amont de nyc —, cette assertion le dira
    // au lieu de laisser le plancher devenir du code mort que plus personne ne motive.
    assertThat("couverture du boot : le plancher rattrape une donnée vide", () => {
        const vide = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-nyc-vide-"));
        try {
            const nu = spawnSync(
                "npx",
                ["nyc", "report", "--nycrc-path", "nyc.config.cjs", `--temp-dir=${vide}`],
                { cwd: ROOT, encoding: "utf8" }
            );
            const wrap = spawnSync("node", ["scripts/verify-e2e-coverage.cjs"], {
                cwd: ROOT,
                encoding: "utf8",
                env: { ...process.env, GEOLEAF_NYC_OUTPUT: vide },
            });

            const failures = [];
            if (nu.status !== 0) {
                failures.push(
                    `nyc nu sort ${nu.status} sur une donnée vide — le trou est refermé en amont, ` +
                        `le plancher du wrapper n'est plus motivé par ce cas (le documenter ou le retirer)`
                );
            }
            if (wrap.status === 0) {
                failures.push("le wrapper CONCLUT sur une donnée vide — le plancher ne mord pas");
            }
            return {
                ok: failures.length === 0,
                detail: failures.length
                    ? failures.join(" · ")
                    : `nyc nu = 0 (vert à tort), wrapper = ${wrap.status} (refuse de conclure)`,
            };
        } finally {
            fs.rmSync(vide, { recursive: true, force: true });
        }
    });

    // ── Q1.3 — le Service Worker livré est bien DANS le périmètre d'ESLint ──────
    //
    // `sw-core.js` est livré en production (cache offline, IndexedDB, Background
    // Sync) et a passé des mois hors des TROIS filets à la fois : `ignores` ESLint,
    // `tsc` (`allowJs: false`) et `count-any` (qui ne collecte que des `.ts`). Le
    // Q1.3 a levé l'`ignores`. Rien ne le garde de revenir.
    //
    // Deux façons de le perdre en silence, et c'est pour ça que le contrôle est ici :
    //   - re-ajouter `"**/sw-core.js"` aux `ignores` (le motif y est resté ~1 an) ;
    //   - déplacer ou renommer le fichier — auquel cas `eslint` sort 0 sur un chemin
    //     inexistant, ce qui RESSEMBLE à un succès.
    // On vérifie donc les deux : le fichier existe, ET ESLint le lit vraiment.
    assertThat("sw-core.js : le SW livré est dans le périmètre d'ESLint", () => {
        const rel = "packages/core/src/kernel/storage/sw-core.js";
        if (!fs.existsSync(path.join(ROOT, rel))) {
            return { ok: false, detail: `${rel} introuvable — chemin à recaler ici même` };
        }
        const res = spawnSync("npx", ["eslint", rel, "--format", "json"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        let parsed;
        try {
            parsed = JSON.parse(res.stdout || "[]");
        } catch {
            return { ok: false, detail: `sortie eslint illisible (exit ${res.status})` };
        }
        const entry = parsed[0];
        if (!entry) return { ok: false, detail: "ESLint n'a produit aucun rapport" };
        // Un fichier ignoré produit UN message `null`-ruleId « File ignored… ».
        const ignored = (entry.messages || []).some((m) => /File ignored/.test(m.message || ""));
        if (ignored) return { ok: false, detail: "ESLint l'IGNORE — l'entrée est revenue" };
        // Preuve positive qu'il a été LU : sa directive de tête supprime ses console.*.
        // 0 suppression = soit le fichier a changé de nature, soit il n'est pas analysé.
        const suppressed = (entry.suppressedMessages || []).length;
        if (suppressed === 0) {
            return {
                ok: false,
                detail: "0 suppression : la directive `eslint-disable no-console` de tête ne porte plus rien — fichier non analysé, ou réécrit",
            };
        }
        return { ok: true, detail: `analysé, ${suppressed} no-console supprimés par sa directive` };
    });

    // PC-04-WIDE (Q2.4/Q2.5, roadmap_qualite-lint-typage-esm) — la sonde d'ESM pur
    // élargie à registry.all() × tout le package (tests/mocks compris) + e2e/ + racine.
    // Réutilise le fixture existant plutôt que d'en planter un nouveau : probe-load.test.js
    // et probe-bare.test.js portent déjà require()/module.exports dans __probe__/__tests__/
    // — hors du périmètre de l'ancien PC-04 (qui exclut __tests__), dans celui du nouveau.
    // Si cette assertion redevient silencieuse, soit le glob registry.all() a cessé de voir
    // le package imbriqué, soit le scan est redevenu limité à src/.
    assertGateSees("PC-04-WIDE : ESM pur élargi voit un package imbriqué (tests compris)", [
        "scripts/verify-plugin-contract.cjs",
    ]);

    // ── Correctif B-37 — un renommage de plugin qui redevient silencieux ────────
    //
    // STRUCT S3.1 a renommé `plugins/storage` → `plugins/offline-ui` sur quatre axes ;
    // deux gates ont manqué le renommage sans qu'aucun rouge ne le signale : la clé de
    // `PLUGIN_BUDGETS_GZ_KB` (retombée sur le budget par défaut, faisant échouer
    // `build:deploy` sur un plugin qui n'avait pourtant pas grossi) et la regex de
    // retrait du `<script>` dans `index.html` (restée sur l'ancien nom, laissant un tag
    // orphelin produire un 404 sur `deploy-core`). Les deux gardes ajoutées ici doivent
    // rougir sur exactement ce défaut, ou elles ne le gardent pas davantage que les
    // gates d'origine ne le gardaient.
    assertThat("check-bundle-size.cjs : clé de budget morte détectée", () => {
        const { assertBudgetKeysAlive, PLUGIN_BUDGETS_GZ_KB } = require(
            path.join(ROOT, "scripts", "check-bundle-size.cjs")
        );
        const PROBE_KEY = "__probe_dead_plugin__";
        // Shape kept in sync with the real table (B-107, 02/08/2026 — two budgets per
        // plugin, `boot` and `total`). `assertBudgetKeysAlive()` only reads KEYS, so the
        // old flat `{warn, fail}` still passed — which is exactly why it had to be fixed
        // rather than left: a planted value that no longer matches the real shape is a
        // stale template sitting in the one file people copy probes from.
        PLUGIN_BUDGETS_GZ_KB[PROBE_KEY] = {
            boot: { warn: 1, fail: 2 },
            total: { warn: 1, fail: 2 },
        };
        try {
            assertBudgetKeysAlive();
            return {
                ok: false,
                detail: "n'a PAS jeté — une clé nommant un plugin disparu passerait inaperçue",
            };
        } catch (err) {
            return { ok: err.message.includes(PROBE_KEY), detail: err.message.split("\n")[0] };
        } finally {
            delete PLUGIN_BUDGETS_GZ_KB[PROBE_KEY];
        }
    });

    assertThat("build-deploy.cjs : <script> orphelin après retrait détecté", () => {
        const { stripPluginScript } = require(path.join(ROOT, "scripts", "build-deploy.cjs"));
        try {
            // Reproduit exactement le défaut STRUCT S3.1 : le nom du bundle est présent
            // dans le HTML mais pas dans la forme `<script ... src="...">` que la regex
            // retire — la regex ne matche donc rien, tout comme quand elle ciblait
            // encore l'ancien nom de fichier après un renommage.
            stripPluginScript(
                '<div data-orphan="dist/geoleaf-offline-ui.plugin.js"></div>',
                "offline-ui",
                "__probe__"
            );
            return {
                ok: false,
                detail: "n'a PAS jeté — un tag survivant au retrait passerait inaperçu",
            };
        } catch (err) {
            return {
                ok: err.message.includes("still references"),
                detail: err.message.split("\n")[0],
            };
        }
    });
} finally {
    cleanup();
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log("");
let failed = 0;
let pendingCount = 0;
const unexpectedlyGreen = [];

for (const { label, ok, detail } of results) {
    const known = PENDING[label];
    let mark;
    if (ok) {
        mark = `${C.g}✓${C.x}`;
        // A pending item that passes means the debt was paid — the list must shrink,
        // otherwise it rots into a lie exactly like the two dead knip workspaces did.
        if (known) unexpectedlyGreen.push(label);
    } else if (known) {
        mark = `${C.y}⧗${C.x}`;
        pendingCount++;
    } else {
        mark = `${C.r}✗${C.x}`;
        failed++;
    }
    console.log(`  ${mark} ${label.padEnd(46)} ${C.d}${known && !ok ? known : detail}${C.x}`);
}

console.log("");
if (unexpectedlyGreen.length > 0) {
    console.log(
        `${C.r}✗ GATE-PROBE : ${unexpectedlyGreen.length} contrôle(s) listé(s) en attente passent désormais.${C.x}`
    );
    for (const l of unexpectedlyGreen) console.log(`${C.d}    retirer de PENDING : ${l}${C.x}`);
    process.exit(1);
}
if (failed > 0) {
    console.log(`${C.r}✗ GATE-PROBE : ${failed} contrôle(s) en échec non prévu.${C.x}`);
    console.log(
        `${C.d}  Une gate qui ne voit pas la sonde ne verra pas non plus un vrai défaut.${C.x}`
    );
    process.exit(1);
}
console.log(
    `${C.g}✓ GATE-PROBE : ${results.length - pendingCount}/${results.length} contrôles voient un package imbriqué.${C.x}`
);
if (pendingCount > 0) {
    console.log(
        `${C.y}  ${pendingCount} en attente du S10.1 — vider PENDING fait partie de son critère de sortie.${C.x}`
    );
}
process.exit(0);

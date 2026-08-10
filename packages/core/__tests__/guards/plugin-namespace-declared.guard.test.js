/**
 * @file plugin-namespace-declared.guard.test.js
 * @description Test-garde — tout namespace qu'un plugin MONTE est DÉCLARÉ dans
 * `GeoLeafGlobal` (`packages/core/src/global.d.ts`).
 *
 * Pourquoi ce garde existe (B-52, 27/07/2026)
 * -------------------------------------------
 * B-13 a retiré la traîne `[key: string]: unknown` de `GeoLeafGlobal` et déclaré 7 namespaces
 * de plugins. **Cinq y manquaient** — `FileImport`, `Measure`, `Print`, `Editor`, `Ws` — et le
 * retrait de la traîne les a rendus **inatteignables au niveau des types** : un intégrateur
 * compilant contre les types publiés recevait TS2339 sur `GeoLeaf.FileImport`, alors que le
 * plugin le monte bien au runtime.
 *
 * Les deux effets de B-13 venaient du MÊME geste — 8 API fantômes documentées tombées d'un
 * côté, 5 plugins publiés fermés de l'autre. Seul le premier était voulu, et **rien ne l'a
 * dit** : les plugins écrivent à travers `GeoLeafHost` (`@geoleaf/host-runtime`), qui porte
 * encore sa traîne, donc leur propre compilation reste verte. Les deux contrats ne sont pas au
 * même stade, et c'est ce décalage qui a rendu l'écart invisible pendant que `ci:local` sortait
 * 54/54.
 *
 * Ce garde ferme la classe, pas les cinq cas : un 14ᵉ plugin qui monterait un namespace non
 * déclaré rougirait ici, sans que personne ait à y penser.
 *
 * ## Ce qu'il ne vérifie PAS
 *
 * Ni la FORME de la surface montée (les membres sont déclarés `unknown` — c'est le gisement de
 * **B-13**, qui progresse par membre), ni l'inverse (une déclaration sans plugin qui la monte).
 * Le second sens serait souhaitable mais n'est pas symétrique : le core déclare légitimement
 * des membres que nul plugin ne monte.
 *
 * ## Pourquoi un TEST et non un script de `scripts/`
 *
 * Même raison que `doc-plugin-manifest.guard.test.js`, écrite dans son en-tête : un script neuf
 * est refusé tant qu'il n'est pas suivi par git ET inscrit dans `SCRIPTS_ALLOWLIST`, donc
 * `ci:local` resterait rouge jusqu'au commit. Contrepartie assumée : ce fichier lit des sources
 * de `packages/plugins/` depuis `core`, **en texte, jamais par import** — un `entry.ts` monte un
 * namespace global et branche des écouteurs à l'évaluation.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Deux assertions anti-garde-vide, et **aucun repli silencieux** : si `GeoLeafGlobal` devient
 * introuvable ou si aucun `entry.ts` n'est lu, le garde jette au lieu de sortir vert.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_OWN_NAMESPACE } from "../_helpers/no-own-namespace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLUGINS_DIR = path.join(REPO_ROOT, "packages/plugins");
const GLOBAL_DTS = path.join(REPO_ROOT, "packages/core/src/global.d.ts");

// La liste des plugins sans façade propre est PARTAGÉE avec
// `doc-plugin-manifest.guard.test.js` : elle énonce un fait du dépôt qui n'appartient à aucun
// des deux gardes, et deux copies dériveraient. Motif complet dans le helper.

/** Les clés de PREMIER niveau de `interface GeoLeafGlobal`, par comptage d'accolades. */
function readGeoLeafGlobalKeys() {
    const src = fs.readFileSync(GLOBAL_DTS, "utf8");
    const i = src.indexOf("interface GeoLeafGlobal");
    if (i === -1) {
        throw new Error(
            "plugin-namespace-declared.guard: `interface GeoLeafGlobal` introuvable dans " +
                "packages/core/src/global.d.ts — l'interface a été renommée. Re-pointer ce garde, " +
                "ne pas l'assouplir : sortir vert ici signifierait « aucun namespace à vérifier »."
        );
    }
    const open = src.indexOf("{", i);
    let depth = 0;
    let close = -1;
    for (let k = open; k < src.length; k += 1) {
        if (src[k] === "{") depth += 1;
        else if (src[k] === "}") {
            depth -= 1;
            if (depth === 0) {
                close = k;
                break;
            }
        }
    }
    if (close === -1) throw new Error("plugin-namespace-declared.guard: interface non refermée");

    // Profondeur 0 DANS le corps : on ne veut pas les membres des types imbriqués.
    const keys = new Set();
    let d = 0;
    for (const line of src.slice(open + 1, close).split("\n")) {
        if (d === 0) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line);
            if (m) keys.add(m[1]);
        }
        for (const ch of line) {
            if (ch === "{") d += 1;
            else if (ch === "}") d -= 1;
        }
    }
    return keys;
}

/**
 * Le namespace monté par un `entry.ts`, ou `null`.
 *
 * Deux formes coexistent, et il a fallu les mesurer : l'affectation directe
 * (`_g.GeoLeaf.COG = buildPublicApi()`, `_host.Table = …`) et — jusqu'au 27/07/2026 —
 * l'écriture par index derrière un transtypage (`(… as Record<string, unknown>)["AddPOI"] = …`).
 * La seconde a disparu avec B-52, mais elle est reconnue ici **exprès** : si elle réapparaissait,
 * le garde doit la voir plutôt que conclure « ce plugin ne monte rien ».
 */
function extractMountedNamespace(entrySource) {
    const direct = /\.([A-Z][A-Za-z0-9]*)\s*=\s*buildPublicApi\s*\(/.exec(entrySource);
    if (direct) return direct[1];
    const indexed = /\[\s*["']([A-Z][A-Za-z0-9]*)["']\s*\]\s*=\s*buildPublicApi\s*\(/.exec(
        entrySource
    );
    return indexed ? indexed[1] : null;
}

const PLUGINS = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, e.name, "src/entry.ts")))
    .map((e) => e.name)
    .sort();

describe("test-garde — tout namespace monté par un plugin est déclaré dans GeoLeafGlobal", () => {
    const declared = readGeoLeafGlobalKeys();

    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("lit au moins un plugin (sinon ce garde ne garde rien)", () => {
        expect(PLUGINS.length, `aucun src/entry.ts sous ${PLUGINS_DIR}`).toBeGreaterThan(0);
    });

    it("lit des clés dans `GeoLeafGlobal` (sinon tout serait déclaré « manquant »)", () => {
        expect(
            declared.size,
            "aucune clé de premier niveau extraite de global.d.ts"
        ).toBeGreaterThan(0);
    });

    it("chaque namespace monté est déclaré côté core", () => {
        const missing = [];
        let mountedCount = 0;

        for (const plugin of PLUGINS) {
            const entry = fs.readFileSync(path.join(PLUGINS_DIR, plugin, "src/entry.ts"), "utf8");
            const ns = extractMountedNamespace(entry);

            if (ns === null) {
                // Le plugin ne monte rien : l'exemption doit être écrite, avec son motif.
                if (!NO_OWN_NAMESPACE[plugin]) {
                    missing.push(
                        `${plugin} : aucun namespace monté détecté, et aucune entrée dans ` +
                            `NO_OWN_NAMESPACE. Soit il monte sa surface d'une forme que ce garde ne ` +
                            `connaît pas (l'apprendre explicitement), soit il n'en monte aucune ` +
                            `(l'inscrire avec son motif).`
                    );
                }
                continue;
            }

            mountedCount += 1;
            if (NO_OWN_NAMESPACE[plugin]) {
                missing.push(
                    `${plugin} : exempté dans NO_OWN_NAMESPACE alors qu'il MONTE \`${ns}\` — retirer l'entrée.`
                );
                continue;
            }
            if (!declared.has(ns)) {
                missing.push(
                    `${plugin} : monte \`GeoLeaf.${ns}\` mais \`${ns}\` n'est pas déclaré dans ` +
                        `packages/core/src/global.d.ts → un intégrateur compilant contre les types ` +
                        `publiés reçoit TS2339 (B-52).`
                );
            }
        }

        // Troisième anti-garde-vide : sans au moins un namespace RÉELLEMENT confronté, la
        // boucle ci-dessus pourrait passer en n'ayant rien comparé.
        expect(
            mountedCount,
            "aucun namespace monté n'a été confronté à global.d.ts"
        ).toBeGreaterThan(0);
        expect(missing, missing.join("\n")).toEqual([]);
    });

    // ── L'exemption doit être FALSIFIABLE ────────────────────────────────────────
    // Sans ces deux vérifications, `NO_OWN_NAMESPACE` serait une dispense de complaisance :
    // n'importe quel plugin ayant OUBLIÉ sa façade pourrait y être inscrit et faire taire le
    // garde. Un plugin qui a oublié sa façade ne pilote RIEN — il ne peut donc pas satisfaire
    // l'assertion `drives`, qui est ce qui distingue « pas de façade, par décision » de
    // « façade oubliée ».
    it("chaque exemption nomme une surface du core qu'elle pilote VRAIMENT", () => {
        const wrong = [];
        for (const [plugin, ex] of Object.entries(NO_OWN_NAMESPACE)) {
            if (!fs.existsSync(path.join(REPO_ROOT, ex.owner))) {
                wrong.push(`${plugin} : \`owner\` introuvable — ${ex.owner}`);
            }
            // ⚠️ Les COMMENTAIRES sont retirés AVANT la recherche, et ce n'est pas cosmétique :
            // l'`entry.ts` d'`offline-ui` nomme `GeoLeaf.Storage` trois fois en prose pour
            // expliquer sa propre exemption. Sans ce nettoyage, l'assertion se satisfaisait de
            // ces mentions — mesuré : en re-pointant le `healthCheck` vers une autre surface,
            // le garde restait VERT. Une exemption se prouve par ce que le code ATTEINT, pas
            // par ce qu'il raconte.
            // `?.` normalisé ensuite : `entry.ts` écrit `_g.GeoLeaf?.Storage`.
            const entry = fs
                .readFileSync(path.join(PLUGINS_DIR, plugin, "src/entry.ts"), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, " ")
                .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
                .replace(/\?\./g, ".");
            const re = new RegExp(`\\b${ex.drives.replace(/\./g, "\\.")}\\b`);
            if (!re.test(entry)) {
                wrong.push(
                    `${plugin} : exempté au motif qu'il pilote \`${ex.drives}\`, mais son ` +
                        `entry.ts ne l'atteint nulle part. Une exemption « pas de façade » n'est ` +
                        `PAS une exemption « façade oubliée ».`
                );
            }
        }
        expect(wrong, wrong.join("\n")).toEqual([]);
    });
});

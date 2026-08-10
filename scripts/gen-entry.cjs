#!/usr/bin/env node
/**
 * @fileoverview GEN-ENTRY — compose une entrée GeoLeaf à partir d'une liste de capacités,
 * en DÉRIVANT tout ce qui peut l'être du disque plutôt qu'en le recopiant.
 *
 * ## Ce que ce script existe pour empêcher
 *
 * Écrire une entrée à la main, c'est recopier quatre choses qui vivent déjà ailleurs : le nom
 * du const installer, l'ordre de chargement, le chemin d'import, et la liste des façades
 * ré-exportables. Les quatre dérivent — donc les quatre peuvent diverger, et **l'ont fait** :
 * `kernel-exports.ts` annonçait « 9 capacités » à côté du nom de `examples/minimal`, qui en
 * embarque 6 (socle-init 7.1).
 *
 * ## Les cinq dérivations, et leur source unique
 *
 *   1. **Le const installer** — `export const <X>` de `capabilities/<id>/install.ts`.
 *   2. **L'ordre** — celui de `FULL.capabilities` dans `presets/manifest.full.ts`. ⚠️ Il est
 *      LOAD-BEARING, et ce fichier-là est le registre des raisons : ne pas les recopier ici.
 *      Les entrées écrites à la main portaient un commentaire « permalink last » expliquant
 *      l'une d'elles ; le dériver rend le commentaire structurellement vrai au lieu de le
 *      laisser à la vigilance.
 *      🛑 Cette puce a énuméré « **trois** raisons sans rapport entre elles (départage de Kahn,
 *      séquence des `sharedLifecycle`, **arêtes de dépendance**) » jusqu'au 08/08/2026, et les
 *      trois termes portaient deux défauts : la séquence des `sharedLifecycle` a été **réfutée**
 *      par socle-init 7.4 (`__tests__/presets/shared-lifecycle-order.test.ts`), et les « arêtes
 *      de dépendance » n'ont **jamais** figuré parmi les raisons du manifeste — elles ont été
 *      inventées dans `contracts/core-module.contract.ts` et recopiées ici. Deux copies d'une
 *      liste, deux dérives : B-43, l'énumération est retirée, pas corrigée.
 *   3. **Les façades ré-exportables** — l'INTERSECTION de deux ensembles dérivés : les
 *      symboles que `bundle-esm-entry.ts` ré-exporte, et ceux que le `registerGlobals()` de
 *      la capacité monte (hors `_privés`). C'est ce qui reproduit le sous-ensemble curé —
 *      `Legend`, `Permalink`, `Share`, `Notifications`, `PWA` — sans table à la main.
 *   4. **Les sous-chemins npm** — la carte `exports` de `packages/core/package.json`, INVERSÉE
 *      sur `./dist/esm/<rel>.js`. Un chemin npm écrit en dur ici serait la 5ᵉ copie.
 *   5. **Les dépendances** — `dependencies` de `capabilities/<id>/<id>-capability.ts`.
 *
 * ## Deux modes, et pourquoi les deux
 *
 *   `--mode=relative` — imports `../../src/…`. C'est ce que compile `size:example`, qui prouve
 *                       le tree-shaking **sur le graphe de sources**.
 *   `--mode=npm`      — imports `@geoleaf/core/…`. C'est ce que compile `check-consumer-bundle`,
 *                       qui prouve que le **paquet publié** résout et secoue. Deux défauts
 *                       invisibles depuis le dépôt n'ont été vus que par là.
 *
 * ## Région bornée, pas fichier écrasé
 *
 * Le script ne réécrit qu'entre `@geoleaf:gen:start` et `@geoleaf:gen:end`. L'en-tête de
 * chaque exemple reste **écrit à la main** : il porte le raisonnement (pourquoi ces
 * capacités-là, ce que l'exclusion prouve, quels défauts l'exemple a attrapés), et un
 * générateur ne sait pas l'écrire. Générer le fichier entier l'aurait détruit.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/gen-entry.cjs --caps=legend,filter --mode=relative      # → stdout
 * node scripts/gen-entry.cjs --file=packages/core/examples/minimal/entry.ts        # régénère
 * node scripts/gen-entry.cjs --file=… --check                          # 0 si à jour, 1 sinon
 * node scripts/gen-entry.cjs --caps=offline --check-deps               # échoue en nommant pwa
 * ```
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 8
 * @see scripts/check-example-bundle.cjs — ⚠️ ce `@see` a dit « `capabilitiesImportedBy`,
 *      réutilisé ici » jusqu'au 08/08/2026, et c'était faux : ce script ne `require()` que
 *      `node:fs` et `node:path`. Le dépôt porte donc **trois** extracteurs indépendants du
 *      même tableau — celui-ci, `capabilitiesImportedBy` (bundle-check), et l'import de
 *      `manifest-full-completeness.guard.test.ts`. GEN-04 tient le premier contre le troisième ;
 *      le second reste non recoupé (backlog).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "packages", "core");
const SRC = path.join(CORE, "src");
const CAPS_DIR = path.join(SRC, "capabilities");
const MANIFEST_FULL = path.join(SRC, "presets", "manifest.full.ts");
const SHIPPED_ENTRY = path.join(SRC, "bundle-esm-entry.ts");
const CORE_PKG = path.join(CORE, "package.json");

const START = "// @geoleaf:gen:start";
const END = "// @geoleaf:gen:end";

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m" };

// ─── Dérivations ──────────────────────────────────────────────────────────────

/** Répertoires de `src/capabilities/` portant un `install.ts`. */
function capabilityDirs() {
    return fs
        .readdirSync(CAPS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(CAPS_DIR, d.name, "install.ts")))
        .map((d) => d.name)
        .sort();
}

/** Le const installer exporté par `capabilities/<id>/install.ts`. */
function installerName(id) {
    const src = fs.readFileSync(path.join(CAPS_DIR, id, "install.ts"), "utf8");
    const m = src.match(/export const (\w+)\s*:\s*CapabilityInstaller/);
    if (!m) throw new Error(`[GEN-ENTRY] ${id}/install.ts n'exporte aucun CapabilityInstaller.`);
    return m[1];
}

/** Ancre du tableau de `manifest.full.ts`. Une seule autorité — l'erreur la cite si elle bouge. */
const MANIFEST_ANCHOR = "capabilities: [";

/**
 * L'ordre de `FULL.capabilities`, sous forme de liste de noms de const.
 *
 * Lu dans le littéral plutôt qu'importé : ce script est CJS et le manifeste est du TypeScript
 * à imports `.js`. L'importer demanderait tsx/jiti et exécuterait les 21 `install.ts` — dont
 * `offline/install.ts`, qui traîne `geoleaf.sync.ts` et son auto-montage sur le global. Un
 * script de build qui ne touche aucun code runtime en exécuterait la moitié.
 *
 * ## Les commentaires sont retirés AVANT le calcul de la borne — et « avant » est tout le sujet
 *
 * 🛑 **Jusqu'au 08/08/2026 ils l'étaient APRÈS**, et la borne se prenait sur le texte BRUT par
 * un `indexOf("],")`. Or le tableau porte un commentaire qui cite `(deps ["geojson"], like
 * legend and filter)` : son `],` était le premier rencontré, la borne y tombait, et le tableau
 * était coupé à **16 entrées sur 21**. Le script refusait alors de composer `theme-selector`,
 * `vector-tiles`, `profile-switcher`, `language-switcher` et `theme-palette` en affirmant
 * qu'ils sont « absents de FULL.capabilities » — une affirmation FAUSSE, produite par
 * l'extracteur lui-même. L'en-tête promettait pourtant déjà le bon geste : il décrivait
 * l'intention, pas ce que le code faisait.
 *
 * ⚠️ La regex de ligne écarte `://` (le `[^:]` devant), sinon un `https://…` en commentaire
 * ferait manger la fin de sa ligne. Elle diffère donc délibérément de celles de
 * `mountedSymbols()` et `declaredDeps()`, restées larges parce qu'elles opèrent sur des régions
 * sans URL — divergence assumée, versée au backlog. ⚠️ Et la forme simplement ANCRÉE en début
 * de ligne (`/^\s*\/\/…$/gm`) ne suffit PAS : mesuré le 08/08, elle laisse passer un commentaire
 * de FIN de ligne, où un nom d'installer cité serait compté deux fois (22 au lieu de 21).
 *
 * La borne se prend ensuite par PROFONDEUR DE CROCHETS, jamais par `indexOf` : un tableau
 * imbriqué ou un objet en ligne ne peut plus la déplacer. Gardé par **GEN-04**, qui compare
 * cette liste à `FULL.capabilities` IMPORTÉ — les deux extracteurs du dépôt, face à face.
 */
function manifestOrder() {
    const src = fs.readFileSync(MANIFEST_FULL, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

    const from = code.indexOf(MANIFEST_ANCHOR);
    if (from < 0) {
        throw new Error(
            `[GEN-ENTRY] ancre \`${MANIFEST_ANCHOR}\` introuvable dans ` +
                `${path.relative(ROOT, MANIFEST_FULL)}. Le manifeste a été réécrit — corriger ` +
                `l'ancre, plutôt que de laisser l'extracteur rendre une liste tronquée.`
        );
    }

    let depth = 0;
    let end = -1;
    for (let i = from + MANIFEST_ANCHOR.length - 1; i < code.length; i++) {
        const c = code[i];
        if (c === "[") depth++;
        else if (c === "]" && --depth === 0) {
            end = i;
            break;
        }
    }
    if (end < 0) {
        throw new Error(`[GEN-ENTRY] le tableau \`${MANIFEST_ANCHOR}\` n'est jamais refermé.`);
    }

    const out = [...code.slice(from, end).matchAll(/\b([A-Z][A-Z0-9_]*_INSTALLER)\b/g)].map(
        (m) => m[1]
    );
    // Anti-gate-vide — même classe que MFC-03 et GEN-03 : un extracteur qui rend `[]` fait
    // sortir VERTE toute garde bâtie dessus, ce qui est pire qu'un extracteur qui en rend 16.
    if (!out.length) {
        throw new Error(
            `[GEN-ENTRY] \`${MANIFEST_ANCHOR}\` lu VIDE — l'extracteur ne voit plus rien. ` +
                `Une liste vide n'est jamais un état légitime de ce manifeste.`
        );
    }
    return out;
}

/** Symboles ré-exportés par l'entrée livrée → chemin source relatif à `src/`. */
function shippedFacades() {
    const src = fs.readFileSync(SHIPPED_ENTRY, "utf8");
    const out = new Map();
    for (const m of src.matchAll(/^export \{ (\w+) \} from "\.\/([^"]+)";/gm)) {
        out.set(m[1], m[2]);
    }
    return out;
}

/** Symboles publics montés par le `registerGlobals()` d'une capacité (hors `_privés`). */
function mountedSymbols(id) {
    const src = fs.readFileSync(path.join(CAPS_DIR, id, "install.ts"), "utf8");
    const from = src.indexOf("registerGlobals(");
    if (from < 0) return [];
    const body = src.slice(from, src.indexOf("\n    },", from));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    return [...code.matchAll(/\bgl\.([A-Za-z]\w*)\s*=/g)].map((m) => m[1]);
}

/** `dependencies` déclarées par `capabilities/<id>/<id>-capability.ts`. */
function declaredDeps(id) {
    const file = path.join(CAPS_DIR, id, `${id}-capability.ts`);
    if (!fs.existsSync(file)) return [];
    const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const m = src.match(/^\s*dependencies:\s*\[([^\]]*)\]/m);
    if (!m) return [];
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * Carte INVERSE de `package.json#exports` : `dist/esm/<rel>.js` → sous-chemin npm.
 *
 * Les entrées globées (`./capabilities/*`) sont converties en préfixes. Sans cette inversion,
 * le mode npm écrirait ses chemins en dur — la copie que ce script existe pour supprimer.
 */
function npmSubpathResolver() {
    const exp = JSON.parse(fs.readFileSync(CORE_PKG, "utf8")).exports;
    const exact = new Map();
    const globs = [];
    for (const [key, val] of Object.entries(exp)) {
        const target = typeof val === "string" ? val : val?.import;
        if (typeof target !== "string" || !target.startsWith("./dist/esm/")) continue;
        const rel = target.slice("./dist/esm/".length);
        if (key.includes("*")) globs.push({ key, rel });
        else if (!exact.has(rel)) exact.set(rel, key);
    }
    return (srcRel) => {
        const js = srcRel.replace(/\.ts$/, ".js");
        if (exact.has(js)) return `@geoleaf/core${exact.get(js).slice(1)}`;
        for (const g of globs) {
            const [pre, post] = g.rel.split("*");
            if (js.startsWith(pre) && js.endsWith(post)) {
                const star = js.slice(pre.length, js.length - post.length);
                return `@geoleaf/core${g.key.replace("*", star).slice(1)}`;
            }
        }
        return null;
    };
}

// ─── Génération ───────────────────────────────────────────────────────────────

/**
 * Construit la région générée d'une entrée.
 *
 * @param {{caps: string[], mode: "relative"|"npm", id: string}} spec
 * @returns {string} le corps, sans les marqueurs
 */
function buildRegion({ caps, mode, id }) {
    const npm = npmSubpathResolver();
    const rel = (p) =>
        mode === "npm" ? (npm(p) ?? _fail(p)) : `../../src/${p.replace(/\.ts$/, ".js")}`;
    const _fail = (p) => {
        throw new Error(
            `[GEN-ENTRY] aucun sous-chemin npm n'expose \`src/${p}\` — la carte \`exports\` de ` +
                `packages/core/package.json doit le déclarer avant qu'une entrée en mode npm ` +
                `puisse l'importer. (Cas connu : \`pwa\`, dont la façade n'a pas de sous-chemin.)`
        );
    };

    const kernelSideEffects =
        mode === "npm"
            ? ['import "@geoleaf/core/globals";', 'import "@geoleaf/core/helpers";']
            : [
                  'import "../../src/globals/globals.js";',
                  'import "../../src/app/app-namespace.js";',
              ];
    const contractPath =
        mode === "npm"
            ? "@geoleaf/core/contracts/preset.contract.js"
            : "../../src/contracts/preset.contract.js";
    const bootPath = mode === "npm" ? "@geoleaf/core/boot" : "../../src/app/boot-install.js";
    const kernelPath = mode === "npm" ? "@geoleaf/core/kernel" : "../../src/kernel-exports.js";

    // L'ordre du manifeste livré, restreint aux capacités demandées.
    const order = manifestOrder();
    const byInstaller = new Map(caps.map((c) => [installerName(c), c]));
    const ordered = order.filter((n) => byInstaller.has(n)).map((n) => byInstaller.get(n));
    const unknown = caps.filter((c) => !ordered.includes(c));
    if (unknown.length) {
        throw new Error(
            `[GEN-ENTRY] capacité(s) absente(s) de FULL.capabilities : ${unknown.join(", ")}. ` +
                `Une entrée ne peut pas embarquer ce que le manifeste livré n'installe pas.`
        );
    }

    // Le graphe de dépendances est contrôlé ICI, sur le chemin d'ÉMISSION, et pas seulement
    // dans `main()`.
    //
    // 🛑 L'en-tête de `main()` a affirmé « le contrôle tourne TOUJOURS, pas seulement sous
    // `--check-deps` » jusqu'au 08/08/2026, alors qu'il ne vivait que dans le CLI. La garde
    // Vitest, elle, appelle `buildRegion` — donc la seule arête réelle du dépôt
    // (`offline → pwa`) n'était traversée par AUCUNE exécution automatique. Émettre une entrée
    // au graphe incomplet, c'est produire le défaut au lieu de le signaler : le contrôle
    // appartient au point d'émission, et `main()` n'en garde que le verdict vert.
    const missingDeps = checkDeps(caps);
    if (missingDeps.length) {
        throw new Error(
            `[GEN-ENTRY] dépendance(s) de capacité non embarquée(s) : ${missingDeps.join(", ")}. ` +
                `\`ICapabilityDeclaration.dependencies\` n'est lu nulle part au runtime — c'est ` +
                `ici, au build, qu'il devient utile. Ajouter la capacité manquante à --caps.`
        );
    }

    const shipped = shippedFacades();
    const facadeLines = [];
    for (const cap of ordered) {
        for (const sym of mountedSymbols(cap)) {
            if (!shipped.has(sym)) continue; // façade non ré-exportable — montée sur GeoLeaf.* seulement
            facadeLines.push(`export { ${sym} } from "${rel(shipped.get(sym))}";`);
        }
    }

    const L = [];
    L.push("// ── 1. Kernel side-effects — les deux que l'entrée livrée importe aussi ──────");
    L.push(...kernelSideEffects);
    L.push("");
    L.push("// ── 2. Le manifeste — les capacités que CE bundle embarque ───────────────────");
    L.push(`import type { PresetManifest } from "${contractPath}";`);
    for (const cap of ordered) {
        L.push(`import { ${installerName(cap)} } from "${rel(`capabilities/${cap}/install.ts`)}";`);
    }
    L.push("");
    L.push(`const MANIFEST: PresetManifest = {`);
    L.push(`    id: ${JSON.stringify(id)},`);
    L.push(`    capabilities: [`);
    for (const cap of ordered) L.push(`        ${installerName(cap)},`);
    L.push(`    ],`);
    L.push(`};`);
    L.push("");
    L.push("// ── 3. Installer le boot, lié à ce manifeste ─────────────────────────────────");
    L.push(`import { installBoot } from "${bootPath}";`);
    L.push("");
    L.push("installBoot(MANIFEST);");
    L.push("");
    L.push("// ── 4. Surface ESM publique ──────────────────────────────────────────────────");
    L.push(`export * from "${kernelPath}";`);
    if (facadeLines.length) {
        L.push("");
        L.push(...facadeLines);
    }
    L.push("");
    L.push('export default typeof window !== "undefined"');
    L.push('    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]');
    L.push("    : {};");
    return L.join("\n");
}

/** `--check-deps` : toute dépendance déclarée d'une capacité embarquée doit l'être aussi. */
function checkDeps(caps) {
    const missing = [];
    for (const cap of caps) {
        for (const dep of declaredDeps(cap)) {
            if (!caps.includes(dep)) missing.push(`${cap} → ${dep}`);
        }
    }
    return missing;
}

/** Lit la directive `@geoleaf:gen:start caps=… mode=… id=…` d'un fichier d'entrée. */
function readSpec(file) {
    const src = fs.readFileSync(file, "utf8");
    const line = src.split("\n").find((l) => l.trimStart().startsWith(START));
    if (!line) throw new Error(`[GEN-ENTRY] ${file} ne porte pas de marqueur ${START}.`);
    const get = (k) => (line.match(new RegExp(`${k}=([\\w,-]+)`)) ?? [])[1];
    const caps = (get("caps") ?? "").split(",").filter(Boolean);
    if (!caps.length) throw new Error(`[GEN-ENTRY] ${file} : marqueur sans \`caps=\`.`);
    return { caps, mode: get("mode") ?? "relative", id: get("id") ?? "custom", src, line };
}

/** Remplace la région bornée d'un fichier, sans toucher à ce qui l'entoure. */
function spliceRegion(src, startLine, region) {
    const i = src.indexOf(startLine);
    const j = src.indexOf(END, i);
    if (j < 0) throw new Error(`[GEN-ENTRY] marqueur ${END} manquant.`);
    return src.slice(0, i) + startLine + "\n\n" + region + "\n\n" + src.slice(j);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
    const arg = (k) =>
        (argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=").slice(1).join("=");
    const has = (k) => argv.includes(`--${k}`);

    const file = arg("file");
    const spec = file
        ? readSpec(path.resolve(ROOT, file))
        : {
              caps: arg("caps").split(",").filter(Boolean),
              mode: arg("mode") || "relative",
              id: arg("id") || "custom",
          };

    if (!spec.caps.length) {
        console.error("[GEN-ENTRY] rien à faire : passer --caps=<a,b,c> ou --file=<entry.ts>.");
        return 2;
    }

    const known = capabilityDirs();
    const strays = spec.caps.filter((c) => !known.includes(c));
    if (strays.length) {
        console.error(
            `${C.red}❌ [GEN-ENTRY] capacité(s) inconnue(s) : ${strays.join(", ")}${C.reset}`
        );
        console.error(`${C.dim}   connues : ${known.join(", ")}${C.reset}`);
        return 1;
    }

    // Le contrôle de fond vit dans `buildRegion` (voir la note sur place) — c'est le point
    // d'ÉMISSION, donc le seul endroit qui le rende inévitable, y compris pour la garde Vitest.
    // Ce qui reste ici est le versant CLI : un message coloré, et le verdict vert de
    // `--check-deps`, qui n'émet rien et n'aurait donc jamais atteint `buildRegion`.
    const missing = checkDeps(spec.caps);
    if (missing.length) {
        console.error(
            `${C.red}❌ [GEN-ENTRY] dépendance(s) de capacité non embarquée(s) : ${missing.join(", ")}${C.reset}`
        );
        console.error(
            `${C.dim}   \`ICapabilityDeclaration.dependencies\` n'est lu nulle part au runtime —\n` +
                `   c'est ici, au build, qu'il devient utile. Ajouter la capacité manquante à --caps.${C.reset}`
        );
        return 1;
    }
    if (has("check-deps")) {
        console.log(
            `${C.green}✅ [GEN-ENTRY] graphe de dépendances complet pour ${spec.caps.join(", ")}${C.reset}`
        );
        return 0;
    }

    const region = buildRegion(spec);

    if (!file) {
        console.log(region);
        return 0;
    }

    const abs = path.resolve(ROOT, file);
    const next = spliceRegion(spec.src, spec.line, region);
    if (has("check")) {
        if (next === spec.src) {
            console.log(`${C.green}✅ [GEN-ENTRY] ${file} est à jour${C.reset}`);
            return 0;
        }
        console.error(
            `${C.red}❌ [GEN-ENTRY] ${file} a DÉRIVÉ de ce que le générateur produit.${C.reset}`
        );
        console.error(`${C.dim}   Régénérer : node scripts/gen-entry.cjs --file=${file}${C.reset}`);
        return 1;
    }
    fs.writeFileSync(abs, next);
    console.log(
        `${C.green}✅ [GEN-ENTRY] ${file} régénéré (${spec.caps.length} capacités, mode ${spec.mode})${C.reset}`
    );
    return 0;
}

module.exports = { buildRegion, checkDeps, readSpec, spliceRegion, declaredDeps, capabilityDirs };

if (require.main === module) process.exit(main(process.argv.slice(2)));

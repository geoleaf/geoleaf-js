#!/usr/bin/env node
/*!
 * probe-typedoc-surface.mjs
 *
 * Sonde de la surface que TypeDoc rendrait si on l'élargissait — l'instrument de la
 * sous-tâche 1 de l'Étape 3 (`_docs_projet/travail/roadmaps/roadmap_documentation-v3.md`).
 *
 * ## Pourquoi elle est VERSIONNÉE alors qu'elle ne garde rien
 *
 * Elle n'est pas une gate et n'a rien à gater : elle ne juge pas, elle **mesure**. Elle est
 * ici parce que la roadmap porte désormais ses chiffres — 2 829 pages pour les 14 paquets,
 * 75 des 92 clés de façade rendues, 132 membres sous `Helpers` et 0 sous `CONSTANTS` — et
 * qu'un chiffre sans commande qui le réimprime est précisément ce que cette refonte traque.
 * `CLAUDE.md` : « tout fait vérifiable porte son vérificateur, ou il n'est pas écrit », et le
 * mode d'échec n° 5 : « un chiffre qu'on ne peut pas re-mesurer ne se périme pas : il se
 * fossilise ». La passe 21 a retiré trois chiffres de la roadmap pour cette raison exacte
 * (« 89-92 % », « ~173 exports », « 1 582 TSDoc ») — elle ne peut pas en écrire quatre
 * nouveaux du même régime.
 *
 * DÉLIBÉRÉMENT hors `ci:local` : convertir les 14 paquets prend quelques secondes et ne
 * protège de rien. La propriété durable, quand elle existera, sera le manifeste de surface
 * committé et sa gate de fraîcheur (§Fraîcheur de la roadmap) — pas cette sonde.
 *
 * ## Ce qu'elle mesure, et à quelle question chacun répond
 *
 *   - VOLUME (modules, réflexions, pages) → « peut-on committer le rendu ? » La réponse est
 *     non, et elle est chiffrée ici : voir aussi le déterminisme ci-dessous.
 *   - Les 4 familles de `validation` de TypeDoc → les critères falsifiables qui remplacent
 *     « la sortie est-elle exploitable ? », qui n'est pas un critère.
 *   - C6, la couverture des `EXPECTED_FACADE_KEYS` → le seul chiffre qui dise si la surface
 *     RUNTIME (celle qu'`API_REFERENCE.md` documente, et que l'entrée ESM ne rend pas) est
 *     dérivable. C'est le critère qui décide de toute l'étape.
 *   - Le compte de membres PAR CLÉ → ⚠️ sans lui, un « 75/92 » global aurait fait supprimer
 *     deux documents dont la façade ne rend AUCUN membre (`CONSTANTS`, `Log`). La moyenne
 *     cachait le défaut ; c'est la ventilation qui l'a montré.
 *   - Le déterminisme du manifeste → la propriété que le rendu HTML échoue : TypeDoc y grave
 *     `git rev-parse HEAD` (29 fichiers sur 54 de la sortie actuelle), donc un point fixe y
 *     est impossible.
 *
 * ## Ce qu'elle n'écrit jamais
 *
 * Rien dans le dépôt. Le rendu n'est pas produit du tout (on s'arrête après `convert()`),
 * et les manifestes partent sous `PROBE_OUT`, hors arborescence par défaut.
 *
 * Usage : node scripts/probe-typedoc-surface.mjs
 *         PROBE_OUT=/tmp/ma-sonde node scripts/probe-typedoc-surface.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Le registre, jamais un `packages/core` en dur : un chemin en dur ne casse pas au
// déplacement, il cesse silencieusement de matcher et la sonde sortirait « verte » en
// n'ayant rien converti. `requireByDirName` jette si le paquet est introuvable.
const registry = require_(path.join(ROOT, "scripts/lib/packages.cjs"));
const CORE = registry.requireByDirName("core");

// TypeDoc n'est installé que dans le core — résolu depuis le registre, pour la même raison.
const TYPEDOC = path.join(CORE.absDir, "node_modules/typedoc/dist/index.js");
if (!fs.existsSync(TYPEDOC)) {
    console.error(
        `✗ TypeDoc introuvable sous ${path.relative(ROOT, TYPEDOC)} — lancer \`npm install\`.`
    );
    process.exit(2);
}
const { Application, TSConfigReader, TypeDocReader, ReflectionKind } = await import(TYPEDOC);

const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), "geoleaf-probe-typedoc");
fs.mkdirSync(OUT, { recursive: true });

/** Range un avertissement de TypeDoc dans une famille — on compte, on ne lit pas. */
function classify(message) {
    const s = String(message);
    if (/not included in the documentation/.test(s)) return "NOT_EXPORTED";
    if (/does not have any documentation/.test(s)) return "NOT_DOCUMENTED";
    if (/Failed to resolve link|Failed to find/.test(s)) return "INVALID_LINK";
    const tag = s.match(/unknown block tag (@[\w-]+)/);
    if (tag) return `UNKNOWN_TAG ${tag[1]}`;
    return "AUTRE: " + s.slice(0, 70);
}

const COMMON = {
    skipErrorChecking: true,
    logLevel: "Warn",
    readme: "none",
    excludeExternals: true, // sans lui, `Window` amène ~220 membres de lib.dom
    excludePrivate: true,
    excludeInternal: true,
    exclude: ["**/__tests__/**", "**/__mocks__/**", "**/*.test.ts", "**/*.spec.ts"],
    validation: {
        notExported: true,
        invalidLink: true,
        rewrittenLink: true,
        notDocumented: true,
        unusedMergeModuleWith: true,
    },
};

async function probe(label, options) {
    const buckets = {};
    const app = await Application.bootstrapWithPlugins(options, [
        new TypeDocReader(),
        new TSConfigReader(),
    ]);
    app.logger.warn = (m) => {
        const k = classify(m);
        buckets[k] = (buckets[k] || 0) + 1;
    };

    const project = await app.convert();
    if (!project) {
        console.error(`✗ ${label} — convert() n'a rien rendu.`);
        process.exitCode = 2;
        return null;
    }
    app.validate(project);

    // Le routeur `kind` est celui du rendu HTML par défaut : buildPages donne le nombre
    // EXACT de fichiers que TypeDoc écrirait, sans en écrire un seul.
    const Router = app.renderer.routers.get("kind");
    const pages = new Router(app).buildPages(project).length;

    // Le manifeste : une ligne par réflexion, trié. C'est la forme que la roadmap retient
    // pour la gate de fraîcheur — pas de SHA, pas de date, pas de chemin absolu, donc une
    // fonction pure de la source. Assertée plus bas, pas supposée.
    const lines = [];
    project.traverse(function walk(r) {
        lines.push(`${ReflectionKind[r.kind]} | ${r.getFullName()}`);
        r.traverse(walk);
        return true;
    });
    lines.sort();

    const modules = (project.children || []).map((c) => c.name);
    const dups = [...new Set(modules.filter((x, i) => modules.indexOf(x) !== i))];

    console.log(`\n── ${label} ${"─".repeat(Math.max(0, 56 - label.length))}`);
    console.log(`   modules    : ${modules.length}${dups.length ? `   ⚠️ DUPLIQUÉS : ${dups.join(", ")}` : ""}`);
    console.log(`   réflexions : ${lines.length}`);
    console.log(`   pages HTML : ${pages}`);
    for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(v).padStart(6)}  ${k}`);
    }

    const file = path.join(OUT, `${label}.manifest.txt`);
    fs.writeFileSync(file, lines.join("\n") + "\n");
    return { label, pages, lines, modules, file };
}

console.log("═".repeat(72));
console.log("SONDE TypeDoc — surface élargie · AUCUNE écriture dans le dépôt");
console.log(`sorties : ${OUT}`);
console.log("═".repeat(72));

const coreTs = path.join(CORE.absDir, "tsconfig.json");

// A. L'état actuel — `resolve` sur l'entrée ESM. Le point de comparaison, et la mesure de
//    la cause : c'est cette stratégie qui rend 0 clé de façade.
const actuel = await probe("A-actuel-resolve", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src/bundle-esm-entry.ts")],
    entryPointStrategy: "resolve",
    tsconfig: coreTs,
});

// B. Élargi — `expand` sur src/. ⚠️ `global.d.ts` y entre TOUT SEUL : le filtre de TypeDoc
//    accepte `.ts`, donc `.d.ts`. La roadmap demandait de l'ajouter en entryPoint ; le
//    contre-essai C montre ce que ça produit.
const elargi = await probe("B-elargi-expand-src", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src")],
    entryPointStrategy: "expand",
    tsconfig: coreTs,
});

// C. Contre-essai du piège. Doit produire un module DUPLIQUÉ nommé `global` — c'est
//    l'assertion qui justifie la correction apportée à l'ordre d'exécution.
const piege = await probe("C-piege-global-en-entryPoint", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src"), path.join(CORE.absDir, "src/global.d.ts")],
    entryPointStrategy: "expand",
    tsconfig: coreTs,
});

// D. Les 13 plugins en `packages`, SANS aucun typedoc.json de plugin — ce qui compte, car
//    `lib/generated-artifacts.cjs` JETTE pour tout typedoc.json de paquet sans `out`.
const pluginDirs = registry
    .all()
    .filter((p) => p.dir.replace(/\\/g, "/").includes("packages/plugins/"))
    .map((p) => p.absDir);
const plugins = await probe("D-plugins-packages", {
    ...COMMON,
    entryPoints: pluginDirs,
    entryPointStrategy: "packages",
    packageOptions: { ...COMMON, entryPoints: ["src"], entryPointStrategy: "expand" },
    name: "GeoLeaf Plugins",
});

// ── C6 — la surface runtime est-elle dérivable ? ────────────────────────────────────────
const { EXPECTED_FACADE_KEYS } = await import(
    path.join(ROOT, "scripts/lib/namespace-surface.mjs")
);

console.log("\n" + "═".repeat(72));
console.log("C6 — couverture des EXPECTED_FACADE_KEYS dans la surface rendue");
console.log("═".repeat(72));

const seenIn = (r) => {
    const blob = r.lines.join("\n");
    return EXPECTED_FACADE_KEYS.filter((k) =>
        new RegExp(`GeoLeafGlobal\\.${k}(\\b|$)`, "m").test(blob)
    );
};
for (const r of [actuel, elargi].filter(Boolean)) {
    const seen = seenIn(r);
    console.log(`   ${r.label.padEnd(24)} ${seen.length}/${EXPECTED_FACADE_KEYS.length} clés rendues`);
}

// ⚠️ La ventilation PAR CLÉ, et non le seul total. Et elle doit distinguer DEUX cas que
// « 0 membre sous la façade » confond — la première version de cette sonde les a confondus,
// et le chiffre faux est parti dans la roadmap avant d'être rattrapé :
//
//   (i)  la clé est déclarée par un TYPE NOMMÉ (`Layers?: LayerDataApi`) : TypeDoc rend les
//        membres au SITE DE DÉCLARATION, pas sous la façade. Le document est dérivable — le
//        lecteur suit une référence cliquable. Ce n'est pas un défaut.
//   (ii) la clé n'a de membres NULLE PART (`CONSTANTS = Object.freeze({…})`,
//        `Cluster = buildPublicApi()`) : le type inféré est opaque pour TypeDoc. Là, un
//        document qui décrit cette façade n'a PAS de remplaçant, et le supprimer perdrait
//        son contenu.
//
// Seul (ii) bloque. Confondre les deux sur-compte le blocage d'un facteur ~3.
if (elargi) {
    const blob = elargi.lines.join("\n");
    const decl = fs.readFileSync(path.join(CORE.absDir, "src/global.d.ts"), "utf8");

    /** Le nom de type par lequel une clé de façade est déclarée, s'il y en a un. */
    function declaredTypeName(key) {
        const m = decl.match(new RegExp(`^\\s+${key}\\??\\s*:\\s*([^;]+);`, "m"));
        if (!m) return null;
        const t = m[1].trim();
        // `typeof import("…").X` / `import("…").X` → X ; `Foo` → Foo. Un `{ … }` inline n'a
        // pas de nom, et c'est justement le cas qui rend ses membres sous la façade.
        const viaImport = t.match(/import\([^)]*\)\.([A-Za-z_]\w*)/);
        if (viaImport) return viaImport[1];
        const bare = t.match(/^([A-Za-z_]\w*)$/);
        return bare ? bare[1] : null;
    }

    const routees = [];
    const opaques = [];
    for (const k of seenIn(elargi)) {
        const direct = (blob.match(new RegExp(`GeoLeafGlobal\\.${k}\\.`, "g")) || []).length;
        if (direct > 0) continue;
        const t = declaredTypeName(k);
        const ailleurs = t
            ? (blob.match(new RegExp(`\\b${t}\\.[A-Za-z_]`, "g")) || []).length
            : 0;
        (ailleurs > 0 ? routees : opaques).push(`${k}${t ? `→${t}` : ""}${ailleurs ? ` (${ailleurs})` : ""}`);
    }

    console.log(
        `\n   ℹ ${routees.length} façade(s) rendue(s) AILLEURS qu'in situ — dérivables, le lecteur`
    );
    console.log(`     suit un type nommé : ${routees.join(", ") || "(aucune)"}`);
    console.log(
        `\n   ⚠️ ${opaques.length} façade(s) dont les membres ne sont rendus NULLE PART — un`
    );
    console.log(
        `      document qui les décrit ne peut PAS être supprimé : ${opaques.join(", ") || "(aucune)"}`
    );

    const abs = EXPECTED_FACADE_KEYS.filter((k) => !seenIn(elargi).includes(k));
    console.log(
        `\n   ℹ ${abs.length} clé(s) absente(s), dont ${abs.filter((k) => k.startsWith("_")).length} ` +
            `préfixée(s) \`_\` (dette D-14, hors namespace par décision)`
    );
    console.log(
        `   ℹ Table/Geocoding/Popup dans EXPECTED_FACADE_KEYS ? ` +
            ["Table", "Geocoding", "Popup"]
                .map((k) => `${k}=${EXPECTED_FACADE_KEYS.includes(k)}`)
                .join(" ")
    );
}

// ── Déterminisme — la propriété que le RENDU échoue et que le manifeste tient ───────────
console.log("\n" + "═".repeat(72));
console.log("DÉTERMINISME du manifeste (le rendu HTML, lui, grave le SHA de HEAD)");
console.log("═".repeat(72));
let impur = 0;
for (const r of [actuel, elargi, piege, plugins].filter(Boolean)) {
    const t = fs.readFileSync(r.file, "utf8");
    const sha = (t.match(/\b[a-f0-9]{40}\b/g) || []).length;
    const abs = (t.match(/\/(home|Users)\/[^\s|]+/g) || []).length;
    const dates = (t.match(/\b20\d\d-\d\d-\d\d\b/g) || []).length;
    if (sha || abs || dates) impur++;
    console.log(`   ${r.label.padEnd(30)} SHA=${sha}  chemins_abs=${abs}  dates=${dates}`);
}
console.log(
    impur === 0
        ? "   ✓ aucun manifeste ne contient de SHA, de date ni de chemin absolu."
        : `   ✗ ${impur} manifeste(s) impur(s) — le régime de gate du §Fraîcheur ne tient plus.`
);

if (elargi && plugins) {
    console.log("\n" + "═".repeat(72));
    console.log(
        `TOTAL 14 paquets : ${elargi.pages + plugins.pages} pages HTML · ` +
            `manifeste ${elargi.lines.length + plugins.lines.length} lignes`
    );
    console.log("═".repeat(72));
}

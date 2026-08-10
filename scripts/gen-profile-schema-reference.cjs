#!/usr/bin/env node
/*!
 * PROFILE-SCHEMA-REFERENCE : le 2ᵉ générateur de la refonte V3 — `profiles/schemas/*.json`
 * vers une référence markdown, et sa gate de fraîcheur.
 *
 * ## Le défaut que ce générateur ferme
 *
 * `PROFILE_JSON_REFERENCE.md` est **écrit à la main** et publié sur npm. Mesuré au 29/07/2026 :
 * il documente **128 paramètres** quand les 12 schémas en portent **233**. Il n'est donc pas
 * seulement exposé à la dérive — **il est incomplet de 45 %**, et rien ne le disait. Un
 * intégrateur qui cherche une clé absente du document conclut qu'elle n'existe pas.
 *
 * ⚠️ **Le sens de l'écart n'est pas celui qu'on attendait.** La roadmap classait ce document
 * « dérivable, donc remplaçable » ; la mesure dit qu'un générateur **couvre presque le double**
 * de ce que le rédigé couvre. Le gain n'est pas la suppression de 3 306 lignes, c'est
 * l'exhaustivité.
 *
 * ## Ce qu'il NE remplace PAS encore, et le chiffre est écrit ici
 *
 * Les schémas portent la STRUCTURE en entier (**233/233** ont un type ou un `$ref`), mais la
 * prose seulement à moitié : **129/233 descriptions (55 %)**, **17 défauts (7 %)**, **0
 * exemple**. Or `PROFILE_JSON_REFERENCE.md` porte **60 blocs de code**.
 *
 * **Donc ce générateur ne peut pas encore remplacer le rédigé, et le dire est le résultat.**
 * La suite est un travail de SOURCE, pas de document : écrire les 104 descriptions manquantes
 * **dans les schémas**, où `check-config-coverage.cjs` les gate déjà dans les deux sens. Toute
 * autre voie — un side-car d'annotations, une fusion à la génération — recrée un second endroit
 * où la même phrase peut diverger, c'est-à-dire le défaut d'origine.
 *
 * ## Où il écrit, et pourquoi pas dans le tarball
 *
 * Sortie sous `docs/reference/`, **pas** `packages/core/docs/`. Y écrire publierait
 * **deux références de profil sur npm** — le doublon exact que cette refonte supprime — et
 * l'item 7 dit « vérifier sa sortie **avant** de retirer » l'ancienne. Tant que les deux
 * coexistent, une seule est publiée. Le jour où l'ancienne part (item 8), `OUT_FILE` déménage :
 * une ligne.
 *
 * ⚠️ La sortie est un `.md` **généré**, donc inscrite dans `.prettierignore` sur le patron
 * d'`ARBORESCENCE_QUALIFIEE.md` : laisser Prettier la reformater la ferait diverger du
 * générateur et rendrait la gate rouge en permanence, sans qu'une source ait bougé.
 *
 * ## Déterminisme
 *
 * Fonction pure des schémas : ni date, ni SHA, ni chemin absolu ; fichiers et propriétés
 * triés. Même exigence que `docs:tree:check` et `gen-api-surface.cjs`, et pour la même raison —
 * un artefact qui contient « maintenant » n'est comparable à rien.
 *
 * Usage:
 *   node scripts/gen-profile-schema-reference.cjs           # (re)génère
 *   node scripts/gen-profile-schema-reference.cjs --check    # gate : exit 1 si périmé
 *   node scripts/gen-profile-schema-reference.cjs --audit     # écart vs le rédigé, n'écrit rien
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = registry.ROOT;
const SCHEMA_DIR = path.join(ROOT, "profiles", "schemas");
const OUT_FILE = docsPaths.reference("PROFILE_SCHEMA_REFERENCE.md");
// Le rédigé que `--audit` compare. Résolu par le registre : un chemin en dur cesserait
// silencieusement de matcher si le core bougeait, et l'audit sortirait « 0 écart ».
const LEGACY_DOC = path.join(
    registry.requireByDirName("core").absDir,
    "docs",
    "PROFILE_JSON_REFERENCE.md"
);

const CHECK = process.argv.includes("--check");
const AUDIT = process.argv.includes("--audit");

// ---------------------------------------------------------------------------
// Lecture des schémas
// ---------------------------------------------------------------------------

/** @returns {{file: string, schema: object}[]} les schémas, triés par nom de fichier. */
function readSchemas() {
    if (!fs.existsSync(SCHEMA_DIR)) {
        throw new Error(
            `[PROFILE-SCHEMA] ${path.relative(ROOT, SCHEMA_DIR)} est introuvable — la gate ` +
                "refuse de conclure plutôt que de générer une référence vide."
        );
    }
    const files = fs
        .readdirSync(SCHEMA_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
    if (files.length === 0) {
        throw new Error("[PROFILE-SCHEMA] aucun schéma trouvé — même motif.");
    }
    return files.map((f) => ({
        file: f,
        schema: JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8")),
    }));
}

/**
 * Résout un `$ref` INTERNE (`#/definitions/x`, `#/$defs/x`).
 *
 * Mesuré au 29/07/2026 : les 12 schémas n'utilisent **que** des refs internes. Une ref
 * externe rendrait `undefined` ici — elle est donc signalée plutôt qu'ignorée, sans quoi la
 * propriété disparaîtrait de la référence sans un mot.
 *
 * @returns {object|null}
 */
function resolveRef(ref, root) {
    if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
    let node = root;
    for (const seg of ref.slice(2).split("/")) {
        if (!node || typeof node !== "object") return null;
        node = node[seg];
    }
    return node && typeof node === "object" ? node : null;
}

/**
 * Aplatit un schéma en chemins pointés.
 *
 * ⚠️ Le garde-cycle est load-bearing : `panelBlock` → `panelBlockBase` se référence en boucle
 * (11 occurrences du même `$ref`), et sans lui la marche ne termine pas. Il coupe sur la
 * DÉFINITION déjà visitée, pas sur le chemin — deux propriétés distinctes peuvent
 * légitimement pointer la même définition.
 *
 * @returns {{path: string, type: string, required: boolean, description: string, def: string, enum: string}[]}
 */
function flatten(node, root, prefix, seenRefs, out) {
    if (!node || typeof node !== "object") return out;

    if (node.$ref) {
        if (seenRefs.has(node.$ref)) return out;
        const target = resolveRef(node.$ref, root);
        if (!target) {
            out.push({
                path: prefix || "(racine)",
                type: `⚠️ $ref non résolue : \`${node.$ref}\``,
                required: false,
                description: "",
                def: "",
                enum: "",
            });
            return out;
        }
        return flatten(target, root, prefix, new Set([...seenRefs, node.$ref]), out);
    }

    for (const key of ["oneOf", "anyOf", "allOf"]) {
        if (Array.isArray(node[key])) {
            for (const sub of node[key]) flatten(sub, root, prefix, seenRefs, out);
        }
    }

    if (node.items) flatten(node.items, root, prefix ? `${prefix}[]` : "[]", seenRefs, out);

    const props = node.properties;
    if (props && typeof props === "object") {
        const required = new Set(Array.isArray(node.required) ? node.required : []);
        for (const key of Object.keys(props).sort()) {
            const val = props[key];
            if (!val || typeof val !== "object") continue;
            const p = prefix ? `${prefix}.${key}` : key;
            out.push({
                path: p,
                type: typeName(val, root),
                required: required.has(key),
                description: (val.description || "").replace(/\s+/g, " ").trim(),
                def: "default" in val ? JSON.stringify(val.default) : "",
                enum: Array.isArray(val.enum)
                    ? val.enum.map((e) => JSON.stringify(e)).join(" \\| ")
                    : "",
            });
            flatten(val, root, p, seenRefs, out);
        }
    }

    // `additionalProperties` décrit les entrées d'une map — `basemaps.{id}.*`. La forme `{id}`
    // est celle que le rédigé emploie déjà, reprise pour que les deux soient comparables.
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
        flatten(node.additionalProperties, root, prefix ? `${prefix}.{id}` : "{id}", seenRefs, out);
    }
    return out;
}

/** Le type affiché d'une propriété — `$ref` rendu par son nom de définition. */
function typeName(val, root) {
    if (val.$ref) {
        const target = resolveRef(val.$ref, root);
        const name = val.$ref.split("/").pop();
        return target ? `\`${name}\`` : `⚠️ \`${val.$ref}\` non résolue`;
    }
    if (Array.isArray(val.type)) return val.type.join(" \\| ");
    if (val.type) return val.type;
    if (val.oneOf || val.anyOf) return "oneOf";
    return "—";
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const BANNER = `<!-- GÉNÉRÉ — ne pas éditer à la main. -->

# Référence des schémas de profil — GÉNÉRÉE

> **Source unique : \`profiles/schemas/*.json\`.** Ce fichier est produit par
> \`npm run gen:profile-schema\` et vérifié à l'octet près par \`npm run gen:profile-schema:check\`
> (câblé dans \`ci:local\` et \`ci.yml\`). Ne pas l'éditer : la prochaine génération écrase.
>
> **Pour corriger une description, éditer le SCHÉMA**, pas ce document. C'est le seul endroit
> où la phrase ne peut pas diverger de ce que le validateur applique.
>
> Ce fichier ne porte ni date ni numéro de version, à dessein : c'est ce qui en fait une
> fonction pure de ses schémas, donc gatable. Les décomptes s'obtiennent par
> \`npm run gen:profile-schema\`, qui les imprime.

`;

function render(schemas) {
    const lines = [BANNER];
    let total = 0;
    let described = 0;

    for (const { file, schema } of schemas) {
        const rows = flatten(schema, schema, "", new Set(), []);
        // Dédoublonnage par chemin : `oneOf` peut produire deux fois la même clé.
        const byPath = new Map();
        for (const r of rows) if (!byPath.has(r.path)) byPath.set(r.path, r);
        const sorted = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

        lines.push(`## \`${file}\``);
        lines.push("");
        if (schema.title) lines.push(`_${schema.title}_`, "");
        if (schema.description)
            lines.push(String(schema.description).replace(/\s+/g, " ").trim(), "");

        if (sorted.length === 0) {
            lines.push("_Aucune propriété déclarée._", "");
            continue;
        }

        lines.push("| Chemin | Type | Requis | Défaut | Valeurs | Description |");
        lines.push("| ------ | ---- | ------ | ------ | ------- | ----------- |");
        for (const r of sorted) {
            total++;
            if (r.description) described++;
            lines.push(
                `| \`${r.path}\` | ${r.type} | ${r.required ? "oui" : "—"} | ${
                    r.def ? `\`${r.def}\`` : "—"
                } | ${r.enum || "—"} | ${r.description || "—"} |`
            );
        }
        lines.push("");
    }

    if (total === 0) {
        throw new Error(
            "[PROFILE-SCHEMA] 0 propriété extraite des schémas. La gate refuse de conclure — " +
                "une référence vide se comparerait à elle-même et sortirait verte en ne décrivant rien."
        );
    }
    return { content: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", total, described };
}

// ---------------------------------------------------------------------------

/** Les paramètres que le document RÉDIGÉ documente, lus sur ses titres. */
function legacyParams() {
    if (!fs.existsSync(LEGACY_DOC)) return null;
    const txt = fs.readFileSync(LEGACY_DOC, "utf8");
    const out = new Set();
    for (const m of txt.matchAll(/^#{3,4} `([^`]+)`/gm)) out.add(m[1]);
    return out;
}

function main() {
    const schemas = readSchemas();
    const { content, total, described } = render(schemas);

    if (AUDIT) {
        const legacy = legacyParams();
        const generated = new Set();
        for (const m of content.matchAll(/^\| `([^`]+)` \|/gm)) generated.add(m[1]);
        console.log("─".repeat(72));
        if (!legacy) {
            console.log("ℹ  Le rédigé est absent — plus rien à comparer, l'item 8 est passé.");
            console.log("─".repeat(72));
            return 0;
        }
        const onlySchema = [...generated].filter((p) => !legacy.has(p)).sort();
        const onlyDoc = [...legacy].filter((p) => !generated.has(p)).sort();
        console.log(
            `AUDIT — schémas : ${generated.size} chemins · rédigé : ${legacy.size} paramètres`
        );
        console.log(`  dans les SCHÉMAS et absents du rédigé : ${onlySchema.length}`);
        for (const p of onlySchema.slice(0, 15)) console.log(`     + ${p}`);
        if (onlySchema.length > 15) console.log(`     … et ${onlySchema.length - 15} de plus`);
        console.log(`  dans le RÉDIGÉ et absents des schémas : ${onlyDoc.length}`);
        for (const p of onlyDoc.slice(0, 15)) console.log(`     − ${p}`);
        if (onlyDoc.length > 15) console.log(`     … et ${onlyDoc.length - 15} de plus`);
        console.log(
            `\n⚠️  Les deux colonnes comptent. « + » = ce que le rédigé NE DIT PAS ; « − » = ce\n` +
                `   qu'il dit et que les schémas n'imposent pas — soit une clé morte, soit une clé\n` +
                `   vivante qu'aucun schéma ne valide. Les départager demande de lire, pas de compter.`
        );
        console.log("─".repeat(72));
        return 0;
    }

    if (!CHECK) {
        fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
        fs.writeFileSync(OUT_FILE, content);
        console.log(
            `✅ [PROFILE-SCHEMA] ${path.relative(ROOT, OUT_FILE)} — ${total} propriété(s) sur ` +
                `${schemas.length} schéma(s) ; ${described} décrite(s) ` +
                `(${((100 * described) / total).toFixed(1)} %, informatif).`
        );
        return 0;
    }

    console.log("─".repeat(72));
    if (!fs.existsSync(OUT_FILE)) {
        console.log(
            `❌ [PROFILE-SCHEMA] ${path.relative(ROOT, OUT_FILE)} est ABSENT.\n` +
                "   Lancer : npm run gen:profile-schema — puis commiter le résultat."
        );
        console.log("─".repeat(72));
        return 1;
    }
    if (fs.readFileSync(OUT_FILE, "utf8") !== content) {
        console.log(
            "❌ [PROFILE-SCHEMA] la référence est PÉRIMÉE — un schéma a bougé depuis la dernière\n" +
                "   génération. Lancer : npm run gen:profile-schema — puis commiter le résultat."
        );
        console.log("─".repeat(72));
        return 1;
    }
    console.log(
        `✅ [PROFILE-SCHEMA] à jour — ${total} propriété(s), ${schemas.length} schéma(s), ` +
            `${described} décrite(s).`
    );
    console.log("─".repeat(72));
    return 0;
}

try {
    process.exit(main());
} catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(2);
}

#!/usr/bin/env node
/**
 * GeoLeaf – Profile + companion schema validation (Sprint S2 — config-contract).
 *
 * Validates, for every profile under profiles/, the profile.json AND its
 * companion config files against profiles/schemas/*.schema.json:
 *   - profile.json                         → profile.schema.json
 *   - config/core/{layers,basemaps,
 *     features,ui,themes,
 *     mapping}.json                        → <name>.schema.json
 *     ⚠️ `taxonomy` ne fait PLUS partie de cette liste (retiré au Lot 2, 11/07/2026 : le
 *     fichier `config/core/taxonomy.json` et `taxonomy.schema.json` n'existent plus, la
 *     taxonomie est un module `config/plugins/taxonomy.json`). Cette docstring l'a gardé
 *     jusqu'au 27/07/2026 alors que `CORE_SCHEMA_BY_FILE` ne l'a jamais eu — un lecteur
 *     s'y fiant cherchait un schéma absent.
 *   - layers/<id>/<id>_config.json         → layer-config.schema.json
 *   - layers/<id>/styles/*.json            → style.schema.json
 *
 * Plugin configs (config/plugins/*.json) are owned and validated by their
 * plugin, not the core contract — they are intentionally skipped here
 * (config-contract scope B7).
 *
 * Run: node scripts/validate-profiles.cjs   |   npm run validate:profiles
 * Exits 1 on any violation — used as a pre-commit gate (CI frozen).
 */
"use strict";

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMAS_DIR = path.join(ROOT, "profiles/schemas");
const PROFILES_DIR = path.join(ROOT, "profiles");

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
// ajv-formats is optional: the contract schemas use no "format" keyword that
// requires it, and the package is not a declared dependency. Loaded if present.
try {
    require("ajv-formats")(ajv);
} catch {
    /* not installed — no format keyword needed */
}

// ⚠️ Il n'y a PLUS de fragment partagé à enregistrer, et c'est le résultat d'une
// mesure plutôt qu'un oubli. `detail-blocks.schema.json` et `geoleaf-profile.schema.json`
// étaient tous deux ORPHELINS : aucun `$ref` ne les visait, aucun fichier n'était validé
// contre eux. Le premier prétendait décrire `sidepanelConfig.detailLayout[]` — une clé que
// `layer-config` n'accepte même pas. Les deux sont supprimés à la tâche 2.11 de
// `roadmap_collecte-terrain-offline`, dans le même commit que leurs deux chargeurs :
// celui-ci et `s13-layers-anomalies-lock.test.js`. Un schéma enregistré mais jamais
// appliqué donne l'illusion d'une validation ; c'est exactement ce que ce chantier retire.

// Compile every contract schema once, keyed by short name.
const SCHEMA_NAMES = [
    "profile",
    "layers",
    "basemaps",
    "features",
    "ui",
    "themes",
    "mapping",
    "layer-config",
    "style",
];
const validators = {};
for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(
        fs.readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), "utf8")
    );
    validators[name] = ajv.compile(schema);
}

// config/core/<file> → schema name
const CORE_SCHEMA_BY_FILE = {
    "layers.json": "layers",
    "basemaps.json": "basemaps",
    "features.json": "features",
    "ui.json": "ui",
    "themes.json": "themes",
    "mapping.json": "mapping",
};

function listJson(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => e.name);
}

function listDirs(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

/** Collect [relativePath, schemaName] pairs to validate for one profile. */
function collectTargets(profileDir) {
    const targets = [];

    if (fs.existsSync(path.join(profileDir, "profile.json"))) {
        targets.push(["profile.json", "profile"]);
    }

    // config/core/*.json (known contract files only)
    const coreDir = path.join(profileDir, "config", "core");
    for (const file of listJson(coreDir)) {
        const schemaName = CORE_SCHEMA_BY_FILE[file];
        if (schemaName) targets.push([path.join("config", "core", file), schemaName]);
    }

    // config/plugins/*.json → intentionally skipped (plugin-owned)

    // layers/<id>/<id>_config.json + layers/<id>/styles/*.json
    const layersDir = path.join(profileDir, "layers");
    for (const layerId of listDirs(layersDir)) {
        const layerDir = path.join(layersDir, layerId);
        for (const file of listJson(layerDir)) {
            if (file.endsWith("_config.json")) {
                targets.push([path.join("layers", layerId, file), "layer-config"]);
            }
        }
        for (const file of listJson(path.join(layerDir, "styles"))) {
            targets.push([path.join("layers", layerId, "styles", file), "style"]);
        }
    }

    return targets;
}

const profileDirs = listDirs(PROFILES_DIR).filter((d) => d !== "schemas");

console.log("GeoLeaf — validation des profils (profile.json + compagnons)\n");

let totalFiles = 0;
let totalErrors = 0;
let profilesWithErrors = 0;
let profilesChecked = 0;

for (const dir of profileDirs) {
    const profileDir = path.join(PROFILES_DIR, dir);
    const targets = collectTargets(profileDir);
    if (targets.length === 0) continue; // not a profile directory

    profilesChecked++;
    const errors = [];

    for (const [rel, schemaName] of targets) {
        totalFiles++;
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(profileDir, rel), "utf8"));
        } catch (e) {
            errors.push({ rel, message: `JSON invalide : ${e.message}` });
            continue;
        }
        const validate = validators[schemaName];
        if (!validate(data)) {
            for (const err of validate.errors) {
                const field = err.instancePath || "(racine)";
                errors.push({ rel, message: `${field}: ${err.message}` });
            }
        }
    }

    if (errors.length === 0) {
        console.log(`  ✓ ${dir} — ${targets.length} fichier(s)`);
    } else {
        profilesWithErrors++;
        totalErrors += errors.length;
        console.error(`  ✗ ${dir} — ${errors.length} erreur(s)`);
        for (const { rel, message } of errors) {
            console.error(`       ${rel.split(path.sep).join("/")}  ${message}`);
        }
    }
}

if (totalErrors > 0) {
    console.error(
        `\n✗ Validation échouée — ${totalErrors} erreur(s) dans ${profilesWithErrors}/${profilesChecked} profil(s) (${totalFiles} fichiers contrôlés).`
    );
    process.exit(1);
} else {
    console.log(`\n✓ ${profilesChecked} profils, ${totalFiles} fichiers valides.`);
}

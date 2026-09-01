#!/usr/bin/env node
/**
 * GeoLeaf – Profile + companion schema validation (config-contract).
 *
 * Validates, for every profile under profiles/, the profile.json AND its
 * companion config files against profiles/schemas/*.schema.json:
 *   - profile.json                         → profile.schema.json
 *   - config/core/{layers,basemaps,
 *     features,ui,themes,
 *     mapping}.json                        → <name>.schema.json
 *     ⚠️ `taxonomy` is NO LONGER part of this list (removed on 2026-07-11: the file
 *     `config/core/taxonomy.json` and `taxonomy.schema.json` no longer exist, the
 *     taxonomy is a `config/plugins/taxonomy.json` module). This docstring kept it
 *     until 2026-07-27 while `CORE_SCHEMA_BY_FILE` never had it — a reader trusting
 *     it looked for an absent schema.
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

// ⚠️ There is NO shared fragment left to register, and it is a measurement's result
// rather than an oversight. `detail-blocks.schema.json` and
// `geoleaf-profile.schema.json` were both ORPHANS: no `$ref` targeted them, no file
// was validated against them. The first claimed to describe
// `sidepanelConfig.detailLayout[]` — a key `layer-config` does not even accept. Both
// were deleted in the same commit as their two loaders: this one and
// `s13-layers-anomalies-lock.test.js`. A schema registered yet never applied gives
// the illusion of validation; exactly what that work removes.

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
    // The 10th schema. It stayed ORPHANED from its creation to this day:
    // `profiles/schemas/` carried ten, this list declared nine, and its 58 lines
    // were read by no validator. A schema present yet never applied gives the
    // illusion of a contract — same defect as the two fragments deleted above,
    // except this one describes a VERY MUCH ALIVE file shipped in every variant.
    "geoleaf-config",
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

const DEPLOY_DIR = path.join(ROOT, "deploy");

/**
 * Roots to validate: the source, then EACH deployed variant present.
 *
 * 🛑 **The deployed corpus was out of this gate's reach, and the build thus
 * produced, at every execution, artifacts the repo's schema forbids — while the repo
 * came out green.** Not a wiring oversight but a perimeter choice: the gate only
 * read the source. It is the "gate goes green having not scanned the right corpus"
 * class, the one a probe watches for package paths and nothing watched here.
 *
 * ⚠️ **The deploy output is NOT a copy of the source**, and that is exactly why
 * validating it teaches something: the build INJECTS keys into it (the aggregated
 * bundle's name, the inventory of embarked profiles) and REMOVES others (the
 * bindings to the development backend). The three gaps found at landing are all of
 * that nature, and the third was named nowhere.
 *
 * 🛑 **`deploy/` is git-ignored, hence absent from a fresh clone.** The gate cannot
 * infer a green from that: it SAYS it saw nothing, and the source half keeps biting.
 * Without that distinction, a widened gate would go green on an empty corpus — the
 * very reproach made to the previous one.
 *
 * @returns {{label: string, dir: string, config: string}[]} Roots to walk.
 */
function collectRoots() {
    const roots = [{ label: "profiles/", dir: PROFILES_DIR, config: "geoleaf.config.json" }];
    for (const variant of listDirs(DEPLOY_DIR)) {
        const dir = path.join(DEPLOY_DIR, variant, "profiles");
        if (!fs.existsSync(dir)) continue;
        roots.push({ label: `deploy/${variant}/profiles/`, dir, config: "geoleaf.config.json" });
    }
    return roots;
}

const roots = collectRoots();

console.log("GeoLeaf — validation des profils (profile.json + compagnons)\n");
let totalFiles = 0;
let totalErrors = 0;
let profilesWithErrors = 0;
let profilesChecked = 0;

/**
 * Validates a file against its schema and accumulates the gaps.
 *
 * @param {string} abs Absolute path of the file.
 * @param {string} rel Path to display.
 * @param {string} schemaName Short schema name.
 * @param {{rel: string, message: string}[]} errors Accumulator.
 * @returns {void}
 */
function validateFile(abs, rel, schemaName, errors) {
    totalFiles++;
    let data;
    try {
        data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
        errors.push({ rel, message: `JSON invalide : ${e.message}` });
        return;
    }
    const validate = validators[schemaName];
    if (!validate(data)) {
        for (const err of validate.errors) {
            const field = err.instancePath || "(racine)";
            errors.push({ rel, message: `${field}: ${err.message}` });
        }
    }
}

for (const root of roots) {
    console.log(`\u2500\u2500 ${root.label}`);

    // The root configuration, against the 10th schema — the one nobody compiled.
    const cfgAbs = path.join(root.dir, root.config);
    if (fs.existsSync(cfgAbs)) {
        const errors = [];
        validateFile(cfgAbs, root.config, "geoleaf-config", errors);
        if (errors.length === 0) {
            console.log(`  \u2713 ${root.config}`);
        } else {
            profilesWithErrors++;
            totalErrors += errors.length;
            console.error(`  \u2717 ${root.config} \u2014 ${errors.length} erreur(s)`);
            for (const { rel, message } of errors) console.error(`       ${rel}  ${message}`);
        }
    }

    for (const dir of listDirs(root.dir).filter((d) => d !== "schemas")) {
        const profileDir = path.join(root.dir, dir);
        const targets = collectTargets(profileDir);
        if (targets.length === 0) continue; // not a profile directory

        profilesChecked++;
        const errors = [];
        for (const [rel, schemaName] of targets) {
            validateFile(path.join(profileDir, rel), rel, schemaName, errors);
        }

        if (errors.length === 0) {
            console.log(`  \u2713 ${dir} \u2014 ${targets.length} fichier(s)`);
        } else {
            profilesWithErrors++;
            totalErrors += errors.length;
            console.error(`  \u2717 ${dir} \u2014 ${errors.length} erreur(s)`);
            for (const { rel, message } of errors) {
                console.error(`       ${rel.split(path.sep).join("/")}  ${message}`);
            }
        }
    }
}

// Anti-empty-gate guard, on the only half that is always there. `deploy/` is
// git-ignored: its absence is normal and gets SAID; `profiles/`'s never is, and a
// silent zero there would be a green obtained having read nothing.
if (profilesChecked === 0) {
    console.error(
        "\n\u2717 Aucun profil scanné \u2014 `profiles/` est vide ou introuvable. Une gate qui ne " +
            "lit rien sort verte en n'ayant rien gardé : elle refuse de conclure."
    );
    process.exit(1);
}

if (roots.length === 1) {
    console.log(
        "\n\u23ed\ufe0f  Aucune variante déployée sous `deploy/` \u2014 cette moitié n'a rien contrôlé.\n" +
            "    Ce n'est PAS un vert du contrat déployé : `deploy/` est git-ignoré, donc absent\n" +
            "    d'un clone frais tant que le build des variantes n'a pas tourné. Or le build\n" +
            "    INJECTE des clés que la source ne porte pas, et en RETIRE d'autres : ces écarts\n" +
            "    ne se voient qu'ici."
    );
}

if (totalErrors > 0) {
    console.error(
        `\n\u2717 Validation échouée \u2014 ${totalErrors} erreur(s) dans ${profilesWithErrors} ensemble(s) sur ${roots.length} racine(s) (${totalFiles} fichiers contrôlés).`
    );
    process.exit(1);
} else {
    console.log(
        `\n\u2713 ${roots.length} racine(s), ${profilesChecked} profils, ${totalFiles} fichiers valides.`
    );
}

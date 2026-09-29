/**
 * The profile contract on disk: where the JSON Schemas live, and which file of a profile each
 * one judges.
 *
 * ## Why this is a module and not three copies
 *
 * No schema describes a whole profile. A profile is a DIRECTORY, and each of its files is
 * validated alone, by the schema its place designates. That table used to live inside
 * `validate-profiles.cjs` only — which compiles the schemas at load time, so no other script
 * could borrow it without side effects. Three readers need it now: the repo's validator, the
 * emitter that ships the schemas with `@geoleaf/core` (`emit-profile-schemas.cjs`), and the test
 * proving that a profile validates against what the tarball carries. A second copy of the table
 * would drift at the first moved file, and the proof would then check a mapping nobody uses.
 *
 * ## What is deliberately NOT mapped
 *
 * `config/plugins/*.json` — a module's configuration. No JSON Schema describes it: no plugin
 * ships one, and `profile.schema.json` keeps each `modules.<id>` block open on purpose. What
 * checks those keys is runtime code: the unknown-key diagnostic of in-core capabilities (against
 * the `configSchema` each declares), and whatever a plugin checks itself.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./packages.cjs");

const PROFILES_DIR = path.join(registry.ROOT, "profiles");
const SCHEMAS_DIR = path.join(PROFILES_DIR, "schemas");
const SCHEMA_SUFFIX = ".schema.json";

/** `config/core/<file>` → the schema that judges it. */
const CORE_SCHEMA_BY_FILE = {
    "layers.json": "layers",
    "basemaps.json": "basemaps",
    "features.json": "features",
    "ui.json": "ui",
    "themes.json": "themes",
    "mapping.json": "mapping",
};

/**
 * Every schema → the file(s) it judges, relative to a profile directory. The single place where
 * a schema is tied to a location: `collectTargets` walks the same places, and the emitter refuses
 * to ship a schema absent from this table — a schema that judges nothing is an orphan, the
 * illusion of a contract.
 *
 * @type {Readonly<Record<string, string>>}
 */
const FILE_OF_SCHEMA = Object.freeze({
    "geoleaf-config": "../geoleaf.config.json",
    profile: "profile.json",
    ...Object.fromEntries(
        Object.entries(CORE_SCHEMA_BY_FILE).map(([file, schema]) => [schema, `config/core/${file}`])
    ),
    "layer-config": "layers/<id>/<id>_config.json",
    style: "layers/<id>/styles/*.json",
});

/**
 * Short names of the schemas present on disk (`profile`, `layer-config`…), sorted.
 *
 * @param {string} [dir] Schema directory — `profiles/schemas/` unless told otherwise.
 * @returns {string[]}
 * @throws {Error} When the directory holds no schema: an empty list would let every reader
 *   conclude on nothing.
 */
function listSchemaNames(dir = SCHEMAS_DIR) {
    const names = fs.existsSync(dir)
        ? fs
              .readdirSync(dir)
              .filter((n) => n.endsWith(SCHEMA_SUFFIX))
              .map((n) => n.slice(0, -SCHEMA_SUFFIX.length))
              .sort()
        : [];
    if (names.length === 0) {
        throw new Error(
            `[profile-schemas] aucun *${SCHEMA_SUFFIX} sous ${dir} — refus de conclure.`
        );
    }
    return names;
}

/**
 * @param {string} dir
 * @returns {string[]} Names of the `.json` files directly under `dir` (none if it is absent).
 */
function listJson(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => e.name);
}

/**
 * @param {string} dir
 * @returns {string[]} Names of the directories directly under `dir` (none if it is absent).
 */
function listDirs(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

/**
 * The files of ONE profile directory that a schema judges, with that schema's short name.
 * An empty list means the directory is not a profile.
 *
 * @param {string} profileDir Absolute path of a profile directory.
 * @returns {[string, string][]} `[path relative to profileDir, schema name]` pairs.
 */
function collectTargets(profileDir) {
    /** @type {[string, string][]} */
    const targets = [];

    if (fs.existsSync(path.join(profileDir, "profile.json"))) {
        targets.push(["profile.json", "profile"]);
    }

    // config/core/*.json — known contract files only.
    const coreDir = path.join(profileDir, "config", "core");
    for (const file of listJson(coreDir)) {
        const schemaName =
            CORE_SCHEMA_BY_FILE[/** @type {keyof typeof CORE_SCHEMA_BY_FILE} */ (file)];
        if (schemaName) targets.push([path.join("config", "core", file), schemaName]);
    }

    // config/plugins/*.json → deliberately not mapped (see the header).

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

module.exports = {
    PROFILES_DIR,
    SCHEMAS_DIR,
    SCHEMA_SUFFIX,
    CORE_SCHEMA_BY_FILE,
    FILE_OF_SCHEMA,
    listSchemaNames,
    listJson,
    listDirs,
    collectTargets,
};

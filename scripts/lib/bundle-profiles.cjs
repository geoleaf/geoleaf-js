/**
 * @fileoverview Generates a profile-bundle.json for each modular GeoLeaf profile.
 *
 * Reads all section files (taxonomy, themes, basemaps, ui, layers + layer configs)
 * from a deploy destination and merges them into a single bundle file, reducing
 * the ~19 HTTP requests at startup to 3 (geoleaf.config.json + profile.json + bundle).
 *
 * Also patches profile.json to add `"bundleFile": "profile-bundle.json"` so the
 * runtime loader can detect and use the bundle automatically.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BUNDLE_VERSION = "1.0";
const BUNDLE_FILENAME = "profile-bundle.json";

/**
 * Returns true if the profile object uses the modular format (Files object present
 * or version >= 1.2), matching the runtime isModularProfile() logic.
 */
function _isModularProfile(profile) {
    if (profile.Files && typeof profile.Files === "object") return true;
    if (profile.version) {
        const m = String(profile.version).match(/^(\d+)\.(\d+)/);
        if (m) {
            const major = parseInt(m[1], 10);
            const minor = parseInt(m[2], 10);
            return major > 1 || (major === 1 && minor >= 2);
        }
    }
    return false;
}

/**
 * Reads a JSON file and returns its parsed content, or null on error.
 */
function _readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Reads a section file referenced by `profile.Files[key]` relative to `profileDir`.
 * Returns null if the key is not declared or the file is missing.
 */
function _readSectionFile(profile, key, profileDir) {
    const fileName = profile.Files?.[key];
    if (!fileName) return null;
    return _readJson(path.join(profileDir, fileName));
}

/**
 * Reads the layers file and returns { layersFileData, staticLayers }.
 * staticLayers are the layers that have a `configFile` (non-template layers).
 */
function _readLayersFile(profile, profileDir) {
    const layersFileName = profile.Files?.layersFile;
    if (!layersFileName) return { layersFileData: null, staticLayers: [] };
    const layersFilePath = path.join(profileDir, layersFileName);
    const layersFileData = _readJson(layersFilePath);
    if (!layersFileData) return { layersFileData: null, staticLayers: [] };

    // Extract the regular layers array (non-template)
    const rawLayers = Array.isArray(layersFileData.layers) ? layersFileData.layers : [];
    const staticLayers = rawLayers.filter(
        (l) => l && typeof l === "object" && typeof l.configFile === "string"
    );
    return { layersFileData, staticLayers };
}

/**
 * Reads every plugin config file declared in `profile.Files.modules`
 * (profile layout v2) and returns the bag { [moduleId]: configObject },
 * or null when nothing is declared / readable.
 */
function _readModuleFiles(profile, profileDir) {
    const modulesMap = profile.Files?.modules;
    if (!modulesMap || typeof modulesMap !== "object" || Array.isArray(modulesMap)) return null;
    const bag = {};
    for (const [moduleId, filePath] of Object.entries(modulesMap)) {
        if (typeof filePath !== "string" || !filePath) continue;
        const config = _readJson(path.join(profileDir, filePath));
        if (config !== null) bag[moduleId] = config;
    }
    return Object.keys(bag).length > 0 ? bag : null;
}

/**
 * Reads all layer config files for the static layers.
 * Returns a map of { [layerId]: configObject }.
 */
function _readLayerConfigs(staticLayers, profileDir) {
    const layerConfigs = {};
    for (const layer of staticLayers) {
        const configPath = path.join(profileDir, layer.configFile);
        const config = _readJson(configPath);
        if (config !== null) {
            layerConfigs[layer.id] = config;
        }
    }
    return layerConfigs;
}

/**
 * Reads every style DOCUMENT a profile's layers can request, and returns the bag
 * `{ [layerId]: { [styleId]: <style JSON> } }`.
 *
 * 🛑 **Covers BOTH families, and that is the whole point.** `_readLayerConfigs` above filters
 * on `typeof l.configFile === "string"`, which excludes every `layerTemplates` INSTANCE by
 * construction — they carry only `{id, label, dataFile}` and inherit their styles from the
 * template. Following that patron here would aggregate the static layers only, produce a
 * plausible weight, and SUCCEED at aggregating a bit more than half the styles. Measured on
 * `tourism` at the time of writing: 20 static + 24 templated = 44 documents; the naive
 * version returns 20 and looks right.
 *
 * ⚠️ **Both key levels are sorted explicitly.** `BUILD-DET` compares two builds on the SAME
 * machine, so it can never see a `readdirSync` ordering that differs between machines — the
 * determinism has to be built in rather than checked. This is the same class of defect that
 * removing `_generatedAt` fixed: a bundle that differs at identical content.
 *
 * @param {Array<object>} staticLayers - Layers carrying a `configFile`.
 * @param {object|null} layersFileData - The layers file, for its `layerTemplates`.
 * @param {object} layerConfigs - Already-read configs of the static layers.
 * @param {string} profileDir - Absolute path to the profile directory.
 * @returns {object} The `{layerId: {styleId: document}}` bag; empty when nothing was read.
 */
function _readLayerStyleDocuments(staticLayers, layersFileData, layerConfigs, profileDir) {
    const out = {};

    const add = (layerId, styles) => {
        if (!layerId || !styles || typeof styles !== "object") return;
        const dir = typeof styles.directory === "string" ? styles.directory : "styles";
        /** styleId → file name. `available` first, then `default` if it names another file. */
        const wanted = new Map();
        for (const entry of Array.isArray(styles.available) ? styles.available : []) {
            if (!entry || typeof entry.file !== "string") continue;
            const id = typeof entry.id === "string" ? entry.id : entry.file.replace(/\.json$/, "");
            wanted.set(id, entry.file);
        }
        if (typeof styles.default === "string" && ![...wanted.values()].includes(styles.default)) {
            wanted.set(styles.default.replace(/\.json$/, ""), styles.default);
        }
        const bag = {};
        for (const [styleId, file] of wanted) {
            const doc = _readJson(path.join(profileDir, "layers", layerId, dir, file));
            if (doc !== null) bag[styleId] = doc;
        }
        if (Object.keys(bag).length === 0) return;
        out[layerId] = Object.fromEntries(
            Object.keys(bag)
                .sort()
                .map((k) => [k, bag[k]])
        );
    };

    for (const layer of staticLayers) add(layer.id, layerConfigs[layer.id]?.styles);

    const templates = Array.isArray(layersFileData?.layerTemplates)
        ? layersFileData.layerTemplates
        : [];
    for (const tpl of templates) {
        const styles = tpl?.template?.styles;
        for (const inst of Array.isArray(tpl?.instances) ? tpl.instances : []) {
            add(inst?.id, styles);
        }
    }

    return Object.fromEntries(
        Object.keys(out)
            .sort()
            .map((k) => [k, out[k]])
    );
}

/**
 * Generates profile-bundle.json for a single modular profile directory.
 * Patches profile.json to add `"bundleFile"`.
 *
 * @param {string} profileDir  - Absolute path to the profile directory (e.g. deploy/.../profiles/tourism)
 * @param {string} profileId   - Profile identifier (e.g. "tourism")
 * @returns {{ bundleSize: number, layerCount: number }}
 */
function bundleProfile(profileDir, profileId) {
    const profilePath = path.join(profileDir, "profile.json");
    const profile = _readJson(profilePath);
    if (!profile) {
        throw new Error(`[BundleProfiles] profile.json not found at ${profilePath}`);
    }

    if (!_isModularProfile(profile)) {
        console.log(`[BundleProfiles] ${profileId}: not a modular profile, skipping`);
        return { bundleSize: 0, layerCount: 0 };
    }

    const themes = _readSectionFile(profile, "themesFile", profileDir);
    const basemaps = _readSectionFile(profile, "basemapsFile", profileDir);
    const ui = _readSectionFile(profile, "uiFile", profileDir);
    const features = _readSectionFile(profile, "featuresFile", profileDir);
    const mapping = _readSectionFile(profile, "mappingFile", profileDir);
    const modules = _readModuleFiles(profile, profileDir);
    const { layersFileData, staticLayers } = _readLayersFile(profile, profileDir);
    const layerConfigs = _readLayerConfigs(staticLayers, profileDir);

    // 🛑 `_generatedAt: Date.now()` REMOVED — written here, read NOWHERE.
    //
    // Zero consumers measured across `packages/*/src`, `apps/` and `scripts/`: it was a
    // purely informative field, and its only observable effect was making the bundle
    // DIFFERENT on every build. That is not benign: this is the file that collapses 32
    // requests into one, and a timestamp made it re-download on every deployment, at
    // identical content.
    //
    // 🔻 CORRECTED on 2026-08-19 — this line claimed the bundle "is pre-cached by the
    // service worker (it is in `STATIC_ASSETS`)". **It is not**: it is fetched after the
    // root config, hence never referenced by the markup the pre-cache derives from. The
    // offline hole is real, but it closes through ENUMERATION, never through the pre-cache.
    //
    // ⚠️ Found by `check-build-determinism.cjs --deploy`, not by the task statement: that
    // statement only named the two `Date.now()` of `build-deploy.cjs`. A gate that compares
    // the whole deploy output sees what a gate that compares the `?v=` strings cannot.
    //
    // `_bundleVersion` stays: it is a FORMAT version, deterministic.
    //
    // ⚠️ This line used to claim "and it IS read" — that was FALSE for months: the field
    // had no reader, here or anywhere. The claim let the field survive the purge that
    // removed its neighbour above, for exactly the reason that should have taken it too.
    // The reader exists since 2026-08-19 (`profile-loader.ts`, `_BUNDLE_FORMAT`): it
    // compares and WARNS on mismatch, without refusing — a bundle held by the service
    // worker of an earlier deployment is the real-world case, and refusing it would render
    // an empty map where a warning makes the defect visible.
    const bundle = {
        _bundleVersion: BUNDLE_VERSION,
        _profileId: profileId,
    };
    if (themes) bundle.themes = themes;
    if (basemaps) bundle.basemaps = basemaps;
    if (ui) bundle.ui = ui;
    if (features) bundle.features = features;
    if (mapping) bundle.mapping = mapping;
    if (modules) bundle.modules = modules;
    if (layersFileData) bundle.layersFile = layersFileData;
    if (Object.keys(layerConfigs).length > 0) bundle.layerConfigs = layerConfigs;
    const layerStyleDocuments = _readLayerStyleDocuments(
        staticLayers,
        layersFileData,
        layerConfigs,
        profileDir
    );
    // `layerStyleDocuments`, NEVER `layerStyles`: that name is already taken in the offline
    // subsystem (`capabilities/offline/cache/storage.ts`), where it maps a layer to its
    // SELECTED style id. Two same-named keys of incompatible shape in one subsystem is a
    // confusion waiting for the next reader.
    if (Object.keys(layerStyleDocuments).length > 0) {
        bundle.layerStyleDocuments = layerStyleDocuments;
    }

    const bundlePath = path.join(profileDir, BUNDLE_FILENAME);
    const bundleJson = JSON.stringify(bundle, null, 2);
    fs.writeFileSync(bundlePath, bundleJson, "utf-8");

    // Patch profile.json: add bundleFile reference
    profile.bundleFile = BUNDLE_FILENAME;
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");

    const bundleSize = Buffer.byteLength(bundleJson, "utf-8");
    const layerCount = Object.keys(layerConfigs).length;
    return { bundleSize, layerCount };
}

module.exports = { bundleProfile, BUNDLE_FILENAME, BUNDLE_VERSION };

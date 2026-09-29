/**
 * @file profile-field-reconciliation.guard.test.ts
 * @description Guard — every field a repository profile declares is carried by its layer's data.
 *
 * ## The defect
 *
 * A profile names the properties of its data in free text — a taxonomy's `subCategoryField`, a
 * style rule's `when.field`, an attribute row's `field`. A name the data does not carry reads
 * `undefined`, and the reader falls back to its default without a word: a profile shipped
 * `subCategoryField: "subcategoryId"` over data carrying `subCategoryId`, and its sub-category
 * icons never showed. `validate:profiles` cannot see it — it judges the SHAPE of a profile and
 * reads no data.
 *
 * The runtime now says it at load time (`kernel/geojson/field-reconciliation.ts`). This guard is
 * the build-time backup, on the profiles this repository ships: a fault lands here before a
 * browser ever loads it — and here EVERY style of a layer is judged, where the runtime only sees
 * the ones a user switches to.
 *
 * ## The same rule, not a copy of it
 *
 * The guard calls the functions the runtime calls: the kernel's own declared fields, each
 * capability's pure provider, the same sampler and the same confrontation. A second
 * implementation in a script would be free to drift from the one that speaks in the browser —
 * and a guard that judges with a laxer rule than the renderer calls a field present that never
 * paints. The profile side is read with the loader's own helpers (templates, data path, module
 * bags).
 *
 * ## Why a TEST and not a `scripts/` gate, nor `validate-profiles.cjs`
 *
 * A script cannot import the TypeScript rules without re-writing them, and re-writing them is the
 * drift above. `validate-profiles.cjs` would otherwise be the natural home; it was being modified
 * by another work stream as this guard was written — the same note as in
 * `taxonomy-symbol-prefix.guard.test.js`, so that meeting it later is a decision, not an oversight.
 * A test under `__tests__/guards/` runs outside the turbo cache (`test:guards`), because what it
 * guards lives outside the package.
 *
 * ## What it does not judge — each skip is named
 *
 * A layer loaded by a plugin, served as vector tiles or by an OGC API, fetched from a remote URL,
 * or mapped from a non-GeoJSON source has no GeoJSON this guard can read as the loader would: it
 * is listed, not silently passed. An empty collection proves nothing. The filter descriptors
 * without an explicit `layers` list, and the `text` ones, are not judged — see
 * `capabilities/filter/declared-fields.ts`. Plugin keys (table columns, realtime, routing) are
 * not the core's to judge.
 *
 * ## A guard never seen red guards nothing
 *
 * Anti-empty assertions: two profiles at least, fifteen judged layers at least, no layer judged on
 * an empty sample, and at least one declared field of every family the repository's profiles use.
 * Without them this guard would come out green the day `profiles/` moves, a key is renamed, or the
 * sampler returns nothing — on zero features, every field is "found".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    findMissingFields,
    kernelDeclaredFields,
    sampleFeatures,
} from "../../src/kernel/geojson/declared-fields.js";
import type {
    DeclaredField,
    DeclaredFieldFeature,
    DeclaredFieldsContext,
} from "../../src/kernel/shared/declared-fields-slot.js";
import {
    expandLayerTemplates,
    extractRawLayers,
    mergeModuleBags,
} from "../../src/kernel/config/profile-loader-helpers.js";
import { layerDataPath } from "../../src/utils/general/layer-data-path.js";
import { taxonomyDeclaredFields } from "../../src/capabilities/taxonomy/declared-fields.js";
import { attributeDeclaredFields } from "../../src/capabilities/feature-info/declared-fields.js";
import { labelDeclaredFields } from "../../src/capabilities/labels/declared-fields.js";
import { filterDeclaredFields } from "../../src/capabilities/filter/declared-fields.js";
import type { TaxonomyConfig } from "../../src/capabilities/taxonomy/types.js";
import type { FilterConfig } from "../../src/capabilities/filter/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");
const PROFILES_DIR = path.join(REPO, "profiles");

type Json = Record<string, unknown>;

const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, "utf8")) as Json;
const isRecord = (v: unknown): v is Json =>
    v !== null && typeof v === "object" && !Array.isArray(v);

/** The families of declared fields, named by the reader that reads them. */
type Family = "style" | "search" | "taxonomy" | "attributes" | "label" | "filter";

interface Judged {
    profile: string;
    layer: string;
    /** Features the confrontation actually read — an empty sample proves nothing. */
    sampled: number;
}

interface Report {
    profiles: string[];
    judged: Judged[];
    skipped: string[];
    families: Set<Family>;
    missing: string[];
}

/** The `modules` bag the loader would build: `Files.modules` files, then the inline block. */
function moduleBag(profileDir: string, profile: Json): Json {
    const files = isRecord(profile["Files"]) ? profile["Files"] : {};
    const manifest = isRecord(files["modules"]) ? files["modules"] : {};
    const fromFiles: Json = {};
    for (const [id, rel] of Object.entries(manifest)) {
        const file = typeof rel === "string" ? path.join(profileDir, rel) : "";
        if (file && fs.existsSync(file)) fromFiles[id] = readJson(file);
    }
    const inline = isRecord(profile["modules"]) ? profile["modules"] : null;
    return mergeModuleBags(fromFiles, inline) ?? {};
}

/** Every layer of a profile, with its configuration and its directory, as the loader resolves them. */
function profileLayers(
    profileDir: string,
    profile: Json
): Array<{ id: string; config: Json; dir: string }> {
    const files = isRecord(profile["Files"]) ? profile["Files"] : {};
    const layersFile = typeof files["layersFile"] === "string" ? files["layersFile"] : null;
    if (!layersFile) return [];
    const layersData = readJson(path.join(profileDir, layersFile));
    const refs = expandLayerTemplates(extractRawLayers(layersData) ?? [], layersData);
    const out: Array<{ id: string; config: Json; dir: string }> = [];
    for (const ref of refs) {
        if (ref.inlineConfig) {
            out.push({ id: ref.id, config: ref.inlineConfig as Json, dir: `layers/${ref.id}` });
        } else if (ref.configFile) {
            const file = path.join(profileDir, ref.configFile);
            if (!fs.existsSync(file)) continue;
            out.push({
                id: ref.id,
                config: readJson(file),
                dir: ref.configFile.replace(/\/[^/]+$/, ""),
            });
        }
    }
    return out;
}

/** Why the loader's GeoJSON path would not read this layer from a local file — or `null`. */
function skipReason(config: Json, dataFile: string | null, abs: string | null): string | null {
    const data = isRecord(config["data"]) ? config["data"] : {};
    if (typeof config["plugin"] === "string") return `plugin "${config["plugin"]}"`;
    if (isRecord(config["vectorTiles"]) && config["vectorTiles"]["enabled"] === true)
        return "vector tiles";
    if (data["ogcApi"]) return "OGC API";
    if (data["mapping"]) return "mapped source";
    if (!dataFile) return typeof data["dataUrl"] === "string" ? "remote dataUrl" : "no data file";
    if (!abs || !fs.existsSync(abs)) return `data file absent (${dataFile})`;
    return null;
}

/** Every style document a layer offers — the default one and every alternative. */
function layerStyles(profileDir: string, layerDir: string, config: Json): Json[] {
    const styles = isRecord(config["styles"]) ? config["styles"] : {};
    const dir = typeof styles["directory"] === "string" ? styles["directory"] : "styles";
    const available = Array.isArray(styles["available"]) ? styles["available"] : [];
    const out: Json[] = [];
    for (const entry of available) {
        const file = isRecord(entry) && typeof entry["file"] === "string" ? entry["file"] : null;
        const abs = file ? path.join(profileDir, layerDir, dir, file) : null;
        if (abs && fs.existsSync(abs)) out.push(readJson(abs));
    }
    return out;
}

function tag(
    fields: readonly DeclaredField[],
    family: Family,
    families: Set<Family>
): DeclaredField[] {
    if (fields.length > 0) families.add(family);
    return [...fields];
}

/** The fields every reader declares on one layer, for one style it may wear. */
function declared(
    ctx: DeclaredFieldsContext,
    modules: Json,
    families: Set<Family>
): DeclaredField[] {
    const kernel = kernelDeclaredFields(ctx);
    return [
        ...tag(
            kernel.filter((d) => d.key.startsWith("style[")),
            "style",
            families
        ),
        ...tag(
            kernel.filter((d) => d.key === "searchable.fields"),
            "search",
            families
        ),
        ...tag(
            taxonomyDeclaredFields(
                { enabled: true, ...(modules["taxonomy"] as object) } as TaxonomyConfig,
                ctx.layerId
            ),
            "taxonomy",
            families
        ),
        ...tag(attributeDeclaredFields(ctx.def), "attributes", families),
        ...tag(labelDeclaredFields(ctx), "label", families),
        ...tag(
            filterDeclaredFields(
                { enabled: true, ...(modules["filter"] as object) } as FilterConfig,
                ctx.layerId
            ),
            "filter",
            families
        ),
    ];
}

function judgeRepository(): Report {
    const report: Report = {
        profiles: [],
        judged: [],
        skipped: [],
        families: new Set(),
        missing: [],
    };
    const dirs = fs
        .readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter(
            (d) => d.isDirectory() && fs.existsSync(path.join(PROFILES_DIR, d.name, "profile.json"))
        );

    for (const { name } of dirs) {
        const profileDir = path.join(PROFILES_DIR, name);
        const profile = readJson(path.join(profileDir, "profile.json"));
        const modules = moduleBag(profileDir, profile);
        report.profiles.push(name);

        for (const layer of profileLayers(profileDir, profile)) {
            const dataFile = layerDataPath(layer.config);
            const abs = dataFile ? path.join(profileDir, layer.dir, dataFile) : null;
            const reason = skipReason(layer.config, dataFile, abs);
            if (reason) {
                report.skipped.push(`${name}/${layer.id}: ${reason}`);
                continue;
            }
            const collection = readJson(abs as string);
            const features = Array.isArray(collection["features"]) ? collection["features"] : [];
            if (features.length === 0) {
                report.skipped.push(`${name}/${layer.id}: empty collection`);
                continue;
            }
            const sample = sampleFeatures(features).filter(isRecord) as DeclaredFieldFeature[];
            report.judged.push({ profile: name, layer: layer.id, sampled: sample.length });

            const styles = layerStyles(profileDir, layer.dir, layer.config);
            const seen = new Set<string>();
            for (const style of styles.length > 0 ? styles : [null]) {
                const ctx = { layerId: layer.id, def: layer.config, style };
                for (const m of findMissingFields(
                    declared(ctx, modules, report.families),
                    sample
                )) {
                    const hint = m.suggestion ? ` (did you mean "${m.suggestion}"?)` : "";
                    const line = `${name}/${layer.id}: ${m.key} "${m.field}"${hint}`;
                    if (!seen.has(line)) report.missing.push(line);
                    seen.add(line);
                }
            }
        }
    }
    return report;
}

describe("guard — every field a repository profile declares is carried by its data", () => {
    const report = judgeRepository();

    it("sees the repository's profiles — anti-empty", () => {
        expect(report.profiles.length).toBeGreaterThanOrEqual(2);
        expect(report.judged.length).toBeGreaterThanOrEqual(15);
        // A sampler that returned nothing would make every field "found": no layer may be judged
        // on an empty sample.
        expect(report.judged.filter((j) => j.sampled === 0)).toEqual([]);
        for (const family of ["style", "taxonomy", "attributes", "label", "filter"] as const) {
            expect(
                report.families,
                `no declared field of the "${family}" family was read`
            ).toContain(family);
        }
    });

    it("names every skipped layer — nothing passes unseen", () => {
        for (const line of report.skipped) expect(line).toMatch(/^[^/]+\/[^:]+: .+/);
    });

    it("finds every declared field in the data", () => {
        expect(report.missing).toEqual([]);
    });
});

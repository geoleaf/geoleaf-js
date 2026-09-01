/**
 * Guard — the bundle carries the style document of EVERY layer, templated ones included.
 *
 * ## The trap this guard exists for
 *
 * `_readLayerConfigs` filters on `typeof l.configFile === "string"`. Every `layerTemplates`
 * INSTANCE is excluded by that filter — instances carry only `{id, label, dataFile}` and
 * inherit their styles from the template. An aggregation written on that patron returns the
 * static layers only: on `tourism` that is 20 documents out of 44, a plausible weight, and a
 * green test.
 *
 * 🛑 **So the expected count is DERIVED from the profile sources, never written down.** A
 * hardcoded 44 would keep passing the day a layer gains a style, and would have passed at 20
 * had the naive version shipped. The derivation below walks the same two families the
 * compiler must walk — if they ever diverge, the mismatch is the point.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const PROFILE = "tourism";
const SRC = path.join(ROOT, "profiles", PROFILE);
const BUNDLE = path.join(ROOT, "deploy", "deploy-core", "profiles", PROFILE, "profile-bundle.json");

/** How many style FILES the profile sources declare, both families counted. */
function expectedFromSources(): number {
    const layersFile = JSON.parse(
        fs.readFileSync(path.join(SRC, "config/core/layers.json"), "utf-8")
    );
    const filesOf = (styles: Record<string, unknown> | undefined): number => {
        if (!styles) return 0;
        const set = new Set<string>();
        for (const a of (styles.available as { file?: string }[]) ?? []) {
            if (a?.file) set.add(a.file);
        }
        if (typeof styles.default === "string") set.add(styles.default);
        return set.size;
    };

    let n = 0;
    for (const layer of layersFile.layers ?? []) {
        if (typeof layer?.configFile !== "string") continue;
        const cfg = JSON.parse(fs.readFileSync(path.join(SRC, layer.configFile), "utf-8"));
        n += filesOf(cfg.styles);
    }
    for (const tpl of layersFile.layerTemplates ?? []) {
        n += filesOf(tpl?.template?.styles) * (tpl?.instances?.length ?? 0);
    }
    return n;
}

describe("profile bundle — layerStyleDocuments", () => {
    it.runIf(fs.existsSync(BUNDLE))(
        "carries as many style documents as the sources declare — templated layers included",
        () => {
            const bundle = JSON.parse(fs.readFileSync(BUNDLE, "utf-8"));
            const got = Object.values(
                (bundle.layerStyleDocuments ?? {}) as Record<string, Record<string, unknown>>
            ).reduce((n, styles) => n + Object.keys(styles).length, 0);

            const expected = expectedFromSources();
            expect(
                expected,
                "the derivation itself returned nothing — it measures nothing"
            ).toBeGreaterThan(0);
            expect(got).toBe(expected);
        }
    );

    it.runIf(fs.existsSync(BUNDLE))("sorts both key levels, so two builds agree", () => {
        const bundle = JSON.parse(fs.readFileSync(BUNDLE, "utf-8"));
        const docs = (bundle.layerStyleDocuments ?? {}) as Record<string, Record<string, unknown>>;
        const layerIds = Object.keys(docs);
        expect(layerIds).toEqual([...layerIds].sort());
        for (const styles of Object.values(docs)) {
            const ids = Object.keys(styles);
            expect(ids).toEqual([...ids].sort());
        }
    });

    it("never uses the name already taken by the offline subsystem", () => {
        const storage = fs.readFileSync(
            path.join(ROOT, "packages/core/src/capabilities/offline/cache/storage.ts"),
            "utf-8"
        );
        // `layerStyles` there maps a layer to its SELECTED style id — a different shape under
        // the same name would be a confusion for whoever reads the subsystem next.
        expect(storage).toContain("layerStyles");
        const compiler = fs.readFileSync(
            path.join(ROOT, "scripts/lib/bundle-profiles.cjs"),
            "utf-8"
        );
        expect(compiler).toContain("layerStyleDocuments");
        expect(compiler).not.toMatch(/bundle\.layerStyles\b/);
    });
});

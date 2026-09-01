/**
 * `resolveProfileLayers` — resolving the OFFLINE path's layer list.
 *
 * 🛑 **This function had NO test, and that is exactly why the defect could
 * live.** It did `json.layers` and ignored `layerTemplates`: on `tourism`,
 * 24 layers out of 42 — 57% of the demo profile — did not appear in the
 * "Download for offline" selector and cached nothing. The defect was SILENT
 * by construction: an unresolved layer is not a failing layer.
 *
 * What this suite guards:
 *
 *  1. That templates are expanded — the root cause.
 *  2. That resolution goes through the SAME helpers as the production
 *     loader. Two resolution paths of which one forgets the templates was
 *     the defect itself; the "read from disk" case below is what confronts
 *     them on real data rather than a self-agreeing fixture.
 *  3. That the degraded modes stay silent and non-throwing — the function's
 *     contract, and fixing it must not change it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProfileLayers } from "../../src/kernel/config/profile-layers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// config → __tests__ → core → packages → <racine>
const REPO = resolve(__dirname, "../../../..");

const okResponse = (payload: unknown) => ({ ok: true, json: async () => payload });

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("resolveProfileLayers — l'expansion des templates (C.15)", () => {
    it("expanse `layerTemplates` derrière les couches directes", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                okResponse({
                    layers: [{ id: "direct", configFile: "layers/direct/direct_config.json" }],
                    layerTemplates: [
                        {
                            layerManagerId: "data-climate",
                            template: { data: { directory: "data" }, geometry: "point" },
                            instances: [
                                { id: "a", label: "A", dataFile: "a.geojson" },
                                { id: "b", label: "B", dataFile: "b.geojson" },
                            ],
                        },
                    ],
                })
            )
        );

        const layers = await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base");

        expect(layers.map((l) => l.id)).toEqual(["direct", "a", "b"]);
        // The instances carry their config INLINE and NO `configFile` — that
        // asymmetry is what made four offline-path sites skip them.
        expect(layers[1]?.configFile).toBeUndefined();
        expect(layers[1]?.inlineConfig).toMatchObject({
            id: "a",
            label: "A",
            data: { directory: "data", file: "a.geojson" },
        });
        // And the template's inheritance does cross the expansion.
        expect(layers[1]?.inlineConfig?.["geometry"]).toBe("point");
    });

    it("un profil SANS template rend ses couches inchangées", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(okResponse({ layers: [{ id: "x" }, { id: "y" }] }))
        );
        const layers = await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base");
        expect(layers.map((l) => l.id)).toEqual(["x", "y"]);
    });

    it("un tableau NU est accepté — alignement sur le chargeur de production", async () => {
        // ⚠️ This path returned `[]` before: it tested `json.layers` on an
        // array, which lacks that key. `extractRawLayers` carries the
        // tolerance, and borrowing it rather than rewriting it is what
        // aligns the two resolutions.
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([{ id: "nu" }])));
        const layers = await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base");
        expect(layers.map((l) => l.id)).toEqual(["nu"]);
    });
});

describe("resolveProfileLayers — confronté au profil RÉEL, lu sur le disque", () => {
    /** A profile's real `layers.json`, never a self-agreeing fixture. */
    const layersFileOf = (profile: string) =>
        JSON.parse(
            readFileSync(resolve(REPO, `profiles/${profile}/config/core/layers.json`), "utf8")
        ) as { layers?: unknown[]; layerTemplates?: Array<{ instances?: unknown[] }> };

    // 🛑 NEVER add `_reference` here to "fill" the list: the comment above
    // forbids it by name, and a self-agreeing fixture proves nothing. The
    // list follows the SHIPPED profiles — those `build-deploy.cjs` harvests,
    // hence outside the `_` prefix.
    // 📌 `reunion-eclairage` had left this list during the public switch,
    // then came back: the removal left a single shipped profile, which
    // deprived the demo of its profile selector and the repo of its only
    // offline vector basemap. The `it.each` form stays, so a new shipped
    // profile enters without a rewrite.
    it.each(["tourism", "reunion-eclairage"])(
        "%s — toutes ses couches sont résolues, templatées comprises",
        async (profile) => {
            const file = layersFileOf(profile);
            const direct = (file.layers ?? []).length;
            const templated = (file.layerTemplates ?? []).reduce(
                (s, t) => s + (t.instances ?? []).length,
                0
            );
            // Anti-empty-gate guard: an empty profile would let the assertion out green.
            expect(direct).toBeGreaterThan(0);

            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(file)));
            const layers = await resolveProfileLayers(
                { Files: { layersFile: "config/core/layers.json" } },
                profile,
                "profiles"
            );

            expect(
                layers.length,
                `${profile} : ${direct} directes + ${templated} templatées doivent toutes être résolues`
            ).toBe(direct + templated);
        }
    );

    it("tourism porte bien un gisement templaté — sans quoi le cas ci-dessus ne prouve rien", () => {
        // 🛑 The assertion that keeps the previous one from coming out green
        // on empty: if `tourism` lost its templates, `direct + templated`
        // would equal `direct`, and the test would pass no longer exercising
        // the expansion at all.
        const file = layersFileOf("tourism");
        const templated = (file.layerTemplates ?? []).reduce(
            (s, t) => s + (t.instances ?? []).length,
            0
        );
        expect(templated).toBeGreaterThan(10);
    });
});

describe("resolveProfileLayers — les modes dégradés, inchangés", () => {
    it("une liste déjà en ligne court-circuite le fetch", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const layers = await resolveProfileLayers({ layers: [{ id: "inline" }] }, "p", "base");
        expect(layers.map((l) => l.id)).toEqual(["inline"]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sans `Files.layersFile`, rend une liste vide sans fetch", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        expect(await resolveProfileLayers({}, "p", "base")).toEqual([]);
        expect(await resolveProfileLayers(null, "p", "base")).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("un fetch en échec rend une liste vide et PRÉVIENT, sans jeter", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        const onWarn = vi.fn();
        expect(
            await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base", { onWarn })
        ).toEqual([]);
        expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("404"));
    });

    it("un fetch qui jette est rattrapé", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        const onWarn = vi.fn();
        expect(
            await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base", { onWarn })
        ).toEqual([]);
        expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("offline"));
    });
});

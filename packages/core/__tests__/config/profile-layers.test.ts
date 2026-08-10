/**
 * `resolveProfileLayers` — la résolution de la liste de couches du chemin HORS-LIGNE.
 *
 * 🛑 **Cette fonction n'avait AUCUN test, et c'est exactement pourquoi C.15 a pu vivre.**
 * Elle faisait `json.layers` et ignorait `layerTemplates` : sur `tourism`, 24 couches sur
 * 42 — 57 % du profil de démo — n'apparaissaient pas dans le sélecteur « Télécharger pour
 * hors-ligne » et ne cachaient rien. Le défaut était SILENCIEUX par construction : une
 * couche non résolue n'est pas une couche en erreur.
 *
 * Ce que cette suite garde :
 *
 *  1. Que les templates sont expansés — la cause racine.
 *  2. Que la résolution passe par les MÊMES helpers que le chargeur de production. Deux
 *     chemins de résolution dont un oublie les templates, c'était le défaut lui-même ;
 *     le cas « lu sur le disque » ci-dessous est ce qui les confronte sur des données
 *     réelles plutôt que sur une fixture d'accord avec elle-même.
 *  3. Que les modes dégradés restent silencieux et non jetants — c'est le contrat de la
 *     fonction, et le corriger ne doit pas le changer.
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
        // Les instances portent leur config EN LIGNE et AUCUN `configFile` — c'est cette
        // asymétrie qui les faisait sauter par quatre sites du chemin hors-ligne.
        expect(layers[1]?.configFile).toBeUndefined();
        expect(layers[1]?.inlineConfig).toMatchObject({
            id: "a",
            label: "A",
            data: { directory: "data", file: "a.geojson" },
        });
        // Et l'héritage du template traverse bien l'expansion.
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
        // ⚠️ Ce chemin-ci rendait `[]` avant 8.9 : il testait `json.layers` sur un tableau,
        // qui n'a pas cette clé. `extractRawLayers` porte la tolérance, et l'emprunter
        // plutôt que la réécrire est ce qui aligne les deux résolutions.
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([{ id: "nu" }])));
        const layers = await resolveProfileLayers({ Files: { layersFile: "l.json" } }, "p", "base");
        expect(layers.map((l) => l.id)).toEqual(["nu"]);
    });
});

describe("resolveProfileLayers — confronté au profil RÉEL, lu sur le disque", () => {
    /** Le vrai `layers.json` d'un profil, jamais une fixture d'accord avec elle-même. */
    const layersFileOf = (profile: string) =>
        JSON.parse(
            readFileSync(resolve(REPO, `profiles/${profile}/config/core/layers.json`), "utf8")
        ) as { layers?: unknown[]; layerTemplates?: Array<{ instances?: unknown[] }> };

    // 🛑 Ne JAMAIS ajouter `_reference` ici pour « remplir » la liste : le commentaire ci-dessus
    // l'interdit nommément, et une fixture d'accord avec elle-même ne prouve rien. La liste suit
    // les profils LIVRÉS — ceux que `build-deploy.cjs` récolte, donc hors préfixe `_`.
    // 📌 `reunion-eclairage` avait quitté cette liste au Sprint 7 du passage public, puis y est
    // revenu : le retrait laissait un seul profil livré, ce qui privait la démo de son sélecteur
    // de profil et le dépôt de son seul fond vectoriel hors-ligne (B-213). La forme `it.each`
    // reste, pour qu'un profil livré neuf entre sans réécriture.
    it.each(["tourism", "reunion-eclairage"])(
        "%s — toutes ses couches sont résolues, templatées comprises",
        async (profile) => {
            const file = layersFileOf(profile);
            const direct = (file.layers ?? []).length;
            const templated = (file.layerTemplates ?? []).reduce(
                (s, t) => s + (t.instances ?? []).length,
                0
            );
            // Garde anti-gate-vide : un profil vide ferait sortir l'assertion verte.
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
        // 🛑 L'assertion qui empêche la précédente de sortir verte à vide : si `tourism`
        // perdait ses templates, `direct + templated` vaudrait `direct`, et le test
        // passerait en n'éprouvant plus l'expansion du tout.
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

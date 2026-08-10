/**
 * Unit tests for ResourceEnumerator — the offline download's shopping list.
 *
 * This 389-line module had **zero tests** and was imported by none, so it sat outside
 * the coverage denominator entirely: the global figure simply did not look at it. That
 * blind spot is what let C-7 live (the profile sprite was never cached, on all 9
 * profiles, silently). Covering it here is the other half of that fix — the enumerator
 * decides what an offline map will and will not have.
 *
 * Dependencies are mocked at the module boundary: the enumerator's job is to BUILD a
 * resource list from config, not to fetch tiles or resolve styles.
 *
 * Loaded via ESM `await import()` with `.js` specifiers — matching how the source
 * imports itself, so V8 keys the coverage to a single module instance.
 */
"use strict";

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreConfigGet: vi.fn((key, fallback) => {
        if (key === "data.profilesBasePath") return "../profiles";
        if (key === "basemaps") return globalThis.__basemaps ?? {};
        // Le drapeau que `_tilesRequested()` lit depuis la tâche 3.13 — pilotable par test.
        if (key === "modules.offline.cache.enableTileCache") return globalThis.__tileFlag ?? true;
        return fallback;
    }),
}));

vi.mock("../../../src/capabilities/offline/cache/storage.js", () => ({
    CacheStorage: { loadLayerSelection: vi.fn(async () => globalThis.__selection ?? null) },
}));

vi.mock("../../../src/capabilities/offline/cache/calculator.js", () => ({
    CacheCalculator: { enumerateTiles: vi.fn(async () => [{ url: "t/1.png", type: "tile" }]) },
}));

vi.mock("../../../src/capabilities/offline/cache/style-resolver.js", () => ({
    StyleResolver: { enumerate: vi.fn(async () => [{ url: "style.json", type: "style" }]) },
}));

const { ResourceEnumerator } = await import(
    "../../../src/capabilities/offline/cache/resource-enumerator.js"
);
const { CacheCalculator } = await import("../../../src/capabilities/offline/cache/calculator.js");
const { StyleResolver } = await import("../../../src/capabilities/offline/cache/style-resolver.js");
const { CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js");

/** profiles/tourism/profile.json as served (v2 layout: pointers only). */
const V2_PROFILE = Object.freeze({
    id: "tourism",
    Files: {
        layersFile: "config/core/layers.json",
        uiFile: "config/core/ui.json",
        modules: {
            taxonomy: "config/plugins/taxonomy.json",
            cluster: "config/plugins/cluster.json",
        },
    },
});

const LAYER = { id: "hebergements", configFile: "layers/hebergements/hebergements_config.json" };

beforeEach(() => {
    globalThis.__basemaps = {};
    globalThis.__selection = null;
});

afterEach(() => {
    vi.clearAllMocks();
    delete globalThis.fetch;
    delete globalThis.__basemaps;
    delete globalThis.__selection;
});

describe("_addConfigResources — reads the Files manifest (the v2 layout)", () => {
    // The counter-example to C-7: this method never assumes a path, it walks the
    // manifest. That is why the plugin config files were cached all along — while the
    // sprite one of them points at was not.
    const push = (profile) => {
        const resources = [];
        ResourceEnumerator._addConfigResources(resources, profile, "tourism", "../profiles");
        return resources;
    };

    test("always caches profile.json, non-optional", () => {
        expect(push({})[0]).toEqual({
            url: "../profiles/tourism/profile.json",
            type: "config",
            priority: 1,
        });
    });

    test("caches each section file, and walks INTO Files.modules", () => {
        const urls = push(V2_PROFILE).map((r) => r.url);

        expect(urls).toContain("../profiles/tourism/config/core/layers.json");
        expect(urls).toContain("../profiles/tourism/config/core/ui.json");
        expect(urls).toContain("../profiles/tourism/config/plugins/taxonomy.json");
        expect(urls).toContain("../profiles/tourism/config/plugins/cluster.json");
    });

    test("caches the pre-built bundle when declared, as optional", () => {
        expect(push({ ...V2_PROFILE, bundleFile: "bundle.json" })).toContainEqual({
            url: "../profiles/tourism/bundle.json",
            type: "config",
            priority: 1,
            optional: true,
        });
    });

    test("skips the bundle when absent; legacy mapping.json stays optional", () => {
        const resources = push({});

        expect(resources.some((r) => r.url.includes("bundle"))).toBe(false);
        expect(resources.find((r) => r.url.endsWith("mapping.json"))?.optional).toBe(true);
    });

    test("ignores non-string manifest entries instead of caching 'undefined'", () => {
        const urls = push({ Files: { layersFile: null, uiFile: "", modules: { x: 42 } } }).map(
            (r) => r.url
        );

        expect(urls.some((u) => u.includes("null") || u.includes("undefined"))).toBe(false);
    });
});

describe("_addLayerResources — layers are hydrated upstream, NOT a stale reader", () => {
    // `if (!profile.layers) return;` looks exactly like the C-7 bug — it is not.
    // loadProfileConfig resolves `layers` from Files.layersFile before the enumerator
    // sees the profile (the "Bug B" fix). Pinned here so nobody "fixes" a healthy path.
    test("no layers → nothing added (the hydrated-empty case)", async () => {
        const resources = [];

        await ResourceEnumerator._addLayerResources(resources, {}, "tourism", "../profiles", null);

        expect(resources).toEqual([]);
    });

    test("caches a layer's config file and the dataFile it declares", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ dataFile: "hebergements.geojson", type: "geojson" }),
        });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources.map((r) => r.url)).toEqual([
            "../profiles/tourism/layers/hebergements/hebergements_config.json",
            "../profiles/tourism/layers/hebergements/hebergements.geojson",
        ]);
        expect(resources[1].type).toBe("geojson");
    });

    // 🛑 LE TEST CI-DESSUS ÉTAIT VERT SUR UNE FICTION, ET C'EST POURQUOI CELUI-CI EXISTE.
    //
    // Il nourrit `{ dataFile: "..." }` — la forme NORMALISÉE, produite par
    // `profile-loader.ts` en hydratant un profil. **Aucun fichier de config de couche du
    // dépôt ne la porte** : mesuré à la tâche 4.2, 46 des 48 déclarent `data: { directory,
    // file }`, et 0 déclare `dataFile`. Or ce chemin-ci refetch la config BRUTE.
    //
    // Le test décrivait donc une entrée que la production ne voit jamais, et il est resté
    // vert pendant que la donnée n'était énumérée pour aucune couche. L'instrument portait
    // le biais qu'il aurait dû mesurer — il est gardé tel quel (la forme normalisée reste
    // acceptée) et les deux ci-dessous couvrent la forme RÉELLE.
    test("4.2 — la forme RÉELLE `data: { directory, file }` est énumérée", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: { directory: "data", file: "hebergements.geojson" },
                type: "geojson",
            }),
        });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources.map((r) => r.url)).toEqual([
            "../profiles/tourism/layers/hebergements/hebergements_config.json",
            "../profiles/tourism/layers/hebergements/data/hebergements.geojson",
        ]);
        expect(resources[1].type).toBe("geojson");
    });

    test("4.2 — `directory` omis retombe sur `data/`, jamais sur la racine", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { file: "hebergements.geojson" } }),
        });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER] },
            "tourism",
            "../profiles",
            null
        );

        // Le défaut sournois si le défaut disparaissait : une URL sans répertoire répond 404,
        // et un 404 sur une ressource optionnelle se tait.
        expect(resources[1].url).toBe(
            "../profiles/tourism/layers/hebergements/data/hebergements.geojson"
        );
    });

    test("a config without dataFile yields the config alone", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources).toHaveLength(1);
    });

    test("a non-ok config response is tolerated (config still cached)", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources).toHaveLength(1);
    });

    test("honours the user's layer selection", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [LAYER, { id: "autre", configFile: "layers/autre/autre_config.json" }] },
            "tourism",
            "../profiles",
            { layers: ["hebergements"] }
        );

        expect(resources.every((r) => r.layerId === "hebergements")).toBe(true);
    });

    // ── C.15 / tâche 8.9 ─────────────────────────────────────────────────────────
    //
    // 🛑 Ces trois cas gardent un défaut qui a vécu SILENCIEUSEMENT : une instance de
    // `layerTemplates` porte sa config EN LIGNE et n'a aucun `configFile`, donc elle
    // traversait `_addLayerResources` sans produire une seule ressource. Sur `tourism`,
    // 24 couches sur 42 — 57 % du profil de démo — étaient cochables dans le sélecteur
    // hors-ligne et ne rapatriaient rien. Une couche non énumérée n'est pas une couche
    // en échec : rien ne le disait.

    test("une couche à config EN LIGNE énumère sa donnée, sans aucun fetch", async () => {
        globalThis.fetch = vi.fn();
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            {
                layers: [
                    {
                        id: "pluviometrie_janvier",
                        inlineConfig: {
                            id: "pluviometrie_janvier",
                            data: { directory: "data", file: "pluviometrie_janvier.geojson" },
                        },
                    },
                ],
            },
            "tourism",
            "../profiles",
            null
        );

        // Le répertoire vaut `layers/<id>` — la convention que `profile-loader.ts:38`
        // applique aux mêmes couches. La reprendre plutôt que d'en inventer une est ce
        // qui empêche le chemin hors-ligne et le chemin de boot de diverger.
        expect(resources).toEqual([
            {
                url: "../profiles/tourism/layers/pluviometrie_janvier/data/pluviometrie_janvier.geojson",
                type: "geojson",
                priority: 3,
                layerId: "pluviometrie_janvier",
            },
        ]);
        // La config est déjà dans `layers.json`, énuméré avec le profil : rien à refetcher.
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("une couche à config EN LIGNE sans donnée déclarée n'énumère rien, sans jeter", async () => {
        globalThis.fetch = vi.fn();
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [{ id: "tuilee", inlineConfig: { id: "tuilee", type: "tile" } }] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources).toEqual([]);
    });

    test("configFile et inlineConfig coexistent sans se marcher dessus", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { directory: "data", file: "h.geojson" } }),
        });
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            {
                layers: [
                    LAYER,
                    {
                        id: "templatee",
                        inlineConfig: { id: "templatee", data: { file: "t.geojson" } },
                    },
                ],
            },
            "tourism",
            "../profiles",
            null
        );

        // La couche classique produit sa config ET sa donnée ; la templatée sa donnée seule.
        expect(resources.filter((r) => r.layerId === "hebergements")).toHaveLength(2);
        expect(resources.filter((r) => r.layerId === "templatee")).toEqual([
            {
                url: "../profiles/tourism/layers/templatee/data/t.geojson",
                type: "geojson",
                priority: 3,
                layerId: "templatee",
            },
        ]);
    });

    test("a layer with a direct url needs no config fetch", async () => {
        globalThis.fetch = vi.fn();
        const resources = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            { layers: [{ id: "direct", url: "https://example.com/d.geojson", type: "geojson" }] },
            "tourism",
            "../profiles",
            null
        );

        expect(resources).toEqual([
            {
                url: "https://example.com/d.geojson",
                type: "geojson",
                priority: 3,
                layerId: "direct",
            },
        ]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("an unreachable layer config degrades to config-only, without throwing", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
        const resources = [];

        await expect(
            ResourceEnumerator._addLayerResources(
                resources,
                { layers: [LAYER] },
                "tourism",
                "../profiles",
                null
            )
        ).resolves.toBeUndefined();
        expect(resources).toHaveLength(1);
    });

    test("a tile layer enumerates its tiles only when the user asked for them", async () => {
        // NB: the layer descriptor itself is pushed with `type: "tile"` too, so assert on
        // the calculator's output (t/1.png), not on the type — they are different things.
        const tiled = { layers: [{ id: "t", url: "x/{z}/{x}/{y}.png", type: "tile" }] };
        const withTiles = [];
        const without = [];

        await ResourceEnumerator._addLayerResources(withTiles, tiled, "p", "../profiles", {
            includeTiles: true,
        });
        await ResourceEnumerator._addLayerResources(without, tiled, "p", "../profiles", {
            includeTiles: false,
        });

        expect(withTiles.map((r) => r.url)).toContain("t/1.png");
        expect(without.map((r) => r.url)).not.toContain("t/1.png");
        expect(without).toHaveLength(1);
    });
});

describe("_resolveUrl — absolute stays, relative gets the profile base", () => {
    const resolve = (u) => ResourceEnumerator._resolveUrl(u, "../profiles", "tourism");

    test("keeps an http(s) URL untouched", () => {
        expect(resolve("https://example.com/a.json")).toBe("https://example.com/a.json");
        expect(resolve("http://example.com/a.json")).toBe("http://example.com/a.json");
    });

    test("keeps an already-relative ../ URL untouched", () => {
        expect(resolve("../profiles/tourism/x.json")).toBe("../profiles/tourism/x.json");
    });

    test("anchors a bare or ./ path under the profile", () => {
        expect(resolve("data/x.json")).toBe("../profiles/tourism/data/x.json");
        expect(resolve("./data/x.json")).toBe("../profiles/tourism/data/x.json");
    });
});

describe("_enumerateTiles — delegates to the calculator, never throws", () => {
    test("returns what the calculator enumerates", async () => {
        expect(await ResourceEnumerator._enumerateTiles({ url: "x" }, "p")).toEqual([
            { url: "t/1.png", type: "tile" },
        ]);
    });

    test("a calculator failure degrades to an empty list", async () => {
        CacheCalculator.enumerateTiles.mockRejectedValueOnce(new Error("boom"));

        expect(await ResourceEnumerator._enumerateTiles({ url: "x" }, "p")).toEqual([]);
    });
});

describe("_addBasemapResources — only offline basemaps, only on demand", () => {
    test("does nothing unless the user asked for tiles", async () => {
        globalThis.__basemaps = { osm: { id: "osm", offline: true, url: "x/{z}/{x}/{y}.png" } };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: false });

        expect(resources).toEqual([]);
    });

    test("skips basemaps not flagged offline", async () => {
        globalThis.__basemaps = { osm: { id: "osm", offline: false, url: "x" } };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: true });

        expect(resources).toEqual([]);
    });

    test("enumerates tiles for a raster offline basemap", async () => {
        globalThis.__basemaps = { osm: { id: "osm", offline: true, url: "x/{z}/{x}/{y}.png" } };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: true });

        expect(resources).toEqual([{ url: "t/1.png", type: "tile" }]);
    });

    test("honours the basemap selection", async () => {
        globalThis.__basemaps = {
            osm: { id: "osm", offline: true, url: "x" },
            ign: { id: "ign", offline: true, url: "y" },
        };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", {
            includeTiles: true,
            basemaps: ["osm"],
        });

        expect(CacheCalculator.enumerateTiles).toHaveBeenCalledTimes(1);
        expect(resources).toHaveLength(1);
    });

    test("routes a vector basemap to the style resolver, not the tile calculator", async () => {
        globalThis.__basemaps = {
            v: { id: "v", offline: true, type: "maplibre", style: "s.json" },
        };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", {
            includeTiles: true,
            vectorZone: { bbox: [0, 0, 1, 1], maxZoom: 10 },
        });

        expect(StyleResolver.enumerate).toHaveBeenCalledWith("s.json", {
            bbox: [0, 0, 1, 1],
            maxZoom: 10,
        });
        expect(CacheCalculator.enumerateTiles).not.toHaveBeenCalled();
        expect(resources).toEqual([{ url: "style.json", type: "style" }]);
    });

    test("a style without url is treated as vector too (style && !url)", async () => {
        globalThis.__basemaps = { v: { id: "v", offline: true, style: "s.json" } };
        const resources = [];

        await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: true });

        expect(StyleResolver.enumerate).toHaveBeenCalled();
    });
});

describe("_addVectorBasemapResources — a zone is optional, a style is not", () => {
    test("no style URL → nothing, and no resolver call", async () => {
        expect(await ResourceEnumerator._addVectorBasemapResources({ id: "v" }, {})).toEqual([]);
        expect(StyleResolver.enumerate).not.toHaveBeenCalled();
    });

    test("without a download zone the style is still resolved (zone = null)", async () => {
        await ResourceEnumerator._addVectorBasemapResources({ id: "v", style: "s.json" }, {});

        expect(StyleResolver.enumerate).toHaveBeenCalledWith("s.json", null);
    });
});

describe("_loadSelection — reads the user's stored choice", () => {
    test("returns the stored selection", async () => {
        globalThis.__selection = { layers: ["a"], basemaps: [] };

        expect(await ResourceEnumerator._loadSelection("tourism")).toEqual({
            layers: ["a"],
            basemaps: [],
        });
        expect(CacheStorage.loadLayerSelection).toHaveBeenCalledWith("tourism");
    });

    test("returns null when nothing was stored", async () => {
        expect(await ResourceEnumerator._loadSelection("tourism")).toBeNull();
    });
});

describe("enumerateAll — the whole shopping list", () => {
    test("assembles config + sprite + layers, and loads the selection when not given", async () => {
        globalThis.__selection = { layers: ["hebergements"] };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ dataFile: "hebergements.geojson", type: "geojson" }),
        });
        const profile = {
            ...V2_PROFILE,
            // Both hydrated by loadProfileConfig before we get here.
            layers: [LAYER],
            icons: { spriteUrl: "../profiles/tourism/icons/sprite_tourism.svg" },
        };

        const resources = await ResourceEnumerator.enumerateAll(profile, "tourism");
        const urls = resources.map((r) => r.url);

        expect(CacheStorage.loadLayerSelection).toHaveBeenCalledWith("tourism");
        expect(urls).toContain("../profiles/tourism/profile.json");
        // C-7: the sprite is in the list. Before the fix it never was.
        expect(urls).toContain("../profiles/tourism/icons/sprite_tourism.svg");
        expect(urls).toContain("../profiles/tourism/layers/hebergements/hebergements.geojson");
    });

    test("an explicit selection short-circuits the stored one", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

        await ResourceEnumerator.enumerateAll({ ...V2_PROFILE, layers: [] }, "tourism", {
            layers: [],
        });

        expect(CacheStorage.loadLayerSelection).not.toHaveBeenCalled();
    });

    test("a profile with no sprite still enumerates its config", async () => {
        const resources = await ResourceEnumerator.enumerateAll(V2_PROFILE, "tourism", {
            layers: [],
        });

        expect(resources.some((r) => r.type === "icon")).toBe(false);
        expect(resources.some((r) => r.url.endsWith("profile.json"))).toBe(true);
    });
    // ── Tâche 3.13 — `enableTileCache` est LU par le moteur, et c'est un VETO ───────────
    //
    // 🛑 CE BLOC EXISTE PARCE QUE LE DRAPEAU N'ÉTAIT LU PAR PERSONNE côté core. Il était
    // écrit à quatre endroits et lu à aucun ; le moteur ne connaissait que
    // `selection.includeTiles`, une valeur que l'INTERFACE persiste. Mesuré en navigateur le
    // 03/08 (`scripts/probe-tile-cache-arbitration.mjs`, M3) : sans sélection persistée,
    // `cacheProfile()` n'énumérait AUCUNE tuile — l'inverse exact de ce que l'inventaire des
    // suppressions annonçait.

    describe("enableTileCache — le drapeau atteint enfin le moteur (3.13)", () => {
        beforeEach(() => {
            globalThis.__tileFlag = undefined;
            globalThis.__basemaps = { osm: { id: "osm", offline: true, url: "https://t/{z}.png" } };
        });

        afterEach(() => {
            globalThis.__tileFlag = undefined;
        });

        test("sans sélection persistée, le drapeau à `true` fait énumérer les tuiles", async () => {
            // C'est le cas de l'hôte sans interface : il n'a aucun autre moyen d'exprimer
            // le réglage, et avant 3.13 il n'obtenait jamais de tuiles.
            const resources = [];

            await ResourceEnumerator._addBasemapResources(resources, "p", null);

            expect(resources.length).toBeGreaterThan(0);
        });

        test("le drapeau à `false` VETO, même sur une sélection qui dit oui", async () => {
            // Un veto, pas un défaut : une sélection persistée avant que le profil ne change
            // d'avis ne doit pas pouvoir passer outre.
            globalThis.__tileFlag = false;
            const resources = [];

            await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: true });

            expect(resources).toEqual([]);
        });

        test("le drapeau à `true` laisse la sélection refuser", async () => {
            // Contre-épreuve : sans elle, une lecture qui rendrait toujours `true` passerait
            // les deux tests précédents.
            const resources = [];

            await ResourceEnumerator._addBasemapResources(resources, "p", { includeTiles: false });

            expect(resources).toEqual([]);
        });

        test("le veto porte AUSSI sur les couches tuilées, pas seulement sur les fonds", async () => {
            // Les deux sites d'énumération sont distincts ; brancher l'un sans l'autre
            // laisserait une moitié du drapeau muette.
            globalThis.__tileFlag = false;
            const resources = [];

            await ResourceEnumerator._addLayerResources(
                resources,
                { layers: [{ id: "l1", type: "tile", url: "https://t/{z}.png" }] },
                "p",
                "../profiles",
                { includeTiles: true }
            );

            // ⚠️ On assert sur l'URL ÉNUMÉRÉE (le mock du calculateur rend `t/1.png`), pas
            // sur `r.type === "tile"` : la couche elle-même est poussée avec ce type, donc
            // une assertion sur le type aurait rougi sur l'entrée de couche — mon premier
            // instrument mesurait autre chose que ce qu'il annonçait.
            expect(resources.some((r) => r.url === "t/1.png")).toBe(false);
        });
    });
});

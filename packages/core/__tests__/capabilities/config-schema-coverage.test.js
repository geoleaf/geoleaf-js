/**
 * Unit tests — FAMILY guard: a config key READ by the runtime must be DECLARED in
 * its capability's `configSchema`.
 *
 * Mirror family of "declared but never read" (B.22 / B.30), and the costlier one:
 * `GeoLeaf.Introspection.getCapabilitySchema('<id>')` is what an integrator and the
 * no-code studio read — an undeclared key is invisible, therefore unguessable.
 *
 * Two complementary guards:
 *
 *  1. `describe("fixture leaves are declared")` — the FAMILY guard. Every leaf of
 *     each exhaustive reference fixture (`profiles/_reference/config/plugins/<id>.json`,
 *     which the config-contract work maintains as the canonical, exhaustive block for
 *     `modules.<id>`) must resolve inside the matching capability's `configSchema`.
 *     Mechanical: a future 5th instance in any fixture-covered capability fails here
 *     with no test to write. Walks fixture and schema in parallel and STOPS at a
 *     declared object with no `properties` (an opaque user-data subtree — per-layer
 *     bindings, named strategies — exactly like the `mapping` / `taxonomies` leaves
 *     of `check-config-coverage.cjs`).
 *
 *  2b. `describe("icons.showOnMap …")` — the B.41 leaf declared on CITATION alone, because
 *     its only reader lives in the legend capability. Now pinned observationally too.
 *  2. `describe("B.34 — the four instances")` — the two B.34 leaves NO fixture
 *     carries (`permalink.fields`: permalink has no profile file at all; `offline.cache
 *     .maxCacheBytes`: absent from `offline.json`), plus the DEFAULT of all four tied
 *     to its real runtime source rather than to a plausible value.
 *
 * Scope note — the quarantine is EMPTY. Its only ever entry, `taxonomy.{icons,render,
 * taxonomies,layers}` (the 5th instance, out of B.34's 4-leaf mandate because it was
 * four subtrees), was cleared by B.41: `TAXONOMY_CAPABILITY.configSchema` now declares
 * the four. The list must only ever shrink.
 *
 * Sibling guard — `config-schema-defaults.test.js` covers the same seam for VALUES:
 * a declared `default` must be the one the capability's config reader applies.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { Introspection } = await import("../../src/api/geoleaf.introspection.ts");

const { CLUSTER_CAPABILITY } = await import("../../src/capabilities/cluster/cluster-capability.ts");
const { FEATURE_INFO_CAPABILITY } =
    await import("../../src/capabilities/feature-info/feature-info-capability.ts");
const { FILTER_CAPABILITY } = await import("../../src/capabilities/filter/filter-capability.ts");
const { LABELS_CAPABILITY } = await import("../../src/capabilities/labels/labels-capability.ts");
const { LEGEND_CAPABILITY } = await import("../../src/capabilities/legend/legend-capability.ts");
const { OFFLINE_CAPABILITY } = await import("../../src/capabilities/offline/offline-capability.ts");
const { PERMALINK_CAPABILITY } =
    await import("../../src/capabilities/permalink/permalink-capability.ts");
const { ROUTE_CAPABILITY } = await import("../../src/capabilities/route/route-capability.ts");
const { TAXONOMY_CAPABILITY } =
    await import("../../src/capabilities/taxonomy/taxonomy-capability.ts");
const { THEME_SELECTOR_CAPABILITY } =
    await import("../../src/capabilities/theme-selector/theme-selector-capability.ts");
const { TOAST_RENDERER_CAPABILITY } =
    await import("../../src/capabilities/toast-renderer/toast-renderer-capability.ts");

// Runtime sources of the two importable defaults (assert against the code, not a literal).
const { DEFAULT_PERMALINK_FIELDS } = await import("../../src/capabilities/permalink/constants.ts");
const { CacheManager } = await import("../../src/capabilities/offline/cache/cache-manager.ts");
const { resolveLayerBinding } = await import("../../src/capabilities/route/resolver.ts");

// B.41 — the runtime that APPLIES the taxonomy defaults, so each declared value is
// checked against behaviour rather than against a plausible literal.
const { resolvePoiIcon, resolveTitleIcon } =
    await import("../../src/capabilities/taxonomy/resolver.ts");
const { resolveBadgeStyle } = await import("../../src/capabilities/taxonomy/badge.ts");
const { resolveIconSize } = await import("../../src/adapters/maplibre/maplibre-taxonomy-paint.ts");
// B.41 residue — `icons.showOnMap`'s ONLY reader is `shouldUseIcons()`, a private
// function of the legend generator. The generator is therefore the only observational
// surface it has: drive it, and read the icon off the produced legend item.
const { LegendGenerator } = await import("../../src/capabilities/legend/legend-generator.ts");

/** Every in-core capability declaration that owns a `modules.<id>` config block. */
const DECLARATIONS = [
    CLUSTER_CAPABILITY,
    FEATURE_INFO_CAPABILITY,
    FILTER_CAPABILITY,
    LABELS_CAPABILITY,
    LEGEND_CAPABILITY,
    OFFLINE_CAPABILITY,
    PERMALINK_CAPABILITY,
    ROUTE_CAPABILITY,
    TAXONOMY_CAPABILITY,
    THEME_SELECTOR_CAPABILITY,
    TOAST_RENDERER_CAPABILITY,
];

/**
 * Pre-existing instances of the family, quarantined so the guard can be posted
 * without fixing them. NOT a licence: every entry is a known defect, and the list
 * must only shrink. **Empty since B.41** — it held the four
 * `modules.taxonomy.{icons,render,taxonomies,layers}` subtrees, now declared.
 */
const KNOWN_UNDECLARED = new Set([]);

// __tests__/capabilities → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE_DIR = resolve(ROOT, "profiles/_reference/config/plugins");

/** Reads the exhaustive reference fixtures, keyed by `modules.<id>`. */
function readFixtures() {
    const out = new Map();
    for (const file of readdirSync(FIXTURE_DIR)) {
        if (!file.endsWith(".json")) continue;
        out.set(
            file.slice(0, -".json".length),
            JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), "utf8"))
        );
    }
    return out;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Walks a fixture block against a `configSchema` level, returning the dotted paths
 * present in the fixture but absent from the schema. Descends only where the schema
 * declares nested `properties`; a declared object without them is an opaque subtree
 * (dynamic keys) and stops the walk.
 */
function undeclaredLeaves(fixture, schemaLevel, prefix = "") {
    const missing = [];
    for (const [key, value] of Object.entries(fixture ?? {})) {
        if (key === "_comment") continue;
        const path = prefix ? `${prefix}.${key}` : key;
        const field = schemaLevel?.[key];
        if (!field) {
            missing.push(path);
            continue;
        }
        if (isPlainObject(value) && field.properties) {
            missing.push(...undeclaredLeaves(value, field.properties, path));
        }
    }
    return missing;
}

/** Resolves a dotted leaf path inside a `configSchema` (null when undeclared). */
function resolveField(configSchema, path) {
    let level = configSchema;
    let field = null;
    for (const part of path.split(".")) {
        field = level?.[part];
        if (!field) return null;
        level = field.properties;
    }
    return field;
}

beforeEach(() => {
    CapabilityRegistry._reset();
    for (const decl of DECLARATIONS) CapabilityRegistry.register(decl);
});

describe("configSchema coverage — fixture leaves are declared", () => {
    const fixtures = readFixtures();
    const covered = DECLARATIONS.filter((d) => fixtures.has(d.id));

    it("the reference fixtures cover the in-core capabilities under test", () => {
        // Guards the guard: a renamed fixture directory would silently empty the loop.
        expect(covered.map((d) => d.id).sort()).toEqual([
            "cluster",
            "feature-info",
            "filter",
            "labels",
            "legend",
            "offline",
            "route",
            "taxonomy",
            "theme-selector",
            "toast-renderer",
        ]);
    });

    it.each(covered.map((d) => d.id))(
        "every key of the %s fixture is declared in getCapabilitySchema()",
        (id) => {
            const schema = Introspection.getCapabilitySchema(id);
            const missing = undeclaredLeaves(fixtures.get(id), schema?.configSchema).filter(
                (leaf) => !KNOWN_UNDECLARED.has(`${id}.${leaf}`)
            );
            expect(missing).toEqual([]);
        }
    );
});

describe("configSchema coverage — B.34, the four instances", () => {
    it("modules.route.layers — declared, opaque object, default {} (resolver.ts:48)", () => {
        const field = resolveField(
            Introspection.getCapabilitySchema("route")?.configSchema,
            "layers"
        );
        expect(field?.type).toBe("object");
        expect(field?.default).toEqual({});
    });

    it("modules.route.layers — {} IS the effective runtime default (absent ≡ empty map)", () => {
        // resolveLayerBinding reads `config.layers?.[layerId] ?? null`: an absent map and
        // an empty one are observationally identical, so `{}` is the real default.
        expect(resolveLayerBinding({ enabled: true }, "any-layer")).toBeNull();
        expect(resolveLayerBinding({ enabled: true, layers: {} }, "any-layer")).toBeNull();
    });

    it("modules.cluster.clusterStrategies — declared, opaque object, default {} (strategy.ts:72,76)", () => {
        const field = resolveField(
            Introspection.getCapabilitySchema("cluster")?.configSchema,
            "clusterStrategies"
        );
        expect(field?.type).toBe("object");
        expect(field?.default).toEqual({});
    });

    it("modules.permalink.fields — declared, array, default = DEFAULT_PERMALINK_FIELDS", () => {
        const field = resolveField(
            Introspection.getCapabilitySchema("permalink")?.configSchema,
            "fields"
        );
        expect(field?.type).toBe("array");
        // The three read sites all fall back to DEFAULT_PERMALINK_FIELDS
        // (permalink-sync.ts, permalink-url.ts and :257).
        expect(field?.default).toEqual([...DEFAULT_PERMALINK_FIELDS]);
        expect(field?.items?.enum).toEqual([...DEFAULT_PERMALINK_FIELDS]);
        // A copy, not the shared constant: getSchema() hands the declaration to studio
        // consumers, which must not be able to mutate the runtime default.
        expect(field.default).not.toBe(DEFAULT_PERMALINK_FIELDS);
        expect(field.items.enum).not.toBe(DEFAULT_PERMALINK_FIELDS);
    });

    it("modules.offline.cache.maxCacheBytes — declared, number, default = CacheManager's", () => {
        const field = resolveField(
            Introspection.getCapabilitySchema("offline")?.configSchema,
            "cache.maxCacheBytes"
        );
        expect(field?.type).toBe("number");
        // The runtime default lives in CacheManager._config (cache-manager.ts) and
        // survives the OfflineLifecycle spread + init() merge when a profile omits the key.
        expect(field?.default).toBe(CacheManager._config.maxCacheBytes);
    });

    it("modules.offline.cache.maxTileCacheEntries — default = le repli codé dans le worker", () => {
        // 🛑 THE WORKER CANNOT IMPORT THIS SCHEMA. `sw-core.js` is copied
        // as-is into each deployment variant, unbundled: it re-declares the
        // fallback ceiling hardcoded. Two literals, no compilation link — and
        // exactly the shape of the offline roadmap's root cause no. 2, where
        // the worker opened the base at v2 while the engine declared it v3,
        // for months, with nothing turning red.
        //
        // This assertion is the ONLY place that would see the two diverge.
        // Its consequence if missing: a profile omitting the key would get
        // the schema's default, the worker would apply its own, and the
        // effective ceiling would be that of neither document describing it.
        const swSource = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), "../../src/kernel/storage/sw-core.js"),
            "utf8"
        );
        const swDefault = swSource.match(/const TILE_CACHE_MAX_ENTRIES = (\d+);/);
        expect(swDefault).not.toBeNull(); // témoin : le littéral existe bien côté worker

        const field = resolveField(
            Introspection.getCapabilitySchema("offline")?.configSchema,
            "cache.maxTileCacheEntries"
        );
        expect(field?.type).toBe("number");
        expect(field?.minimum).toBe(0); // `0` désactive le bornage, il doit rester atteignable
        expect(field?.default).toBe(Number(swDefault[1]));
    });
});

/**
 * B.41 — the 5th instance, the biggest one: `TAXONOMY_CAPABILITY.configSchema` declared
 * `enabled` alone while the runtime consumed ~19 keys across four subtrees. The coverage
 * loop above now proves the four are DECLARED; these tests prove the values declared with
 * them are the ones the runtime APPLIES — each derived from its read site, never guessed.
 */
describe("configSchema coverage — B.41, taxonomy's four subtrees", () => {
    /** A minimal but complete taxonomy: one bound layer, one category with an icon + disc. */
    const CONFIG = {
        enabled: true,
        taxonomies: {
            "poi-cat": {
                categoryField: "categoryId",
                subCategoryField: "subCategoryId",
                categories: {
                    culture: {
                        svgId: "culture-building",
                        marker: { fill: "#6a1b9a", stroke: "#38006b" },
                        subcategories: { musee: { svgId: "culture-museum" } },
                    },
                },
            },
        },
        layers: { pois: { use: "poi-cat" } },
    };
    const FEATURE = { layerId: "pois", properties: { categoryId: "culture" } };

    const taxonomyField = (path) =>
        resolveField(Introspection.getCapabilitySchema("taxonomy")?.configSchema, path);

    it("icons.symbolPrefix — default '' IS what an absent prefix produces", () => {
        expect(taxonomyField("icons.symbolPrefix")?.default).toBe("");
        // resolvePoiIcon prefixes with `config.icons?.symbolPrefix ?? ""` (resolver.ts):
        // no `icons` block and an explicit "" are observationally the same symbol id.
        const bare = resolvePoiIcon(CONFIG, FEATURE);
        const empty = resolvePoiIcon({ ...CONFIG, icons: { symbolPrefix: "" } }, FEATURE);
        expect(bare.symbolId).toBe("culture-building");
        expect(empty.symbolId).toBe(bare.symbolId);
    });

    it("icons.iconSize — default IS the size the paint seam applies with no config", () => {
        // The literal lives in the MapLibre adapter (maplibre-taxonomy-paint.ts) and is
        // not exported; `resolveIconSize()` with no `GeoLeaf.Taxonomy` seam renders it.
        expect(taxonomyField("icons.iconSize")?.default).toBe(resolveIconSize());
    });

    it("render.<surface>.showIcon* — default false IS the no-decoration behaviour", () => {
        for (const surface of ["popup", "tooltip", "sidepanel"]) {
            expect(taxonomyField(`render.${surface}.showIconCategory`)?.default).toBe(false);
            expect(taxonomyField(`render.${surface}.showIconSubcategory`)?.default).toBe(false);
            // resolveTitleIcon bails unless a flag is `=== true` (resolver.ts), so an
            // absent `render` block and both flags at false are the same: no title icon.
            expect(resolveTitleIcon(CONFIG, "pois", FEATURE, surface)).toBeNull();
            const off = {
                ...CONFIG,
                render: { [surface]: { showIconCategory: false, showIconSubcategory: false } },
            };
            expect(resolveTitleIcon(off, "pois", FEATURE, surface)).toBeNull();
            // …and the flag really is the only thing standing between: turn it on.
            const on = { ...CONFIG, render: { [surface]: { showIconCategory: true } } };
            expect(resolveTitleIcon(on, "pois", FEATURE, surface)).toBe("culture-building");
        }
    });

    it("render.<surface>.colorBadges — default false IS the uncoloured behaviour", () => {
        for (const surface of ["popup", "tooltip", "sidepanel"]) {
            expect(taxonomyField(`render.${surface}.colorBadges`)?.default).toBe(false);
            // resolveBadgeStyle returns null unless `colorBadges === true` (badge.ts).
            expect(resolveBadgeStyle(CONFIG, "pois", FEATURE, surface, "categoryId")).toBeNull();
            const off = { ...CONFIG, render: { [surface]: { colorBadges: false } } };
            expect(resolveBadgeStyle(off, "pois", FEATURE, surface, "categoryId")).toBeNull();
            const on = { ...CONFIG, render: { [surface]: { colorBadges: true } } };
            expect(resolveBadgeStyle(on, "pois", FEATURE, surface, "categoryId")?.background).toBe(
                "#6a1b9a"
            );
        }
    });

    /**
     * B.41 residue — `icons.showOnMap` was declared `default: true` on CITATION alone
     * (`legend-generator.ts`), because its only reader is `shouldUseIcons()`, a
     * private function of a capability outside the declaring lot's perimeter. Pinned
     * here by the same observational rule as its four siblings above.
     *
     * The gate is `iconsConfig != null && iconsConfig.showOnMap !== false`, so it has
     * TWO halves and both must be covered:
     *  - INSIDE a present `icons` block, absent ≡ `true` (that is the advertised default);
     *  - an ABSENT `icons` block is itself the off switch — no icon at all, whatever
     *    `showOnMap` would have said. The schema description says exactly this.
     */
    describe("icons.showOnMap — default true, but only inside a present `icons` block", () => {
        /** A style rule whose `when` lands on a category carrying an `svgId`. */
        const STYLE = {
            label: "Icons",
            styleRules: [
                {
                    style: { fillColor: "#f00" },
                    legend: { label: "Culture" },
                    when: { field: "properties.categoryId", value: "culture" },
                },
            ],
        };
        const TAXONOMY_DATA = {
            categories: { culture: { svgId: "culture-building" } },
            icons: { symbolPrefix: "ref-" },
        };

        /** Runs the generator with `GeoLeaf.Taxonomy.getIcons()` stubbed to `icons`. */
        const iconOf = (icons) => {
            const previous = globalThis.GeoLeaf;
            globalThis.GeoLeaf = {
                Taxonomy: {
                    getIcons: () => icons,
                    getCategories: () => TAXONOMY_DATA.categories,
                },
            };
            try {
                const legend = LegendGenerator.generateLegendFromStyle(
                    STYLE,
                    "point",
                    TAXONOMY_DATA
                );
                return legend.sections[0].items[0].symbol.icon;
            } finally {
                globalThis.GeoLeaf = previous;
            }
        };

        it("advertises true", () => {
            expect(taxonomyField("icons.showOnMap")?.default).toBe(true);
        });

        it("inside a present block, absent ≡ explicit true ≡ icons shown", () => {
            // The RAW `symbolPrefix + svgId` — the legend feeds `<use href="#…">`, never
            // the tinted atlas id.
            expect(iconOf({ symbolPrefix: "ref-" })).toBe("ref-culture-building");
            expect(iconOf({ symbolPrefix: "ref-", showOnMap: true })).toBe("ref-culture-building");
        });

        it("an explicit false turns icons off", () => {
            expect(iconOf({ symbolPrefix: "ref-", showOnMap: false })).toBeUndefined();
        });

        it("an ABSENT icons block is off — the default never applies outside it", () => {
            // `getIcons()` returns null when `modules.taxonomy.icons` is absent
            // (taxonomy/public-api.ts), and `iconsConfig != null` fails first.
            expect(iconOf(null)).toBeUndefined();
        });
    });

    it("the opaque and the default-less leaves advertise no default", () => {
        // `taxonomies` / `layers` hold user-named keys, and `spriteUrl` / `defaultIcon` have
        // no runtime fallback (absent ⇒ no sprite / no icon). Advertising `{}` or a value
        // here would be inventing one — and would re-open the very drift B.24 closed.
        for (const path of ["taxonomies", "layers", "icons.spriteUrl", "icons.defaultIcon"]) {
            expect(taxonomyField(path)).toBeTruthy();
            expect(taxonomyField(path)).not.toHaveProperty("default");
        }
        // …and the two opaque maps stop the coverage walk: no `properties` to enumerate.
        expect(taxonomyField("taxonomies")).not.toHaveProperty("properties");
        expect(taxonomyField("layers")).not.toHaveProperty("properties");
    });
});

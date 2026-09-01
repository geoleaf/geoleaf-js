/**
 * Unit tests — FAMILY guard: the `default` a capability ADVERTISES in its
 * `configSchema` must be the value its config READER hands the runtime when the
 * profile carries no `modules.<id>` block.
 *
 * Sibling of `config-schema-coverage.test.js`, which guards the same seam for
 * COVERAGE (a read key must be declared). This one guards VALUES:
 * `GeoLeaf.Introspection.getCapabilitySchema('<id>')` is what an integrator and the
 * no-code studio read, so a `default` that no accessor materialises is a promise the
 * runtime never keeps — and, worse, invites a THIRD copy of the value somewhere else
 * (branding kept its real default in `branding.ts`, a file neither the schema nor the
 * accessor mentions).
 *
 * Mechanical by construction: the subject list is derived from the pairs
 * (declaration, config reader) below, and each pair is compared key by key in BOTH
 * directions. A future instance — a `default` added to a schema without the matching
 * accessor entry, or an accessor default the schema does not advertise — fails here
 * with no test to write.
 *
 * The comparison targets TOP-LEVEL keys: that is the level a `get<X>Config()` reader
 * materialises (`{ ...DEFAULTS, ...raw }`). Nested defaults (`offline.cache.*`,
 * `taxonomy.icons.*`, `pwa.installPrompt.*`) describe what happens INSIDE a block the
 * profile supplies, so no accessor renders them and they are out of this guard's
 * reach — `config-schema-coverage.test.js` and the per-capability tests cover those.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

// Every reader below goes through this one seam (`_Config.get("modules.<id>", {})`),
// so mocking it once simulates "the profile carries no block for any capability".
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { Introspection } = await import("../../src/api/geoleaf.introspection.ts");

const { BRANDING_CAPABILITY } =
    await import("../../src/capabilities/branding/branding-capability.ts");
const { CLUSTER_CAPABILITY } = await import("../../src/capabilities/cluster/cluster-capability.ts");
const { COORDINATES_CAPABILITY } =
    await import("../../src/capabilities/coordinates/coordinates-capability.ts");
const { FEATURE_INFO_CAPABILITY } =
    await import("../../src/capabilities/feature-info/feature-info-capability.ts");
const { FILTER_CAPABILITY } = await import("../../src/capabilities/filter/filter-capability.ts");
const { GEOLOCATION_CAPABILITY } =
    await import("../../src/capabilities/geolocation/geolocation-capability.ts");
const { LABELS_CAPABILITY } = await import("../../src/capabilities/labels/labels-capability.ts");
const { LEGEND_CAPABILITY } = await import("../../src/capabilities/legend/legend-capability.ts");
const { PERMALINK_CAPABILITY } =
    await import("../../src/capabilities/permalink/permalink-capability.ts");
const { ROUTE_CAPABILITY } = await import("../../src/capabilities/route/route-capability.ts");
const { SCALE_CAPABILITY } = await import("../../src/capabilities/scale/scale-capability.ts");
const { TAXONOMY_CAPABILITY } =
    await import("../../src/capabilities/taxonomy/taxonomy-capability.ts");
const { THEME_TOGGLE_CAPABILITY } =
    await import("../../src/capabilities/theme-toggle/theme-toggle-capability.ts");
const { TOAST_RENDERER_CAPABILITY } =
    await import("../../src/capabilities/toast-renderer/toast-renderer-capability.ts");

const { getBrandingConfig } = await import("../../src/capabilities/branding/config.ts");
const { getClusterConfig } = await import("../../src/capabilities/cluster/config.ts");
const { getCoordinatesConfig } = await import("../../src/capabilities/coordinates/config.ts");
const { getFeatureInfoConfig } = await import("../../src/capabilities/feature-info/config.ts");
const { getFilterConfig } = await import("../../src/capabilities/filter/config.ts");
const { getGeolocationConfig } = await import("../../src/capabilities/geolocation/config.ts");
const { getLabelsConfig } = await import("../../src/capabilities/labels/config.ts");
const { getLegendConfig } = await import("../../src/capabilities/legend/config.ts");
const { getPermalinkConfig } = await import("../../src/capabilities/permalink/config.ts");
const { getRouteConfig } = await import("../../src/capabilities/route/config.ts");
const { getScaleConfig } = await import("../../src/capabilities/scale/config.ts");
const { getTaxonomyConfig } = await import("../../src/capabilities/taxonomy/config.ts");
const { getThemeToggleConfig } = await import("../../src/capabilities/theme-toggle/config.ts");
const { getToastRendererConfig } = await import("../../src/capabilities/toast-renderer/config.ts");

/**
 * The complete set of in-core capabilities that own BOTH a declaration and a
 * `config.ts` reader — i.e. every capability for which the question "does the
 * advertised default match the applied one?" is even askable. Adding a 15th
 * `capabilities/<id>/config.ts` without listing it here is caught by the
 * membership test below.
 */
const SUBJECTS = [
    { declaration: BRANDING_CAPABILITY, read: getBrandingConfig },
    { declaration: CLUSTER_CAPABILITY, read: getClusterConfig },
    { declaration: COORDINATES_CAPABILITY, read: getCoordinatesConfig },
    { declaration: FEATURE_INFO_CAPABILITY, read: getFeatureInfoConfig },
    { declaration: FILTER_CAPABILITY, read: getFilterConfig },
    { declaration: GEOLOCATION_CAPABILITY, read: getGeolocationConfig },
    { declaration: LABELS_CAPABILITY, read: getLabelsConfig },
    { declaration: LEGEND_CAPABILITY, read: getLegendConfig },
    { declaration: PERMALINK_CAPABILITY, read: getPermalinkConfig },
    { declaration: ROUTE_CAPABILITY, read: getRouteConfig },
    { declaration: SCALE_CAPABILITY, read: getScaleConfig },
    { declaration: TAXONOMY_CAPABILITY, read: getTaxonomyConfig },
    { declaration: THEME_TOGGLE_CAPABILITY, read: getThemeToggleConfig },
    { declaration: TOAST_RENDERER_CAPABILITY, read: getToastRendererConfig },
];

/**
 * Pre-existing divergences, quarantined so the guard can be posted without fixing
 * them. NOT a licence: every entry is a known defect, and the list must only shrink.
 *
 *  - `legend.*` — CLEARED by the B.24 `legend` volet: `LEGEND_CAPABILITY.configSchema`
 *    now advertises `position` / `collapsedByDefault` / `title` with the very values
 *    `config.ts` DEFAULTS applies, so the three entries left this set.
 *  - `permalink.fields` / `route.layers` — declared by B.34, from the same runtime
 *    constant every read site falls back to (`DEFAULT_PERMALINK_FIELDS`;
 *    `config.layers?.[id] ?? null`, so absent ≡ `{}`). Observationally equivalent
 *    TODAY, but the accessor is still not the single source: the fallback is
 *    re-applied at each call site instead of being materialised once.
 */
const KNOWN_DEFAULT_DRIFT = new Set(["permalink.fields", "route.layers"]);

beforeEach(() => {
    configGet.mockReset();
    // "No `modules.<id>` block at all" — what `Config.get(path, {})` returns for a
    // profile that never declares the capability.
    configGet.mockReturnValue({});
    CapabilityRegistry._reset();
    for (const { declaration } of SUBJECTS) CapabilityRegistry.register(declaration);
});

/** Top-level schema fields carrying a `default`, as `{ key: default }`. */
function advertisedDefaults(configSchema) {
    const out = {};
    for (const [key, field] of Object.entries(configSchema ?? {})) {
        if (field && Object.hasOwn(field, "default")) out[key] = field.default;
    }
    return out;
}

describe("configSchema defaults — advertised ≡ applied", () => {
    it("the subject list covers every capability that owns a config reader", () => {
        // Guards the guard: a new `capabilities/<id>/config.ts` must join SUBJECTS,
        // otherwise the loop below silently stops seeing it.
        expect(SUBJECTS.map(({ declaration }) => declaration.id).sort()).toEqual([
            "branding",
            "cluster",
            "coordinates",
            "feature-info",
            "filter",
            "geolocation",
            "labels",
            "legend",
            "permalink",
            "route",
            "scale",
            "taxonomy",
            "theme-toggle",
            "toast-renderer",
        ]);
    });

    it.each(SUBJECTS.map((s) => [s.declaration.id, s]))(
        "%s — every advertised default is the value the reader applies",
        (id, { read }) => {
            const advertised = advertisedDefaults(
                Introspection.getCapabilitySchema(id)?.configSchema
            );
            const applied = read();
            const drift = Object.entries(advertised)
                .filter(([key]) => !KNOWN_DEFAULT_DRIFT.has(`${id}.${key}`))
                .filter(([key, value]) => JSON.stringify(applied[key]) !== JSON.stringify(value))
                .map(
                    ([key, value]) =>
                        `${key}: advertised ${JSON.stringify(value)}, applied ${JSON.stringify(applied[key])}`
                );
            expect(drift).toEqual([]);
        }
    );

    it.each(SUBJECTS.map((s) => [s.declaration.id, s]))(
        "%s — every default the reader applies is advertised",
        (id, { read }) => {
            const advertised = advertisedDefaults(
                Introspection.getCapabilitySchema(id)?.configSchema
            );
            const undeclared = Object.keys(read())
                .filter((key) => !KNOWN_DEFAULT_DRIFT.has(`${id}.${key}`))
                .filter((key) => !Object.hasOwn(advertised, key));
            expect(undeclared).toEqual([]);
        }
    );
});

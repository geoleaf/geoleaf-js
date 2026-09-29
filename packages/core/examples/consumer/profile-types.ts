/*!
 * GeoLeaf — the profile contract, typed the way an integrator types it.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * `@geoleaf/core/schemas` ships the types of a profile's FILES, generated from the JSON Schemas
 * the package also ships at `@geoleaf/core/schemas/<name>.schema.json`. This file compiles only
 * if both subpaths resolve through the `exports` map — the types entry (types-only, like
 * `./contracts/*`) and the JSON one.
 *
 * ## Why here, and why so little
 *
 * `typecheck:consumer` is a RELEASE gate: this is the witness `release:check` replays. The full
 * proof lives in `__tests__/bundle-profile-contract.test.ts` — every profile file of the repo
 * validated against the schemas the tarball carries and typed against its declarations, a typo
 * refused on each of the ten root types, under two compiler settings. Repeating it here would
 * be a second copy to keep in step; this file keeps what only a release-time compile can say.
 *
 * Type-only at runtime: nothing imports it, so `rollup.consumer.mjs` (input = `entry.ts` alone)
 * does not bundle it and the `size:consumer` measure is untouched.
 */

import type {
    GeoLeafBasemaps,
    GeoLeafCoreFeatures,
    GeoLeafDataMapping,
    GeoLeafLayerConfig,
    GeoLeafLayerStyle,
    GeoLeafLayersIndex,
    GeoLeafProfile,
    GeoLeafRootConfig,
    GeoLeafThemes,
    GeoLeafUIConfig,
} from "@geoleaf/core/schemas";
import profileSchema from "@geoleaf/core/schemas/profile.schema.json";

// The JSON subpath resolves, and it is the schema: its `$id` is the key ajv files it under.
export const profileSchemaId: string = profileSchema.$id;

// A profile written in code, as an integrator writes one.
export const profile: GeoLeafProfile = {
    id: "my-profile",
    label: "My profile",
    _comment: "Comment keys are accepted wherever the schema accepts them.",
    Files: {
        layersFile: "config/core/layers.json",
        modules: { legend: "config/plugins/legend.json" },
    },
    // A module's block is opaque: its keys belong to the capability or plugin.
    modules: { "my-plugin": { anyKey: true } },
};

// @ts-expect-error — a typo is refused: the root of a profile is closed.
export const typo: GeoLeafProfile = { id: "my-profile", lable: "My profile" };

// Each root type is reachable by name: a renamed schema `title` fails to compile here.
export type ProfileFileTypes = [
    GeoLeafBasemaps,
    GeoLeafCoreFeatures,
    GeoLeafDataMapping,
    GeoLeafLayerConfig,
    GeoLeafLayerStyle,
    GeoLeafLayersIndex,
    GeoLeafProfile,
    GeoLeafRootConfig,
    GeoLeafThemes,
    GeoLeafUIConfig,
];

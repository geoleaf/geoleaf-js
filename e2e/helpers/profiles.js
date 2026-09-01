// @ts-check
// Deliverable profiles, DERIVED from disk — the seam the demo purge proved and the suite now shares.
//
// A spec that hard-lists what `profiles/` contains does not break when the directory
// changes — it breaks LATER, and it blames the wrong culprit: measured when the profile
// fleet went from 8 to 2 and a spec kept looking for six demos in a deploy that no longer
// carried them. `vn-profiles-boot.spec.js` fixed that by deriving; this helper is that
// derivation extracted, so the next spec does not re-spell the filter.
//
// ## What this seam does NOT cover, deliberately
//
// Specs that name a profile or a layer as their ASSERTION SUBJECT ("the tourism rainfall
// layers render as twelve sub-layers") keep their literals: deriving the subject from the
// same disk the assertion reads would make the test tautological — green whatever the
// profile ships. The seam serves the other class: paths and lists that must simply agree
// with what the deploy carries.

import fs from "node:fs";

/**
 * Ids of the deliverable profiles, sorted.
 *
 * ⚠️ The filter reproduces EXACTLY the one in `scripts/build-deploy.cjs`: no `schemas/`,
 * no `_`-prefixed directory (`_reference` is the exhaustive config sampler, not a
 * deliverable demo). If the two filters diverged, a consumer would look for a profile the
 * deploy does not serve — the original failure under another name. The duplication of the
 * filter is the risk this comment exists to keep visible.
 *
 * @returns {string[]} Profile directory names, e.g. `["reunion-eclairage", "tourism"]`.
 * @throws {Error} When no deliverable profile is found — an empty list would let every
 *   consumer loop declare zero tests and come out green having verified nothing.
 */
export function deliverableProfiles() {
    const found = fs
        .readdirSync(new URL("../../profiles/", import.meta.url), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
        .map((e) => e.name)
        .sort();
    if (found.length === 0) {
        throw new Error(
            "helpers/profiles: no deliverable profile found under `profiles/`. An empty " +
                "directory would make every consuming loop green by declaring nothing."
        );
    }
    return found;
}

/**
 * Served URL path of a layer's config file, for the profile layout the deploy uses.
 *
 * One shape, one place: specs used to assemble this path by hand, and a layout change
 * would have left each copy silently pointing at a 404.
 *
 * @param {string} profileId Deliverable profile id.
 * @param {string} layerId Layer directory id inside that profile.
 * @returns {string} Root-relative URL path of the layer's `_config.json`.
 */
export function layerConfigPath(profileId, layerId) {
    return `/profiles/${profileId}/layers/${layerId}/${layerId}_config.json`;
}

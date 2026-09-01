/**
 * Guard — a basemap must be REALLY available off-network.
 *
 * `resource-enumerator.ts` filters basemaps on `basemap.offline === true`
 * (`_addBasemapResources`). As long as no shipped profile sets that flag, the
 * branch is gated by a key nobody declares: the filter returns an empty list,
 * the whole basemap caching path is unreachable from a real profile, and **no
 * unit test sees it** — those of `resource-enumerator.test.js` mount their
 * own synthetic `__basemaps`, so they would stay green on a repo where no
 * profile declares anything any more.
 *
 * Exactly the completeness clause's failure class "any path gated by a key no
 * profile sets", and what this guard measures on disk.
 *
 * ## Why the second assertion is about VECTOR, and not the basemap count
 *
 * 🛑 **A basemap's off-network availability is not a property of the server,
 * it is a property of the FORMAT.** The Service Worker's four strategies gate
 * on `status === 200` and an opaque response carries `0` (`sw-core.js`). A
 * **vector** basemap is parsed by MapLibre (PBF): its request is necessarily
 * in `cors` mode, so its response is never opaque — the guarantee is
 * structural. A cross-origin **raster** basemap offers no such guarantee: the
 * probe of 06/08/2026 did measure `Access-Control-Allow-Origin: *` on the 3
 * real origins, but **the request's mode is what decides**, and it is not established.
 *
 * Flipping a raster to `offline: true` would thus look like a fix without
 * being one. The guard requires at least **one** offline basemap to be
 * vector, the only shape known to demonstrably survive.
 *
 * ⚠️ **It does NOT require ALL offline basemaps to be vector**, deliberately:
 * that would claim more than is measured. The real mode of MapLibre's raster
 * requests was never surveyed in a browser (that was half ② of the CORS
 * probe, unexecuted). A guard exceeding its proof gets believed until the day
 * it costs a run.
 *
 * ## Perimeter — derived, never hardcoded
 *
 * Profiles are filtered by **the same rule as `scripts/build-deploy.cjs`**:
 * `schemas/` and any `_`-prefixed directory are set aside. `_reference` is a
 * test fixture never deployed, and it precisely carries a **raster** `street`
 * at `offline: true` — a combination this guard must neither validate nor
 * condemn, since a fixture's role is to exercise the schema's branches.
 * Hardcoding the profile list here would make it stop matching at the first
 * addition, and the guard would come out green having scanned nothing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PROFILES = join(ROOT, "profiles");

/**
 * A `basemaps.json` entry, reduced to what this guard reads from it.
 *
 * ⚠️ Deliberately WIDE and all-optional: the guard reads **real** profile
 * files, not a shape already schema-validated. A strict type here would fail
 * compilation on a malformed profile instead of failing the GUARD, moving the
 * red away from the place that explains it.
 */
interface BasemapEntry {
    type?: string;
    style?: string;
    url?: string;
    offline?: boolean;
}

/**
 * The SHIPPED profiles, by `build-deploy.cjs`'s rule (`schemas/` + `_` prefix
 * set aside). Derived from disk, so adding a profile enters the perimeter
 * with no gesture.
 */
function deployedProfileIds(): string[] {
    if (!existsSync(PROFILES)) return [];
    return readdirSync(PROFILES, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
        .map((e) => e.name);
}

/** Every basemap entry of a shipped profile, flattened with its origin profile. */
function deployedBasemaps(): Array<{ profileId: string; key: string; entry: BasemapEntry }> {
    const out: Array<{ profileId: string; key: string; entry: BasemapEntry }> = [];
    for (const id of deployedProfileIds()) {
        const file = join(PROFILES, id, "config", "core", "basemaps.json");
        if (!existsSync(file)) continue;
        const doc = JSON.parse(readFileSync(file, "utf8")) as {
            basemaps?: Record<string, BasemapEntry>;
        };
        for (const [key, entry] of Object.entries(doc.basemaps ?? {})) {
            out.push({ profileId: id, key, entry });
        }
    }
    return out;
}

/**
 * A basemap is VECTOR in `_addBasemapResources`'s sense: `type: "maplibre"`,
 * or a `style` without `url`. ⚠️ The predicate is COPIED from
 * `resource-enumerator.ts` and must stay so — anchoring it on a basemap's id
 * (`ign-plan-3d`) would turn this guard red at the first correct rename,
 * while the invariant itself had not moved.
 */
function isVector(entry: BasemapEntry): boolean {
    return entry.type === "maplibre" || (!!entry.style && !entry.url);
}

describe("8.1 / A7′ — le hors-ligne a un fond qu'il peut réellement servir", () => {
    it("sanity : le périmètre n'est pas vide (sinon la garde passe sans rien scanner)", () => {
        const profiles = deployedProfileIds();
        const basemaps = deployedBasemaps();
        expect(profiles.length).toBeGreaterThan(0);
        expect(basemaps.length).toBeGreaterThan(0);
    });

    it("au moins un profil LIVRÉ déclare un fond `offline: true` (compteur C2)", () => {
        const offline = deployedBasemaps().filter(({ entry }) => entry.offline === true);
        expect(
            offline.map(({ profileId, key }) => `${profileId}/${key}`),
            "aucun profil livré ne pose `offline: true` — `_addBasemapResources` filtre sur " +
                "une liste vide et tout le chemin de cache de fond est inatteignable"
        ).not.toHaveLength(0);
    });

    it("au moins un de ces fonds est VECTORIEL — la seule forme non opaque par construction", () => {
        const offlineVector = deployedBasemaps().filter(
            ({ entry }) => entry.offline === true && isVector(entry)
        );
        expect(
            offlineVector.map(({ profileId, key }) => `${profileId}/${key}`),
            "les fonds hors-ligne livrés sont tous raster : une réponse opaque porte " +
                "`status: 0` et le Service Worker la refuse, donc aucun ne survit à une coupure"
        ).not.toHaveLength(0);
    });

    it("un fond vectoriel hors-ligne porte bien un `style` résoluble", () => {
        const offlineVector = deployedBasemaps().filter(
            ({ entry }) => entry.offline === true && isVector(entry)
        );
        for (const { profileId, key, entry } of offlineVector) {
            expect(entry.style, `${profileId}/${key} : fond vectoriel sans URL de style`).toMatch(
                /^https?:\/\//
            );
        }
    });
});

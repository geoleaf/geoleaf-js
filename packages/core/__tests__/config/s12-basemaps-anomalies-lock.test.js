/**
 * Config-contract Phase C / C3 — B4 basemaps.json anomalies (regression-lock).
 *
 * No-mapping CONTRACT (❌): keys READ by live code but ABSENT from the hardened
 * basemaps.schema.json (additionalProperties:false) → inconfigurable via the
 * contract. Each lock asserts BOTH: (1) the live code reads the key, and (2) the
 * schema rejects it. If a future change adds the key to the schema OR drops the
 * consumer, one half breaks — flagging the registry entry for resolution.
 *
 *   ANO-042 basemaps[].apiKey / apiKeyRequired   → providers.ts        ❌ ouverte
 *   ANO-043 basemaps[].demUrl/demEncoding/demMaxZoom (top-level) → hillshade.ts  ❌ ouverte
 *   ANO-044 basemaps[].terrain.demMaxZoom        → terrain.ts                ✅ RÉSOLUE
 *   ANO-045 basemaps[].wms.crs / styles / tileSize → wmts-resolver.ts ✅ RÉSOLUE
 *
 * ⚠️ **ANO-044 and ANO-045 are resolved on 30/07/2026, and the lock worked
 * as intended.** `b7785b56` carried into the schema the 7 keys of its
 * "class ④" — live, well addressed, unguarded — including
 * `terrain.demMaxZoom` and `wms.{crs,styles,tileSize}` (397 → 404
 * properties). The `schema:` half of these two locks thus broke, which is
 * EXACTLY what the contract above announces ("one half breaks — flagging
 * the registry entry for resolution"). Their assertions are flipped to
 * `true`: the no-mapping is closed, the key is now configurable. ⚠️ **The
 * red was not a regression, and flipping it the other way — hardening the
 * schema again — would have re-broken a capability the code already
 * serves.** The two `live:` halves stay: they prove the consumer still exists.
 *
 * ANO-043 stays OPEN despite its neighbouring name: it carries the
 * HILLSHADE keys at the first level (`demUrl`/`demEncoding`/`demMaxZoom` on
 * the entry), not under `terrain.` — the fix only carried
 * `hillshade.{accentColor,illuminationAnchor}` into the schema, not that trio.
 *
 * Orphans (⚪, declared in schema, 0 consumer) are locked as schema-ACCEPTED +
 * it.todo: ANO-040 fallbackUrl, ANO-041 encoding (top-level).
 * ⚠️ The original anomaly register is **ARCHIVED**, hence frozen. The path
 * cited here until 30/07/2026 (`travail/rapports/…`) was DEAD: the register
 * had moved without this reference following. The four anomalies' live
 * state is now the table above, kept current by the locks themselves — a
 * frozen file cannot serve as source of truth to a guard that, itself, runs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";

import { normalizeTilesArray } from "../../src/kernel/basemaps/providers.js";
import { buildHillshadeSourceSpec } from "../../src/kernel/basemaps/hillshade.js";
import { buildWmsUrl } from "../../src/kernel/basemaps/wmts-resolver.js";
import {
    activateTerrain,
    _resetTerrainStateForTesting,
} from "../../src/kernel/basemaps/terrain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/basemaps.schema.json"), "utf8")
);
delete schema.$id;
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

/** Wrap a single basemap entry into a full basemaps.json document for validation. */
const doc = (entry) => ({ basemaps: { x: { id: "x", ...entry } } });

describe("config B4 — basemaps @anomaly locks (read by code, rejected by schema)", () => {
    it("sanity: a schema-valid basemap entry passes", () => {
        expect(validate(doc({ type: "tile", url: "https://t.io/{z}/{x}/{y}.png" }))).toBe(true);
    });

    // ── ANO-042 apiKey / apiKeyRequired ───────────────────────────────────────
    describe("@anomaly ANO-042 — basemaps[].apiKey / apiKeyRequired", () => {
        it("live: normalizeTilesArray injects apiKey into a {apikey} url", () => {
            expect(
                normalizeTilesArray({ url: "https://t.io/{z}?k={apikey}", apiKey: "K" })[0]
            ).toBe("https://t.io/{z}?k=K");
        });
        it("live: apiKeyRequired without a key disables the basemap (empty tiles)", () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(
                normalizeTilesArray({ url: "https://t.io/{z}?k={apikey}", apiKeyRequired: true })
            ).toEqual([]);
        });
        it("schema: apiKey is rejected (inconfigurable)", () => {
            expect(validate(doc({ apiKey: "K" }))).toBe(false);
        });
        it("schema: apiKeyRequired is rejected (inconfigurable)", () => {
            expect(validate(doc({ apiKeyRequired: true }))).toBe(false);
        });
    });

    // ── ANO-043 top-level demUrl / demEncoding / demMaxZoom ────────────────────
    describe("@anomaly ANO-043 — basemaps[].demUrl/demEncoding/demMaxZoom (top-level)", () => {
        it("live: buildHillshadeSourceSpec falls back to top-level dem* fields", () => {
            const spec = buildHillshadeSourceSpec({
                demUrl: "https://d.io/x.png",
                demEncoding: "mapbox",
                demMaxZoom: 9,
            });
            expect(spec).toMatchObject({
                tiles: ["https://d.io/x.png"],
                encoding: "mapbox",
                maxzoom: 9,
            });
        });
        it("schema: top-level demUrl is rejected (canonical is hillshade.*)", () => {
            expect(validate(doc({ demUrl: "https://d.io/x.png" }))).toBe(false);
        });
    });

    // ── ANO-044 terrain.demMaxZoom ─────────────────────────────────────────────
    describe("@anomaly ANO-044 — basemaps[].terrain.demMaxZoom", () => {
        afterEach(() => _resetTerrainStateForTesting());
        it("live: activateTerrain reads terrain.demMaxZoom into the raster-dem maxzoom", () => {
            const map = {
                getSource: vi.fn(() => undefined),
                addSource: vi.fn(),
                setTerrain: vi.fn(),
                easeTo: vi.fn(),
                on: vi.fn(),
            };
            activateTerrain(
                map,
                { enabled: true, demUrl: "https://d.io/x.png", demMaxZoom: 11 },
                "k"
            );
            expect(map.addSource).toHaveBeenCalledWith(
                "terrain-dem",
                expect.objectContaining({ maxzoom: 11 })
            );
        });
        it("schema: terrain.demMaxZoom is now ACCEPTED — ANO-044 résolue", () => {
            // This lock expected `false`: the key was read by `terrain.ts`
            // and absent from the hardened schema, hence unconfigurable.
            // `b7785b56` (class ④ "live, well addressed, UNGUARDED") carried
            // it into the schema — 397 → 404 properties. The no-mapping is
            // closed, and the lock is what follows, not the schema that retreats.
            expect(
                validate(
                    doc({ terrain: { enabled: true, demUrl: "https://d.io/x", demMaxZoom: 11 } })
                )
            ).toBe(true);
        });
    });

    // ── ANO-045 wms.crs / styles / tileSize ────────────────────────────────────
    describe("@anomaly ANO-045 — basemaps[].wms.crs / styles / tileSize", () => {
        it("live: buildWmsUrl reads wms.crs / styles / tileSize", () => {
            const url = buildWmsUrl({
                wms: {
                    url: "https://w.io/ows",
                    layers: "a",
                    crs: "EPSG:4326",
                    styles: "s",
                    tileSize: 512,
                },
            });
            expect(url).toContain("CRS=EPSG%3A4326");
            expect(url).toContain("STYLES=s");
            expect(url).toContain("WIDTH=512");
        });
        it("schema: wms.crs is now ACCEPTED — ANO-045 résolue", () => {
            // Same flip as ANO-044: `wms.{crs,styles,tileSize}` are read by
            // `wmts-resolver.ts` and were carried into the schema by `b7785b56`.
            expect(validate(doc({ type: "wms", wms: { crs: "EPSG:4326" } }))).toBe(true);
        });
    });

    // ── Orphans (declared in schema, 0 core consumer) → schema-accepted + todo ──
    describe("@anomaly orphans (schema-accepted, no consumer)", () => {
        it("ANO-040 fallbackUrl: still schema-accepted (configurable, but inert)", () => {
            expect(
                validate(doc({ type: "tile", url: "https://t.io", fallbackUrl: "https://f.io" }))
            ).toBe(true);
        });
        it("ANO-041 encoding (top-level): still schema-accepted (configurable, but inert)", () => {
            expect(validate(doc({ type: "tile", url: "https://t.io", encoding: "png" }))).toBe(
                true
            );
        });
        it.todo("ANO-040 fallbackUrl — 0 consumer (grep=0): wire raster fallback or remove");
        it.todo(
            "ANO-041 encoding (top-level) — 0 consumer: remove (only hillshade/terrain demEncoding read)"
        );
    });
});

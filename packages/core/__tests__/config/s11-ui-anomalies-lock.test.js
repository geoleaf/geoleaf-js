/**
 * Config-contract Phase C / C2 — B3 ui.json anomalies (regression-lock).
 *
 * ANO-034→037 — RESOLVED. Three `ui.*` keys read by the code are now ADDED
 * to the `ui.json` schema (live read + schema-accepted); the 4th (ANO-037)
 * was a duplicate, deleted.
 *
 *   ANO-035 ui.showShareButton   → MIGRÉ modules.share.enabled (capacité in-core share, S12)
 *   ANO-036 ui.interactiveShapes → ajoutée au schéma (live: lecteur geolocation capability)
 *   ANO-037 ui.scaleType         → SUPPRIMÉE (doublon `ui/scale-control` retiré ; keeper =
 *                                  `scaleConfig` + `map/scale-control`)
 *
 * Orphans ANO-038/039 (pageSize / virtualScrolling) migrated to modules.table
 * (plugin-table, extraction roadmap table S4). Plugin-consumed flags are it.todo here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";

// ShareModule → capabilities/permalink/share/lifecycle → share-modal → share-qr
// dynamically imports `qrcode-generator`, absent from this worktree's symlinked
// node_modules (known ENV gap). ShareModule only needs ShareLifecycle — mock it.
vi.mock("../../src/capabilities/permalink/share/lifecycle.js", () => ({
    ShareLifecycle: { init: vi.fn(), _reset: vi.fn() },
}));

import { ShareModule } from "../../src/capabilities/permalink/share/module.js";

// Compile the hardened ui schema (strip $id to avoid ref registration noise).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const uiSchema = JSON.parse(readFileSync(resolve(ROOT, "profiles/schemas/ui.schema.json"), "utf8"));
delete uiSchema.$id;
const validateUi = new Ajv({ allErrors: true, strict: false }).compile(uiSchema);

describe("config B3 — ui.* flags (live read + schema-accepted ; ANO-034/036 résolus, ANO-035 migré modules.share, ANO-037 supprimé)", () => {
    it("sanity: a schema-valid ui key passes (theme)", () => {
        expect(validateUi({ ui: { theme: "dark" } })).toBe(true);
    });

    // ── ANO-035 ui.showShareButton → modules.permalink.share.enabled (share merged into permalink) ──
    describe("@anomaly ANO-035 — ui.showShareButton → modules.permalink.share.enabled (S13 F7)", () => {
        it("live: ShareModule binds its mobile icon to profileKey 'modules.permalink.share.enabled' (default visible)", () => {
            const icon = new ShareModule().ui.mobileIcon;
            expect(icon.profileKey).toBe("modules.permalink.share.enabled");
            expect(icon.defaultVisible).toBe(true);
        });
        it("schema: ui.showShareButton is now REJECTED (migré → modules.permalink.share, S13)", () => {
            expect(validateUi({ ui: { showShareButton: true } })).toBe(false);
        });
    });

    // ── ANO-036 ui.interactiveShapes ──────────────────────────────────────────
    describe("@anomaly ANO-036 — ui.interactiveShapes", () => {
        // Probe re-anchored (KERNEL S6). The former live leg drove
        // `GeoJSONStyleResolver.buildLayerOptions({}).style({})`, purged that sprint as
        // dead code (no production caller). The surviving reader is `_updateGeoMarkers`
        // in the geolocation capability — a module-private function that needs the full
        // capability harness (navigator.geolocation + map adapter + ~10 hoisted mocks),
        // which cannot live in this file without leaking into the other anomaly blocks.
        // So the lock keeps what it is actually for — proving the schema key still HAS a
        // reader — as a source assertion; the runtime propagation of the flag is asserted
        // in __tests__/capabilities/geolocation/geolocation.test.js.
        it("live: the geolocation capability reads ui.interactiveShapes", () => {
            const src = readFileSync(
                resolve(ROOT, "packages/core/src/capabilities/geolocation/geolocation.ts"),
                "utf8"
            );
            // Tolerate the house `_Config.get?.<T>(...)` call form (S6 cast unification)
            // as well as a bare `.get(...)` — both still prove the key has a reader.
            expect(src).toMatch(/\.get(?:\?\.)?(?:<[^>]*>)?\(\s*"ui\.interactiveShapes"/);
        });
        it("schema: ui.interactiveShapes is now ACCEPTED (ANO-036 résolu — Archi S3)", () => {
            expect(validateUi({ ui: { interactiveShapes: true } })).toBe(true);
        });
    });

    // ── ui.permalink → migrated to modules.permalink (in-core permalink capability) ──
    describe("@anomaly — ui.permalink migré → modules.permalink (S13)", () => {
        it("schema: ui.permalink is now REJECTED (migré → modules.permalink, S13)", () => {
            expect(validateUi({ ui: { permalink: { enabled: true, mode: "hash" } } })).toBe(false);
        });
    });

    // ── ANO-037 RESOLVED — the `ui/scale-control` duplicate
    //    (GeoLeaf.UI.ScaleControl, reader of `ui.scaleType`) was DELETED.
    //    The active scale control is `map/scale-control`, driven by
    //    `scaleConfig` (already in the schema). `ui.scaleType` is no longer
    //    a contract key (zero legacy).
    it("ANO-037 résolu : ui.scaleType n'est plus une clé du contrat (rejetée comme inconnue)", () => {
        expect(validateUi({ ui: { scaleType: "numeric" } })).toBe(false);
    });

    // ── Plugin-consumed flags (decision: tests live in the plugin packages) ───
    it.todo(
        "ui.showCacheButton — consumed by plugin-storage (button-control.ts:43); test in plugin-storage"
    );
    it.todo(
        "ui.showCredentialButton — consumed by plugin-connector (credential-button.ts:82); test in plugin-connector"
    );
    it.todo(
        "ui.showEditor — consumed by plugin-editor (config.ts:140, alias of modules.editor.showButton); test in plugin-editor"
    );
});

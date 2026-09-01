// @ts-check
// BROWSER VERIFICATION — family E (permalink), scenarios E.1, E.2, E.4 of the
// internal browser-verification table.
//
// These scenarios take data paths only a real browser executes: `btoa`/`atob`,
// `TextEncoder`/`TextDecoder`, and the URL sync debounced on `moveend` —
// happy-dom has neither faithfully.
//
// ⚠️ E.3 (the `modules.permalink.fields` whitelist on the compact path) is NOT
// here: pre-flight 2026-07-24 — no shipped profile restricts `fields` (tourism
// exposes `{enabled, mode}`), so the exclusion has nothing to exclude on the
// deploy. And it is a PURE serialisation decision, which happy-dom settles: it
// is already covered at the unit tier (`__tests__/ui/permalink.test.js`
// "omits layers when 'layers' not in fields",
// `__tests__/security/permalink-injection.test.js` "truncates text fields from
// compact mode"). Housing it here would have been a subject-less test,
// duplicate of a green unit test.
//
// STABLE anchors (measured, not guessed): the `GeoLeaf.Permalink.getState()`
// API, the real hash, and the native maplibregl centre. No pixel assertion.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// CJK filter long enough for the verbose serialisation to exceed the
// auto-compaction threshold (200 characters,
// `permalink-url.ts:AUTO_COMPACT_THRESHOLD`): what forces the `#gl=<base64>`
// path, hence `_encodeCompact`, hence the former `btoa` that threw beyond
// latin-1.
const CJK_FILTER = "東京タワー・スカイツリー・浅草寺・明治神宮・皇居・上野公園".repeat(4);

/** Decodes a compact `#gl=<base64>` hash as UTF-8 — the read a post-fix link expects. */
function decodeCompactHash(hash) {
    const m = hash.match(/[#&]gl=([^&]+)/);
    if (!m) return null;
    const bin = atob(decodeURIComponent(m[1]));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

test.describe("VN — permalink et données (E.1, E.2, E.4)", () => {
    // ── E.1 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: `_encodeCompact` was `btoa(JSON.stringify(state))`, and
    // `btoa` THROWS on any code point > 255 — a CJK or Cyrillic filter made
    // the encoding fail. Where it bit: `startSync._doWrite` **swallows** the
    // throw (`permalink-sync.ts`), so the URL stopped following the map
    // SILENTLY.
    //
    // The test reproduces exactly that path: long CJK filter (⇒ compact) +
    // move, then it DECODES the written compact to prove the CJK filter
    // survived in it — a throwing `btoa` produces nothing to decode, and the
    // URL would stay frozen. Asserting only "the URL changed" would not
    // suffice: the non-latin-1 content must be proven encoded.
    test("E.1 — un filtre CJK n'empêche pas l'URL compacte de suivre la carte", async ({
        page,
    }) => {
        await page.goto(
            `/#gl_filter=${encodeURIComponent(CJK_FILTER)}&gl_lat=-48&gl_lng=-58&gl_zoom=8`
        );
        await bootMap(page);
        await waitMapLoaded(page);

        // ⚠️ Wait for the permalink RESTORE to finish before moving. The
        // restore is deferred to the boot's `geoleaf:theme:applied` and
        // re-applies the URL's view (zoom 8); leaving too early gets the move
        // overwritten by that late restore — measured, it is what made this
        // test intermittent (captured zoom = 8 instead of 6). The CJK filter's
        // re-injection into the search field is the signal the restore is
        // done.
        await page.waitForFunction(
            () =>
                document
                    .querySelector('[data-gl-filter-id="searchText"] input[type="text"]')
                    ?.value?.includes("東京"),
            null,
            { timeout: 20000 }
        );

        const console_ = captureConsole(page);
        await page.evaluate(() => window.GeoLeaf.Core.getMap().setView({ lat: -45, lng: -60 }, 6));

        // The write is debounced (~400 ms) AND the boot itself rewrites the URL
        // in compact form: waiting for "the hash changed" does not suffice —
        // that condition is met by the boot's re-compaction, before the MOVE
        // is serialised. So the real condition is awaited: the moved zoom (6)
        // present in the decoded compact. Which is also what proves the
        // encoding happened — a throwing `btoa` would never produce a
        // decodable compact carrying the new zoom.
        await expect
            .poll(
                async () => {
                    const hash = await page.evaluate(() => window.location.hash);
                    return decodeCompactHash(hash)?.zoom ?? null;
                },
                {
                    timeout: 8000,
                    message:
                        "l'URL compacte n'a pas capté le déplacement (btoa a-t-il jeté sur le CJK ?)",
                }
            )
            .toBe(6);

        const hash = await page.evaluate(() => window.location.hash);
        expect(hash, "le chemin compact n'a pas été pris").toMatch(/[#&]gl=/);
        const decoded = decodeCompactHash(hash);
        expect(decoded.filter, "le filtre CJK a été perdu à l'encodage").toContain("東京");

        expect(
            console_.errors,
            `erreurs avalées pendant la sync : ${console_.errors.join(" | ")}`
        ).toEqual([]);
    });

    // ── E.2 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: links emitted BEFORE the fix carry latin-1 base64
    // (`btoa(JSON.stringify(...))`). `_decodeCompact` accepts both encodings —
    // replacing the decoder would have broken every permalink already shared.
    // The discrimination is decisive: UTF-8 decoding in `fatal` mode throws on
    // an isolated high byte (`é` = `0xE9`, invalid as lone UTF-8) and falls
    // back to the latin-1 read.
    //
    // So a LEGACY link is forged by hand — `Buffer(..., "latin1")`, what
    // `btoa` did at the time — and verified to restore identically.
    test("E.2 — un lien compact legacy (café en latin-1) se restaure à l'identique", async ({
        page,
    }) => {
        // The era's btoa(JSON.stringify(state)) = base64 of the LATIN-1 bytes.
        const legacyState = { lat: -48, lng: -58, zoom: 8, filter: "café" };
        const legacyPayload = Buffer.from(JSON.stringify(legacyState), "latin1").toString("base64");

        await page.goto(`/#gl=${legacyPayload}`);
        await bootMap(page);
        await waitMapLoaded(page);

        const state = await page.evaluate(() => window.GeoLeaf.Permalink.getState());
        expect(state, "aucun état restauré depuis le lien legacy").not.toBeNull();
        expect(state.filter, "le é latin-1 n'a pas été décodé (mojibake ?)").toBe("café");
        expect(state.lat).toBe(-48);
        expect(state.zoom).toBe(8);
    });

    // ── E.4 🟠 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: `params.get("gl_lat")` returns `""` for a
    // present-but-empty `gl_lat=`, and `Number("")` is `0`, which slipped
    // under the `=== null` guard and recentred the map on 0,0 (off the Gulf of
    // Guinea). `_parseRequiredNumber` now rejects the empty or blank string.
    //
    // Observable: an empty `gl_lat=` must leave `getState()` null (no view to
    // restore) AND the map on the profile's view — above all NOT on 0,0.
    test("E.4 — une URL avec gl_lat= vide ouvre sur la vue du profil, pas sur 0,0", async ({
        page,
    }) => {
        await page.goto("/#gl_lat=&gl_lng=&gl_zoom=");
        await bootMap(page);
        await waitMapLoaded(page);

        const state = await page.evaluate(() => window.GeoLeaf.Permalink.getState());
        expect(state, "un gl_lat vide n'aurait pas dû produire d'état de vue").toBeNull();

        const center = await page.evaluate(() => {
            const c = window.GeoLeaf.Core.getMap().getNativeMap().getCenter();
            return { lng: c.lng, lat: c.lat };
        });
        // The tourism profile's view is in the south-west hemisphere
        // (~-40, -63); 0,0 is the original symptom. The origin's neighbourhood
        // is explicitly rejected.
        expect(
            Math.abs(center.lat) + Math.abs(center.lng),
            `la carte a ouvert près de 0,0 (${center.lat}, ${center.lng}) — Number("") = 0 ?`
        ).toBeGreaterThan(1);
    });
});

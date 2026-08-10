// @ts-check
// VÉRIFICATION NAVIGATEUR — famille E (permalink), scénarios E.1, E.2, E.4 de
// `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` (backlog R.7b).
//
// Ces scénarios empruntent des chemins de données que seul un vrai navigateur exécute :
// `btoa`/`atob`, `TextEncoder`/`TextDecoder`, et la synchronisation d'URL débouncée sur
// `moveend` — happy-dom n'a ni l'un ni l'autre de façon fidèle.
//
// ⚠️ E.3 (liste blanche `modules.permalink.fields` sur le chemin compact) n'est PAS ici :
// pré-vol 24/07 — aucun profil livré ne restreint `fields` (tourism expose `{enabled, mode}`),
// donc l'exclusion n'a rien à exclure sur le déployé. Et c'est une décision de PURE
// sérialisation, que happy-dom tranche : elle est déjà couverte au tier unitaire
// (`__tests__/ui/permalink.test.js` « omits layers when 'layers' not in fields »,
// `__tests__/security/permalink-injection.test.js` « truncates text fields from compact
// mode »). La ranger ici aurait été un test sans objet, doublon d'un test unitaire vert.
//
// Ancrages STABLES (mesurés, pas devinés) : l'API `GeoLeaf.Permalink.getState()`, le hash
// réel, et le centre natif maplibregl. Pas d'assertion pixel.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// Filtre CJK assez long pour que la sérialisation verbeuse dépasse le seuil d'auto-compaction
// (200 caractères, `permalink-url.ts:AUTO_COMPACT_THRESHOLD`) : c'est ce qui force le chemin
// `#gl=<base64>`, donc `_encodeCompact`, donc l'ex-`btoa` qui jetait au-delà du latin-1.
const CJK_FILTER = "東京タワー・スカイツリー・浅草寺・明治神宮・皇居・上野公園".repeat(4);

/** Décode un hash compact `#gl=<base64>` en UTF-8 — la lecture qu'un lien post-B.43 attend. */
function decodeCompactHash(hash) {
    const m = hash.match(/[#&]gl=([^&]+)/);
    if (!m) return null;
    const bin = atob(decodeURIComponent(m[1]));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

test.describe("VN — permalink et données (E.1, E.2, E.4)", () => {
    // ── E.1 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve B.43 : `_encodeCompact` était `btoa(JSON.stringify(state))`, et `btoa`
    // JETTE sur tout point de code > 255 — un filtre en CJK ou cyrillique faisait échouer
    // l'encodage. Où ça mordait : `startSync._doWrite` **avale** le throw
    // (`permalink-sync.ts`), donc l'URL cessait de suivre la carte EN SILENCE.
    //
    // Le test reproduit exactement ce chemin : filtre CJK long (⇒ compact) + déplacement, puis
    // il DÉCODE le compact écrit pour prouver que le filtre CJK y a survécu — un `btoa` qui
    // jette ne produit rien à décoder, et l'URL resterait figée. Asserter seulement « l'URL a
    // changé » ne suffirait pas : il faut prouver que le contenu non-latin-1 a été encodé.
    test("E.1 — un filtre CJK n'empêche pas l'URL compacte de suivre la carte", async ({
        page,
    }) => {
        await page.goto(
            `/#gl_filter=${encodeURIComponent(CJK_FILTER)}&gl_lat=-48&gl_lng=-58&gl_zoom=8`
        );
        await bootMap(page);
        await waitMapLoaded(page);

        // ⚠️ Attendre que le RESTORE permalink soit terminé avant de bouger. Le restore est
        // différé au `geoleaf:theme:applied` du boot et ré-applique la vue de l'URL (zoom 8) ;
        // s'en aller trop tôt fait écraser le déplacement par ce restore tardif — mesuré, c'est
        // ce qui rendait ce test intermittent (zoom capté = 8 au lieu de 6). La réinjection du
        // filtre CJK dans le champ de recherche est le signal que le restore a fini.
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

        // L'écriture est débouncée (~400 ms) ET le boot ré-écrit lui-même l'URL en compact :
        // attendre « le hash a changé » ne suffit pas — cette condition est satisfaite par la
        // ré-compaction du boot, avant que le DÉPLACEMENT soit sérialisé. On attend donc la
        // vraie condition : le zoom déplacé (6) présent dans le compact décodé. C'est aussi ce
        // qui prouve que l'encodage a bien eu lieu — un `btoa` qui jette ne produirait jamais
        // un compact décodable portant le nouveau zoom.
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
    // Contre-épreuve B.43 : les liens émis AVANT le correctif portent un base64 latin-1
    // (`btoa(JSON.stringify(...))`). `_decodeCompact` accepte les deux encodages — remplacer
    // le décodeur aurait cassé tout permalink déjà partagé. La discrimination est décisive :
    // le décodage UTF-8 en mode `fatal` jette sur un octet haut isolé (`é` = `0xE9`, invalide
    // en UTF-8 seul) et retombe sur la lecture latin-1.
    //
    // On forge donc un lien LEGACY à la main — `Buffer(..., "latin1")`, ce que faisait `btoa`
    // à l'époque — et on vérifie qu'il se restaure à l'identique.
    test("E.2 — un lien compact legacy (café en latin-1) se restaure à l'identique", async ({
        page,
    }) => {
        // btoa(JSON.stringify(state)) de l'époque = base64 des octets LATIN-1.
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
    // Contre-épreuve B.37 : `params.get("gl_lat")` rend `""` pour un `gl_lat=` présent-mais-
    // vide, et `Number("")` vaut `0`, ce qui passait sous la garde `=== null` et recentrait la
    // carte sur 0,0 (au large du golfe de Guinée). `_parseRequiredNumber` rejette désormais la
    // chaîne vide ou blanche.
    //
    // Observable : un `gl_lat=` vide doit laisser `getState()` null (aucune vue à restaurer)
    // ET la carte sur la vue du profil — surtout PAS sur 0,0.
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
        // La vue du profil tourism est dans l'hémisphère sud-ouest (~-40, -63) ; 0,0 est le
        // symptôme d'origine. On rejette explicitement le voisinage de l'origine.
        expect(
            Math.abs(center.lat) + Math.abs(center.lng),
            `la carte a ouvert près de 0,0 (${center.lat}, ${center.lng}) — Number("") = 0 ?`
        ).toBeGreaterThan(1);
    });
});

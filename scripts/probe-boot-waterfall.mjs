/**
 * probe-boot-waterfall — what the first load's WATERFALL really costs.
 *
 * Role: produce the number the CHANGELOG publishes for the boot instruction. That
 * number already existed — 5 values read on 2026-08-08 — but it came from an AD HOC
 * probe never committed. A number that cannot be re-measured does not expire: it
 * fossilizes. Hence this file.
 *
 * 🛑 NO COUNT IS WRITTEN HERE, and that is deliberate. The original reading announced
 * "4 chunks"; measured on 2026-08-08 on the deploy output, the static closure of
 * `dist/geoleaf.esm.js` counts **3** (core-utils, geojson, ui-controls), for 5 chunks
 * on disk of which 2 lazy. The `scripts/lib/boot-assets.cjs` comment announced "6 of
 * which 4 eager" for its part: its NAMES are right, its two NUMBERS are wrong. Three
 * sources, three numbers, one disk — the copied-counts class. Everything here derives
 * from the page.
 *
 * What the probe ASSERTS (and can therefore make it go red):
 *   W-01  no request to the 3 third-party boot origins (the self-hosting gain)
 *   W-02  every preloaded chunk is actually used — otherwise we preload dead weight
 *   W-03  every eager chunk STARTS before the entry is received — the proof of the
 *         `modulepreload`: "in parallel with the entry, not after it"
 *   W-04  the map is painted — otherwise we would measure a dead page's waterfall
 *   W-05  no HTTP response ≥ 400
 *   W-06  the preloaded set EQUALS the entry's static closure, re-derived from the
 *         bundle itself. The only one able to see an eager chunk FORGOTTEN by the
 *         preload — verified by mutation on 2026-08-08: on a removed `modulepreload`,
 *         W-06 reddens naming the chunk while W-02 and W-03 stay GREEN.
 *   W-07  the reveal mark `geoleaf:initApp:ready` EXISTS. Without it, the whole
 *         attribution block below would render "0 layers on the path" — i.e. the most
 *         flattering verdict possible — having measured nothing.
 *
 * ## THE REVEAL ATTRIBUTION — added on 2026-08-18, and it is a prerequisite
 *
 * The probe measured the boot waterfall: third-party origins, preloaded chunks,
 * static closure, DCL, load. **It did NOT measure the reveal path**, which waits for
 * layer DATA and comes after. One could thus make it say a boot got better without it
 * being able to say whether the reveal had moved — and the work that wants heavy
 * layers off that path would have announced a gain nothing attributes. A number that
 * cannot be re-measured does not expire, it fossilizes.
 *
 * 🛑 **The reveal REASON is reported before any number, and it is no ornament.**
 * `init-reveal.ts` has three paths: `theme applied, layers loaded`, `layers loaded
 * (no default theme)`, and `safety timeout 5s`. **The third invalidates any
 * attribution** — if the reveal left on the safety net, what is measured is the net,
 * not the layers, and "taking a layer off the path" would change nothing at all. A
 * probe rendering the same table in all three cases would conclude the same thing
 * three times from three different situations.
 *
 * What the attribution reports, without asserting it: the layer-DATA responses
 * finished BEFORE the reveal mark, sorted by finish time. **The last one is the
 * critical path's blocker**; those finishing after are already off the path and
 * removing them would gain nothing. Exactly the list needed to choose, instead of
 * assuming.
 *
 * What it REPORTS without asserting: DOMContentLoaded, load, request count, distinct
 * hosts, opened connections, serialization waves. These values vary from run to run;
 * freezing them into thresholds would make an unstable guard, exactly what an
 * unstable guard has already cost.
 *
 * Usage:
 *   node scripts/probe-boot-waterfall.mjs
 *   GEOLEAF_PROBE_URL=https://demo.geoleaf.local.test/ node scripts/probe-boot-waterfall.mjs
 *
 * ⚠️ Starts no server: targets the permanently served nginx vhosts. Regenerate the
 * deploy output BEFORE, in three steps (`npx turbo run build`,
 * `npm run build:deploy:all`, `node scripts/build-deploy-coverage.cjs`) — without the
 * first, you measure the old bundle.
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";

const URL_CIBLE = process.env.GEOLEAF_PROBE_URL || "https://demo.full.geoleaf.local.test/";

/** The 3 origins self-hosting removed from boot. Not "everything non-same-origin":
 *  remote tiles and datasets are legitimate runtime fetches. Same criterion as
 *  `probe-csp-origins.mjs`, deliberately — two probes, one criterion. */
const BOOT_ORIGINS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];

/** @param {number|null|undefined} v */
const ms0 = (v) => (typeof v === "number" ? `${v.toFixed(0)} ms` : "n/d");

const resultats = [];
/** @param {boolean} ok @param {string} nom @param {string} detail */
function check(ok, nom, detail) {
    resultats.push({ ok, nom, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${nom} — ${detail}`);
}

const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    // The first load is the measurement's object: an active SW would serve cache and
    // render a waterfall that is nobody's.
    serviceWorkers: "block",
});
const page = await ctx.newPage();

const requetes = [];
const echecsHttp = [];
page.on("request", (r) => requetes.push(r.url()));
page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon"))
        echecsHttp.push(`${r.status()} ${r.url()}`);
});

// The reveal reason is exposed nowhere else than in that message: `init-reveal.ts`
// passes it to `AppLog.info`, never to an event nor a mark. Reading it here is the
// only way to tell a LAYER-DRIVEN reveal from one due to the 5 s net.
/** @type {string|null} */
let raisonReveal = null;
page.on("console", (m) => {
    const t = m.text();
    const i = t.indexOf("Application ready: ");
    if (i !== -1 && raisonReveal === null)
        raisonReveal = t.slice(i + "Application ready: ".length).trim();
});

console.log(`\n── probe-boot-waterfall — ${URL_CIBLE} ──\n`);
await page.goto(URL_CIBLE, { waitUntil: "load", timeout: 45000 });
// Let the waterfall finish: the reveal and the last layer batches leave after
// `load`. 6 s is the same budget as `probe-csp-origins.mjs`.
await page.waitForTimeout(6000);

const releve = await page.evaluate(() => {
    // Timing entries are typed `PerformanceEntry` by the DOM lib, while the two real
    // subtypes carry everything read here. The cast is LOCAL and documented: widening
    // the tooling tsconfig for this would mean loosening the typing of 200 files for
    // two lines.
    const nav = /** @type {PerformanceNavigationTiming} */ (
        performance.getEntriesByType("navigation")[0] || {}
    );
    const res = /** @type {PerformanceResourceTiming[]} */ (
        performance.getEntriesByType("resource")
    ).map((r) => ({
        url: r.name,
        debut: r.startTime,
        fin: r.responseEnd,
        connexion: r.connectEnd > r.connectStart,
        protocole: r.nextHopProtocol || "",
        // `transferSize` is 0 on a response served from memory cache;
        // `encodedBodySize` stays right in that case. Taking the max of both avoids
        // rendering "0 bytes" for a heavy layer and wrongly filing it as negligible.
        octets: Math.max(r.transferSize || 0, r.encodedBodySize || 0),
    }));
    const marks = performance
        .getEntriesByType("mark")
        .filter((m) => m.name.startsWith("geoleaf:"))
        .map((m) => ({ nom: m.name, t: m.startTime }));
    return {
        dcl: nav.domContentLoadedEventEnd ?? null,
        load: nav.loadEventEnd ?? null,
        preloads: [...document.querySelectorAll('link[rel="modulepreload"][href]')].map(
            (l) => new URL(l.getAttribute("href"), location.href).pathname
        ),
        res,
        marks,
        carte: (() => {
            const el = document.querySelector("#geoleaf-map");
            return !!el && el.querySelectorAll("canvas").length > 0;
        })(),
    };
});

const chemin = (u) => {
    try {
        return new URL(u).pathname;
    } catch {
        return u;
    }
};
const entree = releve.res.find((r) => chemin(r.url).endsWith("/dist/geoleaf.esm.js"));
const chunksCharges = releve.res.filter((r) => chemin(r.url).includes("/dist/chunks/"));

// ── Assertions ───────────────────────────────────────────────────────────────────
const tierces = requetes.filter((u) => BOOT_ORIGINS.some((o) => u.includes(o)));
check(
    tierces.length === 0,
    "W-01 origines de boot tierces",
    tierces.length === 0
        ? "0 (unpkg / fonts.googleapis / fonts.gstatic)"
        : `${tierces.length} → ${tierces.join(", ")}`
);

const preloadsInutiles = releve.preloads.filter(
    (p) => !chunksCharges.some((c) => chemin(c.url) === p)
);
check(
    releve.preloads.length > 0 && preloadsInutiles.length === 0,
    "W-02 chunks préchargés réellement utilisés",
    releve.preloads.length === 0
        ? "AUCUN modulepreload dans la page — la garde n'aurait rien gardé"
        : `${releve.preloads.length} préchargé(s), ${preloadsInutiles.length} inutilisé(s)${preloadsInutiles.length ? " → " + preloadsInutiles.join(", ") : ""}`
);

// 🛑 W-03 reddened at its FIRST execution, and for a just reason: its first wording
// targeted "every chunk under `dist/chunks/`", so it counted `offline-engine-entry`,
// which is LAZY. A lazy chunk starts after the entry — its definition, not a defect.
// Conflating it with an eager one rendered a perfectly false red, exactly what
// `probe-csp-origins.mjs` already paid once by counting tiles as third-party origins.
// The perimeter is therefore the PRELOADED set, and W-06 below verifies that set is
// the right one — otherwise W-03 would merely validate a list it was handed.
const preloadesCharges = chunksCharges.filter((c) => releve.preloads.includes(chemin(c.url)));
let detailW3 = "entrée introuvable dans le relevé";
let okW3 = false;
if (entree) {
    const tardifs = preloadesCharges.filter((c) => c.debut >= entree.fin);
    okW3 = preloadesCharges.length > 0 && tardifs.length === 0;
    detailW3 = `${preloadesCharges.length} chunk(s) eager, ${tardifs.length} démarré(s) APRÈS réception de l'entrée (${ms0(entree.fin)})${
        tardifs.length ? " → " + tardifs.map((t) => chemin(t.url).split("/").pop()).join(", ") : ""
    }`;
}
check(okW3, "W-03 chunks eager en parallèle de l'entrée", detailW3);

check(
    releve.carte,
    "W-04 carte peinte",
    releve.carte ? "canvas présent" : "AUCUN canvas — cascade d'une page morte"
);

// W-06 — is the preloaded set THE RIGHT one? Derived from the bundle itself, not the
// page: we re-download the entry and read its STATIC imports. The only one of the six
// assertions able to see an eager chunk FORGOTTEN by the `modulepreload` — the costly
// defect, since it is paid with a whole round trip and no other guard names it.
let okW6 = false;
let detailW6 = "entrée introuvable";
if (entree) {
    const src = await (await ctx.request.get(entree.url, { ignoreHTTPSErrors: true })).text();
    const statiques = new Set();
    const re = /\b(?:import|export)\b[^;]*?from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) {
        const spec = m[1] || m[2];
        if (spec && spec.startsWith("."))
            statiques.add(new URL(spec, new URL(entree.url)).pathname);
    }
    const manquants = [...statiques].filter((p) => !releve.preloads.includes(p));
    const enTrop = releve.preloads.filter((p) => !statiques.has(p));
    okW6 = statiques.size > 0 && manquants.length === 0 && enTrop.length === 0;
    detailW6 = `clôture statique de l'entrée = ${statiques.size}, préchargés = ${releve.preloads.length}${
        manquants.length ? ` · MANQUE ${manquants.join(", ")}` : ""
    }${enTrop.length ? ` · EN TROP ${enTrop.join(", ")}` : ""}`;
}
check(okW6, "W-06 préchargés = clôture statique de l'entrée", detailW6);
// W-07 — the reveal mark exists. Without it, the attribution block would render
// "0 layers on the critical path", i.e. the most flattering verdict possible, having
// read nothing.
check(
    releve.marks.some((m) => m.nom === "geoleaf:initApp:ready"),
    "W-07 marque de reveal présente",
    releve.marks.length
        ? `marques geoleaf: ${releve.marks.map((m) => m.nom).join(", ")}`
        : "AUCUNE marque `geoleaf:` — l'attribution du reveal serait un non-verdict"
);

check(
    echecsHttp.length === 0,
    "W-05 réponses HTTP ≥ 400",
    echecsHttp.length === 0 ? "0" : `${echecsHttp.length} → ${echecsHttp.join(" | ")}`
);

// ── Reading (unasserted — these values vary from run to run) ──────────────────────
// "Wave": a new wave starts as soon as a resource CANNOT have been discovered before
// the end of the previous one (its `startTime` ≥ the max `responseEnd` of the current
// wave). A SERIALIZATION measure, not a grouping by temporal proximity.
const parDebut = [...releve.res].sort((a, b) => a.debut - b.debut);
let vagues = 0;
let finVague = -1;
for (const r of parDebut) {
    if (r.debut >= finVague) {
        vagues++;
        finVague = r.fin;
    } else finVague = Math.max(finVague, r.fin);
}
const hotes = [
    ...new Set(
        releve.res.map((r) => {
            try {
                return new URL(r.url).host;
            } catch {
                return "?";
            }
        })
    ),
];
const ms = ms0;
// 🛑 EXACT match on the mark name, no more `includes("ready")`. The loose filter of
// before would have accepted any mark containing "ready" — hence could have attributed
// the reveal to a mark that is not one, all the more easily since the attribution
// table below takes it as its boundary.
const reveal = releve.marks.find((m) => m.nom === "geoleaf:initApp:ready");

console.log("\n  ── relevé (non asserté) ──");
console.log(`  DOMContentLoaded      : ${ms(releve.dcl)}`);
console.log(`  load                  : ${ms(releve.load)}`);
if (entree)
    console.log(
        `  entrée reçue à        : ${ms(entree.fin)} (protocole ${entree.protocole || "n/d"})`
    );
if (reveal) console.log(`  ${reveal.nom.padEnd(22)}: ${ms(reveal.t)}`);
console.log(`  requêtes              : ${requetes.length}`);
console.log(`  ressources chronométrées : ${releve.res.length}`);
// ⚠️ Counts the connections opened BY THE RESOURCES. The one the navigation itself
// opens is not here (it belongs to the `navigation` entry), and in h2 all same-origin
// reuses it: 0 thus reads "no EXTRA connection", not "no connection".
console.log(
    `  connexions ouvertes en plus de la navigation : ${releve.res.filter((r) => r.connexion).length}`
);
console.log(`  hôtes distincts       : ${hotes.length} → ${hotes.join(", ")}`);
console.log(`  vagues de sérialisation : ${vagues}`);
console.log(
    `  chunks eager mesurés  : ${chunksCharges.length} → ${chunksCharges.map((c) => chemin(c.url).split("/").pop()).join(", ") || "aucun"}`
);

// ── Reveal attribution ───────────────────────────────────────────────────────────
//
// The boundary is the `geoleaf:initApp:ready` mark. What finishes BEFORE it is on the
// path; what finishes after is not, and removing it would gain nothing.
console.log("\n  ── attribution du reveal (non assertée) ──");
console.log(`  raison du reveal      : ${raisonReveal ?? "NON CAPTURÉE"}`);
if (raisonReveal && raisonReveal.startsWith("safety timeout")) {
    console.log(
        "  🛑 Le reveal est parti sur le FILET DE SÉCURITÉ, pas sur les couches. Ce qui suit\n" +
            "     mesure le filet : aucun retrait de couche ne déplacerait cette date. Toute\n" +
            "     conclusion sur le chemin critique tirée de ce run serait fausse."
    );
}

// Layer data: what the profile serves under `layers/<id>/data/`. The criterion is the
// served PATH and not the extension — a style `.json` and a data `.json` share the
// same extension with opposite roles, and counting styles would inflate the critical
// path with one-kilobyte files.
const donneesCouche = releve.res.filter((r) => /\/layers\/[^/]+\/data\//.test(chemin(r.url)));
const nomCouche = (u) => chemin(u).split("/layers/")[1]?.split("/")[0] ?? chemin(u);
const ko = (o) => `${(o / 1024).toFixed(0)} Ko`;

if (!reveal) {
    console.log("  ⏭️  Pas de marque de reveal : aucune attribution possible (W-07 l'a dit).");
} else if (donneesCouche.length === 0) {
    console.log("  ⏭️  Aucune requête de donnée de couche sur ce profil — rien à attribuer.");
} else {
    const avant = donneesCouche.filter((r) => r.fin <= reveal.t).sort((a, b) => a.fin - b.fin);
    const apres = donneesCouche.filter((r) => r.fin > reveal.t);
    console.log(
        `  couches sur le chemin : ${avant.length} terminée(s) avant le reveal · ` +
            `${apres.length} après (déjà hors du chemin)`
    );
    for (const r of avant.slice(-6)) {
        console.log(
            `    ${ms(r.fin).padStart(8)}  ${ko(r.octets).padStart(8)}  ${nomCouche(r.url)}`
        );
    }
    const dernier = avant.at(-1);
    if (dernier) {
        console.log(
            `  ⟶ bloqueur du chemin critique : ${nomCouche(dernier.url)} — finit à ${ms(dernier.fin)}, ` +
                `soit ${ms(reveal.t - dernier.fin)} avant le reveal`
        );
        console.log(
            `     ⚠️ « Dernier arrivé » n'est pas « seul responsable » : les ${avant.length} sont sur le\n` +
                `        chemin, et retirer le dernier fait remonter l'avant-dernier. Le gain d'un retrait\n` +
                `        se RE-MESURE ici, il ne se déduit pas de ce tableau.`
        );
    }
    const poidsAvant = avant.reduce((n, r) => n + r.octets, 0);
    console.log(
        `  poids sur le chemin   : ${ko(poidsAvant)} sur ${ko(donneesCouche.reduce((n, r) => n + r.octets, 0))} au total`
    );
}

await ctx.close();
await browser.close();

const echecs = resultats.filter((r) => !r.ok).length;
console.log(
    `\n${echecs === 0 ? "✅" : "❌"} ${resultats.length - echecs}/${resultats.length} assertions\n`
);
process.exit(echecs === 0 ? 0 : 1);

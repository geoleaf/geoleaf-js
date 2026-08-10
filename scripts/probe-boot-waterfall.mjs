/**
 * probe-boot-waterfall — ce que la CASCADE du premier chargement coûte réellement.
 *
 * Rôle : produire le chiffre que le CHANGELOG publie pour la tâche 11.1 de
 * `roadmap_socle-init.md`. Ce chiffre existait déjà — 5 valeurs relevées le 08/08/2026 — mais
 * il venait d'une sonde AD HOC jamais commitée. Un chiffre qu'on ne peut pas re-mesurer ne se
 * périme pas : il se fossilise (mode d'échec n° 5 de `CLAUDE.md`). D'où ce fichier.
 *
 * 🛑 AUCUN DÉCOMPTE N'EST ÉCRIT ICI, et c'est délibéré. Le relevé d'origine annonçait
 * « 4 chunks » ; mesuré le 08/08/2026 sur le déployé, la clôture statique de
 * `dist/geoleaf.esm.js` en compte **3** (core-utils, geojson, ui-controls), pour 5 chunks sur
 * le disque dont 2 paresseux. Le commentaire de `scripts/lib/boot-assets.cjs` annonce de son
 * côté « 6 dont 4 eager » : ses NOMS sont justes, ses deux CHIFFRES sont faux. Trois sources,
 * trois nombres, un seul disque — c'est la classe B-43. Tout ici se dérive de la page.
 *
 * Ce que la sonde ASSERTE (et qui peut donc la faire rougir) :
 *   W-01  aucune requête vers les 3 origines de boot tierces (le gain de S5)
 *   W-02  tout chunk préchargé est réellement utilisé — sinon on précharge du poids mort
 *   W-03  tout chunk eager DÉMARRE avant que l'entrée ne soit reçue — la preuve du
 *         `modulepreload` de S3 : « en parallèle de l'entrée, pas après elle »
 *   W-04  la carte est peinte — sans quoi on mesurerait la cascade d'une page morte
 *   W-05  aucune réponse HTTP ≥ 400
 *   W-06  l'ensemble préchargé ÉGALE la clôture statique de l'entrée, re-dérivée du bundle
 *         lui-même. C'est la seule qui puisse voir un chunk eager OUBLIÉ du préchargement —
 *         vérifié par mutation le 08/08/2026 : sur un `modulepreload` retiré, W-06 rougit en
 *         nommant le chunk pendant que W-02 et W-03 restent VERTES.
 *
 * Ce qu'elle RAPPORTE sans l'asserter : DOMContentLoaded, load, nombre de requêtes, hôtes
 * distincts, connexions ouvertes, vagues de sérialisation. Ces valeurs varient d'un run à
 * l'autre ; les figer en seuil ferait une garde instable, exactement ce que B-176 a coûté.
 *
 * Usage :
 *   node scripts/probe-boot-waterfall.mjs
 *   GEOLEAF_PROBE_URL=https://demo.geoleaf.local.test/ node scripts/probe-boot-waterfall.mjs
 *
 * ⚠️ Ne démarre aucun serveur : vise les vhosts nginx servis en permanence. Régénérer le
 * déployé AVANT, en trois temps (`npx turbo run build`, `npm run build:deploy:all`,
 * `node scripts/build-deploy-coverage.cjs`) — sans le premier, on mesure l'ancien bundle.
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";

const URL_CIBLE = process.env.GEOLEAF_PROBE_URL || "https://demo.full.geoleaf.local.test/";

/** Les 3 origines que S5 a retirées du boot. Pas « tout ce qui n'est pas same-origin » : les
 *  tuiles et jeux de données distants sont des fetchs de runtime légitimes. Même critère que
 *  `probe-csp-origins.mjs`, délibérément — deux sondes, un seul critère. */
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
    // Le premier chargement est l'objet de la mesure : un SW actif servirait du cache et
    // rendrait une cascade qui n'est celle de personne.
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

console.log(`\n── probe-boot-waterfall — ${URL_CIBLE} ──\n`);
await page.goto(URL_CIBLE, { waitUntil: "load", timeout: 45000 });
// Laisser la cascade se terminer : le reveal et les derniers lots de couches partent après
// `load`. 6 s est le même budget que `probe-csp-origins.mjs`.
await page.waitForTimeout(6000);

const releve = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource").map((r) => ({
        url: r.name,
        debut: r.startTime,
        fin: r.responseEnd,
        connexion: r.connectEnd > r.connectStart,
        protocole: r.nextHopProtocol || "",
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

// 🛑 W-03 a rougi à sa PREMIÈRE exécution, et pour un motif juste : sa première rédaction
// visait « tout chunk sous `dist/chunks/` », donc elle comptait `offline-engine-entry`, qui est
// PARESSEUX. Un chunk paresseux démarre après l'entrée — c'est sa définition, pas un défaut.
// La confondre avec un eager rendait un rouge parfaitement faux, exactement ce que
// `probe-csp-origins.mjs` a déjà payé une fois en comptant les tuiles comme origines tierces.
// Le périmètre est donc l'ensemble PRÉCHARGÉ, et W-06 ci-dessous vérifie que cet ensemble est
// bien le bon — sans quoi W-03 se contenterait de valider une liste qu'on lui a donnée.
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

// W-06 — l'ensemble préchargé est-il LE BON ? Dérivé du bundle lui-même, pas de la page : on
// re-télécharge l'entrée et on lit ses imports STATIQUES. C'est la seule des six assertions qui
// puisse voir un chunk eager OUBLIÉ par le `modulepreload` — le défaut coûteux, puisqu'il se
// paie d'un aller-retour entier et qu'aucune autre garde ne le nomme.
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
check(
    echecsHttp.length === 0,
    "W-05 réponses HTTP ≥ 400",
    echecsHttp.length === 0 ? "0" : `${echecsHttp.length} → ${echecsHttp.join(" | ")}`
);

// ── Relevé (non asserté — ces valeurs varient d'un run à l'autre) ─────────────────
// « Vague » : une nouvelle vague commence dès qu'une ressource ne PEUT PAS avoir été découverte
// avant la fin de la précédente (son `startTime` ≥ le `responseEnd` maximal de la vague en
// cours). C'est une mesure de SÉRIALISATION, pas un regroupement par proximité temporelle.
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
const reveal = releve.marks.find((m) => m.nom.includes("ready") || m.nom.includes("reveal"));

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
// ⚠️ Compte les connexions ouvertes PAR LES RESSOURCES. Celle qu'ouvre la navigation elle-même
// n'est pas ici (elle appartient à l'entrée `navigation`), et en h2 tout le same-origin la
// réutilise : 0 se lit donc « aucune connexion EN PLUS », pas « aucune connexion ».
console.log(
    `  connexions ouvertes en plus de la navigation : ${releve.res.filter((r) => r.connexion).length}`
);
console.log(`  hôtes distincts       : ${hotes.length} → ${hotes.join(", ")}`);
console.log(`  vagues de sérialisation : ${vagues}`);
console.log(
    `  chunks eager mesurés  : ${chunksCharges.length} → ${chunksCharges.map((c) => chemin(c.url).split("/").pop()).join(", ") || "aucun"}`
);

await ctx.close();
await browser.close();

const echecs = resultats.filter((r) => !r.ok).length;
console.log(
    `\n${echecs === 0 ? "✅" : "❌"} ${resultats.length - echecs}/${resultats.length} assertions\n`
);
process.exit(echecs === 0 ? 0 : 1);

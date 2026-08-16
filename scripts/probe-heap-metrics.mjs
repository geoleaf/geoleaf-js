#!/usr/bin/env node
/**
 * B-218 — SONDE D'INSTRUCTION (jetable, non gatée) : QUEL instrument de heap voit
 * 10 000 features dans CET environnement, et avec quelle dispersion ?
 *
 * La question commande tout le reste : `06-performance-baseline.spec.js` §6.2.4 lit
 * `performance.memory.usedJSHeapSize` avant et après un ajout de 10k points, et rend
 * `delta = 0` dans les six runs connus. Tant qu'on n'a pas établi qu'une grandeur BOUGE
 * avec son objet, tout seuil posé dessus est décoratif (mode d'échec n° 5 : un verdict
 * invérifiable). Et tant qu'on n'a pas mesuré sa DISPERSION, tout seuil risque d'être
 * posé dans la bande de bruit — c'est exactement ce qui a coûté B-217.
 *
 * ── MODE « instruments » (défaut) ──────────────────────────────────────────────
 * Quatre instruments comparés, sur la même page et le même geste, en dose-réponse
 * (N = 0 témoin inverse, 10 000, 30 000) :
 *   1. `performance.memory.usedJSHeapSize`            — celui du gate d'avant B-218
 *   2. CDP `Performance.getMetrics` → JSHeapUsedSize  — candidat nommé par B-218
 *   3. CDP `Runtime.getHeapUsage` → usedSize          — candidat nommé par B-218
 *   4. `performance.measureUserAgentSpecificMemory()` — candidat nommé par B-218
 * Passe 2 : les mêmes + `--enable-precise-memory-info`, pour ÉVALUER ce drapeau (il
 * lèverait la quantification de `performance.memory`, mais il changerait le régime de
 * mesure de TOUTE la suite — cf. `e2e/helpers/launch-options.js`).
 *
 * ── MODE « bande » (PROBE_MODE=bande) ──────────────────────────────────────────
 * Dispersion du delta RETENU (GC forcé des deux côtés), page fraîche à chaque ligne,
 * sur les deux constructions possibles : l'API GeoLeaf (`adapter.addGeoJSONLayer`) et
 * l'appel natif MapLibre (`map.addSource`) que le spec utilisait. C'est cette table qui
 * fixe le plancher et le plafond de la garde — jamais une constante choisie d'avance.
 *
 * ── MODE « fuite » (PROBE_MODE=fuite) — ajouté par B-219 ───────────────────────
 * Répond à UNE question que les deux modes ci-dessus ne posent pas : que verrait une
 * garde de RÉTENTION (add → remove répétés, puis heap retenu) là où §6.2.4 ne mesure
 * qu'un COÛT ? Trois scénarios sur pages fraîches — churn sain, churn qui FUIT (les
 * collections restent référencées), et témoin sans churn — et, sur la même page, le
 * verdict rendu par l'API produit `analyzeMemoryLeaks()`. C'est la comparaison des deux
 * colonnes qui tranche : si CDP voit la fuite simulée et que le produit dit « normal »,
 * le défaut est chez le produit, pas dans le test.
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-heap-metrics.mjs           (instruments)
 *         E2E_TARGET=nginx PROBE_MODE=bande node scripts/probe-heap-metrics.mjs
 *         E2E_TARGET=nginx PROBE_MODE=fuite node scripts/probe-heap-metrics.mjs
 * Ne démarre aucun serveur : vise les vhosts nginx permanents.
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const URL = process.env.GEOLEAF_PROBE_URL || `${baseURL("core")}/`;
const MODE = process.env.PROBE_MODE || "instruments";
const MB = (o) => (o / (1024 * 1024)).toFixed(2);

/** Le geste mesuré, dans les deux constructions possibles. `api` : "geoleaf" | "native". */
const AJOUT = ([count, api]) => {
    const map = window.GeoLeaf.Core.getMap();
    const native = map.getNativeMap();
    const b = native.getBounds();
    const west = b.getWest(),
        east = b.getEast(),
        south = b.getSouth(),
        north = b.getNorth();
    const features = [];
    for (let i = 0; i < count; i++) {
        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [
                    west + Math.random() * (east - west),
                    south + Math.random() * (north - south),
                ],
            },
            properties: { id: i, name: "Pt " + i, category: "test" },
        });
    }
    const id = "_probe_mem_" + Date.now();
    const data = { type: "FeatureCollection", features };
    // 🖐 B-88 — FAUX POSITIF INSTRUIT, pas une gêne. `detect-possible-timing-attacks` mord sur
    // tout `===` dont un côté s'appelle `api`, `token`, `secret`… — il compare des NOMS, pas
    // des valeurs. Ici `api` est le sélecteur de mode de la sonde (`"geoleaf"` ou l'adaptateur
    // brut), lu depuis un argument CLI d'opérateur : il n'y a ni secret, ni comparaison en
    // temps variable à protéger. Dérogation LOCALE et non extinction de la règle sur
    // `scripts/` : le prochain `===` sur un vrai jeton doit encore rougir.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (api === "geoleaf") {
        map.addGeoJSONLayer(id, data);
    } else {
        native.addSource(id, { type: "geojson", data });
        native.addLayer({ id, type: "circle", source: id, paint: { "circle-radius": 3 } });
    }
    return id;
};

/** Relève les quatre instruments à un instant donné. */
async function releve(page, client, label) {
    const inPage = await page.evaluate(() => {
        const m = performance.memory;
        return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null;
    });
    let cdpMetrics = null;
    try {
        const { metrics } = await client.send("Performance.getMetrics");
        const e = metrics.find((x) => x.name === "JSHeapUsedSize");
        cdpMetrics = e ? e.value : null;
    } catch (err) {
        cdpMetrics = `ERR ${err.message}`;
    }
    let heapUsage = null;
    try {
        const r = await client.send("Runtime.getHeapUsage");
        heapUsage = r.usedSize;
    } catch (err) {
        heapUsage = `ERR ${err.message}`;
    }
    const uaMem = await page.evaluate(async () => {
        if (typeof performance.measureUserAgentSpecificMemory !== "function")
            return "absent (API non exposée)";
        if (!self.crossOriginIsolated) return "indisponible (crossOriginIsolated=false)";
        try {
            const r = await performance.measureUserAgentSpecificMemory();
            return r.bytes;
        } catch (e) {
            return `ERR ${e.name}: ${e.message}`;
        }
    });
    return { label, inPage, cdpMetrics, heapUsage, uaMem };
}

/** GC forcé (deux passes) puis relève — mesure ce qui est RETENU, pas ce qui a été alloué. */
async function releveApresGc(page, client, label) {
    for (let i = 0; i < 2; i++) {
        try {
            await client.send("HeapProfiler.collectGarbage");
        } catch {
            /* non fatal — le relevé dira ce qu'il vaut */
        }
    }
    await page.waitForTimeout(200);
    return releve(page, client, label);
}

/** Ouvre une page fraîche sur la cible, carte prête. */
async function pageFraiche(browser) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    try {
        await client.send("Performance.enable");
    } catch {
        /* déjà actif */
    }
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForFunction(
        () => {
            try {
                const a = window.GeoLeaf?.Core?.getMap();
                return a && a.getNativeMap && a.getNativeMap() !== null;
            } catch {
                return false;
            }
        },
        null,
        { timeout: 20_000 }
    );
    await page.waitForTimeout(500);
    return { context, page, client };
}

async function modeInstruments() {
    const passes = [
        [
            [...SOFTWARE_GL_ARGS, ...hostResolverArgs],
            "PASSE 1 — drapeaux de la suite (GL logiciel), tels qu'ils sont aujourd'hui",
        ],
        [
            [...SOFTWARE_GL_ARGS, ...hostResolverArgs, "--enable-precise-memory-info"],
            "PASSE 2 — LES MÊMES + --enable-precise-memory-info (évaluation du 4ᵉ candidat)",
        ],
    ];
    for (const [args, titre] of passes) {
        console.log(`\n${"═".repeat(90)}\n${titre}\n${"═".repeat(90)}`);
        const browser = await chromium.launch({ args });
        const lignes = [];
        for (const n of [0, 10_000, 30_000]) {
            const { context, page, client } = await pageFraiche(browser);
            const avant = await releve(page, client, "avant");
            const avantGc = await releveApresGc(page, client, "avant (après GC)");
            await page.evaluate(AJOUT, [n, "native"]);
            const apres = await releve(page, client, "après (immédiat)");
            await page.waitForTimeout(1500);
            const apresStab = await releve(page, client, "après (+1,5 s)");
            const apresGc = await releveApresGc(page, client, "après (+GC)");
            lignes.push({ n, avant, avantGc, apres, apresStab, apresGc });
            await context.close();
        }
        await browser.close();

        const instruments = [
            ["performance.memory.usedJSHeapSize", (r) => (r.inPage ? r.inPage.used : null)],
            ["CDP Performance.getMetrics JSHeapUsedSize", (r) => r.cdpMetrics],
            ["CDP Runtime.getHeapUsage usedSize", (r) => r.heapUsage],
            ["measureUserAgentSpecificMemory()", (r) => r.uaMem],
        ];
        for (const [nom, get] of instruments) {
            console.log(`\n── ${nom} ──`);
            console.log(
                "  N        avant      avant+GC   après      après+1,5s après+GC   | Δ immédiat  Δ retenu(GC)"
            );
            for (const l of lignes) {
                const v = (r) => {
                    const x = get(r);
                    return typeof x === "number" ? MB(x) : String(x).slice(0, 10);
                };
                const num = (r) => {
                    const x = get(r);
                    return typeof x === "number" ? x : NaN;
                };
                const dImm = num(l.apres) - num(l.avant);
                const dGc = num(l.apresGc) - num(l.avantGc);
                console.log(
                    "  " +
                        String(l.n).padEnd(9) +
                        v(l.avant).padEnd(11) +
                        v(l.avantGc).padEnd(11) +
                        v(l.apres).padEnd(11) +
                        v(l.apresStab).padEnd(11) +
                        v(l.apresGc).padEnd(11) +
                        "| " +
                        (Number.isNaN(dImm) ? "  n/a".padEnd(12) : (MB(dImm) + " Mo").padEnd(12)) +
                        (Number.isNaN(dGc) ? "  n/a" : MB(dGc) + " Mo")
                );
            }
        }
    }
}

async function modeBande() {
    // Chaque ligne = une page FRAÎCHE. L'ordre alterne les constructions pour qu'une
    // dérive lente de la machine ne se lise pas comme une différence entre elles.
    const plan = [
        [10_000, "geoleaf"],
        [10_000, "native"],
        [0, "geoleaf"],
        [10_000, "geoleaf"],
        [10_000, "native"],
        [0, "native"],
        [10_000, "geoleaf"],
        [10_000, "geoleaf"],
        [30_000, "geoleaf"],
        [10_000, "geoleaf"],
    ];
    console.log(`\n${"═".repeat(78)}`);
    console.log("BANDE — delta RETENU (GC×2 des deux côtés), page fraîche à chaque ligne");
    console.log(`${"═".repeat(78)}`);
    console.log("  N        API      avant+GC   après+GC   | Δ retenu   | perf.memory Δ");
    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    const res = [];
    for (const [n, api] of plan) {
        const { context, page, client } = await pageFraiche(browser);
        const avant = await releveApresGc(page, client, "avant");
        await page.evaluate(AJOUT, [n, api]);
        await page.waitForTimeout(1000);
        const apres = await releveApresGc(page, client, "après");
        const d = apres.heapUsage - avant.heapUsage;
        const dPm = (apres.inPage?.used ?? NaN) - (avant.inPage?.used ?? NaN);
        res.push({ n, api, avant: avant.heapUsage, apres: apres.heapUsage, d });
        console.log(
            "  " +
                String(n).padEnd(9) +
                api.padEnd(9) +
                MB(avant.heapUsage).padEnd(11) +
                MB(apres.heapUsage).padEnd(11) +
                "| " +
                (MB(d) + " Mo").padEnd(11) +
                "| " +
                (Number.isNaN(dPm) ? "n/a" : MB(dPm) + " Mo")
        );
        await context.close();
    }
    await browser.close();

    console.log("\n── Synthèse (Mo) ──");
    for (const clef of [
        "10000|geoleaf",
        "10000|native",
        "0|geoleaf",
        "0|native",
        "30000|geoleaf",
    ]) {
        const [n, api] = clef.split("|");
        const s = res.filter((r) => String(r.n) === n && r.api === api).map((r) => r.d);
        if (!s.length) continue;
        const min = Math.min(...s),
            max = Math.max(...s);
        const moy = s.reduce((a, b) => a + b, 0) / s.length;
        console.log(
            `  N=${n.padEnd(6)} ${api.padEnd(8)} n=${s.length}  min=${MB(min)}  moy=${MB(moy)}  max=${MB(max)}  étendue=${MB(max - min)}`
        );
    }
    console.log(
        "\n  Les lignes N=0 sont le TÉMOIN INVERSE : c'est le plancher que la garde doit voir rouge.\n"
    );
}

/**
 * Phase 1 du churn : `cycles` cycles add→remove complets, PUIS un dernier ajout laissé
 * EN PLACE. La page rend la main là pour que Node lise le PIC par CDP — la mesure qui
 * établit que le geste a un effet visible, sans quoi une rétention nulle serait
 * indiscernable d'un churn qui n'a rien fait (c'est la leçon de plancher de B-218).
 *
 * `leak` : si vrai, les collections restent référencées depuis un tableau global —
 * c'est la FUITE SIMULÉE, et elle sert de témoin positif : une garde de rétention qui
 * ne la voit pas ne garde rien.
 */
const CHURN_PIC = async ([cycles, leak, churn]) => {
    const adapter = window.GeoLeaf.Core.getMap();
    const native = adapter.getNativeMap();
    const b = native.getBounds();
    const west = b.getWest(),
        east = b.getEast(),
        south = b.getSouth(),
        north = b.getNorth();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__probeLeak = [];
    window.__probeSamples = [];

    const collection = () => {
        const features = [];
        for (let i = 0; i < 10000; i++) {
            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [
                        west + Math.random() * (east - west),
                        south + Math.random() * (north - south),
                    ],
                },
                properties: { id: i },
            });
        }
        return { type: "FeatureCollection", features };
    };

    // Le profiler produit tourne PENDANT le churn, exactement comme en 6.2.6.
    window.__probeProfiler = new window.GeoLeaf.Utils.PerformanceProfiler({
        monitoring: { enabled: true, interval: 200, maxDataPoints: 60 },
    });
    window.__probeProfiler.startMonitoring();

    for (let c = 0; c < cycles; c++) {
        // Témoin direct de l'ENTRÉE du profiler : combien de valeurs DISTINCTES
        // `performance.memory` rend-il sur la durée du churn ?
        if (performance.memory) window.__probeSamples.push(performance.memory.usedJSHeapSize);
        if (churn) {
            const data = collection();
            const id = "_churn_" + c;
            adapter.addGeoJSONLayer(id, data);
            await sleep(120);
            adapter.removeLayer(id);
            if (leak) window.__probeLeak.push(data);
            await sleep(120);
        } else {
            await sleep(240);
        }
    }

    // Le dernier ajout reste EN PLACE — c'est lui que la lecture de pic doit voir.
    if (churn) {
        window.__probeHeld = collection();
        adapter.addGeoJSONLayer("_churn_pic", window.__probeHeld);
        await sleep(400);
    }
    return { cycles };
};

/** Phase 2 : retire la couche tenue, libère les références, rend le verdict produit. */
const CHURN_FIN = async ([churn, leak]) => {
    const adapter = window.GeoLeaf.Core.getMap();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (churn) {
        adapter.removeLayer("_churn_pic");
        if (leak) window.__probeLeak.push(window.__probeHeld);
        window.__probeHeld = null;
        await sleep(300);
    }
    if (performance.memory) window.__probeSamples.push(performance.memory.usedJSHeapSize);
    const verdict = window.__probeProfiler.analyzeMemoryLeaks();
    window.__probeProfiler.stopMonitoring();
    return {
        verdict,
        echantillons: window.__probeSamples.length,
        distincts: new Set(window.__probeSamples).size,
        retenues: window.__probeLeak.length,
    };
};

async function modeFuite() {
    // Par défaut la DOSE du spec (`e2e/06-performance-baseline.spec.js` §6.2.6), pour que
    // la bande soit mesurée là où elle est appliquée — la leçon de `heapDeltaBandMb`,
    // qui jette plutôt que de se laisser réemployer à une autre dose.
    const CYCLES = Number(process.env.PROBE_CYCLES || 14);
    // L'ordre ALTERNE les scénarios pour qu'une dérive lente de la machine ne se lise
    // pas comme une différence entre eux.
    const plan = [
        ["churn sain", true, false],
        ["FUITE simulée", true, true],
        ["churn sain", true, false],
        ["témoin sans churn", false, false],
        ["churn sain", true, false],
        ["FUITE simulée", true, true],
        ["churn sain", true, false],
        ["churn sain", true, false],
    ];
    console.log(`\n${"═".repeat(104)}`);
    console.log(
        `FUITE — heap RETENU avant/après ${CYCLES} cycles add→remove (GC×2 des deux côtés), page fraîche par ligne`
    );
    console.log(`${"═".repeat(104)}`);
    console.log(
        "  scénario            avant+GC   pic+GC     après+GC   | Δ PIC      | Δ RETENU   | perf.mem Δ | éch./dist. | verdict produit"
    );
    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    const res = [];
    for (const [label, churn, leak] of plan) {
        const { context, page, client } = await pageFraiche(browser);
        const avant = await releveApresGc(page, client, "avant");
        await page.evaluate(CHURN_PIC, [CYCLES, leak, churn]);
        const pic = await releveApresGc(page, client, "pic");
        const out = await page.evaluate(CHURN_FIN, [churn, leak]);
        await page.waitForTimeout(300);
        const apres = await releveApresGc(page, client, "après");
        const dPic = pic.heapUsage - avant.heapUsage;
        const d = apres.heapUsage - avant.heapUsage;
        const dPm = (apres.inPage?.used ?? NaN) - (avant.inPage?.used ?? NaN);
        res.push({ label, d, dPic, out });
        console.log(
            "  " +
                label.padEnd(20) +
                MB(avant.heapUsage).padEnd(11) +
                MB(pic.heapUsage).padEnd(11) +
                MB(apres.heapUsage).padEnd(11) +
                "| " +
                (MB(dPic) + " Mo").padEnd(11) +
                "| " +
                (MB(d) + " Mo").padEnd(11) +
                "| " +
                (Number.isNaN(dPm) ? "n/a" : MB(dPm) + " Mo").padEnd(11) +
                "| " +
                `${out.echantillons}/${out.distincts}`.padEnd(11) +
                "| " +
                JSON.stringify(out.verdict)
        );
        await context.close();
    }
    await browser.close();

    console.log("\n── Synthèse (Mo) ──");
    for (const clef of ["churn sain", "FUITE simulée", "témoin sans churn"]) {
        const lignes = res.filter((r) => r.label === clef);
        if (!lignes.length) continue;
        for (const [nom, get] of [
            ["PIC (couche présente)", (r) => r.dPic],
            ["RETENU (couche retirée)", (r) => r.d],
        ]) {
            const s = lignes.map(get);
            const min = Math.min(...s),
                max = Math.max(...s);
            const moy = s.reduce((a, b) => a + b, 0) / s.length;
            console.log(
                `  ${clef.padEnd(20)} ${nom.padEnd(25)} n=${s.length}  min=${MB(min)}  moy=${MB(moy)}  max=${MB(max)}  étendue=${MB(max - min)}`
            );
        }
    }
    console.log(
        "\n  La colonne « distincts » est le fait de B-219 : si elle vaut 1, l'entrée du profiler\n" +
            "  n'a pas varié d'un octet, et AUCUN verdict de croissance n'est calculable sur elle.\n"
    );
}

const run = async () => {
    console.log(`cible : ${URL}   mode : ${MODE}`);
    if (MODE === "bande") await modeBande();
    else if (MODE === "fuite") await modeFuite();
    else await modeInstruments();
    console.log("\n=== FIN-SONDE-HEAP ===\n");
};

run().catch((e) => {
    console.error(e);
    process.exit(1);
});

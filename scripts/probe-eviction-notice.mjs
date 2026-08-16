/*!
 * GeoLeaf — sonde B-163
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file probe-eviction-notice.mjs
 * @description Tâche 1.4 de R9 — VOIR l'avis d'éviction s'afficher, sur les DEUX variantes.
 *
 * 🛑 POURQUOI CETTE SONDE EXISTE ALORS QUE 10 TESTS UNITAIRES SONT VERTS.
 * Les unitaires éprouvent la LOGIQUE de l'écouteur ; aucun ne dit qu'il est CÂBLÉ dans le
 * bundle livré. C'est exactement le défaut d'origine vu depuis l'autre bout : `offline-ui`
 * avait un écouteur correct et testé, et l'avis ne s'affichait pas sur `deploy-core` parce que
 * le plugin n'y était pas. Un vert unitaire ne peut pas fermer B-163.
 *
 * 🛑 ET LA VARIANTE QUI COMPTE EST `deploy-core`, celle qu'on oublierait : c'est elle qui
 * portait la régression, et elle qui part chez un client.
 *
 * Elle éprouve aussi l'ABSENCE de doublon sur `deploy-full`, où le core et le plugin
 * pourraient tous deux écouter — deux toasts pour une éviction.
 *
 * Usage : `node scripts/probe-eviction-notice.mjs` (nginx de dev déjà en place).
 */
"use strict";

// ⚠️ `@playwright/test` et NON `playwright` : c'est le paquet déclaré du dépôt. Importer le
// second passe à l'exécution (il est présent en transitif) mais fait rougir Knip — une
// dépendance non déclarée qui marche est exactement ce qu'un lockfile régénéré casse un jour.
import { chromium } from "@playwright/test";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";

/** Détail réaliste : la forme IndexedDB, celle qui renseigne `freedBytes`. */
const DETAIL = { evicted: 3, freedBytes: 2048, totalBefore: 10, totalAfter: 7 };

/**
 * Charge une variante, provoque une éviction, et rend ce qui s'est affiché.
 *
 * ⚠️ On dispatche l'événement plutôt que de remplir un cache réel : l'objet de la tâche est la
 * chaîne « signal → avis », pas l'algorithme d'éviction, qui a ses propres tests. Le signal est
 * émis exactement comme les deux producteurs le font — même nom, même `document`.
 */
async function probeVariant(browser, variant) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const consoleWarnings = [];
    page.on("console", (m) => {
        if (m.type() === "warning") consoleWarnings.push(m.text());
    });

    await page.goto(`${baseURL(variant)}/`, { waitUntil: "load", timeout: 30_000 });
    // Le boot doit être fini : `setupStorage()` câble l'écouteur, et rien ne sert de dispatcher
    // avant. On attend le namespace plutôt qu'un délai fixe.
    await page.waitForFunction(() => typeof globalThis.GeoLeaf !== "undefined", {
        timeout: 30_000,
    });

    const before = await page.evaluate(() => document.querySelectorAll(".gl-toast").length);

    // 🛑 SCÉNARIO DE CONTRÔLE, JOUÉ EN PREMIER — il rend cette sonde falsifiable.
    // Une éviction à ZÉRO entrée ne doit produire AUCUN avis. S'il en apparaît un, le garde
    // `count <= 0` du bundle livré ne mord pas ; et si le scénario nominal ci-dessous verdissait
    // alors que celui-ci échoue, on saurait que la sonde compte n'importe quoi. Sans ce
    // contrôle, « 1 toast correspondant » ne distingue pas un écouteur qui marche d'un
    // compteur complaisant.
    await page.evaluate(() => {
        document.dispatchEvent(
            new CustomEvent("geoleaf:cache:evicted", { detail: { evicted: 0, freedBytes: 0 } })
        );
    });
    await page.waitForTimeout(200);
    const afterZero = await page.evaluate(
        () =>
            [...document.querySelectorAll(".gl-toast")].filter((n) =>
                /hors ligne|offline/i.test(n.textContent)
            ).length
    );

    await page.evaluate((detail) => {
        document.dispatchEvent(new CustomEvent("geoleaf:cache:evicted", { detail }));
    }, DETAIL);

    // Le renderer insère de façon synchrone, mais on laisse une frame pour l'animation.
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll(".gl-toast")];
        return nodes.map((n) => ({ text: n.textContent.trim(), cls: n.className }));
    });

    await page.close();
    return { before, toasts: result, consoleWarnings, afterZero };
}

// ⚠️ `hostResolverArgs` est un TABLEAU, et il n'est peuplé que si `E2E_TARGET=nginx` — sinon
// `baseURL()` viserait les http-servers de Playwright, que cette sonde ne démarre pas.
if (process.env.E2E_TARGET !== "nginx") {
    console.error("❌ Lancer avec E2E_TARGET=nginx — la sonde vise les vhosts, elle ne sert rien.");
    process.exit(2);
}

const browser = await chromium.launch({
    args: [...hostResolverArgs, ...SOFTWARE_GL_ARGS],
});

let failed = false;
const report = [];

for (const variant of ["core", "full"]) {
    const { before, toasts, consoleWarnings, afterZero } = await probeVariant(browser, variant);
    const fresh = toasts.length - before;
    const texts = toasts.map((t) => t.text);
    const matched = texts.filter((t) => /3/.test(t) && /hors ligne|offline/i.test(t));

    const rawKeyLeaked = texts.some((t) => t.includes("storage.notif.cacheEvicted"));
    const placeholderLeaked = texts.some((t) => t.includes("{0}") || t.includes("{count}"));

    // 🛑 L'ORACLE EST LE NOMBRE DE TOASTS D'ÉVICTION, PAS LA VARIATION DU TOTAL.
    // Premier jet de cette sonde : `fresh === 1`, sur le total des `.gl-toast`. Il rendait 3 et 2
    // alors que l'avis était PARFAIT sur les deux variantes — la page porte des avis de boot,
    // qui apparaissent après le point où la ligne de base est prise et n'ont rien à voir avec
    // l'éviction. Un total est un proxy ; ce qu'on veut savoir, c'est « combien d'écouteurs ont
    // répondu », et cela se lit sur les toasts QUI CORRESPONDENT. `fresh` reste imprimé comme
    // contexte, jamais comme critère.
    const ok = matched.length === 1 && afterZero === 0 && !rawKeyLeaked && !placeholderLeaked;
    if (!ok) failed = true;

    report.push({
        variant,
        verdict: ok ? "✅" : "❌",
        toastsFrais: fresh,
        correspondants: matched.length,
        texte: matched[0] ?? texts[0] ?? "(aucun)",
        silenceAZero: afterZero === 0,
        cleBrute: rawKeyLeaked,
        placeholder: placeholderLeaked,
        consoleWarnings: consoleWarnings.filter((w) => /vic|cache/i.test(w)).length,
    });
}

await browser.close();

console.log("\n── B-163 · l'avis d'éviction, sur les deux variantes livrées ──\n");
for (const r of report) {
    console.log(`${r.verdict}  deploy-${r.variant}`);
    console.log(
        `      toasts d'éviction : ${r.correspondants}  (attendu 1 — 0 = le défaut B-163, ≥2 = doublon)`
    );
    console.log(`      texte affiché     : ${r.texte}`);
    console.log(`      (contexte : ${r.toastsFrais} toasts au total, avis de boot compris)`);
    console.log(`      silence si 0 évincé: ${r.silenceAZero}`);
    console.log(`      clé brute fuitée  : ${r.cleBrute}`);
    console.log(`      placeholder fuité : ${r.placeholder}\n`);
}

if (failed) {
    console.error("❌ B-163 n'est PAS soldée — voir ci-dessus.");
    process.exit(1);
}
console.log("✅ B-163 : l'avis s'affiche sur deploy-core ET deploy-full, une seule fois.");

/*!
 * GeoLeaf — eviction-notice probe
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file probe-eviction-notice.mjs
 * @description SEE the eviction notice display, on BOTH variants.
 *
 * 🛑 WHY THIS PROBE EXISTS WHILE 10 UNIT TESTS ARE GREEN.
 * The unit tests prove the listener's LOGIC; none says it is WIRED into the shipped
 * bundle. It is exactly the original defect seen from the other end: `offline-ui` had
 * a correct, tested listener, and the notice did not display on `deploy-core` because
 * the plugin was not there. A unit green cannot close that defect.
 *
 * 🛑 AND THE VARIANT THAT MATTERS IS `deploy-core`, the one that would be forgotten:
 * it carried the regression, and it ships to a client.
 *
 * It also proves the ABSENCE of a duplicate on `deploy-full`, where the core and the
 * plugin could both listen — two toasts for one eviction.
 *
 * Usage: `node scripts/probe-eviction-notice.mjs` (dev nginx already in place).
 */
"use strict";

// ⚠️ `@playwright/test` and NOT `playwright`: it is the repo's declared package.
// Importing the latter works at runtime (present transitively) but makes Knip go red —
// an undeclared dependency that works is exactly what a regenerated lockfile breaks
// one day.
import { chromium } from "@playwright/test";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";

/** Realistic detail: the IndexedDB shape, the one that fills `freedBytes`. */
const DETAIL = { evicted: 3, freedBytes: 2048, totalBefore: 10, totalAfter: 7 };

/**
 * Loads a variant, triggers an eviction, and returns what displayed.
 *
 * ⚠️ We dispatch the event rather than fill a real cache: the subject is the
 * "signal → notice" chain, not the eviction algorithm, which has its own tests. The
 * signal is emitted exactly as both producers do — same name, same `document`.
 */
async function probeVariant(browser, variant) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const consoleWarnings = [];
    page.on("console", (m) => {
        if (m.type() === "warning") consoleWarnings.push(m.text());
    });

    await page.goto(`${baseURL(variant)}/`, { waitUntil: "load", timeout: 30_000 });
    // Boot must be over: `setupStorage()` wires the listener, and dispatching before
    // is pointless. We wait for the namespace rather than a fixed delay.
    await page.waitForFunction(() => typeof globalThis.GeoLeaf !== "undefined", {
        timeout: 30_000,
    });

    const before = await page.evaluate(() => document.querySelectorAll(".gl-toast").length);

    // 🛑 CONTROL SCENARIO, PLAYED FIRST — it makes this probe falsifiable.
    // A ZERO-entry eviction must produce NO notice. If one appears, the shipped
    // bundle's `count <= 0` guard does not bite; and if the nominal scenario below
    // went green while this one fails, we would know the probe counts anything.
    // Without this control, "1 matching toast" cannot tell a working listener from a
    // complacent counter.
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

    // The renderer inserts synchronously, but we leave one frame for the animation.
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll(".gl-toast")];
        return nodes.map((n) => ({ text: n.textContent.trim(), cls: n.className }));
    });

    await page.close();
    return { before, toasts: result, consoleWarnings, afterZero };
}

// ⚠️ `hostResolverArgs` is an ARRAY, and it is only populated when `E2E_TARGET=nginx`
// — otherwise `baseURL()` would target Playwright's http-servers, which this probe
// does not start.
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

    // 🛑 THE ORACLE IS THE NUMBER OF EVICTION TOASTS, NOT THE TOTAL'S VARIATION.
    // This probe's first draft: `fresh === 1`, on the `.gl-toast` total. It returned 3
    // and 2 while the notice was PERFECT on both variants — the page carries boot
    // notices, which appear after the point where the baseline is taken and have
    // nothing to do with the eviction. A total is a proxy; what we want to know is
    // "how many listeners answered", and that reads on the toasts THAT MATCH.
    // `fresh` stays printed as context, never as criterion.
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

console.log("\n── L'avis d'éviction, sur les deux variantes livrées ──\n");
for (const r of report) {
    console.log(`${r.verdict}  deploy-${r.variant}`);
    console.log(
        `      toasts d'éviction : ${r.correspondants}  (attendu 1 — 0 = le défaut, ≥2 = doublon)`
    );
    console.log(`      texte affiché     : ${r.texte}`);
    console.log(`      (contexte : ${r.toastsFrais} toasts au total, avis de boot compris)`);
    console.log(`      silence si 0 évincé: ${r.silenceAZero}`);
    console.log(`      clé brute fuitée  : ${r.cleBrute}`);
    console.log(`      placeholder fuité : ${r.placeholder}\n`);
}

if (failed) {
    console.error("❌ L'avis d'éviction n'est PAS câblé partout — voir ci-dessus.");
    process.exit(1);
}
console.log("✅ L'avis s'affiche sur deploy-core ET deploy-full, une seule fois.");

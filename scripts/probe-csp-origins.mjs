import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";

const targets = [
    ["deploy-core", "https://demo.geoleaf.local.test/"],
    ["deploy-full", "https://demo.full.geoleaf.local.test/"],
];
let bad = 0;
const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
for (const [name, url] of targets) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const violations = [],
        reqs = [],
        errors = [];
    await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
            window.__csp.push(`${e.violatedDirective} ← ${e.blockedURI}`)
        );
    });
    page.on("request", (r) => reqs.push(r.url()));
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForFunction(() => !!window.maplibregl, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(6000);
    violations.push(...(await page.evaluate(() => window.__csp || [])));
    // ⚠️ The criterion: the THREE BOOT origins, not "everything not
    // same-origin". Tiles and remote datasets (OpenTopoMap, USGS, S3) are
    // legitimate runtime fetches, governed by `img-src`/`connect-src 'self'
    // https:` — a first version of this probe counted them and rendered a
    // perfectly false red.
    const BOOT_ORIGINS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
    const third = reqs.filter((u) => BOOT_ORIGINS.some((o) => u.includes(o)));
    const runtimeHosts = [
        ...new Set(
            reqs
                .filter((u) => !u.includes("geoleaf.local.test") && !u.startsWith("data:"))
                .map((u) => new URL(u).host)
        ),
    ];
    const hasMap = await page.evaluate(() => {
        const el = document.querySelector("#geoleaf-map");
        return !!el && !el.hasAttribute("hidden") && el.querySelectorAll("canvas").length > 0;
    });
    const gl = await page.evaluate(() => typeof window.maplibregl);
    console.log(`\n── ${name} ──`);
    console.log(`  maplibregl            : ${gl}`);
    console.log(`  canvas carte rendu    : ${hasMap}`);
    console.log(
        `  violations CSP        : ${violations.length}${violations.length ? " → " + violations.join(" | ") : ""}`
    );
    console.log(
        `  origines de boot tierces : ${third.length}${third.length ? " ❌ → " + third.join(", ") : " (unpkg / fonts.googleapis / fonts.gstatic)"}`
    );
    console.log(
        `  hôtes runtime (tuiles/données, légitimes) : ${runtimeHosts.join(", ") || "aucun"}`
    );
    console.log(
        `  erreurs page          : ${errors.length}${errors.length ? " → " + errors.join(" | ") : ""}`
    );
    if (violations.length || third.length || !hasMap || gl !== "object" || errors.length) bad++;
    await ctx.close();
}
await browser.close();
console.log(
    `\n${bad === 0 ? "✅ les 2 variantes : carte rendue, 0 violation CSP, 0 origine tierce" : `❌ ${bad} variante(s) en défaut`}`
);
process.exit(bad === 0 ? 0 : 1);

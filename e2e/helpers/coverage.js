// @ts-check
// E2E coverage helper — collects Istanbul coverage data from browser and writes to .nyc_output/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NYC_OUTPUT = path.resolve(__dirname, "..", "..", ".nyc_output");

/**
 * Collect Istanbul coverage from a Playwright page and write to .nyc_output/.
 * The page must have been loaded with an instrumented bundle (COVERAGE=true build).
 * @param {import('@playwright/test').Page} page
 * @param {string} name — identifier for this coverage snapshot (e.g. 'boot-sequence')
 */
async function collectCoverage(page, name) {
    const coverage = await page.evaluate(() => window.__coverage__);
    if (!coverage) {
        // This used to be a `console.warn` + `return`. Silent, and above all:
        // it did NOT OVERWRITE the existing file. Coupled with `nyc report`
        // coming out GREEN on empty data, that gave a chain where a broken
        // E2E run left the previous week's measurement in place and the gate
        // green. A collection helper failing silently is the upstream half of
        // that defect.
        throw new Error(
            `[coverage] window.__coverage__ absent pour « ${name} » — le bundle chargé n'est PAS ` +
                `instrumenté. Attendu : deploy-coverage (port 8769), construit par ` +
                `\`npm run build:deploy-coverage\`. Ne pas ignorer : sans cette donnée, la gate ` +
                `de couverture du boot ne mesure rien.`
        );
    }

    if (!fs.existsSync(NYC_OUTPUT)) {
        fs.mkdirSync(NYC_OUTPUT, { recursive: true });
    }

    const outFile = path.join(NYC_OUTPUT, `e2e-${name}.json`);
    fs.writeFileSync(outFile, JSON.stringify(coverage), "utf-8");
    console.log(
        `[coverage] Written ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`
    );
}

/**
 * Registers an `afterEach` that collects each test's own coverage into `.nyc_output/`.
 *
 * ## Why an `afterEach` and not an `afterAll`
 *
 * `window.__coverage__` lives **in the page**, and Playwright gives a fresh
 * page to each test. The `07-boot-sequence` pattern — an `afterAll` opening a
 * fresh page — thus yields only the BOOT's coverage, which is exactly what it
 * wants to measure. For a spec whose interest is what its SCENARIOS exercise,
 * the same shape would add nothing: the collected page would have played no
 * scenario.
 *
 * ## What the fallback does, and why it is not silent
 *
 * If a test fails, its page may be closed or its bundle never loaded —
 * `collectCoverage` would throw, and **one failure would become two**, the
 * second masking the first. So the fallback applies ONLY when the test has
 * already failed. On a passing test, missing data stays a loud error: the
 * only case where it really signals an uninstrumented bundle.
 *
 * @param {import('@playwright/test').TestType<any, any>} test - The spec's `test` object.
 * @param {string} specName - Short spec identifier, used as the file-name prefix.
 * @returns {void}
 */
function registerCoverageCollection(test, specName) {
    test.afterEach(async ({ page }, testInfo) => {
        const slug = testInfo.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60);
        try {
            await collectCoverage(page, `${specName}-${slug}`);
        } catch (err) {
            if (testInfo.status === "passed") throw err;
            console.warn(
                `[coverage] « ${testInfo.title} » a échoué (${testInfo.status}) — collecte ` +
                    `abandonnée pour ne pas masquer l'échec réel : ${String(err)}`
            );
        }
    });
}

export { collectCoverage, registerCoverageCollection };

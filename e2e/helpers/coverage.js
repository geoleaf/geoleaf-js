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
        // T6.1 — c'était un `console.warn` + `return`. Silencieux, et surtout : il
        // N'ÉCRASAIT PAS le fichier existant. Couplé au fait que `nyc report` sort VERT
        // sur une donnée vide, cela donnait une chaîne où un run E2E cassé laissait la
        // mesure de la semaine précédente en place et la gate au vert.
        // Un helper de collecte qui échoue en silence est la moitié amont de ce défaut.
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

export { collectCoverage };

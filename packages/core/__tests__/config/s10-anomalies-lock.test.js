/**
 * Config-contract Phase C / C1 — regression-lock of B1/B2 anomalies that have no
 * "home" feature file (security, performance). Decision (Mattieu, 2026-06-14):
 * lock the CURRENT behaviour so a future fix flips the test → registre exécutoire.
 *
 *   - @anomaly ANO-023: security.httpsOnly — validateUrl HAS the capability, but
 *     the config key is never wired to it (orphan). We lock the capability so a
 *     future wiring already has a tested contract.
 *   - ANO-028/029 (performance.maxConcurrentLayers / layerLoadDelay) and ANO-030
 *     (performance.fitBoundsOnThemeChange, hardcoded false in theme-applier) have
 *     NO runtime consumer to observe → no behavioural test is possible. They stay
 *     locked by the inventory + the coverage guard (consigned in the registre).
 *
 * Consumers: kernel/security/index.ts (validateUrl). Inventory B1/B2.
 */

import { validateUrl } from "../../src/kernel/security/index.js";

describe("@anomaly ANO-023 — security.httpsOnly (capability present, config unwired)", () => {
    it("httpsOnly:true rejects an http: URL", () => {
        expect(() =>
            validateUrl("http://example.com/data.json", undefined, { httpsOnly: true })
        ).toThrow();
    });

    it("httpsOnly:true accepts an https: URL", () => {
        expect(
            validateUrl("https://example.com/data.json", undefined, { httpsOnly: true })
        ).toContain("https://example.com/data.json");
    });

    it("without httpsOnly, http: URLs are accepted (default — capability not enforced)", () => {
        expect(validateUrl("http://example.com/data.json")).toContain(
            "http://example.com/data.json"
        );
    });
});

describe("performance.* orphans (ANO-028/029/030) — locked by inventory, not behaviour", () => {
    // Intentionally no behavioural assertions: these keys have no runtime consumer
    // (maxConcurrentLayers / layerLoadDelay = 0 reader; fitBoundsOnThemeChange =
    // hardcoded `false` in themes/theme-applier/core.ts:162, config never read).
    // A no-effect test would assert nothing observable. The regression-lock is the
    // anomaly registry + check-config-coverage; see registre_anomalies_config.md.
    it.todo("ANO-028 performance.maxConcurrentLayers — wire a consumer, then test");
    it.todo("ANO-029 performance.layerLoadDelay — wire a consumer, then test");
    it.todo("ANO-030 performance.fitBoundsOnThemeChange — read the config, then test");
});

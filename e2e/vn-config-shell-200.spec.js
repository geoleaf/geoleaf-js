// @ts-check
// Witness — a host application's router returns ITS OWN document with
// HTTP 200 on the configuration path, and the boot still announces a
// success.
//
// THE MECHANISM, and nothing about it is integrator-specific: a single-page
// application answers any unknown URL with its HTML shell, status 200. An
// embedded library that derives its configuration's location from the host
// page's URL thus requests a path that does not exist, receives HTML where
// it expects JSON, and the server signals nothing — the 200 is the router's
// normal answer.
//
// WHAT THIS SPEC MEASURES, and the asymmetry is the witness's core:
//   ① GREEN today — at least one console error NAMES the configuration
//      path. The attribution message's anti-regression witness, and it must
//      stay so.
//   ② GREEN since 2026-08-20 — no "Configuration loaded successfully"
//      follows that error. One did as long as the loader's `catch`
//      RESOLVED; it now REJECTS, and the boot stops instead of degrading.
//      🔻 These two lines described the DEAD mechanism for a few hours: the
//      spec's body was right, its header was not.
//
// ⚠️ The defect is NOT silence — the console does carry two precise errors.
// The defect is the CONTRADICTION: a success announced after a failure,
// then consequence errors none of which names the cause. An integrator
// reads a success, then a blank map.
//
// `serviceWorkers: 'block'` — deploy-core ships a PWA service worker, which
// would escape `page.route`. The resulting
// `[SWRegister] Registration failed … reading 'scope'` warning is a harness
// artifact, not a regression.
//
// The `vn-` prefix: browser verification outside the suite numbering.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const SHELL_HTML =
    "<!doctype html><html><head><title>Host application shell</title></head>" +
    '<body><div id="app"></div></body></html>';

test.describe("vn — configuration servie en HTTP 200 par le shell d'un hôte", () => {
    test("nomme la cause, et n'annonce AUCUN succès après l'échec", async ({ page }) => {
        /** @type {string[]} */
        const console_ = [];
        page.on("console", (m) => console_.push(`${m.type()}:${m.text()}`));

        // A host application router's behaviour: 200 + its own document.
        await page.route("**/geoleaf.config.json**", (route) =>
            route.fulfill({ status: 200, contentType: "text/html", body: SHELL_HTML })
        );

        await page.goto("/");

        // ① The cause is named — the attribution message's anti-regression.
        await expect
            .poll(() => console_.filter((l) => /geoleaf\.config\.json/.test(l)).length, {
                timeout: 20000,
            })
            .toBeGreaterThan(0);

        const causeAt = console_.findIndex(
            (l) => l.startsWith("error:") && /geoleaf\.config\.json/.test(l)
        );
        expect(causeAt, "aucune ERREUR ne nomme le chemin de configuration").toBeGreaterThan(-1);

        // ② No success announced AFTER the cause. Red as long as the loader swallows the failure.
        const succesApres = console_
            .slice(causeAt)
            .filter((l) => /Configuration loaded successfully/.test(l));

        expect(
            succesApres,
            `le boot a annoncé un succès APRÈS avoir échoué : ${succesApres.join(" | ")}`
        ).toHaveLength(0);
    });
});

/*!
 * GeoLeaf — E2E preamble: are the harness's ports usable?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The defect, measured on 2026-08-13
 *
 * `npm run ci:local -- --e2e` returned, after 80 green gates and four builds:
 *
 *     Error: Timed out waiting 60000ms from config.webServer.
 *
 * A minute lost, and a message that **names no port**. The cause was two ORPHAN
 * `http-server` holding 8768 and 8769 — the remains of a previous run killed by a
 * `timeout`, which Playwright could not clean up. Once stopped, the suite ran
 * again.
 *
 * ⚠️ **WHAT THIS GUARD DOES NOT CLAIM.** That the orphans were the CAUSE is not
 * demonstrated: `reuseExistingServer` is `true` locally, so a live server is
 * supposed to be reused, and port 8766 was free. The link is a strong clue — the
 * suite ran again after cleanup — not a proof. This guard thus does not rest on
 * that diagnosis: it verifies a property **true independently of it**, namely that
 * each port Playwright will use is in one of the two states it knows how to
 * handle.
 *
 * ## The predicate, and why it is NOT "the port must be free"
 *
 * `playwright.config.js` declares `reuseExistingServer: !process.env.CI`: locally,
 * a server already there is **deliberately reused**. Requiring a free port would
 * thus redden the guard on the nominal case of anyone keeping servers between
 * runs. The three states:
 *
 *   ① connection REFUSED     → the port is free, Playwright will start its own.     ✅
 *   ② an HTTP response       → a server answers, Playwright will reuse it.          ✅
 *   ③ neither                → something HOLDS the port without answering:          ❌
 *                              Playwright can neither reuse it nor bind to it. The
 *                              state that produces the 60 s timeout, and the only
 *                              one refused.
 *
 * ## What is READ rather than guessed
 *
 * The URLs come from `playwright.config.js` itself, never a copied list: a second
 * port list diverges as soon as a variant is added, and the guard would then check
 * ports nobody uses while ignoring the ones that count.
 *
 * ⚠️ **Under `E2E_TARGET=nginx`, `webServer` is EMPTY, and that is this target's
 * point**: the four variants are served by the dev nginx, the suite starts
 * nothing. The guard then SKIPS, saying so — never silently, never rendering a
 * green that verified nothing.
 *
 * Usage : node scripts/verify-e2e-ports.cjs
 */
"use strict";

const http = require("node:http");
const { spawnSync } = require("node:child_process");

const TAG = "E2E-PORTS";

/** Delay beyond which a non-answering port is held occupied-and-mute. */
const PROBE_TIMEOUT_MS = 3000;

/** Tooling exit — never 0, never 1: being able to play is a prerequisite, not a verdict. */
function refuse(lignes) {
    console.error(`\x1b[31m✗\x1b[0m [${TAG}] La suite E2E NE PEUT PAS être jouée.`);
    for (const l of lignes) console.error(l);
    process.exit(2);
}

/**
 * Queries a URL and classes the port into one of the header's three states.
 *
 * @param {string} url
 * @returns {Promise<"libre" | "repond" | "muet">}
 */
function sonder(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: PROBE_TIMEOUT_MS }, (res) => {
            res.resume(); // the body is not read: only the fact of ANSWERING counts
            resolve("repond");
        });
        req.on("timeout", () => {
            req.destroy();
            resolve("muet");
        });
        req.on("error", (err) => {
            // ECONNREFUSED is the FRANK signal that nothing listens. Any other error
            // means something was reached without an answer — hence mute, not free.
            resolve(/** @type {any} */ (err).code === "ECONNREFUSED" ? "libre" : "muet");
        });
    });
}

/** Who holds this port? Best effort, Linux only — the message stands without it. */
function tenantDe(port) {
    const res = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
    if (res.status !== 0) return null;
    const ligne = String(res.stdout ?? "")
        .split("\n")
        .find((l) => l.includes(`:${port} `));
    if (!ligne) return null;
    const m = /users:\(\("([^"]+)",pid=(\d+)/.exec(ligne);
    return m ? `${m[1]} (pid ${m[2]})` : null;
}

async function main() {
    let config;
    try {
        config = (await import("../playwright.config.js")).default;
    } catch (err) {
        refuse([
            "  `playwright.config.js` est illisible — impossible de savoir quels ports seront",
            "  employés, donc impossible de conclure.",
            `  ${String(err).slice(0, 300)}`,
        ]);
    }

    const serveurs = Array.isArray(config?.webServer) ? config.webServer : [];

    // The nginx case: an empty `webServer` is this target's WANTED behaviour, not an outage.
    if (serveurs.length === 0) {
        console.log(
            `⏭️  [${TAG}] SAUTÉ — \`webServer\` est vide : la suite ne démarre aucun serveur.`
        );
        console.log(
            "    C'est le comportement de `E2E_TARGET=nginx`, où les variantes sont déjà servies.\n" +
                "    Ce n'est pas un vert de la garde : aucun port n'a été vérifié."
        );
        return;
    }

    const urls = serveurs.map((s) => s?.url).filter((u) => typeof u === "string");
    if (urls.length === 0) {
        refuse([
            "  `webServer` déclare des entrées mais AUCUNE `url` lisible.",
            "  L'oracle a changé de forme : cette garde vérifierait un ensemble vide et sortirait",
            "  verte en n'ayant rien sondé. Elle refuse plutôt que de le faire.",
        ]);
    }

    const muets = [];
    const ok = [];
    for (const url of urls) {
        const etat = await sonder(url);
        if (etat === "muet") muets.push(url);
        else ok.push(`${url} — ${etat === "libre" ? "libre" : "répond, réutilisable"}`);
    }

    if (muets.length > 0) {
        refuse([
            `  ${muets.length} port(s) TENU(S) mais qui ne répond(ent) pas :`,
            ...muets.map((u) => {
                const port = new URL(u).port;
                const qui = tenantDe(port);
                return `    ✗ ${u}${qui ? `  ← ${qui}` : ""}`;
            }),
            ...ok.map((l) => `    ✓ ${l}`),
            "",
            "  Playwright ne peut ni les réutiliser, ni s'y lier : il attendra 60 s puis rendra",
            "  `Timed out waiting 60000ms from config.webServer` — un message qui ne NOMME aucun",
            "  port, après avoir payé les builds qui précèdent.",
            "",
            "  Cause la plus fréquente : un run précédent tué (`timeout`, Ctrl-C) a laissé ses",
            "  `http-server` orphelins. Le geste :",
            "    ss -ltnp | grep -E '" + urls.map((u) => new URL(u).port).join("|") + "'",
            "    kill <pid>",
        ]);
    }

    console.log(`\x1b[32m✓\x1b[0m [${TAG}] ${ok.length} port(s) utilisable(s).`);
    for (const l of ok) console.log(`\x1b[2m    ${l}\x1b[0m`);
}

main();

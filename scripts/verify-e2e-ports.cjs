/*!
 * GeoLeaf — préambule E2E : les ports du harnais sont-ils utilisables ?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Le défaut, mesuré le 13/08/2026
 *
 * `npm run ci:local -- --e2e` a rendu, après 80 gates vertes et quatre builds :
 *
 *     Error: Timed out waiting 60000ms from config.webServer.
 *
 * Une minute perdue, et un message qui **ne nomme aucun port**. La cause était deux
 * `http-server` ORPHELINS tenant 8768 et 8769 — les restes d'un run précédent tué par un
 * `timeout`, que Playwright n'avait pas pu nettoyer. Après les avoir arrêtés, la suite est
 * repartie.
 *
 * ⚠️ **CE QUE CETTE GARDE N'AFFIRME PAS.** Que les orphelins aient été la CAUSE n'est pas
 * démontré : `reuseExistingServer` vaut `true` en local, donc un serveur vivant est censé être
 * réutilisé, et le port 8766 était libre. Le lien est un indice fort — la suite est repartie
 * après nettoyage — pas une preuve. Cette garde ne repose donc pas sur ce diagnostic : elle
 * vérifie une propriété **vraie indépendamment de lui**, à savoir que chaque port que Playwright
 * va employer est dans l'un des deux états qu'il sait traiter.
 *
 * ## Le prédicat, et pourquoi ce n'est PAS « le port doit être libre »
 *
 * `playwright.config.js` déclare `reuseExistingServer: !process.env.CI` : en local, un serveur
 * déjà là est **délibérément réutilisé**. Exiger un port libre ferait donc rougir la garde sur
 * le cas nominal de quiconque garde ses serveurs entre deux runs. Les trois états :
 *
 *   ① connexion REFUSÉE      → le port est libre, Playwright démarrera le sien.        ✅
 *   ② une réponse HTTP       → un serveur répond, Playwright le réutilisera.           ✅
 *   ③ ni l'un ni l'autre     → quelque chose TIENT le port sans répondre : Playwright  ❌
 *                              ne peut ni le réutiliser, ni s'y lier. C'est l'état qui
 *                              produit le timeout de 60 s, et le seul que l'on refuse.
 *
 * ## Ce qui est LU plutôt que deviné
 *
 * Les URL viennent de `playwright.config.js` lui-même, jamais d'une liste recopiée : une
 * seconde liste de ports diverge dès qu'on ajoute une variante, et la garde vérifierait alors
 * des ports que personne n'emploie tout en ignorant ceux qui comptent.
 *
 * ⚠️ **Sous `E2E_TARGET=nginx`, `webServer` est VIDE, et c'est le but de cette cible** : les
 * quatre variantes sont servies par le nginx de dev, la suite ne démarre rien. La garde SAUTE
 * alors, en le disant — jamais en silence, jamais en rendant un vert qui n'a rien vérifié.
 *
 * Usage : node scripts/verify-e2e-ports.cjs
 */
"use strict";

const http = require("node:http");
const { spawnSync } = require("node:child_process");

const TAG = "E2E-PORTS";

/** Délai au-delà duquel un port qui ne répond pas est tenu pour occupé-et-muet. */
const PROBE_TIMEOUT_MS = 3000;

/** Sortie d'outillage — jamais 0, jamais 1 : pouvoir jouer est un préalable, pas un verdict. */
function refuse(lignes) {
    console.error(`\x1b[31m✗\x1b[0m [${TAG}] La suite E2E NE PEUT PAS être jouée.`);
    for (const l of lignes) console.error(l);
    process.exit(2);
}

/**
 * Interroge une URL et classe le port dans l'un des trois états du bandeau.
 *
 * @param {string} url
 * @returns {Promise<"libre" | "repond" | "muet">}
 */
function sonder(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: PROBE_TIMEOUT_MS }, (res) => {
            res.resume(); // on ne lit pas le corps : seul le fait de RÉPONDRE compte
            resolve("repond");
        });
        req.on("timeout", () => {
            req.destroy();
            resolve("muet");
        });
        req.on("error", (err) => {
            // ECONNREFUSED est le signal FRANC que rien n'écoute. Toute autre erreur signifie
            // qu'on a joint quelque chose sans en tirer de réponse — donc muet, pas libre.
            resolve(/** @type {any} */ (err).code === "ECONNREFUSED" ? "libre" : "muet");
        });
    });
}

/** Qui tient ce port ? Meilleur effort, Linux seulement — le message vaut sans lui. */
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

    // Le cas nginx : `webServer` vide est le comportement VOULU de cette cible, pas une panne.
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

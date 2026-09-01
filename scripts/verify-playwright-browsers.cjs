/*!
 * GeoLeaf — E2E preamble: are Playwright's browsers really there?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The defect this guard exists to make LOUD
 *
 * On 2026-08-13, `npx playwright test` launched **no** test:
 *
 *     browserType.launch: Executable doesn't exist at
 *       ~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/…
 *
 * `ebb962b7` had taken `@playwright/test` from `^1.49.0` to `^1.62.1` — a
 * **deliberate** bump, from a Dependabot PR — and the required browser revision
 * had gone from 1217 to 1234. Nothing had reinstalled them.
 *
 * 🛑 **THE ASYMMETRY IS WHAT MAKES THIS GUARD NECESSARY, AND IT COMPOSES AT THE
 * WORST.** `ci.yml` runs `npx playwright install --with-deps chromium` **before
 * every** E2E run; locally, **nothing** does (`package.json` has only
 * `prepare: husky`). The side that works is thus the one whose E2E steps sit
 * under `workflow_dispatch`, which nobody triggers; the side one launches is the
 * broken one. The suite was **runnable where it is not launched, and dead where
 * it is**.
 *
 * ⚠️ **WHAT THIS GUARD DOES NOT BRING, AND WHAT A FIRST DRAFT LENT IT.** It was
 * justified by "the suite announces GREEN when the browser is missing". **That is
 * false, and the measurement says so**: browser removed, `npx playwright test`
 * returns `215 failed · 14 skipped · 3 passed` and **exit 1**. Playwright reports
 * correctly. What had lied was the READING INSTRUMENT — a `| tail -60` that cut
 * the `215 failed` line out of the window and, a pipeline's exit code being its
 * last link's, returned **0**. The false green was mine, not the tool's.
 *
 * ✅ **What it really brings, and which suffices to justify it**: it fails in **2
 * seconds with a diagnosis**, where the suite takes **1.2 minutes to render 215
 * identical reds**. And above all it DISTINGUISHES: 215 red tests look like a
 * catastrophic product regression, not an absent directory. Same family as "an
 * infrastructure red is indistinguishable from a gate red" — `CC-06`, then
 * `CC-01` launched from a `git worktree` without `node_modules` — except here
 * both reds exist: the problem is knowing WHICH one is being looked at.
 *
 * ## What this guard REFUSES, and why it exits 2
 *
 * It never renders a verdict on the suite: it only says whether the suite **can**
 * be played. A missing prerequisite thus exits **2** — refusal to conclude —
 * never 1, which would mean "the suite found a regression". Same partition as
 * `lib/consumer-manifest.cjs` and `lib/ts-decl-read.cjs`.
 *
 * ## The oracle, and the trap it carries
 *
 * `npx playwright install --dry-run <browser>` prints the **expected** install
 * paths without downloading anything. They are read; not guessed.
 *
 * 🛑 **NEVER PRESUME THE NAMES — THAT IS WHAT WOULD MAKE THIS GUARD HOLLOW.** For
 * the current version, `--dry-run chromium` announces **three** artifacts:
 * `chromium-1234`, `ffmpeg-1011` **and `chromium_headless_shell-1234`**. Yet the
 * artifact missing on the outage day is the **third**, not the one named
 * "chromium". A guard that had verified only `chromium-*` would have **gone green
 * on the very day of the defect it exists to catch**. Hence: everything
 * `--dry-run` prints is verified, whatever the names.
 *
 * ⚠️ **Do not replace this guard with "remember to run `playwright install`" in a
 * README.** The recipe is already printed by Playwright in its own error message:
 * what was missing is not knowledge of the remedy, it is that nobody was made
 * aware of the need.
 *
 * Usage : node scripts/verify-playwright-browsers.cjs
 */
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const TAG = "PW-BROWSERS";

/**
 * Browsers whose binaries are required.
 *
 * `playwright.config.js` declares a single project, `chromium` — also the only
 * one `ci.yml` installs. Widening this list without widening the other two places
 * would produce a guard demanding what nobody installs.
 */
const BROWSERS = ["chromium"];

/** Tooling exit — never 0, never 1: being able to play is a prerequisite, not a verdict. */
function refuse(lignes) {
    console.error(`\x1b[31m✗\x1b[0m [${TAG}] La suite E2E NE PEUT PAS être jouée.`);
    for (const l of lignes) console.error(l);
    process.exit(2);
}

/**
 * Returns the install paths the current Playwright version expects.
 *
 * @param {string} browser
 * @returns {string[]} absolute paths, as `--dry-run` prints them
 */
function cheminsAttendus(browser) {
    const res = spawnSync("npx", ["playwright", "install", "--dry-run", browser], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (res.error || res.status !== 0) {
        refuse([
            `  \`playwright install --dry-run ${browser}\` a échoué — impossible de savoir ce qui`,
            "  est attendu, donc impossible de conclure quoi que ce soit.",
            `  ${String(res.error ?? res.stderr ?? "")
                .trim()
                .slice(0, 300)}`,
        ]);
    }
    const out = String(res.stdout ?? "");
    const chemins = [...out.matchAll(/Install location:\s+(.+)/g)].map((m) => m[1].trim());
    if (chemins.length === 0) {
        refuse([
            `  \`--dry-run ${browser}\` n'a imprimé AUCUN « Install location ».`,
            "  L'oracle a changé de forme : cette garde comparerait deux ensembles vides et",
            "  sortirait verte en n'ayant rien vérifié. Elle refuse plutôt que de le faire.",
        ]);
    }
    return chemins;
}

function main() {
    const manquants = [];
    const vus = [];

    for (const browser of BROWSERS) {
        for (const chemin of cheminsAttendus(browser)) {
            // ⚠️ EVERY printed path is tested, no name filter: the missing
            // directory is `chromium_headless_shell-*`, not `chromium-*`.
            if (fs.existsSync(chemin)) vus.push(chemin);
            else manquants.push(chemin);
        }
    }

    // Non-emptiness floor: without it, an oracle gone mute would render this guard green.
    if (vus.length === 0 && manquants.length === 0) {
        refuse([
            "  aucun artefact à vérifier — l'oracle n'a rien rendu.",
            "  Une garde qui ne vérifie rien est indiscernable d'une garde qui passe.",
        ]);
    }

    if (manquants.length > 0) {
        refuse([
            `  ${manquants.length} artefact(s) attendu(s) et ABSENT(S) :`,
            ...manquants.map((c) => `    ✗ ${c}`),
            ...vus.map((c) => `    ✓ ${c}`),
            "",
            "  Playwright a changé de version sans que ses navigateurs soient réinstallés.",
            "  ⚠️ Sans ce refus, la suite se lancerait et rendrait ~215 rouges IDENTIQUES en 1,2 min —",
            "     ce qui ressemble à une régression du produit, pas à un répertoire absent.",
            "",
            `  Le geste : \x1b[1mnpx playwright install ${BROWSERS.join(" ")}\x1b[0m`,
        ]);
    }

    console.log(
        `\x1b[32m✓\x1b[0m [${TAG}] ${vus.length} artefact(s) présent(s) — la suite peut être jouée.`
    );
    for (const c of vus) console.log(`\x1b[2m    ${c}\x1b[0m`);
}

main();

/**
 * GUARD — a LAZY plugin subscribing to a boot signal must say HOW it survives
 * a late load.
 *
 * 🛑 WHY THIS GUARD EXISTS, AND WHY ITS SHAPE IS THIS ONE.
 *
 * The class closed on itself **twice, on two different plugins, in the same
 * file**: `realtime-layer` on 07/08/2026, then `geocoding` the next day. An
 * on-demand plugin setting its listener **at import time** listens to a
 * signal already gone — and the symptom is **entirely silent**: no error, no
 * trace, the feature simply never appears. Indistinguishable from a plugin
 * legitimately not required.
 *
 * `init.js`'s `beforeBoot` block has described this defect word for word
 * **since 07/08**, and did not prevent the next day's relapse. **Prose that
 * already failed to guard does not guard**; hence a test.
 *
 * ── WHAT THIS GUARD CAN AND CANNOT ────────────────────────────────────────────────────────
 *
 * ⚠️ It **does not prove** a plugin survives a late load — that would be
 * proven in a browser, loading it after the event, which is E2E's domain.
 * What it makes impossible is **the silent omission**: every non-preloaded
 * lazy plugin subscribing to a boot signal must appear below **with the
 * mechanism named**. A new plugin subscribing without an entry turns red; an
 * entry whose plugin no longer subscribes turns red too (otherwise the list
 * would fossilise, exactly what happened to this repo's ALLOWLISTs).
 *
 * ✅ **Seen turning red on ALL THREE mutations, on 17/08/2026**, before being
 * believed: entry removed from `SURVIVANTS_TARDIFS` → red naming `table` ·
 * stale entry added → red · inventory pattern made intolerant (hence empty
 * list) → red on the anti-empty-gate assertion
 * (`expected 0 to be greater than 5`). Without that third direction, the
 * suite would have come out **green having read nothing**.
 *
 * 📌 **The two plugins concerned survive by DIFFERENT mechanisms**, which is
 * the reason each entry carries text — a boolean guard would have suggested
 * a common property that does not exist:
 *   · `editor` — explicit fallback: after setting the listener, it tests
 *     `_getNativeMap()` and calls `_initOnMapReady()` right away if the map
 *     is already there;
 *   · `table` — the ACTION path: `TableLifecycle.ensureInitialized` is
 *     called by the toolbar button's handler, so the panel builds at the
 *     first click and does not depend on the listener.
 *
 * ⚠️ The lazy list is **derived from `init.js`**, never copied — and with a
 * pattern **tolerant to line wrapping**. `grep -c 'registerLazy("<nom>"'`
 * returns **0** on `realtime-layer`, which Prettier formats over three
 * lines: the registry's re-measure command fails precisely on the plugin
 * whose story this line tells.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..", "..", "..");
const INIT_JS = join(RACINE, "apps", "geoleaf-app", "init.js");
const PLUGINS = join(RACINE, "packages", "plugins");

/** The three signals `beforeBoot` names as emitted during boot. */
const SIGNAUX_DE_BOOT = ["geoleaf:profile:loaded", "geoleaf:map:ready", "geoleaf:app:ready"];

/**
 * The non-preloaded lazy plugins that still subscribe to a boot signal.
 * Each entry must name the real mechanism — not "ok", not "checked".
 */
const SURVIVANTS_TARDIFS: Record<string, string> = {
    editor: "Repli explicite dans `entry.ts` : après `addEventListener('geoleaf:map:ready', …)`, il teste `_getNativeMap()` et appelle `_initOnMapReady()` immédiatement si la carte existe déjà.",
    table: "Chemin d'action : `TableLifecycle.ensureInitialized` est appelé par le gestionnaire du bouton de barre d'outils, donc le panneau se construit au premier clic sans dépendre de l'écouteur posé par `init()`.",
    "position-share":
        "Repli explicite dans `lifecycle.ts` : après `addEventListener('geoleaf:app:ready', …)`, il teste `getNativeMap()` et appelle immédiatement le même travail si la carte existe déjà — une garde `_ran` empêche que l'écouteur et le repli le fassent tous les deux. Ce repli a été ajouté PARCE QUE cette garde a rougi : sans lui, un chargement au premier clic laissait le mode `auto` et la réception muets, sans trace.",
};

/** All of a source directory's `.ts`, recursively. */
function sourcesDe(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
            if (e === "__tests__" || e === "__mocks__" || e === "node_modules") continue;
            out.push(...sourcesDe(p));
        } else if (/\.ts$/.test(e) && !/\.d\.ts$/.test(e)) {
            out.push(p);
        }
    }
    return out;
}

/** A REAL subscription, not a comment mention. */
function sAbonneAuBoot(fichier: string): boolean {
    const t = readFileSync(fichier, "utf8");
    return SIGNAUX_DE_BOOT.some((sig) =>
        new RegExp(`addEventListener\\(\\s*["'\`]${sig}["'\`]`).test(t)
    );
}

const init = readFileSync(INIT_JS, "utf8");

/** ⚠️ Pattern TOLERANT to line wrapping — the defect being fixed. */
const PARESSEUX = [...init.matchAll(/registerLazy\(\s*["']([^"']+)["']/g)].map((m) => m[1]);

/** The preloaded: those `beforeBoot` pushes into `needed`. */
const PRECHARGES = [...init.matchAll(/needed\.push\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

describe("garde — un plugin paresseux qui écoute le boot dit comment il survit", () => {
    it("l'inventaire dérivé d'`init.js` n'est pas vide (sinon la garde ne garde rien)", () => {
        // 🛑 Anti-empty-gate assertion. Without it, an `init.js` rename or a
        // call-shape change would make this suite GREEN having read nothing —
        // the very class `probe-gate-visibility.cjs` watches elsewhere in this repo.
        expect(PARESSEUX.length).toBeGreaterThan(5);
        expect(PRECHARGES.length).toBeGreaterThan(0);
    });

    it("tout paresseux NON préchargé qui s'abonne à un signal de boot est déclaré avec son mécanisme", () => {
        const nonDeclares: string[] = [];
        for (const nom of PARESSEUX) {
            if (PRECHARGES.includes(nom)) continue; // préchargé avant les signaux : légitime
            const src = join(PLUGINS, nom, "src");
            if (!existsSync(src)) continue; // plugin hors de ce dépôt
            if (!sourcesDe(src).some(sAbonneAuBoot)) continue; // does not subscribe: nothing to say
            if (!(nom in SURVIVANTS_TARDIFS)) nonDeclares.push(nom);
        }
        expect(
            nonDeclares,
            `Ces plugins sont chargés à la demande, ne sont PAS préchargés par \`beforeBoot\`, ` +
                `et s'abonnent pourtant à un signal de boot : ${nonDeclares.join(", ")}.\n` +
                `Chargés après l'événement, ils poseraient un écouteur pour un signal déjà passé — ` +
                `et l'échec serait SILENCIEUX.\n` +
                `→ soit les précharger dans \`beforeBoot\` d'\`apps/geoleaf-app/init.js\`, ` +
                `soit leur donner un repli et l'inscrire dans \`SURVIVANTS_TARDIFS\` en NOMMANT le mécanisme.`
        ).toEqual([]);
    });

    it("aucune entrée de `SURVIVANTS_TARDIFS` n'est périmée", () => {
        // Without that direction, the list fossilises: a plugin that stops
        // subscribing would stay in it, and the next read would believe the
        // guard wider than it is.
        const perimees = Object.keys(SURVIVANTS_TARDIFS).filter((nom) => {
            const src = join(PLUGINS, nom, "src");
            if (!existsSync(src)) return true;
            return !sourcesDe(src).some(sAbonneAuBoot);
        });
        expect(
            perimees,
            `Ces entrées ne correspondent plus à rien — le plugin ne s'abonne plus à un signal ` +
                `de boot, ou n'existe plus : ${perimees.join(", ")}. Les retirer.`
        ).toEqual([]);
    });

    it("chaque mécanisme déclaré est une PHRASE, pas un tampon", () => {
        for (const [nom, motif] of Object.entries(SURVIVANTS_TARDIFS)) {
            expect(
                motif.length,
                `\`${nom}\` : le mécanisme doit être décrit, pas tamponné.`
            ).toBeGreaterThan(60);
        }
    });
});

#!/usr/bin/env node
/**
 * TPL-CFG — une couche produite par `layerTemplates` ne doit PAS porter de `_config.json`.
 *
 * 🛑 POURQUOI CETTE GATE EXISTE. `expandLayerTemplates`
 * (`kernel/config/profile-loader-helpers.ts`) construit un `inlineConfig` pour chaque instance
 * de template, et son TSDoc est explicite : « **skips the fetch entirely** ». Un `_config.json`
 * présent à côté d'une instance n'est donc **jamais lu** — ni par le loader, ni par le bundle
 * déployé (`profile-bundle.json` ne porte que les couches de `layers[]`).
 *
 * Mesuré au 06/08/2026, tâche 7.1b : `tourism` en portait **24**, soit **16 104 octets** de
 * configuration fantôme qui recopiaient mot pour mot les cinq blocs de leur template
 * (`zIndex`, `geometry`, `styles`, `table`, `clustering`). Aucune gate ne les voyait, et
 * `validate:profiles` les validait consciencieusement — ce qui les faisait passer pour vivants.
 *
 * ⚠️ **Le danger n'est pas l'octet, c'est la DIVERGENCE.** Un fichier mort qui ressemble à un
 * fichier vivant se fait éditer : on y corrige un `zIndex`, rien ne bouge à l'écran, et on
 * cherche le défaut ailleurs. C'est ce que cette gate empêche de revenir.
 *
 * Ce que la gate ne fait PAS : elle ne juge ni le contenu du template, ni celui des configs
 * directes. Elle vérifie une seule chose — qu'aucun fichier ne prétende configurer une couche
 * dont la configuration vient d'ailleurs.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PROFILES = path.join(ROOT, "profiles");

/**
 * Les instances de `layerTemplates`, par profil.
 *
 * @returns {{ profile: string, id: string }[]}
 */
function templateInstances() {
    /** @type {{ profile: string, id: string }[]} */
    const out = [];
    if (!fs.existsSync(PROFILES)) return out;

    for (const entry of fs.readdirSync(PROFILES, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "schemas") continue;
        const layersFile = path.join(PROFILES, entry.name, "config", "core", "layers.json");
        if (!fs.existsSync(layersFile)) continue;

        const data = JSON.parse(fs.readFileSync(layersFile, "utf8"));
        for (const tpl of data.layerTemplates ?? []) {
            for (const inst of tpl.instances ?? []) {
                if (inst && typeof inst.id === "string") {
                    out.push({ profile: entry.name, id: inst.id });
                }
            }
        }
    }
    return out;
}

function main() {
    const instances = templateInstances();

    // 🛑 Assertion anti-gate-vide. Sans sujet, cette gate sortirait verte en n'ayant rien
    // scanné — exactement la classe que `probe-gate-visibility.cjs` surveille. Si plus aucun
    // profil n'utilise `layerTemplates`, c'est la gate qu'il faut retirer, pas son silence
    // qu'il faut accepter.
    if (instances.length === 0) {
        console.error(
            "\n❌ [TPL-CFG] aucune instance de `layerTemplates` trouvée — la gate n'a RIEN scanné.\n" +
                "   Soit `layerTemplates` a disparu des profils (alors retirer cette gate),\n" +
                "   soit la lecture de `config/core/layers.json` est cassée.\n"
        );
        process.exit(1);
    }

    const offenders = instances
        .map(({ profile, id }) => ({
            profile,
            id,
            rel: `profiles/${profile}/layers/${id}/${id}_config.json`,
        }))
        .filter((c) => fs.existsSync(path.join(ROOT, c.rel)));

    if (offenders.length > 0) {
        const bytes = offenders.reduce(
            (sum, o) => sum + fs.statSync(path.join(ROOT, o.rel)).size,
            0
        );
        console.error(
            `\n❌ [TPL-CFG] ${offenders.length} config(s) de couche JAMAIS LUE(S) — ${bytes} octets :\n`
        );
        for (const o of offenders) console.error(`     - ${o.rel}`);
        console.error(
            "\n  Ces couches viennent de `layerTemplates`, dont l'`inlineConfig` « skips the\n" +
                "  fetch entirely ». Leur `_config.json` n'est lu ni par le loader, ni par le\n" +
                "  bundle déployé — mais il se fait éditer, et la divergence est silencieuse.\n" +
                "  Geste : supprimer le fichier, et porter la valeur au `template` si elle\n" +
                "  doit s'appliquer à toutes les instances.\n"
        );
        process.exit(1);
    }

    console.log(
        `✅ [TPL-CFG] ${instances.length} couche(s) templatée(s) sur ${new Set(instances.map((i) => i.profile)).size} profil(s) — aucune config fantôme.`
    );
}

main();

#!/usr/bin/env node
/**
 * TPL-CFG — a layer produced by `layerTemplates` must NOT carry a `_config.json`.
 *
 * 🛑 WHY THIS GATE EXISTS. `expandLayerTemplates`
 * (`kernel/config/profile-loader-helpers.ts`) builds an `inlineConfig` for each
 * template instance, and its TSDoc is explicit: "**skips the fetch entirely**".
 * A `_config.json` present beside an instance is thus **never read** — neither
 * by the loader, nor by the deployed bundle (`profile-bundle.json` carries only
 * the `layers[]` layers).
 *
 * Measured on 2026-08-06: `tourism` carried **24** of them, i.e. **16,104
 * bytes** of ghost configuration copying word for word their template's five
 * blocks (`zIndex`, `geometry`, `styles`, `table`, `clustering`). No gate saw
 * them, and `validate:profiles` validated them conscientiously — which made them
 * pass for alive.
 *
 * ⚠️ **The danger is not the byte, it is DIVERGENCE.** A dead file that looks
 * like a live one gets edited: a `zIndex` is fixed there, nothing moves on
 * screen, and the defect is hunted elsewhere. That is what this gate keeps from
 * returning.
 *
 * What the gate does NOT do: it judges neither the template's content, nor the
 * direct configs'. It verifies one thing — that no file claims to configure a
 * layer whose configuration comes from elsewhere.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PROFILES = path.join(ROOT, "profiles");

/**
 * The `layerTemplates` instances, per profile.
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

    // 🛑 Anti-empty-gate assertion. Without a subject, this gate would go green
    // having scanned nothing — exactly the class `probe-gate-visibility.cjs`
    // watches. If no profile uses `layerTemplates` anymore, it is the gate that
    // must be removed, not its silence that must be accepted.
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

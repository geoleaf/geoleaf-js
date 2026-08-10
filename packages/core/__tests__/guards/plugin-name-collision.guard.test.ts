/**
 * Guard PNC — aucun plugin ne porte un nom que le rapport de boot traite comme du core.
 *
 * ## Le défaut, et pourquoi il est silencieux
 *
 * `reportPlugins()` (`kernel/api/plugin-registry.ts`) filtre sa liste avec `_isCoreName()`,
 * une liste de noms **en dur**. Le risque n'est pas la liste — c'est la **collision** : un
 * plugin qui s'enregistrerait sous `themes`, `legend`, `route`, `labels` ou `layerManager`
 * disparaîtrait du rapport de chaque boot, **en sortant 0**. Il serait chargé, fonctionnel,
 * et invisible. Le fichier porte déjà la trace d'un cas réel : `"table"` a figuré dans cette
 * liste alors que `plugins/table` est un plugin autonome depuis plusieurs sprints, et
 * « keeping it here silently hid a real plugin from every boot report ».
 *
 * ## Deux règles, et une troisième qui garde l'instrument
 *
 *   PNC-01  **Aucun nom de répertoire de plugin dans `_isCoreName()`.** C'est la forme que
 *           `registry.plugins()` connaît, et celle que le build manipule.
 *   PNC-02  **Aucun nom RÉELLEMENT enregistré dans `_isCoreName()`.** C'est la chaîne que
 *           `reportPlugins()` compare à l'exécution — la seule qui décide vraiment. Elle
 *           coïncide aujourd'hui avec le nom de répertoire pour les 12 plugins, mais rien
 *           dans le code ne l'impose : PNC-01 seule serait aveugle à un plugin qui
 *           s'enregistrerait sous un autre nom que son dossier.
 *   PNC-03  **Les deux extracteurs doivent avoir trouvé quelque chose.** C'est la règle qui
 *           garde la garde, et elle n'est pas théorique ici : la première version de ce
 *           relevé cherchait `plugins.register(` et ne voyait **que 7 plugins sur 12** —
 *           les 5 autres écrivent `plugins?.register?.(`, avec chaînage optionnel. Un
 *           extracteur myope rend une garde verte sur le sous-ensemble qu'il sait lire.
 *
 * ## Preuve par mutation — à rejouer avant de croire cette garde
 *
 * Renommer `packages/plugins/measure/` en `packages/plugins/themes/` doit faire rougir
 * **PNC-01** en nommant `themes` ; remplacer `register?.("measure"` par `register?.("legend"`
 * dans son `entry.ts` doit faire rougir **PNC-02**. Vu rouge sur les deux le 07/08/2026.
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 7, tâche 7.3
 * @see packages/core/src/kernel/api/plugin-registry.ts — `_isCoreName()`, le sujet
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

// `packages.cjs` est le registre unique des paquets — il JETTE si rien n'est trouvé, ce qui
// est précisément pourquoi on ne globe pas `packages/plugins/*` à la main ici.
const packages = createRequire(import.meta.url)(path.join(REPO, "scripts/lib/packages.cjs"));

const PLUGIN_REGISTRY_SRC = path.join(REPO, "packages/core/src/kernel/api/plugin-registry.ts");

/**
 * Les noms traités comme du core, LUS dans le corps de `_isCoreName()`.
 *
 * Lus plutôt que recopiés : une copie diverge, et la garde certifierait alors une liste que
 * le runtime n'utilise plus. Même patron que `KNOWN_DEFAULT_DRIFT` dans
 * `capabilities/config-schema-defaults.test.js`, qui lit son voisin au lieu de le dupliquer.
 *
 * Non exporté depuis le module : `check-orphan-exports.cjs` exclut `__tests__` de son corpus,
 * donc un export dont le seul consommateur est ce fichier entrerait en baseline comme orphelin.
 */
function readCoreNames() {
    const src = fs.readFileSync(PLUGIN_REGISTRY_SRC, "utf8");
    const body = src.slice(src.indexOf("function _isCoreName"));
    const arr = body.slice(body.indexOf("["), body.indexOf("]") + 1);
    // ⚠️ Les commentaires DOIVENT tomber avant l'extraction. Le tableau porte une note
    // expliquant pourquoi `"table"` en a été RETIRÉ (API S1) — en citant le nom entre
    // guillemets, à l'intérieur du littéral. Un extracteur naïf le relit comme une entrée
    // vivante et accuse `plugins/table` d'une collision qui a justement été réparée. Vu à
    // la pose de cette garde : elle rougissait sur `table`, et c'était elle qui avait tort.
    const code = arr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    return [...code.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Le nom que chaque plugin passe RÉELLEMENT à `plugins.register(...)`, chaînage compris. */
function readRegisteredNames(pluginDir) {
    const names = new Set();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
                continue;
            }
            if (!/\.(ts|js)$/.test(e.name)) continue;
            const src = fs.readFileSync(p, "utf8");
            // ⚠️ Le `\??` sur CHAQUE maillon est ce qui manquait au premier relevé :
            // `plugins?.register?.(` est la forme des 5 plugins passés par host-runtime.
            for (const m of src.matchAll(/plugins\??\.register\??\.?\(\s*"([^"]+)"/g)) {
                names.add(m[1]);
            }
        }
    };
    const srcDir = path.join(pluginDir, "src");
    if (fs.existsSync(srcDir)) walk(srcDir);
    return [...names];
}

const CORE_NAMES = readCoreNames();
const PLUGINS = packages.plugins().map((p) => ({
    dirName: p.dirName,
    registered: readRegisteredNames(p.absDir),
}));

describe("PNC — noms de plugin ↔ liste `_isCoreName()` du rapport de boot", () => {
    it("PNC-03 — les deux extracteurs ont trouvé quelque chose", () => {
        // Sans ça, PNC-01 et PNC-02 passeraient sur l'ensemble vide : une garde verte qui
        // n'a rien lu. C'est le mode d'échec que ce dépôt nomme « anti-gate-vide ».
        expect(CORE_NAMES.length).toBeGreaterThan(0);
        expect(CORE_NAMES).toContain("core"); // canari : si l'extraction dérape, elle rougit ici
        expect(PLUGINS.length).toBeGreaterThan(0);

        const mute = PLUGINS.filter((p) => p.registered.length === 0).map((p) => p.dirName);
        expect(
            mute,
            `Plugin(s) dont aucun appel \`plugins.register("…")\` n'a été trouvé dans src/ : ` +
                `${mute.join(", ")}. Soit ils ne s'enregistrent plus, soit la forme d'appel a ` +
                `changé et PNC-02 est devenue aveugle à eux — les deux se corrigent ici, ` +
                `jamais en retirant le plugin de la liste.`
        ).toEqual([]);
    });

    it("PNC-01 — aucun nom de répertoire de plugin n'est traité comme du core", () => {
        const clashes = PLUGINS.filter((p) => CORE_NAMES.includes(p.dirName)).map((p) => p.dirName);
        expect(
            clashes,
            `Répertoire(s) de plugin dont le nom figure dans _isCoreName() : ${clashes.join(", ")}. ` +
                `Ces plugins disparaîtraient du rapport de boot en sortant 0. Renommer le plugin, ` +
                `ou retirer le nom de _isCoreName() dans plugin-registry.ts.`
        ).toEqual([]);
    });

    it("PNC-02 — aucun nom réellement enregistré n'est traité comme du core", () => {
        const clashes = PLUGINS.flatMap((p) =>
            p.registered.filter((n) => CORE_NAMES.includes(n)).map((n) => `${p.dirName} → "${n}"`)
        );
        expect(
            clashes,
            `Plugin(s) s'enregistrant sous un nom que _isCoreName() masque : ${clashes.join(", ")}. ` +
                `C'est la chaîne que reportPlugins() compare à l'exécution — la collision est réelle, ` +
                `pas potentielle.`
        ).toEqual([]);
    });
});

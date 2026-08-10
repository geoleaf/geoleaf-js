/*!
 * GeoLeaf — the PUBLISHED recipe, exercised.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * A custom entry in the same shape as `examples/minimal/entry.ts`, written the way a real
 * integrator must write it: through the **published npm subpaths** (`@geoleaf/core/kernel`,
 * `@geoleaf/core/capabilities/<id>/install.js`, …), not through relative `../../src/` paths
 * that only exist inside this repository.
 *
 * ⚠ This paragraph said « **the same nine capabilities** » as `minimal`, which embarks **six**.
 * The two lists differ on purpose — see §Ce que cette entrée embarque below — and the count is
 * no longer written here: it is the `caps=` of the generated region, read by the guard.
 *
 * ## Why this file exists (S6)
 *
 * `examples/minimal/entry.ts` proves that the *source graph* tree-shakes. It cannot prove that
 * the *published package* does — and in S6 we found out the hard way that the two had diverged:
 *
 *   - the recipe documented in COOKBOOK.md pointed at `@geoleaf/core/src/…`, which `files`
 *     never publishes and `exports` never exposes: it could not have worked for anybody;
 *   - `dist/esm/` — the artifact `exports["."]` resolves to — was being built with a
 *     `moduleSideEffects` heuristic that dropped the three modules mutating the `Config`
 *     singleton, so `import { Config } from "@geoleaf/core"` shipped a `Config` with no `.get()`.
 *
 * Neither defect was visible from inside the repo. Both are visible from here. This entry is
 * bundled on every build and measured by `scripts/check-consumer-bundle.cjs`, which asserts that
 * the published package (a) resolves every subpath, (b) tree-shakes the capabilities this entry
 * does not list, and (c) keeps the side-effect modules that `package.json#sideEffects` promises
 * to keep.
 *
 * ## Ce que cette entrée embarque, et pourquoi PAS la même chose que `minimal`
 *
 * 🛑 Cette section a dit « **Keep this list in lock-step with `examples/minimal/entry.ts`** —
 * the two entries embark the same capabilities on purpose » jusqu'au 07/08/2026, et la consigne
 * était **périmée d'un jour**. Mesuré : elle a été écrite le **14/07/2026** (S6 presets), et
 * l'exclusion délibérée de `cluster`, `toast-renderer` et `geolocation` dans `minimal` a été
 * écrite le **15/07/2026** (S7), avec son motif. Personne n'a retiré la première.
 *
 * Les deux entrées ne prouvent **pas la même chose**, donc elles n'embarquent pas la même liste :
 *
 *   - `minimal` **exclut** `cluster`, `toast-renderer` et `geolocation` — ces trois-là
 *     étaient épinglées par un import statique depuis du code de kernel eager, et leur absence
 *     du bundle est ce qui prouve que le service locator les a bien déliées. C'est le versant
 *     **exclusion**, mesuré par `size:example` sur le graphe de SOURCES.
 *   - `consumer` les **inclut** — parce que ce qu'elle éprouve est la résolution des
 *     sous-chemins npm et le `sideEffects` du **paquet publié**, ce qui demande de traverser
 *     le plus de chemins possible, pas le moins.
 *
 * ⚠️ Ces deux puces ont porté un compte — « `minimal` (6) » et « `consumer` (9) » — jusqu'au
 * 08/08/2026, alors que l'en-tête affirme trente lignes plus haut que le compte n'est plus écrit
 * ici mais dérivé du `caps=` de la région générée. Le fichier se contredisait lui-même. B-43 :
 * les deux nombres sont RETIRÉS, pas corrigés — le `caps=` du marqueur est le registre.
 *
 * ⚠️ Ce que 8.3 croyait être une **dérive** (6 contre 9) est donc une divergence **voulue et
 * documentée des deux côtés**. Ce qui manquait n'était pas l'égalité des listes — c'était que
 * chaque entrée soit vraie par construction. C'est ce que la région générée ci-dessous apporte.
 *
 * ## La région bornée
 *
 * Tout ce qui suit `@geoleaf:gen:start` est **généré** par `scripts/gen-entry.cjs` depuis la
 * liste `caps=` du marqueur : noms de const, ordre de chargement (celui de `FULL.capabilities`),
 * chemins d'import et façades ré-exportables en dérivent. Ne pas l'éditer à la main — le garde
 * `__tests__/guards/generated-entries.guard.test.ts` régénère et compare.
 */
"use strict";

// @geoleaf:gen:start caps=taxonomy,feature-info,cluster,toast-renderer,legend,coordinates,scale,geolocation,permalink mode=npm id=consumer

// ── 1. Kernel side-effects — les deux que l'entrée livrée importe aussi ──────
import "@geoleaf/core/globals";
import "@geoleaf/core/helpers";

// ── 2. Le manifeste — les capacités que CE bundle embarque ───────────────────
import type { PresetManifest } from "@geoleaf/core/contracts/preset.contract.js";
import { COORDINATES_INSTALLER } from "@geoleaf/core/capabilities/coordinates/install.js";
import { SCALE_INSTALLER } from "@geoleaf/core/capabilities/scale/install.js";
import { GEOLOCATION_INSTALLER } from "@geoleaf/core/capabilities/geolocation/install.js";
import { TAXONOMY_INSTALLER } from "@geoleaf/core/capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "@geoleaf/core/capabilities/feature-info/install.js";
import { CLUSTER_INSTALLER } from "@geoleaf/core/capabilities/cluster/install.js";
import { TOAST_RENDERER_INSTALLER } from "@geoleaf/core/capabilities/toast-renderer/install.js";
import { LEGEND_INSTALLER } from "@geoleaf/core/capabilities/legend/install.js";
import { PERMALINK_INSTALLER } from "@geoleaf/core/capabilities/permalink/install.js";

const MANIFEST: PresetManifest = {
    id: "consumer",
    capabilities: [
        COORDINATES_INSTALLER,
        SCALE_INSTALLER,
        GEOLOCATION_INSTALLER,
        TAXONOMY_INSTALLER,
        FEATURE_INFO_INSTALLER,
        CLUSTER_INSTALLER,
        TOAST_RENDERER_INSTALLER,
        LEGEND_INSTALLER,
        PERMALINK_INSTALLER,
    ],
};

// ── 3. Installer le boot, lié à ce manifeste ─────────────────────────────────
import { installBoot } from "@geoleaf/core/boot";

installBoot(MANIFEST);

// ── 4. Surface ESM publique ──────────────────────────────────────────────────
export * from "@geoleaf/core/kernel";

export { Notifications } from "@geoleaf/core/capabilities/toast-renderer/public-api.js";
export { Legend } from "@geoleaf/core/facades/legend.js";
export { Permalink } from "@geoleaf/core/facades/permalink.js";
export { Share } from "@geoleaf/core/facades/share.js";

export default typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]
    : {};

// @geoleaf:gen:end

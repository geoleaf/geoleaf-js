/**
 * Guard MFC — le manifeste livré embarque TOUTES les capacités in-core, et il le prouve
 * contre le disque plutôt que contre un nombre écrit à la main.
 *
 * ## Le défaut, mesuré
 *
 * Quatre en-têtes du dépôt annonçaient le nombre de capacités in-core, et **aucun n'était
 * juste** : `presets/manifest.full.ts` disait « 18 », `app/boot.ts` disait « 17 », et le
 * vrai compte était **21** (B-43, qui a retiré les deux). Restaient au 07/08/2026 —
 * socle-init 7.1 — `bundle-esm-entry.ts` (« all 18 ») et `kernel-exports.ts` (« all 17 »),
 * plus un cas pire : `kernel-exports.ts:37` annonçait **9** capacités à côté du nom de
 * `examples/minimal/entry.ts`, qui en embarque **6** — 9 étant le compte de `consumer`.
 * Une ligne qui pointe un fichier et donne le nombre d'un autre.
 *
 * ## Pourquoi une garde, et pas une correction de plus
 *
 * Un nombre en prose est une **seconde source de vérité** : il ne peut que diverger, et sa
 * divergence est indiscernable de la justesse pour tout outil du dépôt. La doctrine B-43 est
 * donc de **ne pas l'écrire** — c'est ce que font désormais les quatre en-têtes. Ce qui reste
 * à tenir, c'est la promesse elle-même : *« l'entrée livrée embarque tout »*. Elle se tient
 * ici, contre `readdirSync`.
 *
 * ⚠️ Ce que la garde attrape vraiment n'est pas le commentaire — c'est **une capacité qui
 * existe sur le disque et que le manifeste n'embarque pas**. Elle serait alors absente du
 * bundle livré, silencieusement : aucun test de capacité ne rougit pour une capacité qu'on
 * n'a jamais installée.
 *
 * ## Les trois règles
 *
 *   MFC-01  **Aucune capacité orpheline.** Tout répertoire de `src/capabilities/` portant un
 *           `install.ts` doit voir son installer dans `FULL.capabilities`.
 *   MFC-02  **Aucun installer fantôme.** Réciproquement, tout membre de `FULL.capabilities`
 *           doit venir d'un `install.ts` présent sur le disque — sinon le manifeste embarque
 *           une capacité que le répertoire ne porte plus.
 *   MFC-03  **Le corpus ne peut pas être vide.** Une garde verte qui n'a rien scanné est le
 *           pire des résultats — même classe que DIST-03, JTD-03 et EOD-03. Ici le piège est
 *           réel : un glob qui cesse de matcher rendrait `{}`, et les deux règles au-dessus
 *           passeraient sur l'ensemble vide.
 *
 * ## Preuve par mutation — à rejouer avant de croire cette garde
 *
 * `mkdir packages/core/src/capabilities/__fake22__ && cp …/scale/install.ts …/__fake22__/`
 * doit faire rougir **MFC-01** en nommant `__fake22__`. Vu rouge le 07/08/2026 à la pose.
 * Le retrait d'une ligne de `FULL.capabilities` doit le faire rougir de même.
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 7, tâche 7.1
 * @see packages/core/src/presets/manifest.full.ts — le sujet
 */
import { describe, expect, it } from "vitest";

const { FULL } = await import("../../src/presets/manifest.full.ts");

// Glob statique : les modules sont énumérés au transform, donc un répertoire de capacité qui
// disparaît ne peut pas être silencieusement sauté par un import dynamique qui échoue. Même
// patron que `doc-capability-config.guard.test.js`.
const INSTALL_MODULES = import.meta.glob("../../src/capabilities/*/install.ts");

/** `../../src/capabilities/<nom>/install.ts` → `<nom>`. */
function capabilityDirOf(globKey) {
    return globKey.replace(/^.*\/capabilities\//, "").replace(/\/install\.ts$/, "");
}

/**
 * L'unique installer exporté par un `install.ts`.
 *
 * Chacun n'en exporte qu'un (`<NOM>_INSTALLER`), mais on ne se fie pas au NOM : le dériver du
 * répertoire re-introduirait exactement la convention implicite que cette garde existe pour
 * ne pas avoir à supposer. On prend l'export qui porte une `declaration`.
 */
function installerOf(mod, dir) {
    const found = Object.values(mod).filter(
        (v) => v && typeof v === "object" && "declaration" in v
    );
    if (found.length !== 1) {
        throw new Error(
            `[MFC] ${dir}/install.ts exporte ${found.length} installer(s) — il en faut exactement 1.`
        );
    }
    return found[0];
}

describe("MFC — manifeste livré ↔ répertoires de capacités (lus sur le disque)", () => {
    it("MFC-03 — le corpus scanné n'est pas vide", () => {
        // Anti-gate-vide : si le glob cesse de matcher (déplacement de `capabilities/`,
        // renommage de `install.ts`), les deux règles suivantes passeraient sur l'ensemble
        // vide et cette garde sortirait verte en ne gardant plus rien.
        expect(Object.keys(INSTALL_MODULES).length).toBeGreaterThan(0);
        expect(FULL.capabilities.length).toBeGreaterThan(0);
    });

    it("MFC-01 — toute capacité présente sur le disque est embarquée par FULL", async () => {
        const embarked = new Set(FULL.capabilities);
        const missing = [];

        for (const [key, load] of Object.entries(INSTALL_MODULES)) {
            const dir = capabilityDirOf(key);
            const installer = installerOf(await load(), dir);
            if (!embarked.has(installer)) missing.push(dir);
        }

        expect(
            missing,
            `Capacité(s) présente(s) dans src/capabilities/ mais ABSENTE(S) de FULL.capabilities : ` +
                `${missing.join(", ")}. Elles ne partent pas dans le bundle livré. ` +
                `Ajouter leur installer à packages/core/src/presets/manifest.full.ts.`
        ).toEqual([]);
    });

    it("MFC-02 — FULL n'embarque aucun installer sans répertoire sur le disque", async () => {
        const onDisk = new Set();
        for (const [key, load] of Object.entries(INSTALL_MODULES)) {
            onDisk.add(installerOf(await load(), capabilityDirOf(key)));
        }

        const ghosts = FULL.capabilities
            .filter((inst) => !onDisk.has(inst))
            .map((inst) => inst?.declaration?.id ?? "<sans id>");

        expect(
            ghosts,
            `FULL.capabilities embarque ${ghosts.length} installer(s) qu'aucun ` +
                `src/capabilities/*/install.ts ne fournit : ${ghosts.join(", ")}.`
        ).toEqual([]);
    });

    it("les deux ensembles ont donc la même taille — le compte n'est écrit nulle part", () => {
        // ⚠️ Cette assertion n'écrit PAS le nombre (B-43). Elle le dérive des deux côtés, ce
        // qui est précisément la différence entre « structurellement vrai » et « vrai le jour
        // où quelqu'un l'a tapé ».
        expect(FULL.capabilities.length).toBe(Object.keys(INSTALL_MODULES).length);
    });
});

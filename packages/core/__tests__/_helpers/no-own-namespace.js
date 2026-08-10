/**
 * @file no-own-namespace.js
 * @description Les plugins qui ne montent AUCUN namespace propre — la liste, le motif de chacun,
 * et la surface qu'ils PILOTENT à la place.
 *
 * ## Pourquoi cette liste vit ici, et non dans l'un des deux gardes qui la lisent
 *
 * Le fait qu'elle énonce — « ce plugin ne pose pas de façade » — n'appartient à aucun des deux.
 * `guards/plugin-namespace-declared.guard.test.js` en tire une **dispense de déclaration** dans
 * `GeoLeafGlobal` ; `guards/doc-plugin-manifest.guard.test.js` en tire ce que la **fiche** doit
 * écrire dans sa ligne `namespace`. Deux copies dériveraient — et le jour où l'une solderait une
 * entrée, l'autre continuerait de dispenser. C'est le motif déjà écrit pour `KNOWN_DEFAULT_DRIFT`,
 * que `doc-capability-config.guard.test.js` **lit à sa source** au lieu de la recopier.
 *
 * ⚠️ **Ce fichier n'est pas une suite de tests.** `packages/core/vitest.config.ts` ne collecte que
 * les fichiers en `.test.js` : un helper sous `__tests__/_helpers/` n'y devient pas un fichier de
 * test vide, il reste un module importable. Deux voisins suivent déjà ce patron
 * (`load-wired-config.js`, `dom-create-double.js`).
 *
 * ## Ce qui rend une entrée FALSIFIABLE — et pourquoi `motif` ne suffisait pas
 *
 * Jusqu'au 28/07/2026 cette liste ne portait qu'un `motif`, c'est-à-dire de la **prose que rien
 * ne lisait**. Une entrée était donc indistinguable d'une dispense de complaisance : n'importe
 * quel plugin ayant *oublié* sa façade pouvait y être inscrit et faire taire le garde.
 *
 * Les deux champs ajoutés ferment ce trou, et ils ne sont pas décoratifs — le garde propriétaire
 * les VÉRIFIE :
 *
 *  - `drives` — la surface du CORE que le plugin pilote à la place de la sienne. Le garde exige
 *    que l'`entry.ts` l'atteigne réellement. Un plugin qui a simplement oublié sa façade ne
 *    pilote **rien**, donc ne peut pas satisfaire cette assertion.
 *  - `owner` — le fichier du core qui POSE cette surface. Le garde exige qu'il existe. Une
 *    exemption qui pointe un fichier disparu dispense encore, mais ne renseigne plus.
 *
 * Même patron que `NO_CONFIG_ACCESSOR` (`__tests__/capabilities/scaffold-taxonomy.test.js`) et
 * `NO_CAPABILITY_CONFIG` (`__tests__/guards/doc-capability-config.guard.test.js`).
 */
"use strict";

/** @type {Record<string, { motif: string, drives: string, owner: string }>} */
export const NO_OWN_NAMESPACE = {
    "offline-ui": {
        motif: "ne monte aucun namespace propre : il PILOTE `GeoLeaf.Storage`, une façade du CORE (capacité `offline`). Son `healthCheck` interroge donc volontairement une surface qu'il n'a pas posée, et son `entry.ts` l'écrit en toutes lettres",
        /** Surface du core réellement pilotée — vérifiée présente dans son `entry.ts`. */
        drives: "GeoLeaf.Storage",
        /** Qui pose cette surface — vérifié existant sur le disque. */
        owner: "packages/core/src/kernel/storage/facade.ts",
    },
};

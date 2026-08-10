/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Barrel — Log module public API
 */

export { Log } from "./logger.js";
// Types LogLevelName, LogImplInterface: import from './logger.js' (avoid export type for Rollup compatibility when consumed by plugins)

// STRUCT S6 — `ErrorLogger` a rejoint ce répertoire (ex-`utils/general/error-logger.ts`), à
// côté de `logger.ts` qui est sa seule dépendance. Il n'est DÉLIBÉRÉMENT PAS sur ce baril,
// contre l'intention initiale du sprint — mesure qui a renversé la décision : **151 fichiers de
// test mockent ce baril**, et un `vi.mock` doit déclarer tout export que le module sous test y
// prend. L'y inscrire taxait donc 151 fichiers d'un stub, au bénéfice d'**un seul importeur
// réel** (`utils/general/utils-namespace.ts`, qui compose `GeoLeaf.Utils.ErrorLogger`).
//
// Ce n'est pas un contournement du motif de médiation décrit en ARCHI S12.2 : ce motif vaut pour
// `Log`, que 117 fichiers prennent ICI. Un export à importateur unique n'est pas de la médiation.
// La même asymétrie est déjà documentée dans l'autre sens au CDC — « avant de conclure qu'un
// baril est mort, vérifier QUI l'importe : un importateur unique peut être le résultat attendu ».
// Bénéfice de bord : `error-logger.ts` garde son `Log` par ce baril, donc les mocks existants
// continuent de l'intercepter, et aucun cycle ne se forme.

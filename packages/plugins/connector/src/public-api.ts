/*!
 * GeoLeaf Connector — Public API
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * La surface publique du plugin, montée sur `GeoLeaf.Connector`.
 *
 *
 * ## Pourquoi ce fichier existe (API publique S4.7)
 *
 * Ce n'est pas de l'uniformité cosmétique. `scripts/check-facade-purity.cjs` (INV-FACADE)
 * énumère les façades à contrôler **par existence de fichier** : elle balaie tout paquet
 * portant un `src/public-api.ts`, et ceux qui n'en ont pas lui échappent intégralement. Le
 * connector montait son namespace par un objet littéral dans `entry.ts` — donc hors du champ
 * de la gate, comme `addpoi` et `storage`.
 *
 * Créer ce fichier est ce qui fait entrer le paquet dans le contrôle. Rien à ajouter au
 * script : sa seule liste est le système de fichiers, et c'est ce qui la rend incorruptible.
 *
 * ## La grammaire, et pourquoi le corps de `openLoginModal` n'est pas ici
 *
 * La gate n'accepte qu'un **délégué mince** : un raccourci vers un symbole importé, ou une
 * méthode dont le corps est UN appel de transfert. `openLoginModal` porte un `if` et un
 * `throw` — deux instructions — donc son corps vit dans `connector-api.ts`, avec l'état qu'il
 * lit. Ce fichier ne fait que nommer la surface.
 *
 * ⚠️ `buildPublicApi` doit rester la SEULE fonction locale de ce fichier : la gate rejette
 * toute autre déclaration.
 */

import { configure, openLoginModal } from "./connector-api.js";

/** @internal Rend la surface publique du plugin, sous la forme montée sur le namespace. */
export function buildPublicApi() {
    return { configure, openLoginModal };
}

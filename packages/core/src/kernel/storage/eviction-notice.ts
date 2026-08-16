/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file eviction-notice.ts
 * @description L'unique écouteur in-core de `geoleaf:cache:evicted` — B-163.
 *
 * 🛑 POURQUOI CE FICHIER EXISTE. Le core ÉMET l'alerte d'éviction depuis deux endroits
 * et ne l'écoutait nulle part : le seul `addEventListener` du dépôt vivait dans
 * `offline-ui`, un plugin **gaté, absent de `deploy-core`**. Sur cette variante — celle
 * qui part chez un client — l'avis partait dans le vide depuis toujours. Ce n'est pas du
 * poids, c'est de la perte de données : l'utilisateur ne savait pas que la place manquait.
 *
 * ## Les deux émetteurs, et pourquoi UN écouteur suffit
 *
 *   1. `kernel/storage/sw-register.ts` — le pont `_wireEvictionBridge()`, qui retransforme
 *      le message du Service Worker en événement DOM (éviction sous pression du quota).
 *   2. `capabilities/offline/cache/cache-manager.ts` — `_enforceCacheQuota()`, **in-core et
 *      hors de tout worker** (éviction sur budget `maxCacheBytes`), donc **aussi hors PWA**.
 *
 * Les deux dispatchent le MÊME nom sur le MÊME `document` : un écouteur unique les couvre.
 * 🛑 **Ne pas en ajouter un second** — c'est le nombre d'écouteurs qui était à zéro, pas le
 * nombre d'émetteurs qui est à corriger.
 *
 * ## ⚠️ POURQUOI LE CÂBLAGE N'EST PAS DANS `_wireEvictionBridge()`
 *
 * Ce pont n'est appelé qu'**après** `navigator.serviceWorker.register()` — « jamais sur une
 * page qui n'a pas de worker », dit son propre commentaire. Y poser l'écouteur le rendrait
 * aveugle à l'émetteur n° 2, précisément le chemin hors-PWA. Le câblage doit donc être sur un
 * chemin **inconditionnel** : il l'est, via `setupStorage()` (B8).
 *
 * ## ⚠️ POURQUOI `notifyPrimitive` ET NON `GeoLeaf.UI.notify`
 *
 * Les deux surfaces ne dégradent PAS de la même façon quand `toast-renderer` est absent ou
 * coupé — et une seule des deux convient ici :
 *
 *   · `GeoLeaf.UI.notify.*` lit `_UINotifications` en `?.` → **no-op silencieux** ;
 *   · `notifyPrimitive.notify()` porte un `_consoleFallback` → **`console.warn`**.
 *
 * Passer par la surface riche reproduirait le silence que ce fichier corrige. Avec la
 * primitive, un profil qui coupe le renderer perd le toast mais **pas le signal** : le
 * message est perdu bruyamment, jamais en silence.
 *
 * © 2026 Mattieu Pottier
 * Licensed under the MIT License
 * SPDX-License-Identifier: MIT
 */

import type { GeoLeafCacheEvictedDetail } from "../../contracts/event-bus.contract.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { formatFileSize } from "../../utils/general/formatters.js";
import { notifyPrimitive } from "../../utils/notify/notify.primitive.js";

/**
 * L'écouteur posé ? `setupStorage()` est re-callable (il est lié au cycle de vie du module
 * `shared`), donc un second appel ne doit pas empiler un second écouteur — ce qui doublerait
 * l'avis affiché. Drapeau au niveau MODULE, comme celui du pont d'éviction.
 */
let _evictionNoticeWired = false;

/**
 * Rend l'avis d'éviction visible sur TOUTES les variantes, `deploy-core` comprise.
 *
 * 🛑 Sortie en tête si rien n'a été évincé. `_enforceCacheQuota()` n'émet que lorsque des
 * enregistrements SONT retirés, mais un détail à zéro reste possible ; une notification
 * « 0 entrée retirée » apprend à l'utilisateur à ne plus les lire.
 *
 * ⚠️ **LES DEUX PRODUCTEURS NE PORTENT PAS LE MÊME DÉTAIL**, et c'est ce qui gouverne le garde
 * ci-dessous :
 *   · IndexedDB (`_enforceCacheQuota` → `db/eviction.ts`) — détail complet, `freedBytes`
 *     renseigné, comptes exprimés en OCTETS ;
 *   · Cache API (le Service Worker, relayé par `sw-register.ts`) — **pas de `freedBytes`** :
 *     la Cache API n'expose la taille d'aucune entrée, et `totalBefore` / `totalAfter` y
 *     comptent des ENTRÉES, pas des octets.
 *
 * Fabriquer un nombre pour homogénéiser les deux producteurs afficherait une quantité fausse ;
 * l'avis se prononce donc sans taille quand elle manque.
 *
 * 🛑 **LE GARDE PORTE SUR LE NOMBRE BRUT, PAS SUR LA CHAÎNE FORMATÉE — et c'est un correctif,
 * pas une transposition.** L'écouteur d'origine (`offline-ui`) testait `formatFileSize(...)`,
 * en s'appuyant sur un commentaire qui affirmait qu'il « rend `""` » quand la mesure manque.
 * **C'était vrai du proxy du plugin seulement lorsque le seam du core est ABSENT** ; dès que
 * le core répond, `formatFileSize(undefined)` rend `"0 B"` — une chaîne **truthy**. Le chemin
 * Cache API affichait donc « (0 B) » à chaque éviction du worker. Garder sur le nombre supprime
 * la classe entière.
 */
function _onEvicted(event: Event): void {
    const detail = (event as CustomEvent<GeoLeafCacheEvictedDetail>).detail ?? {};

    const count = typeof detail.evicted === "number" ? detail.evicted : 0;
    if (count <= 0) return;

    const freedBytes = detail.freedBytes;
    const freed =
        typeof freedBytes === "number" && freedBytes > 0 ? formatFileSize(freedBytes) : "";

    // `{0}` et non `{count}` : `getLabel()` interpole positionnellement. `offline-ui` porte la
    // même clé en `{count}` parce qu'il fait un `.replace()` manuel — ce n'est pas la
    // convention du moteur, et recopier sa graphie afficherait « {count} » à l'écran.
    const base = getLabel("storage.notif.cacheEvicted", String(count));

    notifyPrimitive.notify(freed ? `${base} (${freed})` : base, "warning");
}

/**
 * Câble l'unique écouteur in-core de `geoleaf:cache:evicted`.
 *
 * Appelée par `setupStorage()` (B8) — un chemin de boot **inconditionnel**, volontairement
 * indépendant de l'enregistrement du Service Worker (voir l'en-tête du fichier). Idempotente.
 */
export function wireEvictionNotice(): void {
    if (_evictionNoticeWired) return;
    if (typeof document === "undefined") return;
    _evictionNoticeWired = true;

    document.addEventListener("geoleaf:cache:evicted", _onEvicted);
}

/**
 * Retire l'écouteur posé par {@link wireEvictionNotice}.
 *
 * ⚠️ **Exportée pour le harnais de test**, qui doit pouvoir re-câbler entre deux cas sans
 * empiler d'écouteurs — le drapeau module rendrait sinon tout second `wireEvictionNotice()`
 * inopérant, et un test vert n'éprouverait rien.
 */
export function unwireEvictionNotice(): void {
    if (!_evictionNoticeWired) return;
    _evictionNoticeWired = false;

    document.removeEventListener("geoleaf:cache:evicted", _onEvicted);
}

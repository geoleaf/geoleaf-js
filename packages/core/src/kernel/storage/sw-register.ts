/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file sw-register.ts
 * @description Enregistrement du Service Worker — un seul geste, `register()`.
 *
 * ⚠️ CET EN-TÊTE DÉCRIVAIT TROIS FICTIONS, corrigées à la tâche 3.13 :
 *   · « Handles SW lifecycle: register, update, unregister » — `update()` et
 *     `unregister()` n'avaient aucun appelant de production et sont retirés ; la
 *     désinscription réelle est faite par `capabilities/pwa/lifecycle.ts`
 *     (`_unregisterAll`), qui itère `getRegistrations()` sans lire `_registration` ;
 *   · « The plugin SW (sw.js) replaces it » — il n'existe pas de `sw.js` dans ce dépôt ;
 *   · « storage.enableServiceWorker = true in the profile » — cette clé n'est posée par
 *     AUCUN profil, et elle est retirée par la même tâche.
 *
 * Il reste : `sw-core.js` est enregistré au démarrage par la capacité `pwa`, un point.
 *
 * © 2026 Mattieu Pottier
 * Licensed under the MIT License
 * SPDX-License-Identifier: MIT
 */
"use strict";

import type { GeoLeafCacheEvictedDetail } from "../../contracts/event-bus.contract.js";
import { Log } from "../../utils/log/index.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";

/**
 * Le pont posé ? Un second `register()` ne doit pas empiler un second écouteur.
 *
 * ⚠️ Le drapeau est au niveau MODULE et non sur `SWRegister` : `register()` peut être rappelé
 * (re-boot, changement de scope) et `navigator.serviceWorker` est un singleton du document —
 * deux écouteurs feraient deux toasts pour une seule éviction.
 */
let _evictionBridgeWired = false;

/**
 * Rétablit sur `document` les signaux que le Service Worker ne peut pas émettre lui-même.
 *
 * 🛑 POURQUOI CE PONT EXISTE. Un worker n'a pas de `document` : il ne peut pas dispatcher
 * `geoleaf:cache:evicted`. Il ne peut pas non plus importer le bus — il est copié tel quel
 * dans chaque variante de déploiement, sans bundler. Il poste donc un message, et ce fichier
 * est le SEUL endroit qui le retransforme en événement. Sans lui, une éviction sous pression
 * du quota d'origine — le moment précis où l'utilisateur a besoin de savoir que la place
 * manque — resterait invisible, dans la console d'un worker que personne n'ouvre.
 *
 * Côté page il n'y a ensuite plus rien à écrire : `offline-ui` écoute déjà
 * `geoleaf:cache:evicted` pour l'éviction IndexedDB, et affiche le même avis.
 *
 * ⚠️ Le contrôle de `type` n'est pas décoratif. `navigator.serviceWorker` reçoit les messages
 * de TOUT worker du scope ; re-dispatcher sans discriminer ferait de n'importe quel message un
 * signal d'éviction.
 */
function _wireEvictionBridge(): void {
    if (_evictionBridgeWired) return;
    _evictionBridgeWired = true;

    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; detail?: GeoLeafCacheEvictedDetail } | null;
        if (!data || data.type !== "GEOLEAF_CACHE_EVICTED") return;

        const detail = data.detail;
        // Un détail à zéro reste possible ; `offline-ui` sort déjà en tête dessus, mais émettre
        // un signal vide apprendrait à ses futurs écouteurs à se méfier du signal.
        if (!detail || typeof detail.evicted !== "number" || detail.evicted <= 0) return;

        Log.info(
            `[SWRegister] Cache de tuiles évincé par le worker (${detail.reason}) : ` +
                `${detail.evicted} entrée(s).`
        );
        dispatchGeoLeafEvent("geoleaf:cache:evicted", detail);
    });
}

/**
 * Service Worker registration helper.
 *
 * 🛑 IL N'EST PAS SUR LE NAMESPACE, et son `@example` prétendait le contraire. `@namespace
 * GeoLeaf._SWRegister` et `await GeoLeaf._SWRegister.register()` décrivaient un membre que
 * **rien ne montait** : la seule affectation de `GeoLeaf._SWRegister` dans tout le dépôt est
 * dans un harnais de test. L'exemple était copiable-collable et faux — la gate
 * `typecheck-docs-examples` l'a fait rougir dès que la déclaration fantôme est tombée de
 * `global.d.ts`.
 *
 * Le seul appelant réel est `capabilities/pwa/lifecycle.ts`, par import.
 *
 * @example
 * import { SWRegister } from "./kernel/storage/index.js";
 * await SWRegister.register({ scope: "./" });
 */
const SWRegister = {
    /** @type {ServiceWorkerRegistration|null} */
    _registration: null as ServiceWorkerRegistration | null,

    /** Chemin du script de worker. Un seul existe dans ce dépôt : `sw-core.js`. */
    _swPath: "sw-core.js",

    /**
     * Register the Service Worker.
     * No-op in environments that don't support Service Workers.
     *
     * @param {Object}  [options]
     * @param {string}  [options.path="sw-core.js"] - Chemin du script. ⚠️ Ce paramètre
     *                  n'a aucun appelant qui le renseigne : il documentait un second worker
     *                  (`sw.js`) qui n'a jamais existé dans ce dépôt.
     * @param {string}  [options.scope="/"]     - SW scope
     * @returns {Promise<ServiceWorkerRegistration|null>}
     * @example
     * const reg = await SWRegister.register({ scope: "./" });
     */
    async register(options: { path?: string; scope?: string } = {}) {
        if (!("serviceWorker" in navigator)) {
            Log.warn("[SWRegister] Service Workers not supported in this browser.");
            return null;
        }

        const swPath = options.path || this._swPath;
        const scope = options.scope || "/";

        try {
            const registration = await navigator.serviceWorker.register(swPath, { scope });
            this._registration = registration;

            Log.info(`[SWRegister] Service Worker registered (scope: ${registration.scope})`);

            // Le pont d'éviction (tâche 1.4). Posé APRÈS l'enregistrement, donc jamais sur une
            // page qui n'a pas de worker — et une seule fois, quel que soit le nombre d'appels.
            _wireEvictionBridge();

            // Listen for updates
            registration.addEventListener("updatefound", () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "activated") {
                            Log.info("[SWRegister] New Service Worker activated.");
                            dispatchGeoLeafEvent("geoleaf:sw:updated", {});
                        }
                    });
                }
            });

            return registration;
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            Log.error(`[SWRegister] Registration failed: ${detail}`);
            throw error;
        }
    },

    // ⚠️ `update()`, `unregister()` et `getRegistration()` ont été RETIRÉS à la tâche 3.13,
    // et la mesure vaut d'être écrite : aucun des trois n'avait d'appelant de production.
    //
    // 🛑 CE QUI REND LA SUPPRESSION SÛRE plutôt que optimiste : la désinscription RÉELLE ne
    // passait pas par ici. `capabilities/pwa/lifecycle.ts` (`_unregisterAll`) itère
    // `navigator.serviceWorker.getRegistrations()` et désinscrit tout, sans jamais lire
    // `_registration`. Il y avait donc deux chemins de désinscription, dont un seul
    // s'exécutait — et celui qui restait ne dépendait en rien de celui qu'on retire.
    //
    // `_registration` reste renseigné par `register()` : il porte l'écoute de mise à jour.
};

export { SWRegister };

/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier — MIT License
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Runtime seam to the POI offline sync handler (S14 Phase B).
 *
 * Before B2 the offline `sync-manager` imported addpoi's `POISyncHandler` through a
 * build-time Rollup path rewrite (`../poi/sync-handler.js` → plugin-addpoi). That coupling
 * cannot survive the engine moving in-core (B3, `no-plugin-in-core`). Instead, addpoi now
 * **registers** its handler on the in-core `GeoLeaf.Sync` seam
 * (`registerHandler("poi", POISyncHandler)`), and consumers read it back here at call time.
 *
 * 🛑 **La forme du handler N'EST PLUS déclarée ici** (tâche 4.9). Elle l'était, et son jumeau
 * du core (`kernel/shared/sync-handler-seam.ts`) la déclarait aussi : deux déclarations d'un
 * même contrat, qui ont **menti de concert** sur `restoreBackup(backupId: string)` alors que
 * `sync_backups` est un store `autoIncrement`. Le typecheck sortait vert des deux côtés pour
 * un appel qui ne trouvait jamais rien — c'est le mode d'échec propre au doublon : les deux
 * copies ne divergent pas bruyamment, elles s'accordent et se trompent ensemble.
 *
 * ⚠️ **Le relevé ci-dessus décrit correctement l'état du 02/08 et n'est pas réécrit** — c'est
 * ce qui lui donne sa valeur. Mais son sujet n'existe plus : `restoreBackup` et le magasin
 * `sync_backups` sont retirés à la tâche 4.11, avec toute la chaîne de sauvegarde.
 *
 * L'import est `type`-only, par le subpath publié sans condition `import` : il est **effacé au
 * build**, ce paquet ne gagne aucune dépendance runtime sur le core, et le bundle ne bouge pas.
 */
import type { SyncHandler } from "@geoleaf/core/contracts/sync.contract.js";

interface GeoLeafSyncGlobal {
    GeoLeaf?: { Sync?: { getHandler?(id: string): SyncHandler | undefined } };
}

/**
 * Runtime accessor for the POI offline sync handler registered by addpoi.
 * @returns the handler, or `undefined` when addpoi is not loaded.
 */
export function getPoiSyncHandler(): SyncHandler | undefined {
    const g = globalThis as unknown as GeoLeafSyncGlobal;
    return g.GeoLeaf?.Sync?.getHandler?.("poi");
}

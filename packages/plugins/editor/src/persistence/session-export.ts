/*!
 * @geoleaf-plugins/editor — Session GeoJSON export
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Suit les entités **créées pendant la session de navigation courante** et les exporte en
 * GeoJSON. Absorbé d'`addpoi/src/session-export.ts` (tâche 5.1-e).
 *
 * ⚠️ **« Session » veut dire : jusqu'au rechargement.** Le suivi est un `Set` en mémoire, donc
 * un F5 vide la liste. C'est le comportement de la source, conservé tel quel — mais il faut le
 * dire, parce que le mot « export » invite à croire le contraire. **Ce n'est PAS un filet de
 * sécurité** : celui-là, c'est l'export de l'outbox par `offline-ui`, qui lit IndexedDB et
 * survit au rechargement comme à une purge d'origine.
 *
 * 🛑 **CE QUI N'EST PAS ABSORBÉ, ET POURQUOI — R19.** La source portait un second geste,
 * `submitSessionToServer()`, avec son bouton de barre d'outils. Il est **inatteignable de deux
 * façons indépendantes** :
 *
 *   1. son bouton déclare `profileKey: "ui.showPoiSubmit"` avec `defaultVisible: false`, et
 *      `ui.showPoiSubmit` n'est déclaré dans **aucun schéma** alors que `ui.schema.json` est
 *      `additionalProperties: false` — l'écrire ferait échouer `validate:profiles`. Le bouton
 *      est donc **caché par défaut et ne peut pas être montré** ;
 *   2. il exige `modules.addpoi.submitEndpoint`, que **seul le profil de test** renseigne.
 *
 * Le porter aurait transporté une capacité que personne ne peut atteindre — le troisième
 * orphelin de cette absorption, après `retryPendingUploads` et `createFileInput` (5.1-d).
 */
import { Log, downloadBlob } from "@geoleaf/host-runtime";

/** Identifiants des entités créées depuis le chargement de la page. */
const _sessionIds = new Set<string>();

/** Les propriétés internes, retirées avant export. */
const _STRIP = new Set([
    "_layerConfig",
    "_popupConfig",
    "_sidepanelConfig",
    "_tooltipConfig",
    "_syncStatus",
]);

/**
 * Enregistre une entité comme créée pendant cette session.
 *
 * @param id - Identifiant de l'entité, tel que l'hôte le porte.
 */
export function trackSessionFeature(id: string): void {
    if (id) _sessionIds.add(id);
}

/**
 * Remplace un identifiant local par celui que le serveur a attribué.
 *
 * Sans cela, une entité créée hors réseau puis synchronisée **sortirait** de l'export : elle
 * serait suivie sous son identifiant local, que la couche hôte ne porte plus.
 *
 * @param oldId - Identifiant local, tel qu'il a été suivi.
 * @param newId - Identifiant serveur.
 */
export function renameSessionFeature(oldId: string, newId: string): void {
    if (!_sessionIds.has(oldId)) return;
    _sessionIds.delete(oldId);
    _sessionIds.add(newId);
}

/** @returns le nombre d'entités créées pendant cette session. */
export function sessionFeatureCount(): number {
    return _sessionIds.size;
}

/** Vide le suivi — utilisé au démontage du plugin et par les tests. */
export function resetSessionTracking(): void {
    _sessionIds.clear();
}

/** L'accès aux données de couche du core, lu à l'appel. */
interface LayerData {
    listLayerIds?(): string[];
    getFeatures?(layerId: string): unknown[];
}

function _layers(): LayerData | null {
    return (
        (Reflect.get(globalThis, "GeoLeaf") as { Layers?: LayerData } | undefined)?.Layers ?? null
    );
}

/**
 * Retire les propriétés internes d'une entité.
 *
 * @param feature - Entité telle que la couche hôte la porte.
 * @returns une copie exportable.
 */
function _strip(feature: {
    id?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
}): Record<string, unknown> {
    const src = feature.properties ?? {};
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
        if (!_STRIP.has(k)) properties[k] = v;
    }
    return { type: "Feature", id: feature.id, geometry: feature.geometry, properties };
}

/**
 * Rassemble les entités de la session depuis leurs couches hôtes.
 *
 * @returns les entités suivies, nettoyées de leurs propriétés internes.
 */
export function collectSessionFeatures(): Record<string, unknown>[] {
    const layers = _layers();
    if (!layers?.listLayerIds || !layers.getFeatures) return [];
    const out: Record<string, unknown>[] = [];
    for (const layerId of layers.listLayerIds()) {
        let features: unknown[];
        try {
            features = layers.getFeatures(layerId) ?? [];
        } catch (e) {
            // Une couche déclarée mais jamais chargée jette ; elle ne doit pas aveugler
            // l'export sur les autres — même garde que `drawing/poi-snap.ts`.
            Log?.debug?.("[editor/session-export] Layer unreadable, skipped:", layerId, e);
            continue;
        }
        for (const raw of features) {
            const f = raw as { id?: unknown; properties?: Record<string, unknown> | null };
            const rawId = f.id ?? f.properties?.id;
            if (rawId === undefined || rawId === null) continue;
            if (!_sessionIds.has(String(rawId))) continue;
            out.push(_strip(f as Parameters<typeof _strip>[0]));
        }
    }
    return out;
}

/** Date du jour au format `AAAA-MM-JJ`, pour le nom de fichier. */
function _today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Télécharge un GeoJSON des entités créées pendant cette session.
 *
 * ⚠️ `downloadBlob` de `@geoleaf/host-runtime` plutôt qu'une fabrique d'ancre locale : la
 * source en portait une copie de 12 lignes (`_download`), alors que le seam existait déjà.
 *
 * @returns le nombre d'entités exportées — `0` quand il n'y a rien à exporter.
 */
export async function exportSessionFeatures(): Promise<number> {
    const features = collectSessionFeatures();
    if (!features.length) return 0;
    const json = JSON.stringify({ type: "FeatureCollection", features }, null, 2);
    const blob = new Blob([json], { type: "application/geo+json" });
    await downloadBlob(blob, `geoleaf-session-${_today()}.geojson`);
    return features.length;
}

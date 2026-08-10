/*!
 * GeoLeaf Storage — Estimation d'une zone vecteur
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Estimation avant téléchargement d'une zone vecteur : nombre de tuiles et poids.
 *
 *
 * ## Pourquoi ce code vit ICI depuis l'API publique S4.4
 *
 * Il était dans `@geoleaf/core` (`capabilities/offline/cache/tile-math.ts`), et storage
 * l'atteignait par un alias `@core-offline/*` vers les SOURCES du core — ce qui interdisait à
 * storage de porter un `rootDir`, donc de publier ses types.
 *
 * Le repointer vers le sous-chemin publié `@geoleaf/core/capabilities/offline/cache/tile-math.js`
 * **ne marche pas**, et la raison mérite d'être écrite : le fichier est bien publié, mais le
 * SYMBOLE n'y est pas. Le build du core élague `estimateVectorZone` de son propre artefact —
 * mesuré, `dist/esm/.../tile-math.js` n'exporte que `latLngToTile` — parce qu'AUCUN code du
 * core ne l'appelle. Un sous-chemin publié ne garantit que le fichier ; son contenu dépend du
 * tree-shaking du paquet qui l'émet.
 *
 * C'était donc du code MORT côté core (0 appelant, absent du bundle) et vivant côté storage.
 * Il a été déplacé, pas recopié : le core n'en garde pas de version orpheline.
 *
 * `latLngToTile` reste au core — il y sert à 4 endroits, survit au build, et est importé ici
 * par le sous-chemin publié. La géométrie de tuiles est une affaire du core ; l'heuristique
 * d'octets par tuile est une affaire de storage.
 */

import { latLngToTile } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";
import type { Bounds, VectorZone } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";

/** Coupure de latitude Web Mercator. */
const WEB_MERCATOR_MAX_LAT = 85.0511;

/** Poids gzip moyen d'une tuile vecteur (.pbf), pour l'estimation de zone. */
const AVG_PBF_BYTES = 30 * 1024;

/** Forfait glyphes + sprites, récupéré une fois par zone quel que soit le nombre de tuiles. */
const GLYPH_SPRITE_OVERHEAD = 800 * 1024;

/**
 * Compte les tuiles couvrant `bounds` à `zoom`.
 *
 * ⚠️ Compte arithmétiquement, sans énumérer les coordonnées : l'ancienne voie passait par
 * `getTileCoordsForBounds`, qui rend une liste VIDE au-delà de son plafond de sécurité de
 * 30 000 tuiles par zoom. Tout zoom dépassant ce plafond contribuait donc 0 au total.
 *
 * @param bounds - Zone à couvrir. Des bornes absentes ou invalides rendent 0.
 * @param zoom - Niveau de zoom.
 * @param maxLat - Coupure de latitude, transmise à `latLngToTile`.
 */
function countTilesForBounds(
    bounds: Bounds | null | undefined,
    zoom: number,
    maxLat: number = WEB_MERCATOR_MAX_LAT
): number {
    if (!bounds || bounds.north <= bounds.south || bounds.east <= bounds.west) {
        return 0;
    }
    const minTile = latLngToTile(bounds.south, bounds.west, zoom, maxLat);
    const maxTile = latLngToTile(bounds.north, bounds.east, zoom, maxLat);
    return (Math.abs(maxTile.x - minTile.x) + 1) * (Math.abs(minTile.y - maxTile.y) + 1);
}

/**
 * Estimation grossière avant téléchargement : nombre de tuiles sur la plage de zooms, plus le
 * poids gzip total (tuiles + forfait glyphes/sprites).
 *
 * ⚠️ CAPACITÉS S1 a corrigé ici une SOUS-estimation silencieuse : une zone de 2°×2° au zoom 15
 * (~33 k tuiles) franchissait déjà le plafond de l'ancienne implémentation et comptait 0.
 *
 * @param zone - Zone et plage de zooms à estimer.
 * @returns `{ tiles, bytes }` — nombre de tuiles et taille estimée.
 */
export function estimateVectorZone(zone: VectorZone): { tiles: number; bytes: number } {
    let tiles = 0;
    for (let z = zone.cacheMinZoom; z <= zone.cacheMaxZoom; z++) {
        tiles += countTilesForBounds(zone.bounds, z);
    }
    return { tiles, bytes: tiles * AVG_PBF_BYTES + GLYPH_SPRITE_OVERHEAD };
}

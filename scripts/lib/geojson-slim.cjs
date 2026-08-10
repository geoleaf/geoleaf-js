"use strict";
/**
 * geojson-slim.cjs — allège un GeoJSON au moment du DÉPLOIEMENT, sans toucher à la source.
 *
 * ## Ce que la mesure a dit, et que l'énoncé du sprint ne disait pas
 *
 * La tâche 4.1 de `roadmap_socle-init` demandait de « simplifier les géométries
 * (Douglas-Peucker) » des trois couches lourdes, en annonçant « −60 à −80 % ». Les deux
 * moitiés de cette phrase ont été prises en défaut par le pré-vol du 07/08/2026 :
 *
 * **① Le levier dominant n'est PAS le nombre de sommets, c'est la PRÉCISION.** Les trois
 * fichiers portent jusqu'à **15 décimales** (moyenne 9,6 sur `aires_protegees_nationales_sib`),
 * soit l'échelle du nanomètre pour une carte web. Arrondir à 5 décimales — **≈1,1 m au sol**,
 * trois ordres de grandeur sous le pixel à n'importe quel zoom livré — retire **26,9 %** à lui
 * seul, sans supprimer un seul sommet.
 *
 * **② Le « −60 à −80 % » n'est atteignable à aucune tolérance raisonnable.** Mesuré sur ces
 * fichiers précis, arrondi compris : −29,1 % à 6 m, −30,0 % à 11 m, −38,7 % à 22 m, et
 * **−52,5 % seulement à 56 m** — une tolérance à laquelle les contours côtiers se voient
 * perdre du détail. Le chiffre annoncé était l'attente usuelle de l'algorithme sur des données
 * brutes, pas une mesure sur celles-ci.
 *
 * Le réglage retenu — **5 décimales + 11 m** — est le point où la courbe s'aplatit : passer à
 * 22 m rapporte 8 points de plus et commence à se voir.
 *
 * ## ⚠️ Ce que ce module ne fait PAS, et qu'il faut savoir avant d'élever la tolérance
 *
 * La simplification est **par géométrie, sans topologie partagée**. Deux polygones adjacents
 * (deux aires protégées mitoyennes) sont simplifiés indépendamment, donc leur frontière
 * commune peut diverger et ouvrir une fente. À 11 m cette fente est sous le pixel à tous les
 * zooms livrés — c'est ce qui rend le réglage sûr, pas une propriété de l'algorithme. **Au-delà,
 * il faut un simplificateur TOPOLOGIQUE** (`mapshaper -simplify`), pas une tolérance plus haute
 * ici. Ne pas monter ce nombre sans changer d'outil.
 *
 * @module scripts/lib/geojson-slim
 */

/**
 * Distance perpendiculaire d'un point au segment [a, b], en degrés.
 *
 * ⚠️ Le calcul est PLANAIRE, sur des degrés bruts. C'est légitime ici et seulement ici :
 * la tolérance sert de seuil de rejet, pas de mesure métrique publiée, et l'erreur d'un
 * planaire en longitude (cos φ) ne fait que rendre le filtre plus CONSERVATEUR loin de
 * l'équateur — il retire moins, jamais plus. Un jour où ce module servirait à mesurer, et
 * non à filtrer, ce raccourci ne tiendrait plus.
 *
 * @param {number[]} p
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function perpendicularDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer–Douglas–Peucker, **itératif**.
 *
 * ⚠️ La forme récursive naturelle empile un cadre par sommet retenu dans le pire cas. Une
 * couche de ce dépôt porte 46 941 sommets et une seule `LineString` peut en concentrer
 * plusieurs milliers : la version récursive dépasse la pile sur les données réelles, pas sur
 * un cas limite théorique. La pile explicite ci-dessous n'est pas une préférence de style.
 *
 * @param {number[][]} points
 * @param {number} epsilon Tolérance en degrés.
 * @returns {number[][]} Sous-ensemble des points d'entrée, extrémités toujours conservées.
 */
function simplifyPath(points, epsilon) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop();
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i++) {
            const d = perpendicularDistance(points[i], points[first], points[last]);
            if (d > maxDist) {
                maxDist = d;
                index = i;
            }
        }
        if (index !== -1 && maxDist > epsilon) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
}

/**
 * Arrondit toutes les coordonnées d'une géométrie imbriquée.
 *
 * `Number(v.toFixed(d))` plutôt qu'un `Math.round(v * 10**d) / 10**d` : le second garde des
 * traînées binaires (`-53.60000000000001`) qui repartent en JSON à leur longueur d'origine,
 * donc ne font économiser aucun octet — ce qui est tout l'objet de l'opération.
 *
 * @param {unknown} coords
 * @param {number} decimals
 * @returns {unknown}
 */
function roundCoords(coords, decimals) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
        return coords.map((v) => (typeof v === "number" ? Number(v.toFixed(decimals)) : v));
    }
    return coords.map((c) => roundCoords(c, decimals));
}

/**
 * Simplifie une géométrie imbriquée, en respectant les invariants de chaque type.
 *
 * 🛑 DEUX INVARIANTS QU'UN RDP NU CASSE, ET QUI NE SE VOIENT PAS À L'ŒIL DANS LE JSON :
 *
 *   • **Un anneau doit rester FERMÉ** — premier sommet identique au dernier. RDP conserve
 *     toujours les extrémités, donc la fermeture survit ; c'est vrai par construction et non
 *     par précaution, mais ça cesserait de l'être si on changeait d'algorithme.
 *   • **Un anneau a besoin d'au moins 4 positions** (3 distinctes + la fermeture). En dessous,
 *     le polygone est dégénéré : MapLibre ne le dessine pas et ne dit rien. On garde alors
 *     l'anneau d'ORIGINE plutôt que d'émettre une géométrie invalide — perdre l'économie sur
 *     une poignée d'anneaux minuscules coûte moins qu'une forme qui disparaît en silence.
 *
 * @param {unknown} coords
 * @param {number} epsilon
 * @param {boolean} isRing True dès qu'on descend dans un (Multi)Polygon.
 * @returns {unknown}
 */
function simplifyCoords(coords, epsilon, isRing) {
    if (!Array.isArray(coords) || coords.length === 0) return coords;
    if (typeof coords[0][0] === "number") {
        const simplified = simplifyPath(/** @type {number[][]} */ (coords), epsilon);
        const floor = isRing ? 4 : 2;
        return simplified.length >= floor ? simplified : coords;
    }
    return coords.map((c) => simplifyCoords(c, epsilon, isRing));
}

/**
 * Allège un document GeoJSON : simplification puis arrondi, dans cet ordre.
 *
 * ⚠️ **L'ordre n'est pas indifférent.** Arrondir d'abord crée des sommets colinéaires exacts
 * que RDP retire ensuite — le résultat serait le même en taille, mais la tolérance ne
 * porterait plus sur la géométrie SOURCE, donc le seuil de 11 m ne voudrait plus dire 11 m.
 * On simplifie sur la donnée d'origine, puis on arrondit ce qui reste.
 *
 * Les entités sans géométrie (`null`, `GeometryCollection` vide) traversent intactes : un
 * GeoJSON valide peut en porter, et les écarter changerait le décompte d'entités.
 *
 * @param {Buffer|string} input Le document source.
 * @param {object} opts
 * @param {number} opts.decimals Décimales conservées (5 ≈ 1,1 m).
 * @param {number} opts.toleranceDeg Tolérance RDP en degrés (0 pour n'arrondir que).
 * @returns {{ json: string, verticesBefore: number, verticesAfter: number }}
 * @throws {SyntaxError} Si l'entrée n'est pas du JSON — remonté tel quel, un fichier de
 *   données illisible doit faire échouer le build, pas être copié en silence.
 */
function slimGeoJSON(input, { decimals, toleranceDeg }) {
    const doc = JSON.parse(typeof input === "string" ? input : input.toString("utf-8"));
    let verticesBefore = 0;
    let verticesAfter = 0;
    const count = (c) => {
        if (!Array.isArray(c) || c.length === 0) return 0;
        if (typeof c[0] === "number") return 1;
        let n = 0;
        for (const x of c) n += count(x);
        return n;
    };

    const geometries = [];
    const collect = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
            node.features.forEach(collect);
        } else if (node.type === "Feature") {
            collect(node.geometry);
        } else if (node.type === "GeometryCollection" && Array.isArray(node.geometries)) {
            node.geometries.forEach(collect);
        } else if (node.coordinates) {
            geometries.push(node);
        }
    };
    collect(doc);

    for (const geom of geometries) {
        verticesBefore += count(geom.coordinates);
        const isRing = /Polygon$/.test(String(geom.type));
        // Un (Multi)Point n'a pas de chemin à simplifier — RDP y serait sans objet, et
        // `simplifyCoords` le laisserait passer, mais l'écarter ici évite un parcours inutile
        // sur les couches de POI, qui sont les plus nombreuses en features.
        if (toleranceDeg > 0 && !/Point$/.test(String(geom.type))) {
            geom.coordinates = simplifyCoords(geom.coordinates, toleranceDeg, isRing);
        }
        geom.coordinates = roundCoords(geom.coordinates, decimals);
        verticesAfter += count(geom.coordinates);
    }

    return { json: JSON.stringify(doc), verticesBefore, verticesAfter };
}

module.exports = { slimGeoJSON, simplifyPath, roundCoords };

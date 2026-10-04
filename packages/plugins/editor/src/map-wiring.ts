/*!
 * @geoleaf-plugins/editor — wiring, once per map
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Decides WHEN the editor wires itself: once per engine map.
 *
 * The editor starts on `geoleaf:map:ready`, which it listens to for the life of the page — an
 * application unmounted and mounted again (`GeoLeaf.mount()`) boots a second time on a second
 * map, and the editor must come back on it. That signal says « a map is ready », not « a NEW
 * map is ready »: the core emits it several times per boot, and again after a theme refits the
 * view. A wiring replayed on each of them built the form twice and registered the sync handler
 * twice; a wiring done once for ever (`{ once: true }`) kept drawing on the map that had gone.
 *
 * The map's identity is what tells the cases apart:
 *
 * - never wired → wire, even without a map: the menu and its listeners do not need one, and
 *   the drawing engine reads the map on first use;
 * - wired on THIS map → nothing. This is also what keeps `GeoLeaf.Editor.destroy()` a decision
 *   of the host: a later signal on the same map does not bring the editor back;
 * - wired on ANOTHER map → take down what is left of the previous wiring (nothing, when the
 *   application teardown already ran), then wire on the new one;
 * - wired, and no map → nothing: the application is unmounted, a late signal of the previous
 *   one must not rebuild the editor in a page without a map.
 */

/** What {@link wireOncePerMap} drives. */
interface MapWiring {
    /** The engine map alive now, or `null`. */
    getMap: () => unknown;
    /** Wires the editor on the map alive now. */
    wire: () => void;
    /** Takes the previous wiring down. Must tolerate one already taken down. */
    unwire: () => void;
}

/**
 * Builds the handler of `geoleaf:map:ready`: it wires the editor once per engine map.
 *
 * @param wiring - How to read the map, wire and unwire.
 * @returns The handler — call it on every `geoleaf:map:ready`, and once at load when a map
 *   already exists.
 */
export function wireOncePerMap(wiring: MapWiring): () => void {
    let wired = false;
    let wiredFor: unknown = null;
    return () => {
        const map = wiring.getMap() ?? null;
        if (wired) {
            if (map === null || map === wiredFor) return;
            wiring.unwire();
        }
        wired = true;
        wiredFor = map;
        wiring.wire();
    };
}

// Généré par scripts/build-deploy.cjs — ne pas éditer.
// MapLibre 6 est ESM-only et ne publie plus de global ; GeoLeaf le lit sur
// `globalThis.maplibregl`. Ces deux lignes sont ce qui relie les deux.
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;

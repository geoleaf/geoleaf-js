/*!
 * @geoleaf-plugins/measure — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): shapes the object mounted on `GeoLeaf.Measure` by `entry.ts`
 * and forwards every member to `measure-api.ts`, where the implementation lives.
 * https://geoleaf.dev
 */
import {
    startMeasure,
    stopMeasure,
    clearAll,
    getCollection,
    exportGeoJSON,
    setUnits,
    getUnits,
    getPrintableAnnotations,
    registerMeasureType,
} from "./measure-api.js";

export { openMeasureMenu } from "./measure-api.js";

/** @internal Returns all public API functions as an object. */
export function buildPublicApi() {
    return {
        startMeasure,
        stopMeasure,
        clearAll,
        getCollection,
        exportGeoJSON,
        setUnits,
        getUnits,
        getPrintableAnnotations,
        registerMeasureType,
    };
}
